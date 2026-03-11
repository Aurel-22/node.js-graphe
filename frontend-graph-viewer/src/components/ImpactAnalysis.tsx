import { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { NodeCircleProgram, createNodeCompoundProgram } from 'sigma/rendering';
import { createNodeImageProgram } from '@sigma/node-image';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { GraphData } from '../types/graph';
import { ImpactResult, graphApi, EngineType } from '../services/api';
import './ImpactAnalysis.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

interface ImpactAnalysisProps {
  data: GraphData | null;
  graphId?: string;
  database?: string;
  engine?: string;
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

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ data, graphId, database, engine }) => {
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
  // --- Server-side impact comparison ---
  const [serverImpactResult, setServerImpactResult] = useState<ImpactResult | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverDepth, setServerDepth] = useState(5);
  const [clientImpactCount, setClientImpactCount] = useState<number | null>(null);
  const [clientImpactTime, setClientImpactTime] = useState<number | null>(null);
  const [impactedNodesList, setImpactedNodesList] = useState<Array<{ id: string; label: string }>>([]);
  const [showImpactedList, setShowImpactedList] = useState(false);
  const [propagationThreshold, setPropagationThreshold] = useState(0);

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

    // BFS propagation via outgoing neighbors (with threshold)
    const queue: string[] = [];
    const visited = new Set<string>();
    visited.add(nodeId);
    const bfsStart = performance.now();
    const ratio = propagationThreshold / 100;

    graph.forEachOutNeighbor(nodeId, (neighbor) => {
      if (!visited.has(neighbor)) { queue.push(neighbor); visited.add(neighbor); }
    });

    let impactedCount = 0;
    const impactedNodes: Array<{ id: string; label: string }> = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentState = states.get(current);
      if (!currentState) continue;

      // Check threshold: count how many incoming parents are impacted/blocking
      const totalParents = currentState.dependencies.length;
      if (totalParents === 0) continue;
      const impactedParents = currentState.dependencies.filter((depId) => {
        const depState = states.get(depId);
        return depState && (depState.status === 'blocking' || depState.status === 'impacted');
      }).length;

      const meetsThreshold = ratio === 0
        ? impactedParents > 0
        : (impactedParents / totalParents) >= ratio;

      if (meetsThreshold && currentState.status === 'healthy') {
        currentState.status = 'impacted';
        graph.setNodeAttribute(current, 'color', STATUS_COLORS.impacted);
        graph.setNodeAttribute(current, 'image', STATUS_ICONS.impacted);
        impactedCount++;
        impactedNodes.push({ id: current, label: graph.getNodeAttribute(current, 'label') || current });
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
    // Track client timing
    setClientImpactCount(impactedCount);
    setClientImpactTime(performance.now() - bfsStart);
    setImpactedNodesList(impactedNodes);
    setServerImpactResult(null); // reset server result on new blocking node
    console.info(`Impact: ${impactedCount} nodes impacted from ${nodeId} (threshold=${propagationThreshold}%)`);
  }, [updateStats, propagationThreshold]);

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
    const ratio = propagationThreshold / 100;
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

      const totalParents = currentState.dependencies.length;
      if (totalParents === 0) continue;
      const impactedParents = currentState.dependencies.filter((depId) => {
        const depState = states.get(depId);
        return depState && (depState.status === 'blocking' || depState.status === 'impacted');
      }).length;

      const meetsThreshold = ratio === 0
        ? impactedParents > 0
        : (impactedParents / totalParents) >= ratio;

      if (meetsThreshold) {
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
  }, [isAnimating, updateStats, propagationThreshold]);

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
      const labelColorValue = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#fff';
      const sigma = new Sigma(graph, containerRef.current, {
        renderLabels: !isLarge,
        renderEdgeLabels: false,
        defaultNodeType: 'pictogram',
        nodeProgramClasses: { pictogram: NodeProgram },
        defaultEdgeColor: sizes.edgeColor,
        labelSize: isLarge ? 10 : 12,
        labelWeight: '600',
        labelColor: { color: labelColorValue },
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

  /** Lance l'analyse d'impact côté serveur depuis le nœud actuellement sélectionné. */
  const runServerImpact = useCallback(async () => {
    if (!selectedNode || !graphId) return;
    setServerLoading(true);
    setServerImpactResult(null);
    try {
      const result = await graphApi.computeImpact(
        graphId, selectedNode, serverDepth, database, engine as EngineType, propagationThreshold
      );
      setServerImpactResult(result);
    } catch (err) {
      console.error('Server impact analysis failed:', err);
    } finally {
      setServerLoading(false);
    }
  }, [selectedNode, graphId, serverDepth, database, engine, propagationThreshold]);

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

        <div className="threshold-slider">
          <label title="Pourcentage minimum de parents impactés requis pour propager l'impact">
            <i className="bi bi-sliders"></i> Seuil : {propagationThreshold}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={propagationThreshold}
            onChange={(e) => setPropagationThreshold(Number(e.target.value))}
            title={`${propagationThreshold}% — L'impact se propage si ≥${propagationThreshold}% des parents entrants sont impactés`}
          />
        </div>

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
        <p><i className="bi bi-arrow-right-circle"></i> L'impact se propage aux successeurs{propagationThreshold > 0 ? ` (≥${propagationThreshold}% parents impactés)` : ''}</p>
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
      {/* Panel de comparaison client vs serveur */}
      {selectedNode && (
        <div className="server-impact-panel">
          <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
            <i className="bi bi-cloud-arrow-up"></i> Analyse serveur
          </h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.82rem' }}>
              Profondeur :
              <input
                type="number" value={serverDepth} min={1} max={15}
                onChange={(e) => setServerDepth(Math.min(15, Math.max(1, parseInt(e.target.value) || 5)))}
                style={{ width: 44, marginLeft: 4, padding: '1px 4px', borderRadius: 4 }}
              />
            </label>
            <button
              onClick={runServerImpact}
              disabled={serverLoading || !graphId}
              style={{ padding: '3px 10px', fontSize: '0.82rem', cursor: 'pointer' }}
            >
              {serverLoading
                ? <><i className="bi bi-hourglass-split"></i> Analyse...</>
                : <><i className="bi bi-server"></i> Lancer</>}
            </button>
          </div>

          {(clientImpactCount !== null || serverImpactResult) && (
            <div className="impact-comparison">
              {clientImpactCount !== null && (
                <div className="impact-row impact-row--client">
                  <span className="impact-engine-tag">🖥 Client (graphology BFS)</span>
                  <span><strong>{clientImpactCount}</strong> impactés</span>
                  {clientImpactTime !== null && (
                    <span className="impact-time-tag">{clientImpactTime.toFixed(1)} ms</span>
                  )}
                </div>
              )}
              {serverImpactResult && (
                <div className="impact-row impact-row--server">
                  <span className="impact-engine-tag">🗄 {serverImpactResult.engine} (dép={serverImpactResult.depth})</span>
                  <span><strong>{serverImpactResult.impactedNodes.length}</strong> impactés</span>
                  <span className="impact-time-tag">{serverImpactResult.elapsed_ms} ms</span>
                </div>
              )}
            </div>
          )}
          {/* Liste des éléments impactés */}
          {impactedNodesList.length > 0 && (
            <div className="impacted-list-section">
              <button
                className="impacted-list-toggle"
                onClick={() => setShowImpactedList(v => !v)}
              >
                <i className={`bi ${showImpactedList ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
                {' '}{impactedNodesList.length} éléments impactés
              </button>
              {showImpactedList && (
                <ul className="impacted-list">
                  {impactedNodesList.map((n) => (
                    <li
                      key={n.id}
                      className="impacted-list-item"
                      onClick={() => {
                        // Center camera on the impacted node
                        if (sigmaRef.current && graphRef.current?.hasNode(n.id)) {
                          const pos = graphRef.current.getNodeAttributes(n.id);
                          sigmaRef.current.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 400 });
                        }
                      }}
                    >
                      <i className="bi bi-exclamation-triangle-fill" style={{ color: '#FF9800', fontSize: '0.8em' }}></i>
                      <span className="impacted-list-label" title={n.id}>{n.label}</span>
                      <span className="impacted-list-id">{n.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}        </div>
      )}
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
