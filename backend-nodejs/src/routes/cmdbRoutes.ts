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
    const targetDatabase = (req.query.database as string) || "DATA_VALEO";
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

      // ── 3b. Charger les données de capacité (dépassement) ──
      const capacityResult = await pool.request().query(`
        SELECT ac.ASSET_ID, ac.CAPACITY_VALUE, ac.MAX_TARGET,
          ch.CHARACTERISTIC_FR
        FROM [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET_CHARACTERISTICS ac
        JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_CHARACTERISTICS ch
          ON ac.CHARACTERISTIC_ID = ch.CHARACTERISTIC_ID
        WHERE ch.IS_CAPACITY = 1
          AND ac.CAPACITY_VALUE IS NOT NULL
          AND ac.MAX_TARGET IS NOT NULL
          AND ac.CAPACITY_VALUE > ac.MAX_TARGET
      `);
      const exceededAssets = new Set<number>(
        capacityResult.recordset.map((r: any) => r.ASSET_ID)
      );

      // ── 3c. Compter les requêtes actives (incidents + changements + services) par CI ──
      const requestCountResult = await pool.request().query(`
        SELECT CI_ID, COUNT(*) AS total
        FROM [${EVO_DATA_DB}].[${EVO_SCHEMA}].SD_REQUEST
        WHERE LEFT(RFC_NUMBER, 1) IN ('I', 'R', 'S')
          AND END_DATE_UT IS NULL
          AND CI_ID IS NOT NULL AND CI_ID > 0
        GROUP BY CI_ID
      `);
      const requestCountMap = new Map<number, number>(
        requestCountResult.recordset.map((r: any) => [r.CI_ID, r.total])
      );

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
          capacityExceeded: exceededAssets.has(ci.asset_id),
          requestCount: requestCountMap.get(ci.asset_id) || 0,
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
    const targetDatabase = (req.query.database as string) || "DATA_VALEO";
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
          -- 3. Retourner les CIs du cluster avec classification
          SELECT
            a.ASSET_ID       AS asset_id,
            a.NETWORK_IDENTIFIER AS nom,
            a.ASSET_TAG      AS nDeCI,
            a.IS_SERVICE     AS estUnService,
            a.CI_VERSION     AS version,
            ISNULL(hd.edge_count, 0) AS edge_count,
            CASE WHEN th.id IS NOT NULL THEN 1 ELSE 0 END AS is_hub,
            uc.UN_CLASSIFICATION_ID AS type_id,
            uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id,
            parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM cluster_ids ci
          INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
            ON a.ASSET_ID = ci.node_id
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat
            ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc
            ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc
            ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
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
            edge_cnt.edge_count,
            uc.UN_CLASSIFICATION_ID AS type_id,
            uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id,
            parent_uc.UN_CLASSIFICATION_FR AS family_label
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
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat
            ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc
            ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc
            ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
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
      }

      // ── 3b. Capacity exceeded detection (cross-DB via NETWORK_IDENTIFIER) ──
      const exceededAssets = new Set<number>();
      try {
        // Collect names from DATA_VALEO CIs to match against EVO_DATA capacity data
        const nameToAssetIds = new Map<string, number[]>();
        for (const ci of ciRows) {
          const name = (ci.nom || '').trim();
          if (!name) continue;
          if (!nameToAssetIds.has(name)) nameToAssetIds.set(name, []);
          nameToAssetIds.get(name)!.push(ci.asset_id);
        }
        const uniqueNames = [...nameToAssetIds.keys()];
        if (uniqueNames.length > 0) {
          const NAME_BATCH = 500;
          let capSql = `CREATE TABLE #cap_names (nom NVARCHAR(255) COLLATE SQL_Latin1_General_CP1_CI_AS PRIMARY KEY);\n`;
          for (let i = 0; i < uniqueNames.length; i += NAME_BATCH) {
            const batch = uniqueNames.slice(i, i + NAME_BATCH);
            capSql += `INSERT INTO #cap_names (nom) VALUES ${batch.map(n => `(N'${n.replace(/'/g, "''")}')`).join(",")};\n`;
          }
          capSql += `
            SELECT DISTINCT evo_a.NETWORK_IDENTIFIER AS nom
            FROM #cap_names cn
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET evo_a ON evo_a.NETWORK_IDENTIFIER = cn.nom
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET_CHARACTERISTICS ac ON ac.ASSET_ID = evo_a.ASSET_ID
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_CHARACTERISTICS ch ON ac.CHARACTERISTIC_ID = ch.CHARACTERISTIC_ID
            WHERE ch.IS_CAPACITY = 1
              AND ac.CAPACITY_VALUE IS NOT NULL AND ac.MAX_TARGET IS NOT NULL
              AND ac.CAPACITY_VALUE > ac.MAX_TARGET;
            DROP TABLE #cap_names;
          `;
          const capResult = await pool.request().query(capSql);
          const capRows = (capResult.recordsets as any[]).find(rs => rs.length > 0) || [];
          for (const r of capRows) {
            const ids = nameToAssetIds.get(r.nom);
            if (ids) ids.forEach(id => exceededAssets.add(id));
          }
        }
      } catch (capErr) {
        console.warn("[import-valeo] Capacity check skipped:", (capErr as Error).message);
      }

      await pool.close();

      // ── 4. Transformer en nœuds + arêtes ──
      const nodes = ciRows.map((ci: any) => ({
        id: `CI_${ci.asset_id}`,
        label: ci.nom || ci.nDeCI || `CI_${ci.asset_id}`,
        node_type: ci.type_label || ci.categorie || "CI",
        properties: {
          asset_id: ci.asset_id,
          nom: ci.nom,
          nDeCI: ci.nDeCI,
          categorie: ci.categorie || ci.type_label || null,
          statutDuCI: ci.statutDuCI || null,
          version: ci.version,
          disponibilite: ci.disponibilite || null,
          estUnService: ci.estUnService,
          type_id: ci.type_id || null,
          type_label: ci.type_label || null,
          family_id: ci.family_id || null,
          family_label: ci.family_label || null,
          classification_level: ci.classification_level || null,
          capacityExceeded: exceededAssets.has(ci.asset_id),
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

  // ════════════════════════════════════════════════════════════════════
  // GET /view-valeo — Lecture directe depuis DATA_VALEO (lecture seule)
  //   ?mode=cluster|connected|subgraph|default  ?hubs=10  ?limit=800
  //   ?types=318,317,262  (pour mode=subgraph : filtrage par classification IDs)
  //   Retourne le GraphData sans rien écrire dans dev-11
  // ════════════════════════════════════════════════════════════════════
  router.get("/view-valeo", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 800, 600000);
    const mode = (req.query.mode as string) || "cluster";
    const hubs = Math.min(Number(req.query.hubs) || 10, 500);
    const typesParam = (req.query.types as string) || "";
    const t0 = Date.now();

    try {
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
      let clusterEdgeRows: any[] | null = null;

      if (mode === "cluster") {
        const clusterSql = `
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
            SELECT TOP (${hubs}) id, edge_count FROM hub_degree ORDER BY edge_count DESC
          ),
          cluster_ids AS (
            SELECT DISTINCT node_id FROM (
              SELECT id AS node_id FROM top_hubs
              UNION
              SELECT l.CHILD_CI_ID FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
              WHERE l.PARENT_CI_ID IN (SELECT id FROM top_hubs)
              UNION
              SELECT l.PARENT_CI_ID FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
              WHERE l.CHILD_CI_ID IN (SELECT id FROM top_hubs)
            ) combined
          )
          SELECT
            a.ASSET_ID AS asset_id, a.NETWORK_IDENTIFIER AS nom, a.ASSET_TAG AS nDeCI,
            a.IS_SERVICE AS estUnService, a.CI_VERSION AS version,
            ISNULL(hd.edge_count, 0) AS edge_count,
            CASE WHEN th.id IS NOT NULL THEN 1 ELSE 0 END AS is_hub,
            uc.UN_CLASSIFICATION_ID AS type_id, uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id, parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM cluster_ids ci
          INNER JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a ON a.ASSET_ID = ci.node_id
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
          LEFT JOIN hub_degree hd ON hd.id = a.ASSET_ID
          LEFT JOIN top_hubs th ON th.id = a.ASSET_ID
          WHERE a.IS_CI = 1;
        `;
        const ciResult = await pool.request().query(clusterSql);
        ciRows = ciResult.recordset;

        const assetIds = ciRows.map((r: any) => r.asset_id);
        const ID_BATCH = 1000;
        clusterEdgeRows = [];
        for (let i = 0; i < assetIds.length; i += ID_BATCH) {
          const batch = assetIds.slice(i, i + ID_BATCH);
          const idList = batch.join(",");
          const edgeResult = await pool.request().query(`
            SELECT l.PARENT_CI_ID, l.CHILD_CI_ID, l.RELATION_TYPE_ID, l.BLOCKING,
                   r.REFERENCE_FR AS relation_label
            FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
            LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID
            WHERE l.PARENT_CI_ID IN (${idList}) AND l.CHILD_CI_ID IN (${idList})
          `);
          clusterEdgeRows.push(...edgeResult.recordset);
        }
      } else if (mode === "connected") {
        const connectedSql = `
          ;WITH node_degree AS (
            SELECT id, SUM(c) AS total_degree FROM (
              SELECT PARENT_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK GROUP BY PARENT_CI_ID
              UNION ALL
              SELECT CHILD_CI_ID AS id, COUNT(*) AS c
              FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK GROUP BY CHILD_CI_ID
            ) x GROUP BY id
          )
          SELECT TOP (${limit})
            a.ASSET_ID AS asset_id, a.NETWORK_IDENTIFIER AS nom, a.ASSET_TAG AS nDeCI,
            a.IS_SERVICE AS estUnService, a.CI_VERSION AS version,
            nd.total_degree AS edge_count,
            uc.UN_CLASSIFICATION_ID AS type_id, uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id, parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          JOIN node_degree nd ON nd.id = a.ASSET_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
          WHERE a.IS_CI = 1
          ORDER BY nd.total_degree DESC
        `;
        const ciResult = await pool.request().query(connectedSql);
        ciRows = ciResult.recordset;
      } else if (mode === "subgraph" && typesParam) {
        // Filtrage par classification type IDs (ex: ?types=318,317,262)
        const typeIds = typesParam.split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
        if (typeIds.length === 0) {
          await pool.close();
          res.status(400).json({ error: "Paramètre types invalide" });
          return;
        }
        const typeList = typeIds.join(",");
        const subgraphSql = `
          SELECT
            a.ASSET_ID AS asset_id, a.NETWORK_IDENTIFIER AS nom, a.ASSET_TAG AS nDeCI,
            a.IS_SERVICE AS estUnService, a.CI_VERSION AS version,
            uc.UN_CLASSIFICATION_ID AS type_id, uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id, parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
          WHERE a.IS_CI = 1 AND uc.UN_CLASSIFICATION_ID IN (${typeList})
        `;
        const ciResult = await pool.request().query(subgraphSql);
        ciRows = ciResult.recordset;
      } else {
        const ciResult = await pool.request().query(`
          SELECT TOP (${limit})
            a.ASSET_ID AS asset_id, a.NETWORK_IDENTIFIER AS nom, a.ASSET_TAG AS nDeCI,
            a.IS_SERVICE AS estUnService, a.CI_VERSION AS version,
            uc.UN_CLASSIFICATION_FR AS categorie,
            uc.UN_CLASSIFICATION_ID AS type_id, uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id, parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
          WHERE a.IS_CI = 1
          ORDER BY a.NETWORK_IDENTIFIER
        `);
        ciRows = ciResult.recordset;
      }

      // Edges
      let linkRows: any[];
      if (clusterEdgeRows) {
        linkRows = clusterEdgeRows;
      } else {
        const assetIdSet = new Set(ciRows.map((r: any) => r.asset_id));
        const assetIds = [...assetIdSet];
        const ID_BATCH = 1000;
        linkRows = [];
        for (let i = 0; i < assetIds.length; i += ID_BATCH) {
          const batch = assetIds.slice(i, i + ID_BATCH);
          const idList = batch.join(",");
          const edgeResult = await pool.request().query(`
            SELECT l.PARENT_CI_ID, l.CHILD_CI_ID, l.RELATION_TYPE_ID, l.BLOCKING,
                   r.REFERENCE_FR AS relation_label
            FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
            LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID
            WHERE l.PARENT_CI_ID IN (${idList}) AND l.CHILD_CI_ID IN (${idList})
          `);
          linkRows.push(...edgeResult.recordset);
        }
      }

      // ── Capacity exceeded detection (cross-DB via NETWORK_IDENTIFIER) ──
      const exceededViewAssets = new Set<number>();
      try {
        const nameToIds = new Map<string, number[]>();
        for (const ci of ciRows) {
          const name = (ci.nom || '').trim();
          if (!name) continue;
          if (!nameToIds.has(name)) nameToIds.set(name, []);
          nameToIds.get(name)!.push(ci.asset_id);
        }
        const uniqueNames = [...nameToIds.keys()];
        if (uniqueNames.length > 0) {
          const NAME_BATCH = 500;
          let capSql = `CREATE TABLE #cap_view_names (nom NVARCHAR(255) COLLATE SQL_Latin1_General_CP1_CI_AS PRIMARY KEY);\n`;
          for (let i = 0; i < uniqueNames.length; i += NAME_BATCH) {
            const batch = uniqueNames.slice(i, i + NAME_BATCH);
            capSql += `INSERT INTO #cap_view_names (nom) VALUES ${batch.map(n => `(N'${n.replace(/'/g, "''")}')`).join(",")};\n`;
          }
          capSql += `
            SELECT DISTINCT evo_a.NETWORK_IDENTIFIER AS nom
            FROM #cap_view_names cn
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET evo_a ON evo_a.NETWORK_IDENTIFIER = cn.nom
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_ASSET_CHARACTERISTICS ac ON ac.ASSET_ID = evo_a.ASSET_ID
            INNER JOIN [${EVO_DATA_DB}].[${EVO_SCHEMA}].AM_CHARACTERISTICS ch ON ac.CHARACTERISTIC_ID = ch.CHARACTERISTIC_ID
            WHERE ch.IS_CAPACITY = 1
              AND ac.CAPACITY_VALUE IS NOT NULL AND ac.MAX_TARGET IS NOT NULL
              AND ac.CAPACITY_VALUE > ac.MAX_TARGET;
            DROP TABLE #cap_view_names;
          `;
          const capResult = await pool.request().query(capSql);
          const capRows = (capResult.recordsets as any[]).find(rs => rs.length > 0) || [];
          for (const r of capRows) {
            const ids = nameToIds.get(r.nom);
            if (ids) ids.forEach(id => exceededViewAssets.add(id));
          }
        }
        const capResult = await pool.request().query(capSql);
        const capRows = (capResult.recordsets as any[]).find(rs => rs.length > 0) || [];
        for (const r of capRows) exceededViewAssets.add(r.ASSET_ID as number);
      } catch (capErr) {
        console.warn("[view-valeo] Capacity check skipped:", (capErr as Error).message);
      }

      await pool.close();

      // Transform to GraphData (no write)
      const nodes = ciRows.map((ci: any) => ({
        id: `CI_${ci.asset_id}`,
        label: ci.nom || ci.nDeCI || `CI_${ci.asset_id}`,
        node_type: ci.type_label || ci.categorie || "CI",
        properties: {
          asset_id: ci.asset_id,
          nom: ci.nom,
          nDeCI: ci.nDeCI,
          categorie: ci.categorie || ci.type_label || null,
          type_id: ci.type_id || null,
          type_label: ci.type_label || null,
          family_id: ci.family_id || null,
          family_label: ci.family_label || null,
          classification_level: ci.classification_level || null,
          capacityExceeded: exceededViewAssets.has(ci.asset_id),
          ...(ci.edge_count != null ? { edge_count: ci.edge_count } : {}),
        },
      }));

      const nodeIdSet = new Set(nodes.map((n: any) => n.id));
      const edges = linkRows
        .filter((l: any) => nodeIdSet.has(`CI_${l.PARENT_CI_ID}`) && nodeIdSet.has(`CI_${l.CHILD_CI_ID}`))
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

      const elapsed_ms = Date.now() - t0;
      res.json({
        nodes,
        edges,
        elapsed_ms,
        source: DATA_VALEO_DB,
        mode,
      });
    } catch (error: any) {
      console.error("DATA_VALEO view error:", error);
      res.status(500).json({ error: `Erreur lecture DATA_VALEO : ${error.message}` });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /classifications — Hiérarchie de classification DATA_VALEO
  //   Retourne les familles (level 3) et types (level 4) avec comptage
  // ════════════════════════════════════════════════════════════════════
  router.get("/classifications", async (_req, res) => {
    try {
      const pool = new sql.ConnectionPool({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        database: DATA_VALEO_DB,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 15_000,
        requestTimeout: 60_000,
      });
      await pool.connect();

      const result = await pool.request().query(`
        SELECT
          uc.UN_CLASSIFICATION_ID AS id,
          uc.UN_CLASSIFICATION_FR AS label,
          uc.[LEVEL] AS level,
          uc.PARENT_UN_CLASSIFICATION_ID AS parent_id,
          COUNT(a.ASSET_ID) AS asset_count
        FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc
        LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG c
          ON c.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
        LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          ON a.CATALOG_ID = c.CATALOG_ID
        WHERE uc.[LEVEL] IN (3, 4)
        GROUP BY uc.UN_CLASSIFICATION_ID, uc.UN_CLASSIFICATION_FR, uc.[LEVEL], uc.PARENT_UN_CLASSIFICATION_ID
        HAVING COUNT(a.ASSET_ID) > 0
        ORDER BY uc.[LEVEL], COUNT(a.ASSET_ID) DESC
      `);

      await pool.close();

      const families = result.recordset
        .filter((r: any) => r.level === 3)
        .map((r: any) => ({ id: r.id, label: r.label, asset_count: r.asset_count }));

      const types = result.recordset
        .filter((r: any) => r.level === 4)
        .map((r: any) => ({ id: r.id, label: r.label, parent_id: r.parent_id, asset_count: r.asset_count }));

      res.json({ families, types });
    } catch (error: any) {
      console.error("Classifications error:", error);
      res.status(500).json({ error: `Erreur: ${error.message}` });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /search-ci — Recherche de CIs dans DATA_VALEO par nom/tag
  //   ?q=term&limit=30
  // ════════════════════════════════════════════════════════════════════
  router.get("/search-ci", async (req, res) => {
    const q = ((req.query.q as string) || "").trim();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    if (!q) {
      res.status(400).json({ error: "Paramètre q requis" });
      return;
    }

    try {
      const pool = new sql.ConnectionPool({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        database: DATA_VALEO_DB,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 15_000,
        requestTimeout: 30_000,
      });
      await pool.connect();

      const result = await pool.request()
        .input("q", sql.NVarChar, `%${q}%`)
        .input("limit", sql.Int, limit)
        .query(`
          SELECT TOP (@limit)
            a.ASSET_ID AS asset_id,
            a.NETWORK_IDENTIFIER AS nom,
            a.ASSET_TAG AS nDeCI,
            uc.UN_CLASSIFICATION_FR AS type_label,
            uc.UN_CLASSIFICATION_ID AS type_id,
            (
              SELECT COUNT(*) FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK
              WHERE PARENT_CI_ID = a.ASSET_ID OR CHILD_CI_ID = a.ASSET_ID
            ) AS degree
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          WHERE a.IS_CI = 1
            AND (a.NETWORK_IDENTIFIER LIKE @q OR a.ASSET_TAG LIKE @q)
          ORDER BY a.NETWORK_IDENTIFIER
        `);

      await pool.close();
      res.json(result.recordset);
    } catch (error: any) {
      console.error("Search CI error:", error);
      res.status(500).json({ error: `Erreur: ${error.message}` });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // GET /expand-ci — Retourne les voisins d'un ensemble de CIs
  //   ?ids=123,456,789  (asset_ids à expandre)
  //   Retourne { nodes[], edges[] } des voisins + arêtes connectées
  // ════════════════════════════════════════════════════════════════════
  router.get("/expand-ci", async (req, res) => {
    const idsParam = ((req.query.ids as string) || "").trim();
    if (!idsParam) {
      res.status(400).json({ error: "Paramètre ids requis" });
      return;
    }
    const assetIds = idsParam.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (assetIds.length === 0) {
      res.status(400).json({ error: "Paramètre ids invalide" });
      return;
    }

    const t0 = Date.now();
    try {
      const pool = new sql.ConnectionPool({
        server: mssqlConfig.host,
        port: mssqlConfig.port,
        user: mssqlConfig.user,
        password: mssqlConfig.password,
        database: DATA_VALEO_DB,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 15_000,
        requestTimeout: 120_000,
      });
      await pool.connect();

      // Process in batches of 500 IDs (MSSQL 2100 param limit)
      const ID_BATCH = 500;
      const neighborIds = new Set<number>();
      const allEdges: Array<{ parent: number; child: number; relation_type_id: number; blocking: number; relation_label: string }> = [];

      for (let i = 0; i < assetIds.length; i += ID_BATCH) {
        const batch = assetIds.slice(i, i + ID_BATCH);
        const idList = batch.join(",");
        const edgeResult = await pool.request().query(`
          SELECT l.PARENT_CI_ID, l.CHILD_CI_ID, l.RELATION_TYPE_ID, l.BLOCKING,
                 r.REFERENCE_FR AS relation_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].CONFIGURATION_ITEM_LINK l
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID
          WHERE l.PARENT_CI_ID IN (${idList}) OR l.CHILD_CI_ID IN (${idList})
        `);
        for (const row of edgeResult.recordset) {
          neighborIds.add(row.PARENT_CI_ID);
          neighborIds.add(row.CHILD_CI_ID);
          allEdges.push({
            parent: row.PARENT_CI_ID,
            child: row.CHILD_CI_ID,
            relation_type_id: row.RELATION_TYPE_ID,
            blocking: row.BLOCKING,
            relation_label: row.relation_label,
          });
        }
      }

      // Fetch node details for all neighbor IDs
      const allNodeIds = [...neighborIds];
      const nodeRows: any[] = [];
      for (let i = 0; i < allNodeIds.length; i += ID_BATCH) {
        const batch = allNodeIds.slice(i, i + ID_BATCH);
        const idList = batch.join(",");
        const nodeResult = await pool.request().query(`
          SELECT
            a.ASSET_ID AS asset_id, a.NETWORK_IDENTIFIER AS nom, a.ASSET_TAG AS nDeCI,
            uc.UN_CLASSIFICATION_ID AS type_id, uc.UN_CLASSIFICATION_FR AS type_label,
            uc.[LEVEL] AS classification_level,
            parent_uc.UN_CLASSIFICATION_ID AS family_id, parent_uc.UN_CLASSIFICATION_FR AS family_label
          FROM [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_ASSET a
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
          LEFT JOIN [${DATA_VALEO_DB}].[${DATA_VALEO_SCHEMA}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID
          WHERE a.ASSET_ID IN (${idList})
        `);
        nodeRows.push(...nodeResult.recordset);
      }

      await pool.close();

      const nodes = nodeRows.map((ci: any) => ({
        id: `CI_${ci.asset_id}`,
        label: ci.nom || ci.nDeCI || `CI_${ci.asset_id}`,
        node_type: ci.type_label || "CI",
        properties: {
          asset_id: ci.asset_id,
          nom: ci.nom,
          nDeCI: ci.nDeCI,
          type_id: ci.type_id || null,
          type_label: ci.type_label || null,
          family_id: ci.family_id || null,
          family_label: ci.family_label || null,
          classification_level: ci.classification_level || null,
        },
      }));

      const edges = allEdges.map((e) => ({
        source: `CI_${e.parent}`,
        target: `CI_${e.child}`,
        label: e.relation_label || `type_${e.relation_type_id}`,
        edge_type: e.relation_label || `type_${e.relation_type_id}`,
        properties: {
          relation_type_id: e.relation_type_id,
          blocking: e.blocking,
        },
      }));

      res.json({
        nodes,
        edges,
        elapsed_ms: Date.now() - t0,
      });
    } catch (error: any) {
      console.error("Expand CI error:", error);
      res.status(500).json({ error: `Erreur: ${error.message}` });
    }
  });

  return router;
}
