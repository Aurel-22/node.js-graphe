import {
  Graph,
  GraphData,
  GraphNode,
  GraphEdge,
  GraphStats,
  GraphSummary,
  ImpactResult,
} from "../models/graph.js";

/**
 * Interface commune pour les services de base de données graphe.
 */
export interface GraphDatabaseService {
  /** Nom du moteur (pour le logging / headers) */
  readonly engineName: string;

  /** Initialisation (index, contraintes, etc.) */
  initialize(): Promise<void>;

  /** Fermer la connexion */
  close(): Promise<void>;

  // ===== CRUD Graphes =====

  createGraph(
    graphId: string,
    title: string,
    description: string,
    graphType: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    database?: string,
  ): Promise<Graph>;

  getGraph(graphId: string, database?: string, bypassCache?: boolean): Promise<GraphData>;

  listGraphs(database?: string): Promise<GraphSummary[]>;

  getGraphStats(graphId: string, database?: string): Promise<GraphStats>;

  deleteGraph(graphId: string, database?: string): Promise<void>;

  // ===== Navigation =====

  getStartingNode(graphId: string, database?: string): Promise<GraphNode | null>;

  getNodeNeighbors(
    graphId: string,
    nodeId: string,
    depth: number,
    database?: string,
  ): Promise<GraphData>;

  /**
   * Analyse d'impact côté serveur : BFS depuis nodeId sur les arêtes sortantes.
   * Retourne les nœuds impactés avec leur niveau (distance depuis la source).
   */
  computeImpact(
    graphId: string,
    nodeId: string,
    depth: number,
    database?: string,
    threshold?: number,
  ): Promise<ImpactResult>;

  // ===== Cache =====

  /**
   * Exécuter une requête brute SQL.
   * Retourne les résultats + le temps d'exécution.
   */
  executeRawQuery?(
    query: string,
    database?: string,
  ): Promise<{ rows: Record<string, any>[]; elapsed_ms: number; rowCount: number; engine: string }>;

  getCacheStats(): {
    hits: number;
    misses: number;
    bypasses: number;
    cachedGraphs: number;
    keys: string[];
    nodeCache?: any;
  };

  clearCache(graphId?: string, database?: string): { cleared: string[] };

  // ===== Databases =====

  listDatabases(): Promise<Array<{ name: string; default: boolean; status: string }>>;
  createDatabase(databaseName: string): Promise<void>;
  deleteDatabase(databaseName: string): Promise<void>;
  getDatabaseStats(databaseName: string): Promise<{
    nodeCount: number;
    relationshipCount: number;
    graphCount: number;
  }>;
}
