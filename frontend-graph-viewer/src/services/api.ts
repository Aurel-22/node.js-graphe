import axios from 'axios';
import { decode } from '@msgpack/msgpack';
import { GraphData, GraphSummary, GraphStats } from '../types/graph';

const API_BASE_URL = 'http://172.23.0.162:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export type EngineType = 'mssql';

export interface Database {
  name: string;
  default: boolean;
  status: string;
}

export interface DatabaseStats {
  nodeCount: number;
  relationshipCount: number;
  graphCount: number;
}

export interface GraphLoadResult {
  data: GraphData;
  timeMs: number;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'unknown';
  responseTimeHeader: string | null;
  contentLength: number | null;    // taille compressée (gzip) en octets
  rawContentLength: number | null; // taille brute (avant gzip) en octets
  parallelQueries: boolean;
  engine: string;                  // moteur utilisé
  format: 'json' | 'msgpack';     // format de réponse
  enriched: boolean;               // données enrichies EasyVista
}

export interface CacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  cachedGraphs: number;
  keys: string[];
}

/** Résultat d'une analyse d'impact côté serveur. */
export interface ImpactResult {
  sourceNodeId: string;
  impactedNodes: Array<{ nodeId: string; level: number }>;
  depth: number;
  threshold: number;
  elapsed_ms: number;
  engine: string;
}

/** Résultat d'exécution d'une requête brute SQL. */
export interface RawQueryResult {
  rows: Record<string, any>[];
  elapsed_ms: number;
  rowCount: number;
  engine: string;
  error?: string;
  /** Temps total round-trip (réseau + DB + sérialisation), mesuré côté client. */
  totalMs?: number;
}

/** Résultat du benchmark SQL vs Cache vs JSON. */
export interface BenchmarkTimings {
  times: number[];
  avg: number;
  min: number;
  max: number;
  label: string;
}

export interface BenchmarkResult {
  graphId: string;
  engine: string;
  database: string;
  iterations: number;
  nodeCount: number;
  edgeCount: number;
  jsonSizeBytes: number;
  jsonSizeKB: number;
  msgpackSizeBytes: number;
  msgpackSizeKB: number;
  compressionRatio: number;        // % réduction msgpack vs json
  sql: BenchmarkTimings;
  cache: BenchmarkTimings;
  json: BenchmarkTimings;
  msgpack: BenchmarkTimings;
  enrich?: BenchmarkTimings;       // présent si nœuds CI_ détectés
  coveringIndexes?: boolean;       // état des covering indexes
  speedup: {
    cacheVsSql: number;
    jsonVsSql: number;
    msgpackVsJson: number;
  };
}

// ─── Algorithm result types ────────────────────────────────

export interface TraversalResult {
  visitedNodes: Array<{ nodeId: string; level: number; parent: string | null }>;
  visitedCount: number;
  maxDepth: number;
}

export interface ShortestPathResult {
  path: string[];
  cost: number;
  exploredCount: number;
}

export interface CentralityResultData {
  scores: Array<{ nodeId: string; score: number }>;
  stats: { min: number; max: number; avg: number; median: number };
}

export interface CommunityResultData {
  communities: Record<string, string[]>;
  communityCount: number;
  modularity: number | null;
}

export interface TopologicalSortResult {
  order: string[];
  hasCycle: boolean;
}

export interface AlgorithmResult {
  algorithm: string;
  elapsed_ms: number;
  nodeCount: number;
  edgeCount: number;
  result:
    | { type: 'traversal'; data: TraversalResult }
    | { type: 'shortestPath'; data: ShortestPathResult }
    | { type: 'centrality'; data: CentralityResultData }
    | { type: 'community'; data: CommunityResultData }
    | { type: 'topologicalSort'; data: TopologicalSortResult };
}

export interface EngineInfo {
  available: string[];
  default: string;
}

