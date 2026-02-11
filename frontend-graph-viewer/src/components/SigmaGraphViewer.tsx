import React, { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import './SigmaGraphViewer.css';
import type { GraphData } from '../types/graph';

interface SigmaGraphViewerProps {
  data: GraphData | null;
}

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

const SigmaGraphViewer: React.FC<SigmaGraphViewerProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; color: string; count: number }>>([]);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Démarrer le chronomètre
    const startTime = performance.now();
    setRenderTime(null);

    // Nettoyer l'instance précédente
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    // Créer un nouveau graphe graphology
    const graph = new Graph();
    graphRef.current = graph;

    // Collecter les types de nœuds pour la légende
    const typeMap = new Map<string, { color: string; count: number }>();

    // Ajouter les nœuds
    data.nodes.forEach((node) => {
      const nodeType = node.node_type || 'default';
      const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);
      
      // Compter les types
      const existing = typeMap.get(nodeType);
      if (existing) {
        existing.count++;
      } else {
        typeMap.set(nodeType, { color, count: 1 });
      }
      
      graph.addNode(node.id, {
        label: node.label || node.id,
        size: 10,
        color: color,
        x: Math.random() * 100,
        y: Math.random() * 100,
        type: 'circle', // Sigma v3 nécessite un type de renderer valide
        nodeType: nodeType, // Stocker le type custom comme attribut
      });
    });

    // Mettre à jour les types pour la légende
    const typesArray = Array.from(typeMap.entries())
      .map(([type, { color, count }]) => ({ type, color, count }))
      .sort((a, b) => b.count - a.count); // Trier par nombre décroissant
    setNodeTypes(typesArray);

    // Ajouter les arêtes
    data.edges.forEach((edge) => {
      try {
        graph.addEdge(edge.source, edge.target, {
          size: 2,
          color: '#666',
          type: 'arrow',
        });
      } catch (error) {
        console.warn(`Could not add edge ${edge.source} -> ${edge.target}`, error);
      }
    });

    // Optimisation adaptative selon la taille du graphe
    const nodeCount = data.nodes.length;
    let iterations: number;
    let layoutSettings: any;

    if (nodeCount < 1000) {
      // Petits graphes : layout de qualité
      iterations = 50;
      layoutSettings = {
        gravity: 1,
        scalingRatio: 10,
        slowDown: 1,
      };
    } else if (nodeCount < 5000) {
      // Graphes moyens : équilibre qualité/vitesse
      iterations = 30;
      layoutSettings = {
        gravity: 0.5,
        scalingRatio: 5,
        slowDown: 2,
        barnesHutOptimize: true, // Accélération pour graphes moyens
      };
    } else if (nodeCount < 10000) {
      // Grands graphes : priorité vitesse
      iterations = 15;
      layoutSettings = {
        gravity: 0.3,
        scalingRatio: 3,
        slowDown: 3,
        barnesHutOptimize: true,
        barnesHutTheta: 1.2, // Moins précis mais plus rapide
      };
    } else {
      // Graphes massifs : vitesse maximale
      iterations = 5;
      layoutSettings = {
        gravity: 0.1,
        scalingRatio: 2,
        slowDown: 5,
        barnesHutOptimize: true,
        barnesHutTheta: 1.5, // Approximation agressive
      };
    }

    // Appliquer le layout ForceAtlas2 optimisé
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        ...settings,
        ...layoutSettings,
      },
    });

    // Créer l'instance Sigma avec options optimisées
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      renderLabels: nodeCount < 5000, // Désactiver labels pour graphes > 5k
      defaultNodeColor: NODE_COLORS.default,
      defaultEdgeColor: '#666',
      labelSize: nodeCount < 1000 ? 12 : 10,
      labelWeight: '600',
      labelColor: { color: '#fff' },
      enableEdgeEvents: nodeCount < 5000, // Désactiver edge events pour graphes > 5k
      allowInvalidContainer: true,
    });

    sigmaRef.current = sigma;

    // Calculer le temps de rendu
    const elapsed = performance.now() - startTime;
    setRenderTime(elapsed);

    // Gestion du hover
    sigma.on('enterNode', ({ node }) => {
      setHoveredNode(node);
      
      // Mettre en évidence le nœud et ses voisins
      const neighbors = new Set(graph.neighbors(node));
      neighbors.add(node);

      graph.forEachNode((n) => {
        if (neighbors.has(n)) {
          graph.setNodeAttribute(n, 'highlighted', true);
          graph.setNodeAttribute(n, 'size', 15);
        } else {
          graph.setNodeAttribute(n, 'color', '#333');
          graph.setNodeAttribute(n, 'highlighted', false);
        }
      });

      graph.forEachEdge((edge, _attributes, source, target) => {
        if (source === node || target === node) {
          graph.setEdgeAttribute(edge, 'color', '#fff');
          graph.setEdgeAttribute(edge, 'size', 3);
        } else {
          graph.setEdgeAttribute(edge, 'color', '#333');
        }
      });

      sigma.refresh();
    });

    sigma.on('leaveNode', () => {
      setHoveredNode(null);

      // Restaurer les couleurs originales
      graph.forEachNode((node) => {
        const attributes = graph.getNodeAttributes(node);
        const nodeType = attributes.nodeType || 'default';
        const originalColor = NODE_COLORS[nodeType] || NODE_COLORS.default;
        graph.setNodeAttribute(node, 'color', originalColor);
        graph.setNodeAttribute(node, 'size', 10);
        graph.setNodeAttribute(node, 'highlighted', false);
      });

      graph.forEachEdge((edge) => {
        graph.setEdgeAttribute(edge, 'color', '#666');
        graph.setEdgeAttribute(edge, 'size', 2);
      });

      sigma.refresh();
    });

    // Cleanup
    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [data]);

  const handleFitView = () => {
    if (sigmaRef.current) {
      sigmaRef.current.getCamera().animatedReset({ duration: 600 });
    }
  };

  const handleZoomIn = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      camera.animatedZoom({ duration: 300 });
    }
  };

  const handleZoomOut = () => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      camera.animatedUnzoom({ duration: 300 });
    }
  };

  if (!data) {
    return (
      <div className="sigma-graph-viewer">
        <div className="empty-state">
          <h3>Aucun graphe sélectionné</h3>
          <p>Sélectionnez un graphe dans la liste pour le visualiser</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sigma-graph-viewer">
      <div className="sigma-controls">
        <button onClick={handleFitView} title="Ajuster la vue">
          🔍 Fit View
        </button>
        <button onClick={handleZoomIn} title="Zoom avant">
          ➕ Zoom In
        </button>
        <button onClick={handleZoomOut} title="Zoom arrière">
          ➖ Zoom Out
        </button>
      </div>

      <div ref={containerRef} className="sigma-container" />

      <div className="sigma-legend">
        <h4>Légende ({nodeTypes.length} types)</h4>
        <div className="legend-items-scroll">
          {nodeTypes.map(({ type, color, count }) => (
            <div key={type} className="legend-item">
              <span className="legend-color" style={{ backgroundColor: color }}></span>
              <span className="legend-label">{type}</span>
              <span className="legend-count">({count})</span>
            </div>
          ))}
        </div>
      </div>

      {hoveredNode && (
        <div className="sigma-tooltip">
          <strong>Nœud :</strong> {hoveredNode}
        </div>
      )}

      {renderTime !== null && (
        <div className="sigma-render-time">
          ⏱️ <strong>Sigma.js:</strong> {renderTime.toFixed(0)}ms
          {data.nodes.length > 5000 && (
            <span className="optimization-note"> (optimisé)</span>
          )}
        </div>
      )}

      <div className="sigma-stats">
        <span>{data.nodes.length} nœuds</span>
        <span>•</span>
        <span>{data.edges.length} arêtes</span>
      </div>
    </div>
  );
};

export default SigmaGraphViewer;
