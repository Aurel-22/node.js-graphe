import neo4j, { Driver, Session, Integer } from "neo4j-driver";
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

export class Neo4jService implements GraphDatabaseService {
  readonly engineName: string = "neo4j";
  protected driver: Driver;
  protected defaultDatabase: string = 'neo4j';
  // In-memory cache (TTL 5 minutes par défaut)
  protected graphCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

  // Statistiques de cache pour le monitoring
  protected cacheStats = { hits: 0, misses: 0, bypasses: 0 };

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      connectionAcquisitionTimeout: 10000,  // 10 secondes max pour obtenir une connexion
      connectionTimeout: 10000,             // 10 secondes max pour établir la connexion TCP
      maxConnectionPoolSize: 20,
    });
  }

  /** Convertit une valeur entière Neo4j (driver v5) ou un nombre natif (driver v4/Memgraph) en number JS */
  protected toNum(v: any): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === "number") return v;
    if (typeof v.toNumber === "function") return v.toNumber();
    return Number(v);
  }

  // Créer une session avec une database spécifique
  protected getSession(database?: string): Session {
    return this.driver.session({ 
      database: database || this.defaultDatabase 
    });
  }

  // Accès aux stats et contrôle du cache
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

  async initialize(): Promise<void> {
    console.log("Initializing Neo4j database...");

    const session = this.getSession();
    try {
      // Créer les contraintes et index
      await session.run(`
        CREATE CONSTRAINT graph_id IF NOT EXISTS
        FOR (g:Graph) REQUIRE g.id IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX node_graph_id IF NOT EXISTS
        FOR (n:GraphNode) ON (n.graph_id, n.node_id)
      `);

      console.log("Neo4j constraints and indexes created");
    } catch (err: any) {
      console.log("Constraints may already exist:", err.message);
    } finally {
      await session.close();
    }
  }

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
    const session = this.getSession(database);

    try {
      // Créer le graphe principal
      await session.run(
        `
        CREATE (g:Graph {
          id: $graphId,
          title: $title,
          description: $description,
          graph_type: $graphType,
          node_count: $nodeCount,
          edge_count: $edgeCount,
          created_at: $createdAt
        })
        `,
        {
          graphId,
          title,
          description,
          graphType,
          nodeCount: neo4j.int(nodes.length),
          edgeCount: neo4j.int(edges.length),
          createdAt,
        }
      );

      // Créer les nœuds par batch UNWIND (500 par batch)
      const BATCH_SIZE = 500;
      for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE).map(n => ({
          node_id: n.id,
          label: n.label,
          node_type: n.node_type,
          properties: JSON.stringify(n.properties),
        }));
        await session.run(
          `UNWIND $batch AS node
           CREATE (n:GraphNode {
             graph_id: $graphId,
             node_id: node.node_id,
             label: node.label,
             node_type: node.node_type,
             properties: node.properties
           })`,
          { graphId, batch }
        );
      }

      // Créer les arêtes par batch UNWIND (500 par batch)
      for (let i = 0; i < edges.length; i += BATCH_SIZE) {
        const batch = edges.slice(i, i + BATCH_SIZE).map(e => ({
          source: e.source,
          target: e.target,
          label: e.label || "",
          edge_type: e.edge_type,
          properties: JSON.stringify(e.properties),
        }));
        await session.run(
          `UNWIND $batch AS edge
           MATCH (source:GraphNode {graph_id: $graphId, node_id: edge.source})
           MATCH (target:GraphNode {graph_id: $graphId, node_id: edge.target})
           CREATE (source)-[:CONNECTED_TO {
             graph_id: $graphId,
             label: edge.label,
             edge_type: edge.edge_type,
             properties: edge.properties
           }]->(target)`,
          { graphId, batch }
        );
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
    } finally {
      await session.close();
    }
  }

  async getGraph(graphId: string, database?: string, bypassCache = false): Promise<GraphData> {
    const cacheKey = `graph:${database || this.defaultDatabase}:${graphId}`;

    // Cache lookup (sauf si bypass demandé)
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

    // Deux sessions pour requêtes parallèles
    const sessionNodes = this.getSession(database);
    const sessionEdges = this.getSession(database);

    try {
      // Requêtes en parallèle (au lieu de séquentiel)
      const [nodesResult, edgesResult] = await Promise.all([
        sessionNodes.run(
          `MATCH (n:GraphNode {graph_id: $graphId})
           RETURN n.node_id as id, n.label as label, n.node_type as node_type, n.properties as properties`,
          { graphId }
        ),
        sessionEdges.run(
          `MATCH (source:GraphNode {graph_id: $graphId})-[r:CONNECTED_TO]->(target:GraphNode {graph_id: $graphId})
           RETURN id(r) as id, source.node_id as source, target.node_id as target,
                  r.label as label, r.edge_type as edge_type, r.properties as properties`,
          { graphId }
        ),
      ]);

      const nodes: GraphNode[] = nodesResult.records.map((record) => ({
        id: record.get("id"),
        label: record.get("label"),
        node_type: record.get("node_type"),
        properties: JSON.parse(record.get("properties") || "{}"),
      }));

      const edges: GraphEdge[] = edgesResult.records.map((record) => ({
        id: record.get("id").toString(),
        source: record.get("source"),
        target: record.get("target"),
        label: record.get("label") || undefined,
        edge_type: record.get("edge_type"),
        properties: JSON.parse(record.get("properties") || "{}"),
      }));

      const result: GraphData = { nodes, edges };

      // Mise en cache du résultat
      if (!bypassCache) {
        this.graphCache.set(cacheKey, result);
      }

      return result;
    } finally {
      await Promise.all([sessionNodes.close(), sessionEdges.close()]);
    }
  }

  // Obtenir un noeud de départ (le premier noeud d'un graphe)
  async getStartingNode(graphId: string, database?: string): Promise<GraphNode | null> {
    const session = this.getSession(database);

    try {
      const result = await session.run(
        `
        MATCH (n:GraphNode {graph_id: $graphId})
        RETURN n.node_id as id, n.label as label, n.node_type as node_type, n.properties as properties
        LIMIT 1
        `,
        { graphId }
      );

      if (result.records.length === 0) {
        return null;
      }

      const record = result.records[0];
      return {
        id: record.get("id"),
        label: record.get("label"),
        node_type: record.get("node_type"),
        properties: JSON.parse(record.get("properties") || "{}"),
      };
    } finally {
      await session.close();
    }
  }

  // Obtenir les voisins d'un noeud (noeuds et arêtes directement connectés)
  async getNodeNeighbors(graphId: string, nodeId: string, depth: number = 1, database?: string): Promise<GraphData> {
    const session = this.getSession(database);

    try {
      // Récupérer les nœuds voisins et les arêtes sur la profondeur spécifiée
      // Utiliser UNION pour capturer relations sortantes ET entrantes
      const result = await session.run(
        `
        MATCH path = (n:GraphNode {graph_id: $graphId, node_id: $nodeId})-[r:CONNECTED_TO*1..${depth}]->(neighbor:GraphNode {graph_id: $graphId})
        WITH nodes(path) as pathNodes, relationships(path) as pathRels
        UNWIND pathNodes as node
        WITH collect(DISTINCT {
          id: node.node_id,
          label: node.label,
          node_type: node.node_type,
          properties: node.properties
        }) as nodesList, pathRels
        UNWIND pathRels as rel
        WITH nodesList, collect(DISTINCT {
          id: id(rel),
          source: startNode(rel).node_id,
          target: endNode(rel).node_id,
          label: rel.label,
          edge_type: rel.edge_type,
          properties: rel.properties
        }) as edgesList
        RETURN nodesList, edgesList
        
        UNION
        
        MATCH path = (n:GraphNode {graph_id: $graphId, node_id: $nodeId})<-[r:CONNECTED_TO*1..${depth}]-(neighbor:GraphNode {graph_id: $graphId})
        WITH nodes(path) as pathNodes, relationships(path) as pathRels
        UNWIND pathNodes as node
        WITH collect(DISTINCT {
          id: node.node_id,
          label: node.label,
          node_type: node.node_type,
          properties: node.properties
        }) as nodesList, pathRels
        UNWIND pathRels as rel
        WITH nodesList, collect(DISTINCT {
          id: id(rel),
          source: startNode(rel).node_id,
          target: endNode(rel).node_id,
          label: rel.label,
          edge_type: rel.edge_type,
          properties: rel.properties
        }) as edgesList
        RETURN nodesList, edgesList
        `,
        { graphId, nodeId }
      );

      const allNodes = new Map<string, GraphNode>();
      const allEdges = new Map<string, GraphEdge>();

      // Combiner les résultats des deux parties du UNION
      result.records.forEach((record) => {
        const nodes: GraphNode[] = (record.get("nodesList") || []).map((n: any) => ({
          id: n.id,
          label: n.label,
          node_type: n.node_type,
          properties: JSON.parse(n.properties || "{}"),
        }));

        const edges: GraphEdge[] = (record.get("edgesList") || []).map((e: any) => ({
          id: e.id.toString(),
          source: e.source,
          target: e.target,
          label: e.label || undefined,
          edge_type: e.edge_type,
          properties: JSON.parse(e.properties || "{}"),
        }));

        nodes.forEach(node => allNodes.set(node.id, node));
        edges.forEach(edge => allEdges.set(edge.id ?? edge.source + '-' + edge.target, edge));
      });

      return { 
        nodes: Array.from(allNodes.values()), 
        edges: Array.from(allEdges.values()) 
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Analyse d'impact côté serveur — propagation BFS sortante via Cypher.
   * Neo4j/Memgraph : traversée native index-free adjacency O(k^d),
   * nettement plus rapide que la CTE récursive MSSQL.
   */
  async computeImpact(graphId: string, nodeId: string, depth: number, database?: string): Promise<ImpactResult> {
    const t0 = Date.now();
    const maxDepth = Math.min(depth, 15);
    const session = this.getSession(database);
    try {
      const result = await session.run(
        `MATCH path = (source:GraphNode {graph_id: $graphId, node_id: $nodeId})
               -[:CONNECTED_TO*1..${maxDepth}]->
               (n:GraphNode {graph_id: $graphId})
         RETURN n.node_id AS nodeId, min(length(path)) AS level`,
        { graphId, nodeId }
      );

      const impactedNodes = result.records.map((r) => ({
        nodeId: r.get("nodeId") as string,
        level: this.toNum(r.get("level")),
      }));

      return {
        sourceNodeId: nodeId,
        impactedNodes,
        depth: maxDepth,
        elapsed_ms: Date.now() - t0,
        engine: this.engineName,
      };
    } finally {
      await session.close();
    }
  }

  async listGraphs(database?: string): Promise<GraphSummary[]> {
    const session = this.getSession(database);

    try {
      const result = await session.run(`
        MATCH (g:Graph)
        RETURN g.id as id, g.title as title, g.description as description,
               g.graph_type as graph_type, g.node_count as node_count, g.edge_count as edge_count
        ORDER BY g.created_at DESC
      `);

      return result.records.map((record) => ({
        id: record.get("id"),
        title: record.get("title"),
        description: record.get("description"),
        graph_type: record.get("graph_type"),
        node_count: this.toNum(record.get("node_count")),
        edge_count: this.toNum(record.get("edge_count")),
      }));
    } finally {
      await session.close();
    }
  }

  async getGraphStats(graphId: string, database?: string): Promise<GraphStats> {
    const session = this.getSession(database);

    try {
      const result = await session.run(
        `
        MATCH (n:GraphNode {graph_id: $graphId})
        OPTIONAL MATCH (n)-[r:CONNECTED_TO {graph_id: $graphId}]-()
        WITH count(DISTINCT n) as node_count, 
             count(DISTINCT r) as edge_count,
             collect(DISTINCT n.node_type) as types,
             n.node_type as node_type
        WITH node_count, edge_count, 
             collect({type: node_type, count: count(*)}) as type_counts
        RETURN node_count, edge_count, type_counts
        `,
        { graphId }
      );

      if (result.records.length === 0) {
        return {
          node_count: 0,
          edge_count: 0,
          node_types: {},
          average_degree: 0,
        };
      }

      const record = result.records[0];
      const nodeCount = this.toNum(record.get("node_count"));
      const edgeCount = this.toNum(record.get("edge_count"));

      // Récupérer les types de nœuds
      const typesResult = await session.run(
        `
        MATCH (n:GraphNode {graph_id: $graphId})
        RETURN n.node_type as type, count(*) as count
        `,
        { graphId }
      );

      const nodeTypes: Record<string, number> = {};
      typesResult.records.forEach((rec) => {
        nodeTypes[rec.get("type")] = this.toNum(rec.get("count"));
      });

      return {
        node_count: nodeCount,
        edge_count: edgeCount,
        node_types: nodeTypes,
        average_degree: nodeCount > 0 ? edgeCount / nodeCount : 0,
      };
    } finally {
      await session.close();
    }
  }

  async deleteGraph(graphId: string, database?: string): Promise<void> {
    const session = this.getSession(database);

    try {
      // Supprimer les nœuds et leurs relations
      await session.run(
        `
        MATCH (n:GraphNode {graph_id: $graphId})
        DETACH DELETE n
        `,
        { graphId }
      );

      // Supprimer le graphe principal
      await session.run(
        `
        MATCH (g:Graph {id: $graphId})
        DELETE g
        `,
        { graphId }
      );
    } finally {
      await session.close();
    }
  }

  async createExampleGraph(): Promise<Graph> {
    console.log("Creating example graph...");

    const nodes: GraphNode[] = [
      { id: "A", label: "Start", node_type: "start", properties: {} },
      { id: "B", label: "Process 1", node_type: "process", properties: {} },
      { id: "C", label: "Decision", node_type: "decision", properties: {} },
      { id: "D", label: "Process 2A", node_type: "process", properties: {} },
      { id: "E", label: "Process 2B", node_type: "process", properties: {} },
      { id: "F", label: "Merge", node_type: "process", properties: {} },
      { id: "G", label: "Validate", node_type: "process", properties: {} },
      { id: "H", label: "Success", node_type: "end", properties: {} },
      { id: "I", label: "Error", node_type: "error", properties: {} },
      { id: "J", label: "Retry", node_type: "process", properties: {} },
      { id: "K", label: "Log", node_type: "process", properties: {} },
    ];

    const edges: GraphEdge[] = [
      {
        source: "A",
        target: "B",
        label: "Start",
        edge_type: "next",
        properties: {},
      },
      {
        source: "B",
        target: "C",
        label: "Process",
        edge_type: "next",
        properties: {},
      },
      {
        source: "C",
        target: "D",
        label: "Yes",
        edge_type: "condition",
        properties: {},
      },
      {
        source: "C",
        target: "E",
        label: "No",
        edge_type: "condition",
        properties: {},
      },
      { source: "D", target: "F", edge_type: "next", properties: {} },
      { source: "E", target: "F", edge_type: "next", properties: {} },
      {
        source: "F",
        target: "G",
        label: "Merged",
        edge_type: "next",
        properties: {},
      },
      {
        source: "G",
        target: "H",
        label: "Valid",
        edge_type: "condition",
        properties: {},
      },
      {
        source: "G",
        target: "I",
        label: "Invalid",
        edge_type: "condition",
        properties: {},
      },
      {
        source: "I",
        target: "J",
        label: "Retry",
        edge_type: "retry",
        properties: {},
      },
      { source: "J", target: "B", edge_type: "next", properties: {} },
      {
        source: "B",
        target: "K",
        label: "Log",
        edge_type: "log",
        properties: {},
      },
      {
        source: "F",
        target: "K",
        label: "Log",
        edge_type: "log",
        properties: {},
      },
      {
        source: "G",
        target: "K",
        label: "Log",
        edge_type: "log",
        properties: {},
      },
    ];

    return await this.createGraph(
      "example",
      "Example Workflow",
      "A demonstration workflow",
      "flowchart",
      nodes,
      edges
    );
  }

  async createXLargeTestGraph(): Promise<Graph> {
    console.log("Creating extra large DENSE test graph with 20,000 nodes...");

    const nodeCount = 20_000;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Créer les nœuds
    for (let i = 0; i < nodeCount; i++) {
      const nodeType = ["start", "process", "decision", "end", "process"][
        i % 5
      ];
      nodes.push({
        id: `XL${i}`,
        label: `Node ${i}`,
        node_type: nodeType,
        properties: {},
      });
    }

    // Créer les arêtes (graphe dense avec 3-10 connexions par nœud)
    for (let i = 0; i < nodeCount; i++) {
      // 1. Connexion suivante
      if (i < nodeCount - 1) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 1}`,
          edge_type: "next",
          properties: {},
        });
      }

      // 2. Connexion précédente (bidirectionalité partielle)
      if (i > 0 && i % 3 === 0) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i - 1}`,
          edge_type: "back",
          properties: {},
        });
      }

      // 3. Connexion +5 (proche voisinage)
      if (i + 5 < nodeCount) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 5}`,
          label: "near",
          edge_type: "relation",
          properties: {},
        });
      }

      // 4. Connexion +10 (voisinage moyen)
      if (i + 10 < nodeCount && i % 2 === 0) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 10}`,
          label: "mid",
          edge_type: "relation",
          properties: {},
        });
      }

      // 5. Connexion +20 (cluster)
      if (i + 20 < nodeCount) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 20}`,
          label: "cluster",
          edge_type: "condition",
          properties: {},
        });
      }

      // 6. Connexion +50 (long range)
      if (i + 50 < nodeCount && i % 5 === 0) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 50}`,
          label: "long",
          edge_type: "skip",
          properties: {},
        });
      }

      // 7. Connexion +100 (très long range)
      if (i + 100 < nodeCount && i % 10 === 0) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 100}`,
          label: "distant",
          edge_type: "skip",
          properties: {},
        });
      }

      // 8. Connexion +200 (cross-cluster)
      if (i + 200 < nodeCount && i % 20 === 0) {
        edges.push({
          source: `XL${i}`,
          target: `XL${i + 200}`,
          label: "cross",
          edge_type: "skip",
          properties: {},
        });
      }

      // 9. Connexion aléatoire locale
      if (i + 15 < nodeCount && i % 7 === 0) {
        const offset = 15 + (i % 15);
        if (i + offset < nodeCount) {
          edges.push({
            source: `XL${i}`,
            target: `XL${i + offset}`,
            label: "random",
            edge_type: "relation",
            properties: {},
          });
        }
      }

      // 10. Connexion "hub"
      if (i % 100 === 0) {
        for (let j = 1; j <= 3; j++) {
          if (i + j * 30 < nodeCount) {
            edges.push({
              source: `XL${i}`,
              target: `XL${i + j * 30}`,
              label: "hub",
              edge_type: "relation",
              properties: {},
            });
          }
        }
      }
    }

    console.log(
      `Generated ${nodes.length} nodes and ${edges.length} edges (${(edges.length / nodes.length).toFixed(1)} edges per node)`
    );

    return await this.createGraph(
      "xlarge_test",
      "Extra Large Dense Test Graph",
      "An extra large dense test graph with 20,000 nodes and 3-10 edges per node",
      "network",
      nodes,
      edges
    );
  }

  // ========== Gestion des Databases (Mode Cluster) ==========

  async listDatabases(): Promise<Array<{ name: string; default: boolean; status: string }>> {
    const session = this.getSession('system');

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SHOW DATABASES timed out after 8s')), 8000)
      );
      const result = await Promise.race([
        session.run('SHOW DATABASES', {}, { timeout: 7000 }),
        timeout,
      ]);
      
      return result.records.map((record) => ({
        name: record.get('name'),
        default: record.get('default') || false,
        status: record.get('currentStatus') || 'unknown',
      }));
    } finally {
      await session.close();
    }
  }

  async createDatabase(databaseName: string): Promise<void> {
    const session = this.getSession('system');

    try {
      await session.run(`CREATE DATABASE \`${databaseName}\` IF NOT EXISTS`);
      console.log(`Database ${databaseName} created successfully`);
    } catch (err: any) {
      console.error(`Failed to create database ${databaseName}:`, err.message);
      throw err;
    } finally {
      await session.close();
    }
  }

  async deleteDatabase(databaseName: string): Promise<void> {
    if (databaseName === 'neo4j' || databaseName === 'system') {
      throw new Error('Cannot delete system databases (neo4j, system)');
    }

    const session = this.getSession('system');

    try {
      await session.run(`DROP DATABASE \`${databaseName}\` IF EXISTS`);
      console.log(`Database ${databaseName} deleted successfully`);
    } catch (err: any) {
      console.error(`Failed to delete database ${databaseName}:`, err.message);
      throw err;
    } finally {
      await session.close();
    }
  }

  async getDatabaseStats(databaseName: string): Promise<{ 
    nodeCount: number; 
    relationshipCount: number;
    graphCount: number;
  }> {
    const session = this.getSession(databaseName);

    try {
      const result = await session.run(`
        MATCH (n)
        OPTIONAL MATCH ()-[r]->()
        OPTIONAL MATCH (g:Graph)
        RETURN count(DISTINCT n) as nodeCount, 
               count(DISTINCT r) as relationshipCount,
               count(DISTINCT g) as graphCount
      `);

      const record = result.records[0];
      return {
        nodeCount: this.toNum(record.get('nodeCount')),
        relationshipCount: this.toNum(record.get('relationshipCount')),
        graphCount: this.toNum(record.get('graphCount')),
      };
    } finally {
      await session.close();
    }
  }

  // ===== Raw Query Execution =====

  async executeRawQuery(
    query: string,
    database?: string,
  ): Promise<{ rows: Record<string, any>[]; elapsed_ms: number; rowCount: number; engine: string }> {
    const session = this.getSession(database);
    try {
      const t0 = Date.now();
      const result = await session.run(query);
      const elapsed_ms = Date.now() - t0;

      const rows = result.records.map((record) => {
        const obj: Record<string, any> = {};
        record.keys.forEach((key) => {
          const val = record.get(key);
          // Convert Neo4j Integer to JS number
          if (val && typeof val === 'object' && typeof val.toNumber === 'function') {
            obj[key as string] = val.toNumber();
          } else if (val && typeof val === 'object' && val.properties) {
            // Neo4j Node — extract properties
            obj[key as string] = { ...val.properties, _labels: val.labels };
          } else {
            obj[key as string] = val;
          }
        });
        return obj;
      });

      return { rows, elapsed_ms, rowCount: rows.length, engine: this.engineName };
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
