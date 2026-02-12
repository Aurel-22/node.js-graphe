import { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { GraphData } from '../types/graph';
import './ImpactAnalysis.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

interface ImpactAnalysisProps {
  data: GraphData | null;
  graphId?: string;
}

type NodeStatus = 'healthy' | 'blocking' | 'impacted';

interface NodeState {
  status: NodeStatus;
  dependencies: string[]; // IDs des nœuds dont ce nœud dépend
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const baseNodeSizeRef = useRef<number>(8);
  
  const [nodeStates, setNodeStates] = useState<Map<string, NodeState>>(new Map());
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isVeryLargeGraph, setIsVeryLargeGraph] = useState(false);

  // Initialiser le graphe Sigma
  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Nettoyer l'instance précédente UNIQUEMENT si le container change ou data change vraiment
    if (sigmaRef.current) {
      try {
        sigmaRef.current.kill();
      } catch (e) {
        console.warn('Sigma cleanup error:', e);
      }
      sigmaRef.current = null;
    }

    // Créer un nouveau graphe (multi pour autoriser les arêtes multiples)
    const graph = new Graph({ multi: true });
    graphRef.current = graph;

    // Construire la map des états des nœuds
    const statesMap = new Map<string, NodeState>();

    
    const baseSize = data.nodes.length < 1000 ? 12 : (data.nodes.length > 5000 ? 4 : 6);
    baseNodeSizeRef.current = baseSize;

    // Ajouter les nœuds
    data.nodes.forEach((node) => {
      graph.addNode(node.id, {
        label: node.label,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: baseSize,
        color: '#4CAF50', // Vert par défaut (healthy)
        labelColor: '#FFFFFF',
        type: 'circle',
      });

      // Initialiser l'état du nœud
      statesMap.set(node.id, {
        status: 'healthy',
        dependencies: [],
      });
    });

    // Ajouter les relations et calculer les dépendances
    // Utiliser un Set pour éviter les doublons
    const edgeSet = new Set<string>();
    data.edges.forEach((edge) => {
      const edgeKey = `${edge.source}->${edge.target}`;
      
      // Vérifier si on n'a pas déjà cette arête
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        graph.addEdge(edge.source, edge.target, {
          size: 1,
          color: '#666',
          type: 'arrow',
        });

        // Le nœud target dépend du nœud source
        const targetState = statesMap.get(edge.target);
        if (targetState && !targetState.dependencies.includes(edge.source)) {
          targetState.dependencies.push(edge.source);
        }
      }
    });

    setNodeStates(statesMap);

    // Optimisations pour les grands graphes
    const largeGraph = data.nodes.length > 1000;
    const veryLargeGraph = data.nodes.length > 5000;
    setIsVeryLargeGraph(veryLargeGraph);

    // Créer l'instance Sigma avec options optimisées
    try {
      const sigma = new Sigma(graph, containerRef.current, {
        renderLabels: !largeGraph, // Désactiver les labels pour les grands graphes
        renderEdgeLabels: true,
        defaultNodeType: 'circle',
        defaultEdgeType: 'arrow',
        labelSize: 12,
        labelWeight: 'normal',
      });

      sigmaRef.current = sigma;

      // Gestion des clics sur les nœuds
      sigma.on('clickNode', ({ node }) => {
        handleNodeClick(node);
      });

      // Gestion de la perte du contexte WebGL
      sigma.on('kill', () => {
        console.log('Sigma instance killed');
      });
    } catch (error) {
      console.error('Erreur lors de la création de Sigma:', error);
      // Nettoyer en cas d'erreur
      if (sigmaRef.current) {
        try {
          sigmaRef.current.kill();
        } catch (e) {
          console.error('Erreur lors du nettoyage:', e);
        }
        sigmaRef.current = null;
      }
    }

    // Cleanup
    // NE PAS tuer l'instance à chaque render, seulement lors du démontage du composant
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      if (sigmaRef.current) {
        try {
          sigmaRef.current.kill();
        } catch (e) {
          console.warn('Sigma cleanup error:', e);
        }
        sigmaRef.current = null;
      }
    };
  }, [containerRef.current, data]);

  // Gérer le clic sur un nœud
  const handleNodeClick = useCallback((nodeId: string) => {
    if (isAnimating) return;

    setSelectedNode(nodeId);
    const currentState = nodeStates.get(nodeId);
    
    if (currentState?.status === 'healthy') {
      // Marquer le nœud comme bloquant et propager
      markAsBlocking(nodeId);
    } else {
      // Réinitialiser le nœud
      resetNode(nodeId);
    }
  }, [nodeStates, isAnimating]);

  // Marquer un nœud comme bloquant et propager l'impact
  const markAsBlocking = useCallback(async (nodeId: string) => {
    if (!graphRef.current || !sigmaRef.current) return;

    setIsAnimating(true);
    const graph = graphRef.current;
    const sigma = sigmaRef.current;

    try {
      // Étape 1 : Marquer le nœud initial comme bloquant
      const newStates = new Map(nodeStates);
      const nodeState = newStates.get(nodeId);
      if (nodeState) {
        nodeState.status = 'blocking';
        graph.setNodeAttribute(nodeId, 'color', '#F44336'); // Rouge
        graph.setNodeAttribute(nodeId, 'labelColor', '#FFFFFF');

        // Pour les très grands graphes : ne pas refresh tant que la propagation n'est pas terminée
        if (!isVeryLargeGraph) {
          sigma.refresh();
          await sleep(300);
        }
      }

      setNodeStates(new Map(newStates));

      // Étape 2 : Propager l'impact
      await propagateImpact(nodeId, newStates);
      
      // Pour les très grands graphes : UN SEUL refresh final après tous les changements
      if (isVeryLargeGraph) {
        sigma.refresh();
      }
    } catch (error) {
      console.error('Erreur lors du marquage:', error);
    } finally {
      setIsAnimating(false);
    }
  }, [nodeStates, isVeryLargeGraph]);

  // Propager l'impact aux nœuds dépendants
  const propagateImpact = async (_blockingNodeId: string, states: Map<string, NodeState>) => {
    if (!graphRef.current || !sigmaRef.current) return;

    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    
    let hasChanges = true;
    let iteration = 0;
    const maxIterations = 20; // Éviter les boucles infinies

    // Pour les très grands graphes, désactiver complètement les animations et refresh intermédiaires
    const shouldAnimate = !isVeryLargeGraph;
    const nodesToUpdate: string[] = [];

    try {
      while (hasChanges && iteration < maxIterations) {
        hasChanges = false;
        iteration++;
        nodesToUpdate.length = 0;

        // Parcourir tous les nœuds pour voir lesquels sont impactés
        for (const [nodeId, nodeState] of states.entries()) {
          if (nodeState.status === 'healthy' && nodeState.dependencies.length > 0) {
            // Vérifier si toutes les dépendances sont bloquantes ou impactées
            const allDependenciesBlocked = nodeState.dependencies.every(depId => {
              const depState = states.get(depId);
              return depState && (depState.status === 'blocking' || depState.status === 'impacted');
            });

            if (allDependenciesBlocked) {
              // Ce nœud devient impacté
              nodeState.status = 'impacted';
              graph.setNodeAttribute(nodeId, 'color', '#FF9800'); // Orange
              graph.setNodeAttribute(nodeId, 'labelColor', '#FFFFFF');
              nodesToUpdate.push(nodeId);
              hasChanges = true;
            }
          }
        }

        // Si des nœuds ont été mis à jour
        if (nodesToUpdate.length > 0 && shouldAnimate) {
          // Animation : effet de pulse UNIQUEMENT pour les petits graphes
          for (const nodeId of nodesToUpdate) {
            const originalSize = graph.getNodeAttribute(nodeId, 'size');
            graph.setNodeAttribute(nodeId, 'size', originalSize * 1.3);
          }
          sigma.refresh();
          await sleep(150);
          
          for (const nodeId of nodesToUpdate) {
            const originalSize = graph.getNodeAttribute(nodeId, 'size');
            graph.setNodeAttribute(nodeId, 'size', originalSize / 1.3);
          }
          sigma.refresh();
          await sleep(200);
        }
        // Pour les très grands graphes : AUCUN refresh intermédiaire
      }

      setNodeStates(new Map(states));
      
      // Pas de refresh final ici, il sera fait dans markAsBlocking pour les très grands graphes
    } catch (error) {
      console.error('Erreur lors de la propagation:', error);
      // En cas d'erreur, au moins mettre à jour les états
      setNodeStates(new Map(states));
    }
  };

  // Réinitialiser un nœud
  const resetNode = useCallback(async (nodeId: string) => {
    if (!graphRef.current || !sigmaRef.current) return;

    const graph = graphRef.current;
    const sigma = sigmaRef.current;

    try {
      // Réinitialiser ce nœud
      const newStates = new Map(nodeStates);
      const nodeState = newStates.get(nodeId);
      if (nodeState) {
        nodeState.status = 'healthy';
        nodeState.status = 'healthy';
        graph.setNodeAttribute(nodeId, 'color', '#4CAF50'); // Vert
        graph.setNodeAttribute(nodeId, 'size', baseNodeSizeRef.current);
        graph.setNodeAttribute(nodeId, 'labelColor', '#FFFFFF');
        sigma.refresh();
      }

      setNodeStates(new Map(newStates));
    } catch (error) {
      console.error('Erreur lors de la réinitialisation:', error);
    }
  }, [nodeStates]);

  // Réinitialiser tous les nœuds
  const resetAll = useCallback(() => {
    if (!graphRef.current || !sigmaRef.current || isAnimating) return;

    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const newStates = new Map(nodeStates);

    try {
      // Réinitialiser tous les nœuds
      for (const [nodeId, nodeState] of newStates.entries()) {
        nodeState.status = 'healthy';
        graph.setNodeAttribute(nodeId, 'color', '#4CAF50');
        graph.setNodeAttribute(nodeId, 'size', baseNodeSizeRef.current);
      }

      sigma.refresh();
      setNodeStates(new Map(newStates));
      setSelectedNode(null);
    } catch (error) {
      console.error('Erreur lors de la réinitialisation complète:', error);
    }
  }, [nodeStates, isAnimating]);

  // Fonction utilitaire pour les délais
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Calculer les statistiques
  const stats = {
    healthy: Array.from(nodeStates.values()).filter(s => s.status === 'healthy').length,
    blocking: Array.from(nodeStates.values()).filter(s => s.status === 'blocking').length,
    impacted: Array.from(nodeStates.values()).filter(s => s.status === 'impacted').length,
  };

  if (!data) {
    return (
      <div className="impact-analysis">
        <div className="empty-state">
          <h3>Aucun graphe sélectionné</h3>
          <p>Sélectionnez un graphe pour commencer l'analyse d'impact</p>
        </div>
      </div>
    );
  }

  return (
    <div className="impact-analysis">
      <div className="impact-controls">
        <button onClick={resetAll} disabled={isAnimating}>
          Réinitialiser
        </button>
        <div className="impact-legend">
          <div className="legend-item">
            <i className="bi bi-check-circle-fill legend-icon" style={{ color: '#4CAF50' }}></i>
            <span>Normal ({stats.healthy})</span>
          </div>
          <div className="legend-item">
            <i className="bi bi-exclamation-octagon-fill legend-icon" style={{ color: '#F44336' }}></i>
            <span>Bloquant ({stats.blocking})</span>
          </div>
          <div className="legend-item">
            <i className="bi bi-exclamation-triangle-fill legend-icon" style={{ color: '#FF9800' }}></i>
            <span>Impacté ({stats.impacted})</span>
          </div>
        </div>
      </div>

      <div className="impact-info">
        <h3>Analyse d'Impact</h3>
        <p>Cliquez sur un nœud pour le marquer comme bloquant</p>
        <p>Les nœuds dépendants seront colorés automatiquement</p>
        {isVeryLargeGraph && (
          <div className="warning-badge">
            Graphe très large ({data?.nodes.length.toLocaleString()} nœuds)
            <br />
            Les animations sont désactivées pour optimiser les performances
          </div>
        )}
        {isAnimating && <div className="animating-badge">Animation en cours...</div>}
      </div>

      <div ref={containerRef} className="impact-container" />

      {selectedNode && (
        <div className="selected-node-info">
          <i className={`bi ${getNodeIcon(nodeStates.get(selectedNode)?.status || 'healthy')} legend-icon`} style={{ marginRight: 6 }}></i>
          <strong>Nœud sélectionné:</strong> {selectedNode}
          <br />
          <strong>Statut:</strong> {nodeStates.get(selectedNode)?.status}
        </div>
      )}
    </div>
  );
};

// Helper to get icon class by node status
const getNodeIcon = (status: NodeStatus) => {
  switch (status) {
    case 'blocking':
      return 'bi-exclamation-octagon-fill';
    case 'impacted':
      return 'bi-exclamation-triangle-fill';
    default:
      return 'bi-check-circle-fill';
  }
};

export default ImpactAnalysis;
