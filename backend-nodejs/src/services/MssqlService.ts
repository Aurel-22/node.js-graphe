import sql from "mssql";
import NodeCache from "node-cache";
import {
  GraphNode,
  GraphEdge,
  Graph,
  GraphData,
  GraphStats,
  GraphSummary,
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
      requestTimeout: 30_000,
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
    const cacheKey = `graph:${database || this.defaultDatabase}:${graphId}`;

    if (!bypassCache) {
      const cached = this.graphCache.get<GraphData>(cacheKey);
      if (cached) { this.cacheStats.hits++; return cached; }
      this.cacheStats.misses++;
    } else {
      this.cacheStats.bypasses++;
    }

    const pool = await this.getPool(database);

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

  async listGraphs(database?: string): Promise<GraphSummary[]> {
    const pool = await this.getPool(database);
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
