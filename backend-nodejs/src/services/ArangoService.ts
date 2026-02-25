import { Database, aql } from "arangojs";
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
 * Service ArangoDB — même API que Neo4jService pour comparaison.
 *
 * Modèle de données :
 * - Collection de documents "graphs" (métadonnées des graphes)
 * - Collection de documents "graph_nodes" (nœuds)
 * - Collection d'arêtes "graph_edges" (relations)
 *
 * ArangoDB utilise AQL (ArangoDB Query Language) au lieu de Cypher.
 */
export class ArangoService implements GraphDatabaseService {
  readonly engineName = "arangodb";

  private db: Database;
  private defaultDatabase: string;
  private url: string;
  private username: string;
  private password: string;

  // In-memory cache (TTL 5 minutes par défaut)
  private graphCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
  private cacheStats = { hits: 0, misses: 0, bypasses: 0 };

  constructor(url: string, username: string, password: string, database: string = "_system") {
    this.url = url;
    this.username = username;
    this.password = password;
    this.defaultDatabase = database;

    this.db = new Database({
      url,
      databaseName: database,
      auth: { username, password },
    });
  }

  /** Obtenir une instance DB pour une database spécifique */
  private getDb(database?: string): Database {
    const dbName = database || this.defaultDatabase;
    if (dbName === this.defaultDatabase) {
      return this.db;
    }
    return new Database({
      url: this.url,
      databaseName: dbName,
      auth: { username: this.username, password: this.password },
    });
  }

  // ===== Cache =====

  getCacheStats() {
    const keys = this.graphCache.keys();
    const nodeCache = this.graphCache.getStats();
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      bypasses: this.cacheStats.bypasses,
      cachedGraphs: keys.length,
      keys,
      nodeCache,
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

  // ===== Initialisation =====

  async initialize(): Promise<void> {
    console.log("Initializing ArangoDB database...");

    const db = this.getDb();

    // Créer les collections si elles n'existent pas
    const collections = await db.listCollections();
    const collectionNames = collections.map((c: any) => c.name);

    if (!collectionNames.includes("graphs")) {
      await db.createCollection("graphs");
      console.log("Created 'graphs' collection");
    }

    if (!collectionNames.includes("graph_nodes")) {
      await db.createCollection("graph_nodes");
      console.log("Created 'graph_nodes' collection");
    }

    if (!collectionNames.includes("graph_edges")) {
      await db.createEdgeCollection("graph_edges");
      console.log("Created 'graph_edges' edge collection");
    }

    // Créer les index
    const nodesCol = db.collection("graph_nodes");
    const edgesCol = db.collection("graph_edges");
    const graphsCol = db.collection("graphs");

    // Index unique sur graph_id dans graphs
    await graphsCol.ensureIndex({
      type: "persistent",
      fields: ["graph_id"],
      unique: true,
    });

    // Index composé sur graph_nodes (graph_id, node_id)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["graph_id", "node_id"],
      unique: true,
    });

    // Index sur graph_id pour graph_nodes (lookups rapides)
    await nodesCol.ensureIndex({
      type: "persistent",
      fields: ["graph_id"],
    });

    // Index sur graph_id pour graph_edges
    await edgesCol.ensureIndex({
      type: "persistent",
      fields: ["graph_id"],
    });

    console.log("ArangoDB collections and indexes created");
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
    const createdAt = new Date().toISOString();
    const db = this.getDb(database);

    const graphsCol = db.collection("graphs");
    const nodesCol = db.collection("graph_nodes");
    const edgesCol = db.collection("graph_edges");

    // Créer le document graphe principal
    await graphsCol.save({
      graph_id: graphId,
      title,
      description,
      graph_type: graphType,
      node_count: nodes.length,
      edge_count: edges.length,
      created_at: createdAt,
    });

    // Insertion batch des nœuds
    const nodeDocs = nodes.map((node) => ({
      graph_id: graphId,
      node_id: node.id,
      label: node.label,
      node_type: node.node_type,
      properties: node.properties,
    }));

    if (nodeDocs.length > 0) {
      // Insérer par lots de 5000
      for (let i = 0; i < nodeDocs.length; i += 5000) {
        const batch = nodeDocs.slice(i, i + 5000);
        await nodesCol.import(batch);
      }
    }

    // Construire un map _id pour les arêtes (source/target doivent être des _id ArangoDB)
    // On récupère les _id des nœuds insérés
    const cursor = await db.query(aql`
      FOR n IN graph_nodes
        FILTER n.graph_id == ${graphId}
        RETURN { node_id: n.node_id, _id: n._id }
    `);
    const nodeIdMap = new Map<string, string>();
    for await (const doc of cursor) {
      nodeIdMap.set(doc.node_id, doc._id);
    }

