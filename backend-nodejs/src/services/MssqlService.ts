import sql from "mssql";
import NodeCache from "node-cache";
import {
  GraphNode,
  GraphEdge,
  Graph,
  GraphData,
  GraphStats,
  GraphSummary,
  ImpactResult,
} from "../models/graph.js";
import { GraphDatabaseService } from "./GraphDatabaseService.js";

/**
 * MssqlService — Microsoft SQL Server implementation of GraphDatabaseService.
 *
 * Modèle de données :
 *   graphs          — métadonnées du graphe
 *   graph_nodes     — nœuds avec node_id + graph_id
 *   graph_edges     — arêtes avec source_id/target_id
 *
 * Traversée via CTE récursive SQL Server (WITH RECURSIVE).
 * Cache NodeCache 5 min, requêtes nœuds/arêtes en Promise.all().
 */
export class MssqlService implements GraphDatabaseService {
  readonly engineName = "mssql";

  // Base contenant les graphs pré-stockés (pour comparaison cross-DB)
  private static readonly GRAPH_STORE_DB = "dev-11";
  // DATA_VALEO : schéma EasyVista natif
  private static readonly DATA_VALEO_DB = "DATA_VALEO";
  private static readonly DATA_VALEO_SCHEMA = "50004";

  private baseConfig: sql.config;
  private pools = new Map<string, sql.ConnectionPool>();

  // Cache en mémoire (TTL 5 min)
  private graphCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
  private cacheStats = { hits: 0, misses: 0, bypasses: 0 };

