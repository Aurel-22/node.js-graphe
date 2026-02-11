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
  mermaid_code: string;
}
