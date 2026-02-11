import { GraphNode, GraphEdge, ForceGraphData, ForceGraphNode, ForceGraphLink } from '../types/graph';

// Couleurs par type de nœud
const NODE_COLORS: Record<string, string> = {
  // Types de workflow
  start: '#4CAF50',      // Vert
  end: '#F44336',        // Rouge
  error: '#FF5722',      // Orange foncé
  decision: '#FF9800',   // Orange
  process: '#2196F3',    // Bleu
  
  // Types supplémentaires
  action: '#9C27B0',     // Violet
  validation: '#00BCD4', // Cyan
  data: '#8BC34A',       // Vert clair
  api: '#FFC107',        // Jaune
  database: '#795548',   // Marron
  service: '#607D8B',    // Gris bleu
  user: '#E91E63',       // Rose
  system: '#673AB7',     // Violet foncé
  notification: '#FFEB3B', // Jaune vif
  log: '#9E9E9E',        // Gris
  queue: '#FF5722',      // Orange rouge
  timer: '#00E676',      // Vert néon
  condition: '#FF6F00',  // Orange foncé
  loop: '#536DFE',       // Bleu indigo
  merge: '#651FFF',      // Violet profond
  split: '#00B0FF',      // Bleu clair
  
  // Défaut
  default: '#9E9E9E',
};

// Générateur de couleur déterministe pour types inconnus
const generateColorFromString = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Générer une couleur vive et contrastée
  const h = Math.abs(hash % 360);
  const s = 65 + (Math.abs(hash) % 20); // 65-85%
  const l = 50 + (Math.abs(hash >> 8) % 15); // 50-65%
  
  return `hsl(${h}, ${s}%, ${l}%)`;
};

// Couleurs par type d'arête
const EDGE_COLORS: Record<string, string> = {
  next: '#666666',
  condition: '#FF9800',
  retry: '#F44336',
  log: '#9C27B0',
  relation: '#00BCD4',
  strong: '#000000',
  optional: '#BDBDBD',
  default: '#999999',
};

export function transformGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[]
): ForceGraphData {
  const forceNodes: ForceGraphNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.label,
    type: node.node_type,
    color: NODE_COLORS[node.node_type] || generateColorFromString(node.node_type),
    val: 10, // Taille du nœud
  }));

  const forceLinks: ForceGraphLink[] = edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: edge.edge_type,
    color: EDGE_COLORS[edge.edge_type] || EDGE_COLORS.default,
  }));

  return {
    nodes: forceNodes,
    links: forceLinks,
  };
}

export function getNodeColor(type: string): string {
  return NODE_COLORS[type] || generateColorFromString(type);
}

export function getEdgeColor(type: string): string {
  return EDGE_COLORS[type] || EDGE_COLORS.default;
}