  constructor(
    host: string,
    port: number,
    user: string,
    password: string,
    private defaultDatabase: string = "graph_db",
  ) {
    this.baseConfig = {
      server: host,
      port,
      user,
      password,
      options: {
        encrypt: false,          // true pour Azure
        trustServerCertificate: true,
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
      connectionTimeout: 15_000,
      requestTimeout: 600_000,
    };
  }

  // ===== Connexion / Pool =====

  private async getPool(database?: string): Promise<sql.ConnectionPool> {
    const db = database || this.defaultDatabase;
    if (!this.pools.has(db)) {
      const pool = new sql.ConnectionPool({ ...this.baseConfig, database: db });
      await pool.connect();
      this.pools.set(db, pool);
    }
    return this.pools.get(db)!;
  }

  /** Pool sur la base master (pour créer/supprimer des bases) */
  private async getMasterPool(): Promise<sql.ConnectionPool> {
    return this.getPool("master");
  }

  // ===== Lifecycle =====

  async initialize(): Promise<void> {
    console.log("Initializing MSSQL database...");

    // S'assurer que la base par défaut existe
    const master = await this.getMasterPool();
    await master.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${this.defaultDatabase}')
      BEGIN
        CREATE DATABASE [${this.defaultDatabase}]
      END
    `);

    const pool = await this.getPool();

    // Table graphs
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graphs')
      CREATE TABLE graphs (
        id           NVARCHAR(255) NOT NULL PRIMARY KEY,
        title        NVARCHAR(255),
        description  NVARCHAR(MAX),
        graph_type   NVARCHAR(50),
        node_count   INT DEFAULT 0,
        edge_count   INT DEFAULT 0,
        created_at   DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Table graph_nodes
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_nodes')
      BEGIN
        CREATE TABLE graph_nodes (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          graph_id    NVARCHAR(255) NOT NULL,
          node_id     NVARCHAR(255) NOT NULL,
          label       NVARCHAR(255),
          node_type   NVARCHAR(100),
          properties  NVARCHAR(MAX) DEFAULT '{}',
          CONSTRAINT UQ_graph_nodes UNIQUE (graph_id, node_id),
          CONSTRAINT FK_graph_nodes_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        )
        CREATE INDEX IX_graph_nodes_graph_id ON graph_nodes (graph_id)
      END
    `);

    // Table graph_edges
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_edges')
      BEGIN
        CREATE TABLE graph_edges (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          graph_id    NVARCHAR(255) NOT NULL,
          source_id   NVARCHAR(255) NOT NULL,
          target_id   NVARCHAR(255) NOT NULL,
          label       NVARCHAR(255),
          edge_type   NVARCHAR(100),
          properties  NVARCHAR(MAX) DEFAULT '{}',
          CONSTRAINT FK_graph_edges_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        )
        CREATE INDEX IX_graph_edges_graph_id ON graph_edges (graph_id)
        CREATE INDEX IX_graph_edges_source   ON graph_edges (graph_id, source_id)
        CREATE INDEX IX_graph_edges_target   ON graph_edges (graph_id, target_id)
      END
    `);

    console.log("MSSQL initialization complete ✓");
  }

  // ===== Raw Query Execution =====

  async executeRawQuery(
    query: string,
    database?: string,
  ): Promise<{ rows: Record<string, any>[]; elapsed_ms: number; rowCount: number; engine: string }> {
    const pool = await this.getPool(database);
    const t0 = Date.now();
    const result = await pool.request().query(query);
    const elapsed_ms = Date.now() - t0;
    const rows = result.recordset || [];
    return { rows, elapsed_ms, rowCount: rows.length, engine: this.engineName };
  }

  async close(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.close();
    }
    this.pools.clear();
  }

  // ===== Cache =====

  getCacheStats() {
    const keys = this.graphCache.keys();
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      bypasses: this.cacheStats.bypasses,
      cachedGraphs: keys.length,
      keys,
    };
  }

  clearCache(graphId?: string, database?: string) {
    if (graphId) {
      const key = `graph:${database || this.defaultDatabase}:${graphId}`;
      this.graphCache.del(key);
      return { cleared: [key] };
    }
    const keys = this.graphCache.keys();
    this.graphCache.flushAll();
    this.cacheStats = { hits: 0, misses: 0, bypasses: 0 };
    return { cleared: keys };
  }

  // ===== CRUD Graphes =====

  async createGraph(
    graphId: string,
    title: string,
    description: string,
    graphType: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    database?: string,
  ): Promise<Graph> {
    const pool = await this.getPool(database);
    const createdAt = new Date().toISOString();

    // Insérer le graphe
    await pool.request()
      .input("id",          sql.NVarChar(255), graphId)
      .input("title",       sql.NVarChar(255), title)
      .input("description", sql.NVarChar(sql.MAX), description)
      .input("graphType",   sql.NVarChar(50),  graphType)
      .input("nodeCount",   sql.Int,           nodes.length)
      .input("edgeCount",   sql.Int,           edges.length)
      .input("createdAt",   sql.DateTime2,     new Date(createdAt))
      .query(`
        INSERT INTO graphs (id, title, description, graph_type, node_count, edge_count, created_at)
        VALUES (@id, @title, @description, @graphType, @nodeCount, @edgeCount, @createdAt)
      `);

    // Insérer les nœuds par batch
    // Limite SQL Server : 2100 paramètres max par requête
    // Nœuds : 4 colonnes + 1 graphId partagé → max = floor((2100-1)/4) = 524 lignes
    const BATCH_NODES = 500;
    for (let i = 0; i < nodes.length; i += BATCH_NODES) {
      const batch = nodes.slice(i, i + BATCH_NODES);
      const req = pool.request().input("graphId", sql.NVarChar(255), graphId);
      const rows = batch.map((n, idx) => {
        req.input(`nid${idx}`,   sql.NVarChar(255), n.id);
        req.input(`nlbl${idx}`,  sql.NVarChar(255), n.label);
        req.input(`ntyp${idx}`,  sql.NVarChar(100), n.node_type);
        req.input(`nprop${idx}`, sql.NVarChar(sql.MAX), JSON.stringify(n.properties));
        return `(@graphId, @nid${idx}, @nlbl${idx}, @ntyp${idx}, @nprop${idx})`;
      });
      await req.query(
        `INSERT INTO graph_nodes (graph_id, node_id, label, node_type, properties) VALUES ${rows.join(",")}`,
      );
    }

    // Insérer les arêtes par batch
    // Arêtes : 5 colonnes + 1 graphId partagé → max = floor((2100-1)/5) = 419 lignes
    const BATCH_EDGES = 400;
    for (let i = 0; i < edges.length; i += BATCH_EDGES) {
      const batch = edges.slice(i, i + BATCH_EDGES);
      const req = pool.request().input("graphId", sql.NVarChar(255), graphId);
      const rows = batch.map((e, idx) => {
        req.input(`esrc${idx}`,  sql.NVarChar(255), e.source);
        req.input(`etgt${idx}`,  sql.NVarChar(255), e.target);
        req.input(`elbl${idx}`,  sql.NVarChar(255), e.label ?? "");
        req.input(`etyp${idx}`,  sql.NVarChar(100), e.edge_type);
        req.input(`eprop${idx}`, sql.NVarChar(sql.MAX), JSON.stringify(e.properties));
        return `(@graphId, @esrc${idx}, @etgt${idx}, @elbl${idx}, @etyp${idx}, @eprop${idx})`;
      });
      await req.query(
        `INSERT INTO graph_edges (graph_id, source_id, target_id, label, edge_type, properties) VALUES ${rows.join(",")}`,
      );
    }

    // Invalider le cache
    const cacheKey = `graph:${database || this.defaultDatabase}:${graphId}`;
    this.graphCache.del(cacheKey);

    return { id: graphId, title, description, graph_type: graphType, node_count: nodes.length, edge_count: edges.length, created_at: createdAt };
  }

  async getGraph(graphId: string, database?: string, bypassCache = false): Promise<GraphData> {
    const db = database || this.defaultDatabase;
    const cacheKey = `graph:${db}:${graphId}`;

    if (!bypassCache) {
      const cached = this.graphCache.get<GraphData>(cacheKey);
      if (cached) { this.cacheStats.hits++; return cached; }
      this.cacheStats.misses++;
    } else {
      this.cacheStats.bypasses++;
    }

    // ── DATA_VALEO : charger les mêmes graphes depuis les tables EasyVista ──
    if (db === MssqlService.DATA_VALEO_DB) {
      const result = await this.getGraphFromValeo(graphId);
      if (!bypassCache) this.graphCache.set(cacheKey, result);
      return result;
    }

    const pool = await this.getPool(db);

    // Requêtes nœuds + arêtes en parallèle
    const [nodesRes, edgesRes] = await Promise.all([
      pool.request()
        .input("graphId", sql.NVarChar(255), graphId)
        .query(`SELECT node_id, label, node_type, properties FROM graph_nodes WHERE graph_id = @graphId`),
      pool.request()
        .input("graphId", sql.NVarChar(255), graphId)
        .query(`SELECT id, source_id, target_id, label, edge_type, properties FROM graph_edges WHERE graph_id = @graphId`),
    ]);

    const nodes: GraphNode[] = nodesRes.recordset.map((r: any) => ({
      id: r.node_id,
      label: r.label,
      node_type: r.node_type,
      properties: JSON.parse(r.properties || "{}"),
    }));

    const edges: GraphEdge[] = edgesRes.recordset.map((r: any) => ({
      id: String(r.id),
      source: r.source_id,
      target: r.target_id,
      label: r.label || undefined,
      edge_type: r.edge_type,
      properties: JSON.parse(r.properties || "{}"),
    }));

    const result: GraphData = { nodes, edges };
    if (!bypassCache) this.graphCache.set(cacheKey, result);
    return result;
  }

  /**
   * Charge un graphe depuis les tables EasyVista natives (DATA_VALEO).
   * 1. Lit les node_id depuis [dev-11].dbo.graph_nodes (cross-DB) pour connaître les asset_ids
   * 2. Lit les edges depuis [dev-11].dbo.graph_edges (cross-DB) pour connaître la structure
   * 3. Pour chaque nœud, requête AM_ASSET + classification pour récupérer les infos live
   * 4. Pour chaque arête, requête CONFIGURATION_ITEM_LINK + AM_REFERENCE pour le label
   */
  private async getGraphFromValeo(graphId: string): Promise<GraphData> {
    const pool = await this.getPool(MssqlService.DATA_VALEO_DB);
    const storeDb = MssqlService.GRAPH_STORE_DB;
    const schema = MssqlService.DATA_VALEO_SCHEMA;
    const dvDb = MssqlService.DATA_VALEO_DB;

    // 1. Lire la liste des node_id depuis dev-11 (cross-database)
    const nodeListRes = await pool.request()
      .input("graphId", sql.NVarChar(255), graphId)
      .query(`SELECT node_id FROM [${storeDb}].dbo.graph_nodes WHERE graph_id = @graphId`);

    const nodeIds: string[] = nodeListRes.recordset.map((r: any) => r.node_id);
    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    // Extraire les asset_ids (format CI_12345 → 12345)
    const assetIds = nodeIds
      .filter((id: string) => id.startsWith("CI_"))
      .map((id: string) => parseInt(id.replace("CI_", ""), 10))
      .filter((n: number) => !isNaN(n));

    if (assetIds.length === 0) return { nodes: [], edges: [] };

    // 2. Requêter les infos nœuds depuis les tables EasyVista (AM_ASSET + classification)
    const ID_BATCH = 1000;
    let batchSql = `CREATE TABLE #asset_ids (asset_id INT PRIMARY KEY);\n`;
    for (let i = 0; i < assetIds.length; i += ID_BATCH) {
      const batch = assetIds.slice(i, i + ID_BATCH);
      batchSql += `INSERT INTO #asset_ids (asset_id) VALUES ${batch.map((id: number) => `(${id})`).join(",")};\n`;
    }
    batchSql += `
      SELECT
        a.ASSET_ID       AS asset_id,
        a.NETWORK_IDENTIFIER AS nom,
        a.ASSET_TAG      AS nDeCI,
        a.IS_SERVICE     AS estUnService,
        a.CI_VERSION     AS version,
        uc.UN_CLASSIFICATION_ID AS type_id,
        uc.UN_CLASSIFICATION_FR AS type_label,
        uc.[LEVEL] AS classification_level,
        parent_uc.UN_CLASSIFICATION_ID AS family_id,
        parent_uc.UN_CLASSIFICATION_FR AS family_label
      FROM #asset_ids ai
      INNER JOIN [${dvDb}].[${schema}].AM_ASSET a ON a.ASSET_ID = ai.asset_id
      LEFT JOIN [${dvDb}].[${schema}].AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
      LEFT JOIN [${dvDb}].[${schema}].AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
      LEFT JOIN [${dvDb}].[${schema}].AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID;

      -- Arêtes : lire les paires source/target depuis dev-11, puis enrichir
      -- depuis CONFIGURATION_ITEM_LINK pour les labels/propriétés live EasyVista.
      -- On ne prend que les relations correspondant aux arêtes stockées (pas toutes
      -- les relations possibles entre les nœuds, qui seraient 1M+).
      SELECT
        e.id,
        e.source_id,
        e.target_id,
        COALESCE(r.REFERENCE_FR COLLATE DATABASE_DEFAULT, e.label) AS label,
        COALESCE(r.REFERENCE_FR COLLATE DATABASE_DEFAULT, e.edge_type) AS edge_type,
        l.RELATION_TYPE_ID,
        l.BLOCKING
      FROM [${storeDb}].dbo.graph_edges e
      LEFT JOIN [${dvDb}].[${schema}].CONFIGURATION_ITEM_LINK l
        ON l.PARENT_CI_ID = CAST(REPLACE(e.source_id, 'CI_', '') AS INT)
       AND l.CHILD_CI_ID  = CAST(REPLACE(e.target_id, 'CI_', '') AS INT)
      LEFT JOIN [${dvDb}].[${schema}].AM_REFERENCE r
        ON r.REFERENCE_ID = l.RELATION_TYPE_ID
      WHERE e.graph_id = @graphId;

      DROP TABLE #asset_ids;
    `;

    const batchResult = await pool.request()
      .input("graphId", sql.NVarChar(255), graphId)
      .query(batchSql);

    const recordsets = batchResult.recordsets as any[];
    const ciRows = recordsets[0] || [];
    const edgeRows = recordsets[1] || [];

    // 3. Transformer en GraphData
    const nodes: GraphNode[] = ciRows.map((ci: any) => ({
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
        version: ci.version,
        estUnService: ci.estUnService,
      },
    }));