export interface CreateGraphRequest {
  title: string;
  description: string;
  graph_type: string;
  mermaid_code?: string;
  nodes?: Array<{ id: string; label: string; node_type: string; properties?: Record<string, any> }>;
  edges?: Array<{ source: string; target: string; label?: string; edge_type: string; properties?: Record<string, any> }>;
}

export const graphApi = {
  // Créer un nouveau graphe
  createGraph: async (
    request: CreateGraphRequest,
    database?: string,
    engine?: EngineType,
  ): Promise<GraphSummary> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.post<GraphSummary>('/graphs', request, { params });
    return response.data;
  },

  // Supprimer un graphe
  deleteGraph: async (id: string, database?: string, engine?: EngineType): Promise<void> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    await api.delete(`/graphs/${id}`, { params });
  },

  // Lister tous les graphes
  listGraphs: async (database?: string, engine?: EngineType): Promise<GraphSummary[]> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get<GraphSummary[]>('/graphs', { params });
    return response.data;
  },

  // Obtenir un graphe (avec mesures de performance)
  getGraph: async (
    id: string,
    database?: string,
    options?: { nocache?: boolean; nocompress?: boolean; compress?: 'gzip' | 'brotli'; engine?: EngineType; format?: 'json' | 'msgpack'; enrich?: boolean; forjson?: boolean; stream?: boolean }
  ): Promise<GraphLoadResult> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (options?.nocache) params.nocache = 'true';
    if (options?.nocompress) params.nocompress = 'true';
    if (options?.compress === 'brotli') params.compress = 'brotli';
    if (options?.compress === 'gzip') params.compress = 'gzip';
    if (options?.engine) params.engine = options.engine;
    if (options?.format) params.format = options.format;
    if (options?.enrich) params.enrich = 'true';
    if (options?.forjson) params.forjson = 'true';
    if (options?.stream) params.stream = 'true';

    const useMsgpack = options?.format === 'msgpack';
    const useBrotli = options?.compress === 'brotli';

    const t0 = performance.now();
    // Brotli responses are raw compressed bytes (application/octet-stream) — always fetch as arraybuffer
    const response = (useMsgpack || useBrotli)
      ? await api.get(`/graphs/${id}`, { params, responseType: 'arraybuffer' })
      : await api.get<GraphData>(`/graphs/${id}`, { params });
    const timeMs = Math.round(performance.now() - t0);

    let data: GraphData;
    if (useBrotli) {
      // Brotli responses are opaque compressed bytes — skip decoding.
      // The simulation only needs timing and sizes from headers.
      data = { nodes: [], edges: [] };
    } else if (useMsgpack) {
      data = decode(new Uint8Array(response.data as ArrayBuffer)) as GraphData;
    } else {
      data = response.data as GraphData;
    }

    const cacheHeader = response.headers['x-cache'] || response.headers['X-Cache'];
    const responseTimeHeader = response.headers['x-response-time'] || response.headers['X-Response-Time'] || null;
    const contentLengthStr = response.headers['content-length'];
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : null;
    const brotliSizeStr = response.headers['x-brotli-size'] || response.headers['X-Brotli-Size'];
    // For brotli: use X-Brotli-Size as compressed size (Content-Length = compressed for octet-stream)
    const compressedSize = brotliSizeStr ? parseInt(brotliSizeStr, 10) : contentLength;
    const rawLengthStr = response.headers['x-content-length-raw'] || response.headers['X-Content-Length-Raw'];
    const rawContentLength = rawLengthStr ? parseInt(rawLengthStr, 10) : null;
    const parallelQueries = (response.headers['x-parallel-queries'] || response.headers['X-Parallel-Queries']) === 'true';
    const engineHeader = response.headers['x-engine'] || response.headers['X-Engine'] || 'unknown';
    const formatHeader = response.headers['x-format'] || 'json';
    const enrichedHeader = response.headers['x-enriched'] === 'true';

    return {
      data,
      timeMs,
      cacheStatus: (cacheHeader as GraphLoadResult['cacheStatus']) ?? 'unknown',
      responseTimeHeader,
      contentLength: compressedSize,
      rawContentLength,
      parallelQueries,
      engine: engineHeader,
      format: formatHeader as 'json' | 'msgpack',
      enriched: enrichedHeader,
    };
  },

  // Obtenir les statistiques d'un graphe
  getGraphStats: async (id: string, database?: string, engine?: EngineType): Promise<GraphStats> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get<GraphStats>(`/graphs/${id}/stats`, { params });
    return response.data;
  },

  // Obtenir un noeud de départ pour un graphe
  getStartingNode: async (id: string, database?: string, engine?: EngineType): Promise<GraphData['nodes'][0]> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get(`/graphs/${id}/starting-node`, { params });
    return response.data;
  },

  // Obtenir les voisins d'un noeud
  getNodeNeighbors: async (graphId: string, nodeId: string, depth: number = 1, database?: string, engine?: EngineType): Promise<GraphData> => {
    const params: Record<string, string> = { depth: depth.toString() };
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get<GraphData>(`/graphs/${graphId}/nodes/${nodeId}/neighbors`, { params });
    return response.data;
  },

  // Analyse d'impact côté serveur
  computeImpact: async (
    graphId: string,
    nodeId: string,
    depth: number = 5,
    database?: string,
    engine?: EngineType,
    threshold: number = 0,
  ): Promise<ImpactResult> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.post<ImpactResult>(
      `/graphs/${graphId}/impact`,
      { nodeId, depth, threshold },
      { params },
    );
    return response.data;
  },

  // Health check
  healthCheck: async (): Promise<{ status: string; timestamp: string }> => {
    const response = await api.get('/health');
    return response.data;
  },

  // Exécuter une requête brute SQL
  executeQuery: async (
    query: string,
    database?: string,
    engine?: EngineType,
  ): Promise<RawQueryResult> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    try {
      const response = await api.post<RawQueryResult>('/query', { query }, { params });
      return response.data;
    } catch (err: any) {
      const errData = err?.response?.data;
      return {
        rows: [],
        elapsed_ms: 0,
        rowCount: 0,
        engine: errData?.engine || engine || 'unknown',
        error: errData?.error || err.message || 'Query failed',
      };
    }
  },

  // Benchmark SQL vs Cache vs JSON
  benchmarkGraph: async (
    graphId: string,
    database?: string,
    engine?: EngineType,
    iterations: number = 3,
  ): Promise<BenchmarkResult> => {
    const params: Record<string, string> = { iterations: iterations.toString() };
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get<BenchmarkResult>(`/graphs/${graphId}/benchmark`, { params });
    return response.data;
  },
};

