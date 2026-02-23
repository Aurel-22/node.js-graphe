import { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeCircleProgram, createNodeCompoundProgram } from 'sigma/rendering';
import { createNodeImageProgram } from '@sigma/node-image';
import forceAtlas2 from 'graphology-layout-forceatlas2';
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
  dependencies: string[];
}

const STATUS_ICONS: Record<NodeStatus, string> = {
  healthy: 'https://icons.getbootstrap.com/assets/icons/check-circle.svg',
  blocking: 'https://icons.getbootstrap.com/assets/icons/x-octagon.svg',
  impacted: 'https://icons.getbootstrap.com/assets/icons/exclamation-triangle.svg',
};

const STATUS_COLORS: Record<NodeStatus, string> = {
  healthy: '#4CAF50',
  blocking: '#F44336',
  impacted: '#FF9800',
};

const NodePictogramProgram = createNodeImageProgram({
  padding: 0.15,
  size: { mode: 'force', value: 256 },
  drawingMode: 'color',
  colorAttribute: 'pictoColor',
});

const NodeProgram = createNodeCompoundProgram([NodeCircleProgram, NodePictogramProgram]);

function getAdaptiveSizes(nodeCount: number) {
  if (nodeCount > 10000) {
    return { nodeSize: 3, edgeSize: 0.3, labelThreshold: 15, edgeColor: 'rgba(100,100,100,0.15)' };
  } else if (nodeCount > 5000) {
    return { nodeSize: 4, edgeSize: 0.5, labelThreshold: 10, edgeColor: 'rgba(100,100,100,0.25)' };
  } else if (nodeCount > 1000) {
    return { nodeSize: 6, edgeSize: 1, labelThreshold: 8, edgeColor: '#555' };
  }
  return { nodeSize: 10, edgeSize: 2, labelThreshold: 6, edgeColor: '#666' };
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const nodeStatesRef = useRef<Map<string, NodeState>>(new Map());

  const [stats, setStats] = useState({ healthy: 0, blocking: 0, impacted: 0 });
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedNodeStatus, setSelectedNodeStatus] = useState<NodeStatus>('healthy');
  const [isVeryLargeGraph, setIsVeryLargeGraph] = useState(false);
  const [renderTime, setRenderTime] = useState<number | null>(null);

  const updateStats = useCallback(() => {
    const states = nodeStatesRef.current;
    let healthy = 0, blocking = 0, impacted = 0;
    for (const state of states.values()) {
      if (state.status === 'healthy') healthy++;
      else if (state.status === 'blocking') blocking++;
      else impacted++;
    }
    setStats({ healthy, blocking, impacted });
  }, []);

  const propagateBlocking = useCallback((nodeId: string) => {
    if (!graphRef.current || !sigmaRef.current) return;
    setIsAnimating(true);
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const states = nodeStatesRef.current;
    const sizes = getAdaptiveSizes(graph.order);

    const nodeState = states.get(nodeId);
    if (!nodeState) { setIsAnimating(false); return; }
    nodeState.status = 'blocking';
    graph.setNodeAttribute(nodeId, 'color', STATUS_COLORS.blocking);
    graph.setNodeAttribute(nodeId, 'image', STATUS_ICONS.blocking);

    // BFS propagation via outgoing neighbors
    const queue: string[] = [];
    const visited = new Set<string>();
    visited.add(nodeId);

    graph.forEachOutNeighbor(nodeId, (neighbor) => {
      if (!visited.has(neighbor)) { queue.push(neighbor); visited.add(neighbor); }
    });

    let impactedCount = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentState = states.get(current);
      if (!currentState) continue;

      // AT LEAST ONE dependency is blocked/impacted => this node is impacted
      const hasBlockedDep = currentState.dependencies.some((depId) => {
        const depState = states.get(depId);
        return depState && (depState.status === 'blocking' || depState.status === 'impacted');
      });

      if (hasBlockedDep && currentState.status === 'healthy') {
        currentState.status = 'impacted';
        graph.setNodeAttribute(current, 'color', STATUS_COLORS.impacted);
        graph.setNodeAttribute(current, 'image', STATUS_ICONS.impacted);
        impactedCount++;
        graph.forEachOutNeighbor(current, (neighbor) => {
          if (!visited.has(neighbor)) { queue.push(neighbor); visited.add(neighbor); }
        });
      }
    }

    // Color edges on impacted paths
    graph.forEachEdge((edge, _attrs, source, target) => {
      const srcState = states.get(source);
      const tgtState = states.get(target);
      if (srcState && tgtState &&
          (srcState.status === 'blocking' || srcState.status === 'impacted') &&
          (tgtState.status === 'blocking' || tgtState.status === 'impacted')) {
        graph.setEdgeAttribute(edge, 'color', '#FF5722');
        graph.setEdgeAttribute(edge, 'size', Math.max(sizes.edgeSize * 2, 1));
      }
    });

    sigma.refresh();
    updateStats();
    setIsAnimating(false);
    console.info(`Impact: ${impactedCount} nodes impacted from ${nodeId}`);
  }, [updateStats]);

  const resetSingleNode = useCallback((nodeId: string) => {
    if (!graphRef.current || !sigmaRef.current) return;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const states = nodeStatesRef.current;
    const sizes = getAdaptiveSizes(graph.order);

    const nodeState = states.get(nodeId);
    if (!nodeState) return;
    nodeState.status = 'healthy';
    graph.setNodeAttribute(nodeId, 'color', STATUS_COLORS.healthy);
    graph.setNodeAttribute(nodeId, 'image', STATUS_ICONS.healthy);

    // Reset all impacted nodes to healthy first
    for (const [nId, nState] of states.entries()) {
      if (nState.status === 'impacted') {
        nState.status = 'healthy';
        graph.setNodeAttribute(nId, 'color', STATUS_COLORS.healthy);
        graph.setNodeAttribute(nId, 'image', STATUS_ICONS.healthy);
      }
    }

    // Re-propagate from all remaining blocking nodes
    const blockingNodes: string[] = [];
    for (const [nId, nState] of states.entries()) {
      if (nState.status === 'blocking') blockingNodes.push(nId);
    }

    const visited = new Set<string>(blockingNodes);
    const nextQueue: string[] = [];
    for (const bNode of blockingNodes) {
      graph.forEachOutNeighbor(bNode, (neighbor) => {
        if (!visited.has(neighbor)) { nextQueue.push(neighbor); visited.add(neighbor); }
      });
    }

    const bfsQueue = [...nextQueue];
    while (bfsQueue.length > 0) {
      const current = bfsQueue.shift()!;
      const currentState = states.get(current);
      if (!currentState || currentState.status !== 'healthy') continue;

      const hasBlockedDep = currentState.dependencies.some((depId) => {
        const depState = states.get(depId);
        return depState && (depState.status === 'blocking' || depState.status === 'impacted');
      });

      if (hasBlockedDep) {
        currentState.status = 'impacted';
        graph.setNodeAttribute(current, 'color', STATUS_COLORS.impacted);
        graph.setNodeAttribute(current, 'image', STATUS_ICONS.impacted);
        graph.forEachOutNeighbor(current, (neighbor) => {
          if (!visited.has(neighbor)) { bfsQueue.push(neighbor); visited.add(neighbor); }
        });
      }
    }

    // Update edge colors
    graph.forEachEdge((edge, _attrs, source, target) => {
      const srcState = states.get(source);
      const tgtState = states.get(target);
      if (srcState && tgtState &&
          (srcState.status === 'blocking' || srcState.status === 'impacted') &&
          (tgtState.status === 'blocking' || tgtState.status === 'impacted')) {
        graph.setEdgeAttribute(edge, 'color', '#FF5722');
        graph.setEdgeAttribute(edge, 'size', Math.max(sizes.edgeSize * 2, 1));
      } else {
        graph.setEdgeAttribute(edge, 'color', sizes.edgeColor);
        graph.setEdgeAttribute(edge, 'size', sizes.edgeSize);
      }
    });

    sigma.refresh();
    updateStats();
    setSelectedNode(null);
  }, [updateStats]);

  const resetAll = useCallback(() => {
    if (!graphRef.current || !sigmaRef.current || isAnimating) return;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const states = nodeStatesRef.current;
    const sizes = getAdaptiveSizes(graph.order);

    for (const [nodeId, nodeState] of states.entries()) {
      nodeState.status = 'healthy';
      graph.setNodeAttribute(nodeId, 'color', STATUS_COLORS.healthy);
      graph.setNodeAttribute(nodeId, 'size', sizes.nodeSize);
      graph.setNodeAttribute(nodeId, 'image', STATUS_ICONS.healthy);
    }
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, 'color', sizes.edgeColor);
      graph.setEdgeAttribute(edge, 'size', sizes.edgeSize);
    });
    sigma.refresh();
    updateStats();
    setSelectedNode(null);
  }, [isAnimating, updateStats]);

  // Main effect: build graph and create Sigma
  useEffect(() => {
    if (!containerRef.current || !data || data.nodes.length === 0) return;

    const startTime = performance.now();

    if (sigmaRef.current) {
      try { sigmaRef.current.kill(); } catch (e) { console.warn('Sigma cleanup:', e); }
      sigmaRef.current = null;
    }

    const nodeCount = data.nodes.length;
    const sizes = getAdaptiveSizes(nodeCount);
    const isLarge = nodeCount > 1000;
    const isVeryLarge = nodeCount > 5000;
    setIsVeryLargeGraph(isVeryLarge);

    const graph = new Graph();
    graphRef.current = graph;

    const statesMap = new Map<string, NodeState>();

    // Add nodes
    data.nodes.forEach((node) => {
      graph.addNode(node.id, {
        label: node.label || node.id,
        x: Math.random() * 500,
        y: Math.random() * 500,
        size: sizes.nodeSize,
        color: STATUS_COLORS.healthy,
        type: 'pictogram',
        image: STATUS_ICONS.healthy,
        pictoColor: '#fff',
      });
      statesMap.set(node.id, { status: 'healthy', dependencies: [] });
    });

    // Add edges with deduplication
    const edgeSet = new Set<string>();
    let skippedEdges = 0;
    data.edges.forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      const edgeKey = `${edge.source}->${edge.target}`;
      if (edgeSet.has(edgeKey)) { skippedEdges++; return; }
      edgeSet.add(edgeKey);
      try {
        graph.addEdge(edge.source, edge.target, {
          size: sizes.edgeSize, color: sizes.edgeColor, type: 'arrow',
        });
        // Track dependencies: target depends on source
        const targetState = statesMap.get(edge.target);
        if (targetState && !targetState.dependencies.includes(edge.source)) {
          targetState.dependencies.push(edge.source);
        }
      } catch (error) { /* skip duplicate */ }
    });

    if (skippedEdges > 0) console.info(`Impact: ${skippedEdges} duplicate edges skipped`);

    nodeStatesRef.current = statesMap;
    updateStats();

    // ForceAtlas2 layout - adaptive by graph size
    try {
      const settings = forceAtlas2.inferSettings(graph);
      let iterations: number;
      let layoutSettings: Record<string, unknown>;

      if (nodeCount > 10000) {
        iterations = 15;
        layoutSettings = {
          gravity: 0.05, scalingRatio: 50, slowDown: 10,
          barnesHutOptimize: true, barnesHutTheta: 1.2,
          outboundAttractionDistribution: true,
        };
      } else if (nodeCount > 5000) {
        iterations = 20;
        layoutSettings = {
          gravity: 0.3, scalingRatio: 10, slowDown: 3,
          barnesHutOptimize: true, barnesHutTheta: 1.0,
        };
      } else if (nodeCount > 1000) {
        iterations = 30;
        layoutSettings = {
          gravity: 0.5, scalingRatio: 5, slowDown: 2,
          barnesHutOptimize: true,
        };
      } else {
        iterations = 50;
        layoutSettings = { gravity: 1, scalingRatio: 10, slowDown: 1 };
      }

      forceAtlas2.assign(graph, { iterations, settings: { ...settings, ...layoutSettings } });
    } catch (error) {
      console.error('Layout error:', error);
    }

    // Create Sigma instance
    try {
      const sigma = new Sigma(graph, containerRef.current, {
        renderLabels: !isLarge,
        renderEdgeLabels: false,
        defaultNodeType: 'pictogram',
        nodeProgramClasses: { pictogram: NodeProgram },
        defaultEdgeColor: sizes.edgeColor,
        labelSize: isLarge ? 10 : 12,
        labelWeight: '600',
        labelColor: { color: '#fff' },
        labelRenderedSizeThreshold: sizes.labelThreshold,
        enableEdgeEvents: !isLarge,
        allowInvalidContainer: true,
        zIndex: true,
        minCameraRatio: 0.01,
        maxCameraRatio: 20,
      });

      sigmaRef.current = sigma;

      // WebGL context loss recovery
      const canvas = containerRef.current.querySelector('canvas');
      if (canvas) {
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          console.warn('Impact: WebGL context lost');
        });
        canvas.addEventListener('webglcontextrestored', () => {
          console.info('Impact: WebGL context restored');
          sigma.refresh();
        });
      }

      // Click node: toggle blocking/healthy
      sigma.on('clickNode', ({ node }) => {
        const states = nodeStatesRef.current;
        const currentState = states.get(node);
        if (!currentState) return;
        setSelectedNode(node);
        setSelectedNodeStatus(currentState.status);
        if (currentState.status === 'healthy') {
          propagateBlocking(node);
        } else {
          resetSingleNode(node);
        }
      });

      // Hover highlight neighbors
      sigma.on('enterNode', ({ node }) => {
        if (!graph.hasNode(node)) return;
        const neighbors = new Set(graph.neighbors(node));
        neighbors.add(node);
        graph.forEachNode((n) => {
          if (!neighbors.has(n)) {
            graph.setNodeAttribute(n, 'color', 'rgba(50,50,50,0.15)');
          }
        });
        graph.forEachEdge((edge, _attrs, source, target) => {
          if (source !== node && target !== node) {
            graph.setEdgeAttribute(edge, 'color', 'rgba(50,50,50,0.05)');
          } else {
            graph.setEdgeAttribute(edge, 'color', '#fff');
            graph.setEdgeAttribute(edge, 'size', Math.max(sizes.edgeSize * 3, 1.5));
          }
        });
        sigma.refresh();
      });

      // Leave node: restore colors
      sigma.on('leaveNode', () => {
        const states = nodeStatesRef.current;
        graph.forEachNode((n) => {
          const state = states.get(n);
          const status = state?.status || 'healthy';
          graph.setNodeAttribute(n, 'color', STATUS_COLORS[status]);
        });
        graph.forEachEdge((edge) => {
          graph.setEdgeAttribute(edge, 'color', sizes.edgeColor);
          graph.setEdgeAttribute(edge, 'size', sizes.edgeSize);
        });
        sigma.refresh();
      });

      const elapsed = performance.now() - startTime;
      setRenderTime(elapsed);
    } catch (error) {
      console.error('Sigma creation error:', error);
    }

    return () => {
      if (sigmaRef.current) {
        try { sigmaRef.current.kill(); } catch (e) { /* ignore */ }
        sigmaRef.current = null;
      }
    };
  }, [data, propagateBlocking, resetSingleNode, updateStats]);

  const handleFitView = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
  }, []);

  const handleZoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  }, []);

  const handleZoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  }, []);

  if (!data) {
    return (
      <div className="impact-analysis">
        <div className="empty-state">
          <i className="bi bi-diagram-3" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
          <h3>Aucun graphe sélectionné</h3>
          <p>Sélectionnez un graphe pour commencer l'analyse d'impact</p>
        </div>
      </div>
    );
  }

  return (
    <div className="impact-analysis">
      <div className="impact-controls">
        <button onClick={handleFitView} title="Ajuster la vue">
          <i className="bi bi-arrows-fullscreen"></i> Fit View
        </button>
        <button onClick={handleZoomIn} title="Zoom avant">
          <i className="bi bi-zoom-in"></i> Zoom +
        </button>
        <button onClick={handleZoomOut} title="Zoom arrière">
          <i className="bi bi-zoom-out"></i> Zoom -
        </button>
        <button onClick={resetAll} disabled={isAnimating} title="Réinitialiser tout">
          <i className="bi bi-arrow-counterclockwise"></i> Reset
        </button>

        <div className="impact-legend">
          <div className="legend-item">
            <i className="bi bi-check-circle-fill" style={{ color: '#4CAF50', fontSize: '1.1em' }}></i>
            <span>Normal ({stats.healthy.toLocaleString()})</span>
          </div>
          <div className="legend-item">
            <i className="bi bi-x-octagon-fill" style={{ color: '#F44336', fontSize: '1.1em' }}></i>
            <span>Bloquant ({stats.blocking.toLocaleString()})</span>
          </div>
          <div className="legend-item">
            <i className="bi bi-exclamation-triangle-fill" style={{ color: '#FF9800', fontSize: '1.1em' }}></i>
            <span>Impacté ({stats.impacted.toLocaleString()})</span>
          </div>
        </div>
      </div>

      <div className="impact-info">
        <h3><i className="bi bi-bullseye"></i> Analyse d'Impact</h3>
        <p><i className="bi bi-hand-index"></i> Cliquez sur un noeud pour le marquer comme bloquant</p>
        <p><i className="bi bi-arrow-right-circle"></i> L'impact se propage aux successeurs</p>
        {isVeryLargeGraph && (
          <div className="warning-badge">
            <i className="bi bi-lightning-charge-fill"></i> Graphe massif ({data.nodes.length.toLocaleString()} noeuds) — optimisé
          </div>
        )}
        {renderTime !== null && (
          <div className="render-time-badge">
            <i className="bi bi-stopwatch"></i> Rendu : {renderTime.toFixed(0)}ms
          </div>
        )}
        {isAnimating && (
          <div className="animating-badge">
            <i className="bi bi-arrow-repeat bi-spin"></i> Propagation en cours...
          </div>
        )}
      </div>

      <div ref={containerRef} className="impact-container" />

      {selectedNode && (
        <div className="selected-node-info">
          <i className={`bi ${getNodeIcon(selectedNodeStatus)}`}
             style={{ color: STATUS_COLORS[selectedNodeStatus], marginRight: 6, fontSize: '1.2em' }}></i>
          <strong>Noeud :</strong> {selectedNode}
          <span style={{
            marginLeft: 10,
            padding: '2px 8px',
            borderRadius: 4,
            backgroundColor: STATUS_COLORS[selectedNodeStatus],
            color: '#fff',
            fontSize: '0.85em'
          }}>
            {selectedNodeStatus}
          </span>
        </div>
      )}

      <div className="impact-stats-bar">
        <span>
          <i className="bi bi-circle-fill" style={{ fontSize: '0.6em' }}></i>{' '}
          {data.nodes.length.toLocaleString()} noeuds
        </span>
        <span>—</span>
        <span>
          <i className="bi bi-arrow-right" style={{ fontSize: '0.8em' }}></i>{' '}
          {data.edges.length.toLocaleString()} arêtes
        </span>
      </div>
    </div>
  );
};

const getNodeIcon = (status: NodeStatus) => {
  switch (status) {
    case 'blocking': return 'bi-x-octagon-fill';
    case 'impacted': return 'bi-exclamation-triangle-fill';
    default: return 'bi-check-circle-fill';
  }
};

export default ImpactAnalysis;