    const edges: GraphEdge[] = edgeRows.map((r: any) => ({
      id: String(r.id),
      source: r.source_id,
      target: r.target_id,
      label: r.label || undefined,
      edge_type: r.edge_type || "relation",
      properties: {
        relation_type_id: r.RELATION_TYPE_ID || null,
        blocking: r.BLOCKING || null,
      },
    }));

    return { nodes, edges };
  }

  async listGraphs(database?: string): Promise<GraphSummary[]> {
    const db = database || this.defaultDatabase;
    const pool = await this.getPool(db);

    // Pour DATA_VALEO : pas de table graphs locale → lister via cross-DB depuis dev-11
    if (db === MssqlService.DATA_VALEO_DB) {
      try {
        const storeDb = MssqlService.GRAPH_STORE_DB;
        const res = await pool.request().query(`
          SELECT id, title, description, graph_type, node_count, edge_count
          FROM [${storeDb}].dbo.graphs
          ORDER BY created_at DESC
        `);
        return res.recordset.map((r: any) => ({
          id: r.id,
          title: `⚡ ${r.title}`,
          description: r.description,
          graph_type: r.graph_type,
          node_count: r.node_count,
          edge_count: r.edge_count,
        }));
      } catch (err) {
        console.warn("Cross-DB listGraphs from dev-11 failed:", err);
        return [];
      }
    }

    const res = await pool.request().query(`
      SELECT id, title, description, graph_type, node_count, edge_count
      FROM graphs
      ORDER BY created_at DESC
    `);
    return res.recordset.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      graph_type: r.graph_type,
      node_count: r.node_count,
      edge_count: r.edge_count,
    }));
  }

  async getGraphStats(graphId: string, database?: string): Promise<GraphStats> {
    const pool = await this.getPool(database);

    const [countRes, typesRes] = await Promise.all([
      pool.request()
        .input("graphId", sql.NVarChar(255), graphId)
        .query(`
          SELECT
            (SELECT COUNT(*) FROM graph_nodes WHERE graph_id = @graphId) AS node_count,
            (SELECT COUNT(*) FROM graph_edges WHERE graph_id = @graphId) AS edge_count
        `),
      pool.request()
        .input("graphId", sql.NVarChar(255), graphId)
        .query(`
          SELECT node_type, COUNT(*) AS cnt
          FROM graph_nodes
          WHERE graph_id = @graphId
          GROUP BY node_type
        `),
    ]);

    const nodeCount = countRes.recordset[0]?.node_count ?? 0;
    const edgeCount = countRes.recordset[0]?.edge_count ?? 0;
    const nodeTypes: Record<string, number> = {};
    typesRes.recordset.forEach((r: any) => { nodeTypes[r.node_type] = r.cnt; });

    return {
      node_count: nodeCount,
      edge_count: edgeCount,
      node_types: nodeTypes,
      average_degree: nodeCount > 0 ? edgeCount / nodeCount : 0,
    };
  }

  async deleteGraph(graphId: string, database?: string): Promise<void> {
    const pool = await this.getPool(database);
    // ON DELETE CASCADE supprime graph_nodes et graph_edges automatiquement
    await pool.request()
      .input("graphId", sql.NVarChar(255), graphId)
      .query(`DELETE FROM graphs WHERE id = @graphId`);
    const cacheKey = `graph:${database || this.defaultDatabase}:${graphId}`;
    this.graphCache.del(cacheKey);
  }

  async getStartingNode(graphId: string, database?: string): Promise<GraphNode | null> {
    const pool = await this.getPool(database);
    const res = await pool.request()
      .input("graphId", sql.NVarChar(255), graphId)
      .query(`
        SELECT TOP 1 node_id, label, node_type, properties
        FROM graph_nodes
        WHERE graph_id = @graphId
      `);
    if (!res.recordset.length) return null;
    const r = res.recordset[0];
    return { id: r.node_id, label: r.label, node_type: r.node_type, properties: JSON.parse(r.properties || "{}") };
  }

  /**
   * Traversée de voisins via CTE récursive SQL Server.
   * NOTE SQL Server : pas de cycle guard natif, on limite via level < depth.
   *      Sur de grands graphes, c'est nettement plus lent qu'une BD graphe.
   */
  async getNodeNeighbors(graphId: string, nodeId: string, depth = 1, database?: string): Promise<GraphData> {
    const maxDepth = Math.min(depth, 15);
    const pool = await this.getPool(database);

    // CTE récursive : explore les voisins sortants ET entrants
    const res = await pool.request()
      .input("graphId",   sql.NVarChar(255), graphId)
      .input("nodeId",    sql.NVarChar(255), nodeId)
      .input("maxDepth",  sql.Int,           maxDepth)
      .query(`
        -- Traversée sortante
        WITH Traverse AS (
          SELECT node_id, 0 AS lvl
          FROM graph_nodes
          WHERE graph_id = @graphId AND node_id = @nodeId

          UNION ALL

          SELECT n.node_id, t.lvl + 1
          FROM Traverse t
          JOIN graph_edges e  ON e.graph_id = @graphId AND e.source_id = t.node_id
          JOIN graph_nodes n  ON n.graph_id = @graphId AND n.node_id   = e.target_id
          WHERE t.lvl < @maxDepth
        ),
        -- Traversée entrante
        TraverseIn AS (
          SELECT node_id, 0 AS lvl
          FROM graph_nodes
          WHERE graph_id = @graphId AND node_id = @nodeId

          UNION ALL

          SELECT n.node_id, t.lvl + 1
          FROM TraverseIn t
          JOIN graph_edges e  ON e.graph_id = @graphId AND e.target_id = t.node_id
          JOIN graph_nodes n  ON n.graph_id = @graphId AND n.node_id   = e.source_id
          WHERE t.lvl < @maxDepth
        ),
        AllNodeIds AS (
          SELECT DISTINCT node_id FROM Traverse
          UNION
          SELECT DISTINCT node_id FROM TraverseIn
        )
        -- Nœuds
        SELECT 'node' AS kind,
               n.node_id AS node_id, n.label, n.node_type, n.properties,
               NULL AS edge_id, NULL AS source_id, NULL AS target_id,
               NULL AS edge_label, NULL AS edge_type, NULL AS edge_props
        FROM graph_nodes n
        WHERE n.graph_id = @graphId AND n.node_id IN (SELECT node_id FROM AllNodeIds)

        UNION ALL

        -- Arêtes entre les nœuds trouvés
        SELECT 'edge' AS kind,
               NULL, NULL, NULL, NULL,
               CAST(e.id AS NVARCHAR), e.source_id, e.target_id,
               e.label, e.edge_type, e.properties
        FROM graph_edges e
        WHERE e.graph_id = @graphId
          AND e.source_id IN (SELECT node_id FROM AllNodeIds)
          AND e.target_id IN (SELECT node_id FROM AllNodeIds)
        OPTION (MAXRECURSION 200)
      `);

    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    for (const r of res.recordset as any[]) {
      if (r.kind === "node") {
        nodeMap.set(r.node_id, {
          id: r.node_id,
          label: r.label,
          node_type: r.node_type,
          properties: JSON.parse(r.properties || "{}"),
        });
      } else {
        const key = r.edge_id;
        edgeMap.set(key, {
          id: key,
          source: r.source_id,
          target: r.target_id,
          label: r.edge_label || undefined,
          edge_type: r.edge_type,
          properties: JSON.parse(r.edge_props || "{}"),
        });
      }
    }

    return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
  }

  /**
   * Analyse d'impact côté serveur — propagation BFS sortante via CTE récursive.
   * Chaque niveau effectue un JOIN sur la table complète → O(k^d × n).
   * Devient très lent au-delà de depth=4 sur de grands graphes.
   */
  async computeImpact(graphId: string, nodeId: string, depth: number, database?: string, threshold: number = 0): Promise<ImpactResult> {
    const t0 = Date.now();
    const maxDepth = Math.min(depth, 15);

    // Quand threshold > 0, on fait un BFS in-memory avec seuil de propagation
    if (threshold > 0) {
      return this.computeImpactWithThreshold(graphId, nodeId, maxDepth, database, threshold);
    }

    const pool = await this.getPool(database);

    const res = await pool.request()
      .input("graphId",  sql.NVarChar(255), graphId)
      .input("nodeId",   sql.NVarChar(255), nodeId)
      .input("maxDepth", sql.Int,           maxDepth)
      .query(`
        -- BFS sortant uniquement (propagation de panne vers l'aval)
        WITH Impact AS (
          SELECT node_id, 0 AS lvl
          FROM graph_nodes
          WHERE graph_id = @graphId AND node_id = @nodeId

          UNION ALL

          SELECT n.node_id, i.lvl + 1
          FROM Impact i
          JOIN graph_edges e ON e.graph_id = @graphId AND e.source_id = i.node_id
          JOIN graph_nodes n ON n.graph_id = @graphId AND n.node_id   = e.target_id
          WHERE i.lvl < @maxDepth
        )
        SELECT node_id AS nodeId, MIN(lvl) AS level
        FROM Impact
        WHERE node_id <> @nodeId
        GROUP BY node_id
        OPTION (MAXRECURSION 200)
      `);

    return {
      sourceNodeId: nodeId,
      impactedNodes: res.recordset.map((r: any) => ({ nodeId: r.nodeId, level: r.level })),
      depth: maxDepth,
      threshold: 0,
      elapsed_ms: Date.now() - t0,
      engine: this.engineName,
    };
  }

  /**
   * BFS in-memory avec seuil : un nœud est impacté seulement si au moins
   * `threshold`% de ses parents entrants sont eux-mêmes impactés/bloquants.
   */
  private async computeImpactWithThreshold(
    graphId: string, nodeId: string, maxDepth: number,
    database: string | undefined, threshold: number,
  ): Promise<ImpactResult> {
    const t0 = Date.now();
    const graphData = await this.getGraph(graphId, database);

    // Build adjacency : outgoing neighbors + incoming parents
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const edge of graphData.edges) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source)!.push(edge.target);
      if (!incoming.has(edge.target)) incoming.set(edge.target, []);
      incoming.get(edge.target)!.push(edge.source);
    }

    const impacted = new Map<string, number>(); // nodeId → level
    impacted.set(nodeId, 0);
    let frontier = [nodeId];
    const ratio = threshold / 100;

    for (let level = 1; level <= maxDepth && frontier.length > 0; level++) {
      const candidates = new Set<string>();
      for (const src of frontier) {
        for (const tgt of (outgoing.get(src) || [])) {
          if (!impacted.has(tgt)) candidates.add(tgt);
        }
      }
      const newFrontier: string[] = [];
      for (const candidate of candidates) {
        const parents = incoming.get(candidate) || [];
        if (parents.length === 0) continue;
        const impactedParents = parents.filter(p => impacted.has(p)).length;
        if (impactedParents / parents.length >= ratio) {
          impacted.set(candidate, level);
          newFrontier.push(candidate);
        }
      }
      frontier = newFrontier;
    }

    impacted.delete(nodeId);
    return {
      sourceNodeId: nodeId,
      impactedNodes: Array.from(impacted.entries()).map(([id, level]) => ({ nodeId: id, level })),
      depth: maxDepth,
      threshold,
      elapsed_ms: Date.now() - t0,
      engine: this.engineName,
    };
  }

  // ===== Gestion des bases de données =====

  async listDatabases(): Promise<Array<{ name: string; default: boolean; status: string }>> {
    const pool = await this.getMasterPool();
    const res = await pool.request().query(`
      SELECT name, state_desc
      FROM sys.databases
      WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
      ORDER BY name
    `);
    return res.recordset.map((r: any) => ({
      name: r.name,
      default: r.name === this.defaultDatabase,
      status: r.state_desc === "ONLINE" ? "online" : "offline",
    }));
  }

  async createDatabase(databaseName: string): Promise<void> {
    const pool = await this.getMasterPool();
    // Pas de paramètres dans CREATE DATABASE — on nettoie le nom
    const safeName = databaseName.replace(/[^a-zA-Z0-9_]/g, "");
    await pool.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = '${safeName}')
        CREATE DATABASE [${safeName}]
    `);
    // Initialiser les tables dans la nouvelle base
    const newPool = await this.getPool(safeName);
    await this.ensureTables(newPool);
  }

  async deleteDatabase(databaseName: string): Promise<void> {
    if (databaseName === this.defaultDatabase || databaseName === "master") {
      throw new Error(`Cannot delete protected database '${databaseName}'`);
    }
    // Fermer le pool existant
    if (this.pools.has(databaseName)) {
      await this.pools.get(databaseName)!.close();
      this.pools.delete(databaseName);
    }
    const safeName = databaseName.replace(/[^a-zA-Z0-9_]/g, "");
    const pool = await this.getMasterPool();
    await pool.request().query(`
      IF EXISTS (SELECT name FROM sys.databases WHERE name = '${safeName}')
      BEGIN
        ALTER DATABASE [${safeName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        DROP DATABASE [${safeName}];
      END
    `);
  }

  async getDatabaseStats(databaseName: string): Promise<{ nodeCount: number; relationshipCount: number; graphCount: number }> {
    const pool = await this.getPool(databaseName);
    const res = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM graph_nodes)  AS nodeCount,
        (SELECT COUNT(*) FROM graph_edges)  AS relationshipCount,
        (SELECT COUNT(*) FROM graphs)       AS graphCount
    `);
    const r = res.recordset[0];
    return { nodeCount: r?.nodeCount ?? 0, relationshipCount: r?.relationshipCount ?? 0, graphCount: r?.graphCount ?? 0 };
  }

  // ===== Helpers =====

  /** Crée les tables si elles n'existent pas (utilisé lors de createDatabase) */
  private async ensureTables(pool: sql.ConnectionPool): Promise<void> {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graphs')
      CREATE TABLE graphs (
        id NVARCHAR(255) NOT NULL PRIMARY KEY, title NVARCHAR(255),
        description NVARCHAR(MAX), graph_type NVARCHAR(50),
        node_count INT DEFAULT 0, edge_count INT DEFAULT 0,
        created_at DATETIME2 DEFAULT GETDATE()
      )
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_nodes')
      BEGIN
        CREATE TABLE graph_nodes (
          id INT IDENTITY(1,1) PRIMARY KEY, graph_id NVARCHAR(255) NOT NULL,
          node_id NVARCHAR(255) NOT NULL, label NVARCHAR(255), node_type NVARCHAR(100),
          properties NVARCHAR(MAX) DEFAULT '{}',
          CONSTRAINT UQ_gn_${Date.now()} UNIQUE (graph_id, node_id),
          FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        )
        CREATE INDEX IX_gn_gid_${Date.now()} ON graph_nodes (graph_id)
      END
    `);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_edges')
      BEGIN
        CREATE TABLE graph_edges (
          id INT IDENTITY(1,1) PRIMARY KEY, graph_id NVARCHAR(255) NOT NULL,
          source_id NVARCHAR(255) NOT NULL, target_id NVARCHAR(255) NOT NULL,
          label NVARCHAR(255), edge_type NVARCHAR(100),
          properties NVARCHAR(MAX) DEFAULT '{}',
          FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        )
        CREATE INDEX IX_ge_gid_${Date.now()} ON graph_edges (graph_id)
      END
    `);
  }
}