    // Insertion batch des arêtes
    const edgeDocs = edges
      .filter((edge) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
      .map((edge) => ({
        _from: nodeIdMap.get(edge.source)!,
        _to: nodeIdMap.get(edge.target)!,
        graph_id: graphId,
        label: edge.label || "",
        edge_type: edge.edge_type,
        properties: edge.properties,
      }));

    if (edgeDocs.length > 0) {
      for (let i = 0; i < edgeDocs.length; i += 5000) {
        const batch = edgeDocs.slice(i, i + 5000);
        await edgesCol.import(batch);
      }
    }

    return {
      id: graphId,
      title,
      description,
      graph_type: graphType,
      node_count: nodes.length,
      edge_count: edges.length,
      created_at: createdAt,
    };
  }

  async getGraph(graphId: string, database?: string, bypassCache = false): Promise<GraphData> {
    const cacheKey = `graph:${database || this.defaultDatabase}:${graphId}`;

    if (!bypassCache) {
      const cached = this.graphCache.get<GraphData>(cacheKey);
      if (cached) {
        this.cacheStats.hits++;
        return cached;
      }
      this.cacheStats.misses++;
    } else {
      this.cacheStats.bypasses++;
    }

    const db = this.getDb(database);

    // Requêtes en parallèle (comme Neo4jService)
    const [nodesCursor, edgesCursor] = await Promise.all([
      db.query(aql`
        FOR n IN graph_nodes
          FILTER n.graph_id == ${graphId}
          RETURN { id: n.node_id, label: n.label, node_type: n.node_type, properties: n.properties }
      `),
      db.query(aql`
        FOR e IN graph_edges
          FILTER e.graph_id == ${graphId}
          LET sourceNode = FIRST(FOR n IN graph_nodes FILTER n._id == e._from RETURN n.node_id)
          LET targetNode = FIRST(FOR n IN graph_nodes FILTER n._id == e._to RETURN n.node_id)
          RETURN { id: e._key, source: sourceNode, target: targetNode, label: e.label, edge_type: e.edge_type, properties: e.properties }
      `),
    ]);

    const nodes: GraphNode[] = await nodesCursor.all();
    const edges: GraphEdge[] = await edgesCursor.all();

    const result: GraphData = { nodes, edges };

    if (!bypassCache) {
      this.graphCache.set(cacheKey, result);
    }

    return result;
  }

  async getStartingNode(graphId: string, database?: string): Promise<GraphNode | null> {
    const db = this.getDb(database);

    const cursor = await db.query(aql`
      FOR n IN graph_nodes
        FILTER n.graph_id == ${graphId}
        LIMIT 1
        RETURN { id: n.node_id, label: n.label, node_type: n.node_type, properties: n.properties }
    `);

    const results = await cursor.all();
    return results.length > 0 ? results[0] : null;
  }

  async getNodeNeighbors(
    graphId: string,
    nodeId: string,
    depth: number = 1,
    database?: string,
  ): Promise<GraphData> {
    const db = this.getDb(database);

    // Utiliser un traversal AQL pour trouver les voisins
    const cursor = await db.query(aql`
      LET startNode = FIRST(
        FOR n IN graph_nodes
          FILTER n.graph_id == ${graphId} AND n.node_id == ${nodeId}
          RETURN n
      )
      
      LET traversal = (
        FOR v, e, p IN 1..${depth} ANY startNode graph_edges
          FILTER v.graph_id == ${graphId}
          RETURN DISTINCT { vertex: v, edge: e }
      )
      
      LET vertices = UNION_DISTINCT(
        [{ id: startNode.node_id, label: startNode.label, node_type: startNode.node_type, properties: startNode.properties }],
        (FOR t IN traversal
          RETURN { id: t.vertex.node_id, label: t.vertex.label, node_type: t.vertex.node_type, properties: t.vertex.properties })
      )
      
      LET edgeList = (
        FOR t IN traversal
          FILTER t.edge != null
          LET sourceNode = FIRST(FOR n IN graph_nodes FILTER n._id == t.edge._from RETURN n.node_id)
          LET targetNode = FIRST(FOR n IN graph_nodes FILTER n._id == t.edge._to RETURN n.node_id)
          RETURN DISTINCT { id: t.edge._key, source: sourceNode, target: targetNode, label: t.edge.label, edge_type: t.edge.edge_type, properties: t.edge.properties }
      )
      
      RETURN { nodes: vertices, edges: edgeList }
    `);

    const results = await cursor.all();

    if (results.length === 0 || !results[0]) {
      return { nodes: [], edges: [] };
    }

    return {
      nodes: results[0].nodes || [],
      edges: results[0].edges || [],
    };
  }

