import { Router  } from "express";
import sql from "mssql";

/**
 * Route CMDB : importe les CIs EasyVista (AM_ASSET + CONFIGURATION_ITEM_LINK)
 * depuis la base EVO_DATA et les stocke comme graphe dans la base cible (dev-11).
 *
 * POST /api/cmdb/import
 * Body: { limit?: number }   — nombre max de CIs à importer (défaut 800)
 */
export function cmdbRoutes(
  /** MSSQL connection config — même serveur, juste la base change */
  mssqlConfig: {
    host: string;
    port: number;
    user: string;
    password: string;
  },
  /** Fonction createGraph du MssqlService pour écrire dans dev-11 */
  createGraphFn: (
    graphId: string,
    title: string,
    description: string,
    graphType: string,
    nodes: Array<{ id: string; label: string; node_type: string; properties: Record<string, any> }>,
    edges: Array<{ source: string; target: string; label: string; edge_type: string; properties: Record<string, any> }>,
    database?: string,
  ) => Promise<any>,
  broadcast?: (msg: Record<string, any>) => void,
) {
  const router = Router();

  // Nom de la base EasyVista (table EVO_DATA)
  const EVO_DATA_DB = "devenv_dev_ded_033_EVO_DATA40000";
  const EVO_SCHEMA = "40000";

  // ── DATA_VALEO database ──
  const DATA_VALEO_DB = "DATA_VALEO";
  const DATA_VALEO_SCHEMA = "50004";

  router.post("/import", async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 800, 5000);
    const targetDatabase = (req.query.database as string) || "dev-11";
    const t0 = Date.now();

    try {
      // ── 1. Connexion à la base EVO_DATA ──
      const pool = new sql.ConnectionPool({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        database: EVO_DATA_DB,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 15_000,
        requestTimeout: 60_000,
      });
      await pool.connect();

      // ── 2. Charger les CIs (nœuds) — requête EasyVista avec ROW_NUMBER ──
      const ciResult = await pool.request().query(`
        SELECT * FROM (
          SELECT 
            ROW_NUMBER() OVER (ORDER BY DUMMY) RN, 
            SMO.* 
          FROM (SELECT 1 DUMMY) A,
          (
            SELECT TOP (1000000000) 
              AM_ASSET.ASSET_ID                          AS asset_id,
              AM_ASSET.NETWORK_IDENTIFIER                AS nom,
              AM_ASSET.ASSET_TAG                         AS nDeCI,
              AM_UN_CLASSIFICATION.UN_CLASSIFICATION_FR  AS categorie,
              CMDB_CI_STATUS.CI_STATUS_FR                AS statutDuCI,
              AM_ASSET.CI_VERSION                        AS version,
              CASE 
                WHEN ((
                  SELECT COUNT(CMDB_UNAVAILABILITY.UNAVAILABILITY_ID)
                  FROM [${EVO_DATA_DB}].[${EVO_SCHEMA}].CMDB_UNAVAILABILITY
                  WHERE (CMDB_UNAVAILABILITY.ASSET_ID = AM_ASSET.ASSET_ID) 
                    AND (CMDB_UNAVAILABILITY.START_DATE <= GETUTCDATE()) 
                    AND ((CMDB_UNAVAILABILITY.END_DATE IS NULL) OR (CMDB_UNAVAILABILITY.END_DATE > GETUTCDATE()))
                ) > 0) THEN 'Indisponible'
                ELSE 'Disponible'
              END AS disponibilite,
              AM_ASSET.E_COST                            AS cout,
              AM_ASSET.IS_SERVICE                        AS estUnService
            FROM [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET

            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_LOCATION "ALIAS_DOMAIN_0" 
              ON (AM_ASSET.LOCATION_ID = "ALIAS_DOMAIN_0".LOCATION_ID)

            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_CATALOG 
              ON AM_ASSET.CATALOG_ID = AM_CATALOG.CATALOG_ID

            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_UN_CLASSIFICATION 
              ON AM_CATALOG.UN_CLASSIFICATION_ID = AM_UN_CLASSIFICATION.UN_CLASSIFICATION_ID

            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_REFERENCE 
              ON AM_UN_CLASSIFICATION.ARTICLE_TYPE_ID = AM_REFERENCE.REFERENCE_ID

            LEFT OUTER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].CMDB_CI_STATUS 
              ON AM_ASSET.CI_STATUS_ID = CMDB_CI_STATUS.CI_STATUS_ID

            WHERE (
              (AM_ASSET.IS_CI = 1)
              AND (
                (DATEADD(minute, 0, AM_ASSET.REMOVED_DATE) > (
                  SELECT CAST(FLOOR(CAST(DATEADD(minute, 0, GETUTCDATE()) AS FLOAT)) AS DATETIME)
                ))
                OR (AM_ASSET.REMOVED_DATE IS NULL)
              )
            )
            AND ("ALIAS_DOMAIN_0".LFT BETWEEN 1 AND 9999)

            ORDER BY AM_ASSET.NETWORK_IDENTIFIER ASC
          ) SMO
        ) tmp
        WHERE RN >= 1 AND RN < ${limit + 1}
      `);

      const ciRows: any[] = ciResult.recordset;

      if (ciRows.length === 0) {
        await pool.close();
        return res.status(404).json({ error: "Aucun CI trouvé dans la base EasyVista" });
      }

      // Map asset_id → node pour retrouver les IDs
      const assetIdSet = new Set(ciRows.map((r) => r.asset_id));

      // ── 3. Charger les relations entre CIs présents ──
      // On récupère aussi le libellé du type de relation
      const linkResult = await pool.request().query(`
        SELECT 
          l.PARENT_CI_ID,
          l.CHILD_CI_ID,
          l.RELATION_TYPE_ID,
          l.BLOCKING,
          r.REFERENCE_FR AS relation_label
        FROM [${EVO_DATA_DB}].[${EVO_SCHEMA}].CONFIGURATION_ITEM_LINK l
        LEFT JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_REFERENCE r
          ON r.REFERENCE_ID = l.RELATION_TYPE_ID
      `);

      await pool.close();

      // ── 4. Transformer en nœuds + arêtes pour le graph viewer ──
      const nodes = ciRows.map((ci) => ({
        id: `CI_${ci.asset_id}`,
        label: ci.nom || ci.nDeCI || `CI_${ci.asset_id}`,
        node_type: ci.categorie || "CI",
        properties: {
          asset_id: ci.asset_id,
          nom: ci.nom,
          nDeCI: ci.nDeCI,
          categorie: ci.categorie,
          statutDuCI: ci.statutDuCI,
          version: ci.version,
          disponibilite: ci.disponibilite,
          cout: ci.cout,
          estUnService: ci.estUnService,
        },
      }));

      // Filtrer les relations : garder uniquement celles dont parent ET child sont dans le set
      const edges = linkResult.recordset
        .filter((l: any) => assetIdSet.has(l.PARENT_CI_ID) && assetIdSet.has(l.CHILD_CI_ID))
        .map((l: any) => ({
          source: `CI_${l.PARENT_CI_ID}`,
          target: `CI_${l.CHILD_CI_ID}`,
          label: l.relation_label || `type_${l.RELATION_TYPE_ID}`,
          edge_type: l.relation_label || `type_${l.RELATION_TYPE_ID}`,
          properties: {
            relation_type_id: l.RELATION_TYPE_ID,
            blocking: l.BLOCKING,
          },
        }));

      // ── 5. Stocker dans la base cible (dev-11) ──
      const graphId = `cmdb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const title = `CMDB EasyVista (${nodes.length} CIs)`;
      const description = `Importé depuis ${EVO_DATA_DB} — ${nodes.length} CIs, ${edges.length} relations`;

      const graph = await createGraphFn(
        graphId,
        title,
        description,
        "cmdb",
        nodes,
        edges,
        targetDatabase,
      );

      // Broadcast WebSocket
      broadcast?.({
        type: "graph:created",
        graphId,
        title,
        engine: "mssql",
        database: targetDatabase,
      });

      const elapsed_ms = Date.now() - t0;

      res.status(201).json({
        ...graph,
        elapsed_ms,
        imported: {
          nodes: nodes.length,
          edges: edges.length,
          source: EVO_DATA_DB,
        },
      });
    } catch (error: any) {
      console.error("CMDB import error:", error);
      res.status(500).json({
        error: `Erreur d'import CMDB : ${error.message}`,
      });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /import-valeo — Import CIs depuis DATA_VALEO (schéma 50004)
  //   body: { limit?: number, mode?: "connected"|"cluster", hubs?: number }
  //   mode=connected → sélectionne les CIs les plus connectés (dense graph)
  //   mode=cluster   → top N hubs + voisins directs + edges internes (dense)
  //   mode par défaut → sélection alphabétique classique
  // ════════════════════════════════════════════════════════════════════
  router.post("/import-valeo", async (req, res) => {
    const limit = Math.min(Number(req.body?.limit) || 800, 600000);
    const mode = (req.body?.mode as string) || "default";
    const hubs = Math.min(Number(req.body?.hubs) || 10, 500);
    const targetDatabase = (req.query.database as string) || "dev-11";
    const t0 = Date.now();

    try {
      // ── 1. Connexion à la base DATA_VALEO ──
      const pool = new sql.ConnectionPool({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        database: DATA_VALEO_DB,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 30_000,
        requestTimeout: 600_000,
      });
      await pool.connect();

      let ciRows: any[];
      let clusterEdgeRows: any[] | null = null; // only used in cluster mode

      if (mode === "cluster") {
        // ── Mode cluster : top N hubs + tous leurs voisins + edges internes ──
        // Tout en un seul batch SQL pour éviter les problèmes de temp table
        console.log(`[import-valeo] Cluster mode: top ${hubs} hubs + neighbors...`);
        const clusterSql = `
          -- 1. Identifier les top hubs par degré
          ;WITH hub_degree AS (
            SELECT id, SUM(c) AS edge_count FROM (
              SELECT PARENT_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
              UNION ALL
              SELECT CHILD_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
            ) x GROUP BY id
          ),
          top_hubs AS (
            SELECT TOP (${hubs}) id, edge_count
            FROM hub_degree
            ORDER BY edge_count DESC
          ),
          -- 2. Voisins directs des hubs (union des endpoints de leurs edges)
          cluster_ids AS (
            SELECT DISTINCT node_id FROM (
              SELECT id AS node_id FROM top_hubs
              UNION
              SELECT l.CHILD_CI_ID AS node_id
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
              WHERE l.PARENT_CI_ID IN (SELECT id FROM top_hubs)
              UNION
              SELECT l.PARENT_CI_ID AS node_id
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
              WHERE l.CHILD_CI_ID IN (SELECT id FROM top_hubs)
            ) combined
          )
          -- 3. Retourner les CIs du cluster
          SELECT
            a.ASSET_ID       AS asset_id,
            a.NETWORK_IDENTIFIER AS nom,
            a.ASSET_TAG      AS nDeCI,
            a.IS_SERVICE     AS estUnService,
            a.CI_VERSION     AS version,
            ISNULL(hd.edge_count, 0) AS edge_count,
            CASE WHEN th.id IS NOT NULL THEN 1 ELSE 0 END AS is_hub
          FROM cluster_ids ci
          INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
            ON a.ASSET_ID = ci.node_id
          LEFT JOIN hub_degree hd ON hd.id = a.ASSET_ID
          LEFT JOIN top_hubs th ON th.id = a.ASSET_ID
          WHERE a.IS_CI = 1;
        `;
        const ciResult = await pool.request().query(clusterSql);
        ciRows = ciResult.recordset;
        console.log(`[import-valeo] Cluster: ${ciRows.length} CIs found`);

        // 4. Récupérer les edges internes au cluster (un seul batch)
        const assetIds = ciRows.map((r: any) => r.asset_id);
        const ID_BATCH = 1000;
        let edgeBatchSql = `CREATE TABLE #cluster_ids (asset_id INT PRIMARY KEY);\n`;
        for (let i = 0; i < assetIds.length; i += ID_BATCH) {
          const batch = assetIds.slice(i, i + ID_BATCH);
          edgeBatchSql += `INSERT INTO #cluster_ids (asset_id) VALUES ${batch.map((id: number) => `(${id})`).join(",")};\n`;
        }
        edgeBatchSql += `
          SELECT
            l.PARENT_CI_ID, l.CHILD_CI_ID, l.RELATION_TYPE_ID, l.BLOCKING,
            r.REFERENCE_FR AS relation_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
          INNER JOIN #cluster_ids p ON p.asset_id = l.PARENT_CI_ID
          INNER JOIN #cluster_ids c ON c.asset_id = l.CHILD_CI_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE r
            ON r.REFERENCE_ID = l.RELATION_TYPE_ID;
        `;
        console.log(`[import-valeo] Fetching edges for ${assetIds.length} cluster nodes...`);
        const edgeResult = await pool.request().query(edgeBatchSql);
        const rs = edgeResult.recordsets as any[];
        clusterEdgeRows = rs[rs.length - 1];
        console.log(`[import-valeo] Cluster edges: ${clusterEdgeRows!.length}`);

      } else if (mode === "connected") {
        // ── Mode connecté : CIs triés par nombre de relations (les plus denses d'abord) ──
        const ciResult = await pool.request().query(`
          SELECT TOP (${limit})
            a.ASSET_ID       AS asset_id,
            a.NETWORK_IDENTIFIER AS nom,
            a.ASSET_TAG      AS nDeCI,
            a.IS_SERVICE     AS estUnService,
            a.CI_VERSION     AS version,
            edge_cnt.edge_count
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          INNER JOIN (
            SELECT id, SUM(c) AS edge_count FROM (
              SELECT PARENT_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK
              GROUP BY PARENT_CI_ID
              UNION ALL
              SELECT CHILD_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK
              GROUP BY CHILD_CI_ID
            ) x GROUP BY id
          ) edge_cnt ON edge_cnt.id = a.ASSET_ID
          WHERE a.IS_CI = 1
          ORDER BY edge_cnt.edge_count DESC
        `);
        ciRows = ciResult.recordset;
      } else {
        // ── Mode par défaut : sélection classique avec filtre localisation ──
        const ciResult = await pool.request().query(`
          SELECT * FROM (
            SELECT 
              ROW_NUMBER() OVER (ORDER BY DUMMY) RN, 
              SMO.* 
            FROM (SELECT 1 DUMMY) A,
            (
              SELECT TOP (1000000000) 
                AM_ASSET.ASSET_ID                          AS asset_id,
                AM_ASSET.NETWORK_IDENTIFIER                AS nom,
                AM_ASSET.ASSET_TAG                         AS nDeCI,
                AM_UN_CLASSIFICATION.UN_CLASSIFICATION_FR  AS categorie,
                CMDB_CI_STATUS.CI_STATUS_FR                AS statutDuCI,
                AM_ASSET.CI_VERSION                        AS version,
                CASE 
                  WHEN ((
                    SELECT COUNT(CMDB_UNAVAILABILITY.UNAVAILABILITY_ID)
                    FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CMDB_UNAVAILABILITY
                    WHERE (CMDB_UNAVAILABILITY.ASSET_ID = AM_ASSET.ASSET_ID) 
                      AND (CMDB_UNAVAILABILITY.START_DATE <= GETUTCDATE()) 
                      AND ((CMDB_UNAVAILABILITY.END_DATE IS NULL) OR (CMDB_UNAVAILABILITY.END_DATE > GETUTCDATE()))
                  ) > 0) THEN 'Indisponible'
                  ELSE 'Disponible'
                END AS disponibilite,
                AM_ASSET.IS_SERVICE                        AS estUnService
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET

              INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_LOCATION "ALIAS_DOMAIN_0" 
                ON (AM_ASSET.LOCATION_ID = "ALIAS_DOMAIN_0".LOCATION_ID)

              INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG 
                ON AM_ASSET.CATALOG_ID = AM_CATALOG.CATALOG_ID

              INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION 
                ON AM_CATALOG.UN_CLASSIFICATION_ID = AM_UN_CLASSIFICATION.UN_CLASSIFICATION_ID

              INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE 
                ON AM_UN_CLASSIFICATION.ARTICLE_TYPE_ID = AM_REFERENCE.REFERENCE_ID

              LEFT OUTER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CMDB_CI_STATUS 
                ON AM_ASSET.CI_STATUS_ID = CMDB_CI_STATUS.CI_STATUS_ID

              WHERE (
                (AM_ASSET.IS_CI = 1)
                AND (
                  (DATEADD(minute, 0, AM_ASSET.REMOVED_DATE) > (
                    SELECT CAST(FLOOR(CAST(DATEADD(minute, 0, GETUTCDATE()) AS FLOAT)) AS DATETIME)
                  ))
                  OR (AM_ASSET.REMOVED_DATE IS NULL)
                )
              )
              AND ("ALIAS_DOMAIN_0".LFT BETWEEN 1 AND 9999)

              ORDER BY AM_ASSET.NETWORK_IDENTIFIER ASC
            ) SMO
          ) tmp
          WHERE RN >= 1 AND RN < ${limit + 1}
        `);
        ciRows = ciResult.recordset;
      }

      if (ciRows.length === 0) {
        await pool.close();
        return res.status(404).json({ error: "Aucun CI trouvé dans DATA_VALEO" });
      }

      // Map asset_id → node pour retrouver les IDs
      const assetIdSet = new Set(ciRows.map((r: any) => r.asset_id));

      let linkRows: any[];

      if (clusterEdgeRows) {
        // Cluster mode: edges already fetched
        linkRows = clusterEdgeRows;
        await pool.close();
      } else {
        // ── 3. Charger les relations ENTRE les CIs sélectionnés (filtre côté SQL) ──
        // On combine CREATE TABLE + INSERTs + SELECT en un seul batch pour garder le scope de la temp table
        const idArr = Array.from(assetIdSet);
        const ID_BATCH = 1000;

        let batchSql = `CREATE TABLE #ci_ids (asset_id INT PRIMARY KEY);\n`;
        for (let i = 0; i < idArr.length; i += ID_BATCH) {
          const batch = idArr.slice(i, i + ID_BATCH);
          const values = batch.map((id: number) => `(${id})`).join(",");
          batchSql += `INSERT INTO #ci_ids (asset_id) VALUES ${values};\n`;
        }
        batchSql += `
          SELECT 
            l.PARENT_CI_ID,
            l.CHILD_CI_ID,
            l.RELATION_TYPE_ID,
            l.BLOCKING,
            r.REFERENCE_FR AS relation_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
          INNER JOIN #ci_ids p ON p.asset_id = l.PARENT_CI_ID
          INNER JOIN #ci_ids c ON c.asset_id = l.CHILD_CI_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE r
            ON r.REFERENCE_ID = l.RELATION_TYPE_ID;
        `;

        console.log(`[import-valeo] Executing batch SQL (${batchSql.length} chars, ${idArr.length} CIs)...`);
        const linkBatchResult = await pool.request().query(batchSql);
        // recordsets: one per INSERT (empty) + the SELECT = last one
        const rs = linkBatchResult.recordsets as any[];
        linkRows = rs[rs.length - 1];
        console.log(`[import-valeo] Got ${linkRows.length} edges from SQL`);
        await pool.close();
      }

      // ── 4. Transformer en nœuds + arêtes ──
      const nodes = ciRows.map((ci: any) => ({
        id: `CI_${ci.asset_id}`,
        label: ci.nom || ci.nDeCI || `CI_${ci.asset_id}`,
        node_type: ci.categorie || "CI",
        properties: {
          asset_id: ci.asset_id,
          nom: ci.nom,
          nDeCI: ci.nDeCI,
          categorie: ci.categorie || null,
          statutDuCI: ci.statutDuCI || null,
          version: ci.version,
          disponibilite: ci.disponibilite || null,
          estUnService: ci.estUnService,
          ...(ci.edge_count != null ? { edge_count: ci.edge_count } : {}),
        },
      }));

      const edges = (linkRows as any[]).map((l: any) => ({
        source: `CI_${l.PARENT_CI_ID}`,
        target: `CI_${l.CHILD_CI_ID}`,
        label: l.relation_label || `type_${l.RELATION_TYPE_ID}`,
        edge_type: l.relation_label || `type_${l.RELATION_TYPE_ID}`,
        properties: {
          relation_type_id: l.RELATION_TYPE_ID,
          blocking: l.BLOCKING,
        },
      }));

      // ── 5. Stocker dans la base cible ──
      const graphId = `valeo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const modeLabel = mode === "cluster" ? `(cluster top-${hubs}) ` : mode === "connected" ? "(dense) " : "";
      const title = `CMDB Valeo ${modeLabel}(${nodes.length} noeuds, ${edges.length} relations)`;
      const description = `Importé depuis ${DATA_VALEO_DB} — ${nodes.length} CIs, ${edges.length} relations (mode: ${mode}${mode === "cluster" ? `, hubs: ${hubs}` : ""})`;

      const graph = await createGraphFn(
        graphId,
        title,
        description,
        "cmdb",
        nodes,
        edges,
        targetDatabase,
      );

      // Broadcast WebSocket
      broadcast?.({
        type: "graph:created",
        graphId,
        title,
        engine: "mssql",
        database: targetDatabase,
      });

      const elapsed_ms = Date.now() - t0;

      res.status(201).json({
        ...graph,
        elapsed_ms,
        imported: {
          nodes: nodes.length,
          edges: edges.length,
          source: DATA_VALEO_DB,
        },
      });
    } catch (error: any) {
      console.error("DATA_VALEO import error:", error);
      res.status(500).json({
        error: `Erreur d'import DATA_VALEO : ${error.message}`,
      });
    }
  });

  return router;
}
