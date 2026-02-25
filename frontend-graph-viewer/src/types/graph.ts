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

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSummary {
  id: string;
  title: string;
  description: string;
  graph_type: string;
  node_count: number;
  edge_count: number;
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  node_types: Record<string, number>;
  average_degree: number;
}

// Pour react-force-graph
export interface ForceGraphNode {
  id: string;
  name: string;
  type: string;
  color?: string;
  val?: number;
}

export interface ForceGraphLink {
  source: string;
  target: string;
  label?: string;
  type: string;
  color?: string;
}

export interface ForceGraphData {
  nodes: ForceGraphNode[];
  links: ForceGraphLink[];
}