  async listGraphs(database?: string): Promise<GraphSummary[]> {
    const db = this.getDb(database);

    const cursor = await db.query(aql`
      FOR g IN graphs
        SORT g.created_at DESC
        RETURN {
          id: g.graph_id,
          title: g.title,
          description: g.description,
          graph_type: g.graph_type,
          node_count: g.node_count,
          edge_count: g.edge_count
        }
    `);

    return await cursor.all();
  }

  async getGraphStats(graphId: string, database?: string): Promise<GraphStats> {
    const db = this.getDb(database);

    const cursor = await db.query(aql`
      LET nodeCount = LENGTH(FOR n IN graph_nodes FILTER n.graph_id == ${graphId} RETURN 1)
      LET edgeCount = LENGTH(FOR e IN graph_edges FILTER e.graph_id == ${graphId} RETURN 1)
      LET typeCounts = (
        FOR n IN graph_nodes
          FILTER n.graph_id == ${graphId}
          COLLECT type = n.node_type WITH COUNT INTO cnt
          RETURN { type, count: cnt }
      )
      RETURN { nodeCount, edgeCount, typeCounts }
    `);

    const results = await cursor.all();

    if (results.length === 0) {
      return { node_count: 0, edge_count: 0, node_types: {}, average_degree: 0 };
    }

    const { nodeCount, edgeCount, typeCounts } = results[0];
    const nodeTypes: Record<string, number> = {};
    for (const tc of typeCounts) {
      nodeTypes[tc.type] = tc.count;
    }

    return {
      node_count: nodeCount,
      edge_count: edgeCount,
      node_types: nodeTypes,
      average_degree: nodeCount > 0 ? edgeCount / nodeCount : 0,
    };
  }

  async deleteGraph(graphId: string, database?: string): Promise<void> {
    const db = this.getDb(database);

    // Supprimer les arêtes
    await db.query(aql`
      FOR e IN graph_edges
        FILTER e.graph_id == ${graphId}
        REMOVE e IN graph_edges
    `);

    // Supprimer les nœuds
    await db.query(aql`
      FOR n IN graph_nodes
        FILTER n.graph_id == ${graphId}
        REMOVE n IN graph_nodes
    `);

    // Supprimer le graphe
    await db.query(aql`
      FOR g IN graphs
        FILTER g.graph_id == ${graphId}
        REMOVE g IN graphs
    `);
  }

  // ===== Gestion des Databases =====

  async listDatabases(): Promise<Array<{ name: string; default: boolean; status: string }>> {
    const systemDb = new Database({
      url: this.url,
      databaseName: "_system",
      auth: { username: this.username, password: this.password },
    });

    const databases = await systemDb.listDatabases();

    return databases.map((name) => ({
      name,
      default: name === this.defaultDatabase,
      status: "online",
    }));
  }

  async createDatabase(databaseName: string): Promise<void> {
    const systemDb = new Database({
      url: this.url,
      databaseName: "_system",
      auth: { username: this.username, password: this.password },
    });

    await systemDb.createDatabase(databaseName);
    console.log(`ArangoDB database ${databaseName} created successfully`);

    // Initialiser les collections dans la nouvelle database
    const newDb = new Database({
      url: this.url,
      databaseName,
      auth: { username: this.username, password: this.password },
    });

    await newDb.createCollection("graphs");
    await newDb.createCollection("graph_nodes");
    await newDb.createEdgeCollection("graph_edges");
    console.log(`Collections created in database ${databaseName}`);
  }

  async deleteDatabase(databaseName: string): Promise<void> {
    if (databaseName === "_system") {
      throw new Error("Cannot delete the _system database");
    }

    const systemDb = new Database({
      url: this.url,
      databaseName: "_system",
      auth: { username: this.username, password: this.password },
    });

    await systemDb.dropDatabase(databaseName);
    console.log(`ArangoDB database ${databaseName} deleted successfully`);
  }

  async getDatabaseStats(databaseName: string): Promise<{
    nodeCount: number;
    relationshipCount: number;
    graphCount: number;
  }> {
    const db = this.getDb(databaseName);

    const cursor = await db.query(aql`
      RETURN {
        nodeCount: LENGTH(graph_nodes),
        relationshipCount: LENGTH(graph_edges),
        graphCount: LENGTH(graphs)
      }
    `);

    const results = await cursor.all();
    if (results.length === 0) {
      return { nodeCount: 0, relationshipCount: 0, graphCount: 0 };
    }

    return results[0];
  }

  async close(): Promise<void> {
    // arangojs n'a pas besoin de fermer explicitement la connexion
    // mais on vide le cache
    this.graphCache.flushAll();
  }
}