export const cmdbApi = {
  /** Importer les CIs EasyVista comme graphe */
  importCmdb: async (
    limit: number = 800,
    database?: string,
    engine?: EngineType,
  ): Promise<any> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.post('/cmdb/import', { limit }, { params });
    return response.data;
  },

  /** Lecture directe depuis DATA_VALEO (lecture seule, pas d'écriture) */
  viewValeo: async (
    mode: string = 'cluster',
    hubs: number = 10,
    limit: number = 800,
    types?: string,
  ): Promise<any> => {
    const params: Record<string, any> = { mode, hubs, limit };
    if (types) params.types = types;
    const response = await api.get('/cmdb/view-valeo', { params });
    return response.data;
  },

  /** Récupérer la hiérarchie de classification (familles + types) */
  getClassifications: async (): Promise<{
    families: Array<{ id: number; label: string; asset_count: number }>;
    types: Array<{ id: number; label: string; parent_id: number | null; asset_count: number }>;
  }> => {
    const response = await api.get('/cmdb/classifications');
    return response.data;
  },

  /** Rechercher des CIs dans DATA_VALEO par nom/tag */
  searchCi: async (q: string, limit: number = 30): Promise<Array<{
    asset_id: number; nom: string; nDeCI: string;
    type_label: string; type_id: number; degree: number;
  }>> => {
    const response = await api.get('/cmdb/search-ci', { params: { q, limit } });
    return response.data;
  },

  /** Expandre les voisins d'un ensemble de CIs */
  expandCi: async (ids: number[]): Promise<{
    nodes: Array<any>; edges: Array<any>; elapsed_ms: number;
  }> => {
    const response = await api.get('/cmdb/expand-ci', { params: { ids: ids.join(',') } });
    return response.data;
  },
};

