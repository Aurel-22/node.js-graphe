export interface GraphNode {
  id: string;
  label: string;
  node_type: string;
  properties: Record<string, any>;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  edge_type: string;
  properties: Record<string, any>;
}

export interface Graph {
  id: string;
  title: string;
  description: string;
  graph_type: string;
  node_count: number;
  edge_count: number;
  created_at: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  node_types: Record<string, number>;
  average_degree: number;
}

export interface GraphSummary {
  id: string;
  title: string;
  description: string;
  graph_type: string;
  node_count: number;
  edge_count: number;
}

export interface CreateGraphRequest {
  title: string;
  description: string;
  graph_type: string;
  // Option A — parsing Mermaid
  mermaid_code?: string;
  // Option B — nœuds/arêtes fournis directement (grands graphes)
  nodes?: Array<{ id: string; label: string; node_type: string; properties?: Record<string, any> }>;
  edges?: Array<{ source: string; target: string; label?: string; edge_type: string; properties?: Record<string, any> }>;
}

/**
 * Résultat d'une analyse d'impact côté serveur.
 * Retourné par le endpoint POST /api/graphs/:id/impact
 */
export interface ImpactResult {
  /** Nœud source (point de panne) */
  sourceNodeId: string;
  /** Nœuds impactés en aval, avec leur niveau de propagation */
  impactedNodes: Array<{ nodeId: string; level: number }>;
  /** Profondeur maximale utilisée */
  depth: number;
  /** Temps d'exécution en millisecondes (mesure serveur) */
  elapsed_ms: number;
  /** Moteur de base de données ayant produit ce résultat */
  engine: string;
}
