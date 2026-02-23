import axios from 'axios';
import { GraphData, GraphSummary, GraphStats } from '../types/graph';

const API_BASE_URL = 'http://127.0.0.1:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
}

export interface CacheStats {
  hits: number;
  misses: number;
  bypasses: number;
  cachedGraphs: number;
  keys: string[];
}

export const graphApi = {
  // Lister tous les graphes
  listGraphs: async (database?: string): Promise<GraphSummary[]> => {
    const params = database ? { database } : {};
    const response = await api.get<GraphSummary[]>('/graphs', { params });
    return response.data;
  },

  // Obtenir un graphe (avec mesures de performance)
  getGraph: async (
    id: string,
    database?: string,
    options?: { nocache?: boolean; nocompress?: boolean }
  ): Promise<GraphLoadResult> => {
    const params: Record<string, string> = {};
    if (database) params.database = database;
    if (options?.nocache) params.nocache = 'true';
    if (options?.nocompress) params.nocompress = 'true';

    const t0 = performance.now();
    const response = await api.get<GraphData>(`/graphs/${id}`, { params });
    const timeMs = Math.round(performance.now() - t0);

    const cacheHeader = response.headers['x-cache'] || response.headers['X-Cache'];
    const responseTimeHeader = response.headers['x-response-time'] || response.headers['X-Response-Time'] || null;
    const contentLengthStr = response.headers['content-length'];
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : null;
    const rawLengthStr = response.headers['x-content-length-raw'] || response.headers['X-Content-Length-Raw'];
    const rawContentLength = rawLengthStr ? parseInt(rawLengthStr, 10) : null;
    const parallelQueries = (response.headers['x-parallel-queries'] || response.headers['X-Parallel-Queries']) === 'true';

    return {
      data: response.data,
      timeMs,
      cacheStatus: (cacheHeader as GraphLoadResult['cacheStatus']) ?? 'unknown',
      responseTimeHeader,
      contentLength,
      rawContentLength,
      parallelQueries,
    };
  },

  // Obtenir les statistiques d'un graphe
  getGraphStats: async (id: string, database?: string): Promise<GraphStats> => {
    const params = database ? { database } : {};
    const response = await api.get<GraphStats>(`/graphs/${id}/stats`, { params });
    return response.data;
  },

  // Obtenir un noeud de départ pour un graphe
  getStartingNode: async (id: string, database?: string): Promise<GraphData['nodes'][0]> => {
    const params = database ? { database } : {};
    const response = await api.get(`/graphs/${id}/starting-node`, { params });
    return response.data;
  },

  // Obtenir les voisins d'un noeud
  getNodeNeighbors: async (graphId: string, nodeId: string, depth: number = 1, database?: string): Promise<GraphData> => {
    const params = database ? { database, depth: depth.toString() } : { depth: depth.toString() };
    const response = await api.get<GraphData>(`/graphs/${graphId}/nodes/${nodeId}/neighbors`, { params });
    return response.data;
  },

  // Health check
  healthCheck: async (): Promise<{ status: string; timestamp: string }> => {
    const response = await api.get('/health');
    return response.data;
  },
};

export const databaseApi = {
  // Lister toutes les databases
  listDatabases: async (): Promise<Database[]> => {
    const response = await api.get<Database[]>('/databases');
    return response.data;
  },

  // Créer une nouvelle database
  createDatabase: async (name: string): Promise<{ message: string; name: string }> => {
    const response = await api.post('/databases', { name });
    return response.data;
  },

  // Supprimer une database
  deleteDatabase: async (name: string): Promise<{ message: string }> => {
    const response = await api.delete(`/databases/${name}`);
    return response.data;
  },

  // Obtenir les statistiques d'une database
  getDatabaseStats: async (name: string): Promise<DatabaseStats> => {
    const response = await api.get<DatabaseStats>(`/databases/${name}/stats`);
    return response.data;
  },
};

export const optimApi = {
  // Stats du cache backend
  getCacheStats: async (): Promise<CacheStats> => {
    const response = await api.get<CacheStats>('/optim/cache/stats');
    return response.data;
  },

  // Vider le cache
  clearCache: async (): Promise<{ message: string; cleared: string[] }> => {
    const response = await api.delete('/optim/cache');
    return response.data;
  },

  // Statut des optimisations
  getStatus: async () => {
    const response = await api.get('/optim/status');
    return response.data;
  },
};
