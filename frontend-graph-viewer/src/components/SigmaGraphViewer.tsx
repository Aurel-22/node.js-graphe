import React, { useEffect, useRef, useState, useCallback } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import './SigmaGraphViewer.css';
import type { GraphData } from '../types/graph';
import { graphApi } from '../services/api';
import { nodePositionCache } from '../services/nodePositionCache';

interface SigmaGraphViewerProps {
  data: GraphData | null;
  graphId?: string;
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

const SigmaGraphViewer: React.FC<SigmaGraphViewerProps> = ({ data, graphId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; color: string; count: number }>>([]);
  
  // États pour le chargement progressif
  const [progressiveMode, setProgressiveMode] = useState<boolean>(false);
  const [currentDepth, setCurrentDepth] = useState<number>(0);
  const [isLoadingLevel, setIsLoadingLevel] = useState<boolean>(false);
  const [visibleNodes, setVisibleNodes] = useState<Set<string>>(new Set());
  
  // Refs pour éviter les problèmes de closure
  const progressiveModeRef = useRef<boolean>(false);
  const currentDepthRef = useRef<number>(0);
  const visibleNodesRef = useRef<Set<string>>(new Set());
  
  // Mettre à jour les refs quand les states changent
  useEffect(() => {
    progressiveModeRef.current = progressiveMode;
  }, [progressiveMode]);
  
  useEffect(() => {
    currentDepthRef.current = currentDepth;
  }, [currentDepth]);
  
  useEffect(() => {
    visibleNodesRef.current = visibleNodes;
  }, [visibleNodes]);

  // Fonction pour charger le niveau suivant (tous les voisins des nœuds visibles)
  const loadNextLevel = useCallback(async () => {
    if (!graphId || !graphRef.current || isLoadingLevel) {
      return;
    }

    setIsLoadingLevel(true);

    try {
      const graph = graphRef.current;
      
      // Obtenir TOUS les nœuds actuellement dans le graphe
      const currentNodes: string[] = [];
      graph.forEachNode((nodeId) => {
        currentNodes.push(nodeId);
      });
      
      if (currentNodes.length === 0) {
        return;
      }

      const newNodes = new Set<string>();
      const typeMap = new Map<string, { color: string; count: number }>();

      // Charger les types existants
      nodeTypes.forEach(({ type, color, count }) => {
        typeMap.set(type, { color, count });
      });

      // Charger les voisins de tous les nœuds actuellement dans le graphe
      for (const nodeId of currentNodes) {
        try {
          const neighbors = await graphApi.getNodeNeighbors(graphId, nodeId, 1);
          
          // Ajouter les nouveaux nœuds
          neighbors.nodes.forEach((node) => {
            if (!graph.hasNode(node.id)) {
              newNodes.add(node.id);
              
              const nodeType = node.node_type || 'default';
              const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);

              // Compter les types
              const existing = typeMap.get(nodeType);
              if (existing) {
                existing.count++;
              } else {
                typeMap.set(nodeType, { color, count: 1 });
              }

              // Vérifier si une position est en cache
              const cachedPosition = nodePositionCache.getPosition(graphId, node.id);
              
              graph.addNode(node.id, {
                label: node.label || node.id,
                size: 10,
                color: color,
                x: cachedPosition?.x ?? Math.random() * 100,
                y: cachedPosition?.y ?? Math.random() * 100,
                type: 'circle',
                nodeType: nodeType,
              });
            }
          });

          // Ajouter les nouvelles arêtes
          neighbors.edges.forEach((edge) => {
            if (!graph.hasEdge(edge.source, edge.target)) {
              try {
                graph.addEdge(edge.source, edge.target, {
                  size: 2,
                  color: '#666',
                  type: 'arrow',
                });
              } catch (error) {
                console.warn(`Could not add edge ${edge.source} -> ${edge.target}`, error);
              }
            }
          });
        } catch (error) {
          console.error(`Failed to load neighbors for node ${nodeId}:`, error);
        }
      }

      // Appliquer un layout rapide pour les nouveaux nœuds
      if (newNodes.size > 0) {
        const settings = forceAtlas2.inferSettings(graph);
        forceAtlas2.assign(graph, {
          iterations: 10,
          settings: {
            ...settings,
            gravity: 1,
            scalingRatio: 5,
          },
        });

        // Mettre à jour les types
        const typesArray = Array.from(typeMap.entries())
          .map(([type, { color, count }]) => ({ type, color, count }))
          .sort((a, b) => b.count - a.count);
        setNodeTypes(typesArray);

        // Sauvegarder les positions dans le cache
        const positions: Record<string, { x: number; y: number }> = {};
        graph.forEachNode((nodeId, attrs) => {
          positions[nodeId] = { x: attrs.x, y: attrs.y };
        });
        nodePositionCache.setGraphPositions(graphId, positions);

        // Mettre à jour les nœuds visibles avec TOUS les nœuds du graphe
        const allNodes = new Set<string>();
        graph.forEachNode((nodeId) => {
          allNodes.add(nodeId);
        });
        setVisibleNodes(allNodes);

        // Incrémenter la profondeur
        setCurrentDepth(prev => prev + 1);

        // Rafraîchir Sigma
        sigmaRef.current?.refresh();
      }
    } catch (error) {
      console.error('Failed to load next level:', error);
    } finally {
      setIsLoadingLevel(false);
    }
  }, [graphId, isLoadingLevel, nodeTypes]);

