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

export const graphApi = {
  // Lister tous les graphes
  listGraphs: async (database?: string): Promise<GraphSummary[]> => {
    const params = database ? { database } : {};
    const response = await api.get<GraphSummary[]>('/graphs', { params });
    return response.data;
  },

  // Obtenir un graphe spécifique
  getGraph: async (id: string, database?: string): Promise<GraphData> => {
    const params = database ? { database } : {};
    const response = await api.get<GraphData>(`/graphs/${id}`, { params });
    return response.data;
  },

  // Obtenir les statistiques d'un graphe
  getGraphStats: async (id: string, database?: string): Promise<GraphStats> => {
    const params = database ? { database } : {};
    const response = await api.get<GraphStats>(`/graphs/${id}/stats`, { params });
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