export const databaseApi = {
  // Lister toutes les databases
  listDatabases: async (engine?: EngineType): Promise<Database[]> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.get<Database[]>('/databases', { params });
    return response.data;
  },

  // Créer une nouvelle database
  createDatabase: async (name: string, engine?: EngineType): Promise<{ message: string; name: string }> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.post('/databases', { name }, { params });
    return response.data;
  },

  // Supprimer une database
  deleteDatabase: async (name: string, engine?: EngineType): Promise<{ message: string }> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.delete(`/databases/${name}`, { params });
    return response.data;
  },

  // Obtenir les statistiques d'une database
  getDatabaseStats: async (name: string, engine?: EngineType): Promise<DatabaseStats> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.get<DatabaseStats>(`/databases/${name}/stats`, { params });
    return response.data;
  },
};

export const optimApi = {
  // Stats du cache backend
  getCacheStats: async (engine?: EngineType): Promise<CacheStats> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.get<CacheStats>('/optim/cache/stats', { params });
    return response.data;
  },

  // Vider le cache
  clearCache: async (engine?: EngineType): Promise<{ message: string; cleared: string[] }> => {
    const params: Record<string, string> = {};
    if (engine) params.engine = engine;
    const response = await api.delete('/optim/cache', { params });
    return response.data;
  },

  // Statut des optimisations
  getStatus: async (database?: string, engine?: EngineType) => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get('/optim/status', { params });
    return response.data;
  },

  // ── Covering Indexes ──

  /** Vérifier si les covering indexes existent */
  hasCoveringIndexes: async (database?: string, engine?: EngineType): Promise<{ coveringIndexes: boolean; database: string }> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get('/optim/indexes/covering', { params });
    return response.data;
  },

  /** Créer les covering indexes */
  createCoveringIndexes: async (database?: string, engine?: EngineType): Promise<{ message: string }> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.post('/optim/indexes/covering', {}, { params });
    return response.data;
  },

  /** Supprimer les covering indexes */
  dropCoveringIndexes: async (database?: string, engine?: EngineType): Promise<{ message: string }> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.delete('/optim/indexes/covering', { params });
    return response.data;
  },
};

export const engineApi = {
  // Lister les moteurs disponibles
  getEngines: async (): Promise<EngineInfo> => {
    const response = await api.get<EngineInfo>('/engines');
    return response.data;
  },
};

export const algorithmApi = {
  /** Lister les algorithmes disponibles */
  listAlgorithms: async (
    graphId: string,
    database?: string,
    engine?: EngineType,
  ): Promise<{ algorithms: string[] }> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.get<{ algorithms: string[] }>(`/graphs/${graphId}/algorithms`, { params });
    return response.data;
  },

  /** Exécuter un algorithme sur un graphe */
  runAlgorithm: async (
    graphId: string,
    algorithm: string,
    options?: {
      sourceNode?: string;
      targetNode?: string;
      depth?: number;
      iterations?: number;
      damping?: number;
      threshold?: number;
      sampleSize?: number;
    },
    database?: string,
    engine?: EngineType,
  ): Promise<AlgorithmResult> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (engine) params.engine = engine;
    const response = await api.post<AlgorithmResult>(
      `/graphs/${graphId}/algorithms`,
      { algorithm, ...options },
      { params },
    );
    return response.data;
  },
};