  // Fonction pour réinitialiser au nœud de départ
  const resetToStart = useCallback(() => {
    if (!graphRef.current || !data || data.nodes.length === 0) {
      return;
    }

    const graph = graphRef.current;
    
    // Supprimer tous les nœuds sauf le premier
    const firstNodeId = data.nodes[0].id;
    const nodesToRemove: string[] = [];
    
    graph.forEachNode((nodeId) => {
      if (nodeId !== firstNodeId) {
        nodesToRemove.push(nodeId);
      }
    });
    
    nodesToRemove.forEach(nodeId => {
      if (graph.hasNode(nodeId)) {
        graph.dropNode(nodeId);
      }
    });

    // Réinitialiser les états
    setVisibleNodes(new Set([firstNodeId]));
    setCurrentDepth(0);
    
    // Rafraîchir Sigma
    sigmaRef.current?.refresh();
  }, [data]);

  // useEffect principal pour créer/recréer le graphe
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

    // Charger les positions du cache si disponibles
    const cachedPositions = graphId ? nodePositionCache.getGraphPositions(graphId) : {};
    
    // Mode progressif : charger seulement le premier nœud
    if (progressiveMode) {
      const firstNode = data.nodes[0];
      if (firstNode) {
        const nodeType = firstNode.node_type || 'default';
        const color = NODE_COLORS[nodeType] || generateColorFromString(nodeType);
        
        typeMap.set(nodeType, { color, count: 1 });
        
        const cachedPosition = cachedPositions[firstNode.id];
        
        graph.addNode(firstNode.id, {
          label: firstNode.label || firstNode.id,
          size: 10,
          color: color,
          x: cachedPosition?.x ?? 50,
          y: cachedPosition?.y ?? 50,
          type: 'circle',
          nodeType: nodeType,
        });
        
        // Initialiser les nœuds visibles avec le premier nœud
        setVisibleNodes(new Set([firstNode.id]));
        setCurrentDepth(0);
      }
    } else {
      // Mode normal : charger tous les nœuds
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
        
        const cachedPosition = cachedPositions[node.id];
        
        graph.addNode(node.id, {
          label: node.label || node.id,
          size: 10,
          color: color,
          x: cachedPosition?.x ?? Math.random() * 100,
          y: cachedPosition?.y ?? Math.random() * 100,
          type: 'circle',
          nodeType: nodeType,
        });
      });

      // Ajouter les arêtes en mode normal
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
          barnesHutOptimize: true,
        };
      } else if (nodeCount < 10000) {
        // Grands graphes : priorité vitesse
        iterations = 15;
        layoutSettings = {
          gravity: 0.3,
          scalingRatio: 3,
          slowDown: 3,
          barnesHutOptimize: true,
          barnesHutTheta: 1.2,
        };
      } else {
        // Graphes massifs : vitesse maximale
        iterations = 5;
        layoutSettings = {
          gravity: 0.1,
          scalingRatio: 2,
          slowDown: 5,
          barnesHutOptimize: true,
          barnesHutTheta: 1.5,
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

      // Sauvegarder les positions dans le cache
      if (graphId) {
        const positions: Record<string, { x: number; y: number }> = {};
        graph.forEachNode((nodeId, attrs) => {
          positions[nodeId] = { x: attrs.x, y: attrs.y };
        });
        nodePositionCache.setGraphPositions(graphId, positions);
      }
    }

    // Mettre à jour les types pour la légende
    const typesArray = Array.from(typeMap.entries())
      .map(([type, { color, count }]) => ({ type, color, count }))
      .sort((a, b) => b.count - a.count);
    setNodeTypes(typesArray);

    // Créer l'instance Sigma avec options optimisées
    const nodeCount = progressiveMode ? 1 : data.nodes.length;
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      renderLabels: nodeCount < 5000,
      defaultNodeColor: NODE_COLORS.default,
      defaultEdgeColor: '#666',
      labelSize: nodeCount < 1000 ? 12 : 10,
      labelWeight: '600',
      labelColor: { color: '#fff' },
      enableEdgeEvents: nodeCount < 5000,
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
  }, [data, graphId, progressiveMode]);

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
          Fit View
        </button>
        <button onClick={handleZoomIn} title="Zoom avant">
          Zoom In
        </button>
        <button onClick={handleZoomOut} title="Zoom arrière">
          Zoom Out
        </button>
        <button 
          onClick={() => setProgressiveMode(!progressiveMode)} 
          title={progressiveMode ? "Mode normal" : "Mode par niveaux"}
          style={{ 
            backgroundColor: progressiveMode ? '#4CAF50' : '#666',
            color: '#fff',
            fontWeight: progressiveMode ? 'bold' : 'normal'
          }}
        >
          {progressiveMode ? 'Par niveaux' : 'Normal'}
        </button>
        {progressiveMode && graphId && (
          <>
            <button 
              onClick={loadNextLevel}
              disabled={isLoadingLevel}
              title="Charger un niveau de relations supplémentaire"
              style={{ 
                backgroundColor: isLoadingLevel ? '#999' : '#2196F3',
                cursor: isLoadingLevel ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoadingLevel ? 'Chargement...' : '+1 Niveau'}
            </button>
            <button 
              onClick={resetToStart}
              title="Revenir au nœud de départ"
              style={{ backgroundColor: '#FF5722' }}
            >
              Reset
            </button>
            <button 
              onClick={() => nodePositionCache.clearGraph(graphId)} 
              title="Effacer le cache des positions"
              style={{ backgroundColor: '#ff9800' }}
            >
              Clear Cache
            </button>
          </>
        )}
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

      {progressiveMode && (
        <div className="sigma-progressive-info">
          <strong>Mode par niveaux</strong>
          <p>Profondeur actuelle : {currentDepth}</p>
          <p>{visibleNodes.size} nœud(s) visible(s)</p>
          {isLoadingLevel && (
            <p>Chargement du niveau suivant...</p>
          )}
        </div>
      )}

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
