import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Network, Options, Data as VisData } from 'vis-network';
import { DataSet } from 'vis-data';
import type { GraphData } from '../types/graph';
import { generateColorFromString, getEdgeColor } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './VisNetworkViewer.css';

interface VisNetworkViewerProps {
  data: GraphData | null;
  graphId?: string;
}

// Adaptive presets based on graph size
function getDefaultParams(nodeCount: number) {
  if (nodeCount > 10000) {
    return {
      nodeSize: 4, borderWidth: 0.5, showLabels: false, showEdgeLabels: false,
      labelSize: 8, showArrows: false,
      edgeWidth: 0.3, edgeOpacity: 0.2, edgeSmooth: false,
      gravitationalConstant: -2000, centralGravity: 0.3,
      springLength: 50, springConstant: 0.01, damping: 0.3,
      solver: 'barnesHut' as const, maxVelocity: 80,
      stabilizationIterations: 200,
    };
  }
  if (nodeCount > 5000) {
    return {
      nodeSize: 6, borderWidth: 1, showLabels: false, showEdgeLabels: false,
      labelSize: 9, showArrows: false,
      edgeWidth: 0.5, edgeOpacity: 0.3, edgeSmooth: false,
      gravitationalConstant: -3000, centralGravity: 0.25,
      springLength: 80, springConstant: 0.02, damping: 0.25,
      solver: 'barnesHut' as const, maxVelocity: 60,
      stabilizationIterations: 250,
    };
  }
  if (nodeCount > 2000) {
    return {
      nodeSize: 8, borderWidth: 1.5, showLabels: false, showEdgeLabels: false,
      labelSize: 10, showArrows: true,
      edgeWidth: 0.8, edgeOpacity: 0.4, edgeSmooth: false,
      gravitationalConstant: -5000, centralGravity: 0.2,
      springLength: 120, springConstant: 0.03, damping: 0.2,
      solver: 'barnesHut' as const, maxVelocity: 50,
      stabilizationIterations: 300,
    };
  }
  if (nodeCount > 500) {
    return {
      nodeSize: 12, borderWidth: 2, showLabels: true, showEdgeLabels: false,
      labelSize: 11, showArrows: true,
      edgeWidth: 1, edgeOpacity: 0.5, edgeSmooth: true,
      gravitationalConstant: -8000, centralGravity: 0.15,
      springLength: 150, springConstant: 0.04, damping: 0.15,
      solver: 'barnesHut' as const, maxVelocity: 40,
      stabilizationIterations: 400,
    };
  }
  // < 500 nodes
  return {
    nodeSize: 18, borderWidth: 2.5, showLabels: true, showEdgeLabels: true,
    labelSize: 12, showArrows: true,
    edgeWidth: 1.5, edgeOpacity: 0.6, edgeSmooth: true,
    gravitationalConstant: -12000, centralGravity: 0.1,
    springLength: 200, springConstant: 0.05, damping: 0.09,
    solver: 'barnesHut' as const, maxVelocity: 30,
    stabilizationIterations: 500,
  };
}

type SolverType = 'barnesHut' | 'forceAtlas2Based' | 'repulsion' | 'hierarchicalRepulsion';

const SOLVER_LABELS: Record<SolverType, string> = {
  barnesHut: '🌳 Barnes-Hut',
  forceAtlas2Based: '⚡ ForceAtlas2',
  repulsion: '💥 Repulsion',
  hierarchicalRepulsion: '📊 Hierarchical',
};

const VisNetworkViewer: React.FC<VisNetworkViewerProps> = ({ data, graphId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const [renderTime, setRenderTime] = useState<number>(0);
  const [stabilizing, setStabilizing] = useState(false);
  const [stabilizationProgress, setStabilizationProgress] = useState(0);
  const [timingDetails, setTimingDetails] = useState<{
    dataTransform: number; networkInit: number; stabilization: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<{ label: string; type: string; color: string; id: string; connections: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  // Timing refs
  const startTimeRef = useRef(0);
  const dataTransformTimeRef = useRef(0);
  const networkInitTimeRef = useRef(0);

  // Interactive parameters
  const nodeCount = data?.nodes?.length || 0;
  const defaults = getDefaultParams(nodeCount);

  const [nodeSize, setNodeSize] = useState(defaults.nodeSize);
  const [borderWidth, setBorderWidth] = useState(defaults.borderWidth);
  const [showLabels, setShowLabels] = useState(defaults.showLabels);
  const [showEdgeLabels, setShowEdgeLabels] = useState(defaults.showEdgeLabels);
  const [labelSize, setLabelSize] = useState(defaults.labelSize);
  const [showArrows, setShowArrows] = useState(defaults.showArrows);
  const [edgeWidth, setEdgeWidth] = useState(defaults.edgeWidth);
  const [edgeOpacity, setEdgeOpacity] = useState(defaults.edgeOpacity);
  const [edgeSmooth, setEdgeSmooth] = useState(defaults.edgeSmooth);
  const [gravitationalConstant, setGravitationalConstant] = useState(defaults.gravitationalConstant);
  const [centralGravity, setCentralGravity] = useState(defaults.centralGravity);
  const [springLength, setSpringLength] = useState(defaults.springLength);
  const [springConstant, setSpringConstant] = useState(defaults.springConstant);
  const [damping, setDamping] = useState(defaults.damping);
  const [solver, setSolver] = useState<SolverType>(defaults.solver);
  const [maxVelocity, setMaxVelocity] = useState(defaults.maxVelocity);
  const [stabilizationIterations, setStabilizationIterations] = useState(defaults.stabilizationIterations);

  // Reset params when graph changes
  useEffect(() => {
    const nc = data?.nodes?.length || 0;
    const d = getDefaultParams(nc);
    setNodeSize(d.nodeSize); setBorderWidth(d.borderWidth);
    setShowLabels(d.showLabels); setShowEdgeLabels(d.showEdgeLabels);
    setLabelSize(d.labelSize); setShowArrows(d.showArrows);
    setEdgeWidth(d.edgeWidth); setEdgeOpacity(d.edgeOpacity);
    setEdgeSmooth(d.edgeSmooth);
    setGravitationalConstant(d.gravitationalConstant); setCentralGravity(d.centralGravity);
    setSpringLength(d.springLength); setSpringConstant(d.springConstant);
    setDamping(d.damping); setSolver(d.solver);
    setMaxVelocity(d.maxVelocity); setStabilizationIterations(d.stabilizationIterations);
  }, [data, graphId]);

  // Build network
  const buildNetwork = useCallback(() => {
    if (!containerRef.current || !data) return;

    // Destroy previous
    if (networkRef.current) {
      networkRef.current.destroy();
      networkRef.current = null;
    }

    startTimeRef.current = performance.now();
    const t0 = performance.now();

    const nc = data.nodes.length;

    // Build type stats
    const typeCounts = new Map<string, number>();
    data.nodes.forEach((n) => {
      typeCounts.set(n.node_type, (typeCounts.get(n.node_type) || 0) + 1);
    });

    // Create vis DataSets
    const nodeSet = new Set(data.nodes.map((n) => n.id));
    const visNodes = new DataSet(
      data.nodes.map((n) => {
        const color = generateColorFromString(n.node_type);
        return {
          id: n.id,
          label: showLabels ? (n.label || n.id) : undefined,
          title: `${n.label} (${n.node_type})`,
          color: {
            background: color,
            border: '#fff',
            highlight: { background: '#FFD700', border: '#333' },
            hover: { background: color, border: '#333' },
          },
          size: nodeSize,
          borderWidth,
          font: {
            size: labelSize,
            color: '#333',
            face: 'system-ui, -apple-system, sans-serif',
            strokeWidth: 2,
            strokeColor: '#fff',
          },
          shape: 'dot',
          // Store custom data
          nodeType: n.node_type,
          nodeColor: color,
        };
      })
    );

    const edgeColorHex = `rgba(150,150,150,${edgeOpacity})`;
    const visEdges = new DataSet(
      data.edges
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .map((e, i) => ({
          id: e.id || `edge-${i}`,
          from: e.source,
          to: e.target,
          label: showEdgeLabels ? (e.label || '') : undefined,
          color: {
            color: getEdgeColor(e.edge_type) || edgeColorHex,
            opacity: edgeOpacity,
            highlight: '#333',
            hover: '#555',
          },
          width: edgeWidth,
          arrows: showArrows ? { to: { enabled: true, scaleFactor: 0.5 } } : undefined,
          smooth: edgeSmooth ? { enabled: true, type: 'continuous', roundness: 0.3 } : false,
          font: { size: 9, color: '#666', align: 'middle', strokeWidth: 2, strokeColor: '#fff' },
        })) as any
    );

    const t1 = performance.now(); // End data transform
    dataTransformTimeRef.current = t1 - t0;

    // Physics config based on solver
    const physicsConfig: any = {
      enabled: true,
      stabilization: {
        enabled: true,
        iterations: stabilizationIterations,
        updateInterval: 25,
      },
      maxVelocity,
      minVelocity: 0.75,
    };

    if (solver === 'barnesHut') {
      physicsConfig.solver = 'barnesHut';
      physicsConfig.barnesHut = {
        gravitationalConstant,
        centralGravity,
        springLength,
        springConstant,
        damping,
        avoidOverlap: 0.5,
      };
    } else if (solver === 'forceAtlas2Based') {
      physicsConfig.solver = 'forceAtlas2Based';
      physicsConfig.forceAtlas2Based = {
        gravitationalConstant: gravitationalConstant * 0.5,
        centralGravity: centralGravity * 0.1,
        springLength,
        springConstant: springConstant * 2,
        damping,
        avoidOverlap: 0.5,
      };
    } else if (solver === 'repulsion') {
      physicsConfig.solver = 'repulsion';
      physicsConfig.repulsion = {
        nodeDistance: springLength,
        centralGravity,
        springLength,
        springConstant,
        damping,
      };
    } else {
      physicsConfig.solver = 'hierarchicalRepulsion';
      physicsConfig.hierarchicalRepulsion = {
        nodeDistance: springLength * 1.5,
        centralGravity,
        springLength,
        springConstant,
        damping,
        avoidOverlap: 0.5,
      };
    }

    // Network options
    const options: Options = {
      nodes: {
        shape: 'dot',
        scaling: { min: nodeSize * 0.5, max: nodeSize * 2 },
      },
      edges: {
        smooth: edgeSmooth ? { enabled: true, type: 'continuous', roundness: 0.3 } : { enabled: false, type: 'continuous', roundness: 0.3 },
        selectionWidth: 2,
      },
      physics: physicsConfig,
      interaction: {
        hover: true,
        tooltipDelay: 200,
        hideEdgesOnDrag: nc > 5000,
        hideEdgesOnZoom: nc > 5000,
        dragNodes: nc < 10000,
        multiselect: true,
        navigationButtons: false,
        keyboard: { enabled: true },
        zoomView: true,
        dragView: true,
      },
      layout: solver === 'hierarchicalRepulsion'
        ? { hierarchical: { direction: 'UD', sortMethod: 'hubsize', levelSeparation: 100 } }
        : { improvedLayout: nc < 5000 },
    };

    // Create network
    const visData = { nodes: visNodes as any, edges: visEdges as any } as VisData;
    const network = new Network(containerRef.current, visData, options);
    networkRef.current = network;

    const t2 = performance.now(); // End network init
    networkInitTimeRef.current = t2 - t1;

    setStabilizing(true);
    setStabilizationProgress(0);

    // Stabilization progress
    network.on('stabilizationProgress', (params) => {
      setStabilizationProgress(Math.round((params.iterations / params.total) * 100));
    });

    // Stabilization done
    network.on('stabilizationIterationsDone', () => {
      const t3 = performance.now();
      setStabilizing(false);
      setStabilizationProgress(100);
      network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });

      const total = t3 - t0;
      setRenderTime(total);
      setTimingDetails({
        dataTransform: dataTransformTimeRef.current,
        networkInit: networkInitTimeRef.current,
        stabilization: t3 - t2,
      });
    });

    // Hover events
    network.on('hoverNode', (params) => {
      const nodeId = params.node;
      const nodeData = visNodes.get(nodeId) as any;
      if (!nodeData) return;
      setHoveredNode({
        label: nodeData.label || nodeData.title || nodeId,
        type: nodeData.nodeType || 'unknown',
        color: nodeData.nodeColor || '#999',
        id: String(nodeId),
        connections: network.getConnectedEdges(nodeId).length,
      });

      // Highlight neighborhood
      const connectedNodes = network.getConnectedNodes(nodeId) as string[];
      const allNodeIds = visNodes.getIds();
      const neighborSet = new Set([nodeId, ...connectedNodes]);

      visNodes.update(
        allNodeIds.map((id) => ({
          id: String(id),
          opacity: neighborSet.has(id) ? 1 : 0.15,
        })) as any
      );
    });

    network.on('blurNode', () => {
      setHoveredNode(null);
      const allNodeIds = visNodes.getIds();
      visNodes.update(allNodeIds.map((id) => ({ id: String(id), opacity: 1 })) as any);
    });

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [data, graphId, nodeSize, borderWidth, showLabels, showEdgeLabels, labelSize,
      showArrows, edgeWidth, edgeOpacity, edgeSmooth,
      gravitationalConstant, centralGravity, springLength, springConstant,
      damping, solver, maxVelocity, stabilizationIterations]);

  // Effect: build on data/param change
  useEffect(() => {
    const cleanup = buildNetwork();
    return cleanup;
  }, [buildNetwork]);

  // Reset
  const resetParams = () => {
    const d = getDefaultParams(data?.nodes?.length || 0);
    setNodeSize(d.nodeSize); setBorderWidth(d.borderWidth);
    setShowLabels(d.showLabels); setShowEdgeLabels(d.showEdgeLabels);
    setLabelSize(d.labelSize); setShowArrows(d.showArrows);
    setEdgeWidth(d.edgeWidth); setEdgeOpacity(d.edgeOpacity);
    setEdgeSmooth(d.edgeSmooth);
    setGravitationalConstant(d.gravitationalConstant); setCentralGravity(d.centralGravity);
    setSpringLength(d.springLength); setSpringConstant(d.springConstant);
    setDamping(d.damping); setSolver(d.solver);
    setMaxVelocity(d.maxVelocity); setStabilizationIterations(d.stabilizationIterations);
  };

  const handleFitView = () => {
    networkRef.current?.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  };

  const handleStabilize = () => {
    if (networkRef.current) {
      networkRef.current.stabilize(stabilizationIterations);
    }
  };

  if (!data) {
    return (
      <div className="vis-graph-viewer">
        <div className="vis-empty-state">
          <h3>No graph selected</h3>
          <p>Select a graph from the list to visualize it</p>
        </div>
      </div>
    );
  }

  return (
    <div className="vis-graph-viewer">
      <div className="vis-controls">
        <div className="vis-stats">
          <span className="stat-badge">
            <strong>{data?.nodes?.length || 0}</strong> nodes
          </span>
          <span className="stat-badge">
            <strong>{data?.edges?.length || 0}</strong> edges
          </span>
          <span className="stat-badge render-time">
            Render: <strong>{renderTime.toFixed(0)}ms</strong>
          </span>
          <span className="stat-badge-info">vis-network</span>
        </div>

        {/* Timing details */}
        {timingDetails && (
          <div className="timing-details-bar">
            <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
              ⏱️ Timing details {timingOpen ? '▼' : '▶'}
            </button>
            {timingOpen && (
              <div className="timing-breakdown">
                <span className="timing-badge data">Data: <strong>{timingDetails.dataTransform.toFixed(1)}ms</strong></span>
                <span className="timing-badge init">Network init: <strong>{timingDetails.networkInit.toFixed(1)}ms</strong></span>
                <span className="timing-badge sim">Stabilization: <strong>{timingDetails.stabilization.toFixed(1)}ms</strong></span>
              </div>
            )}
          </div>
        )}

        {/* Solver selector */}
        <div className="vis-solver-selector">
          {(Object.keys(SOLVER_LABELS) as SolverType[]).map((s) => (
            <button
              key={s}
              className={`solver-btn ${solver === s ? 'active' : ''}`}
              onClick={() => setSolver(s)}
            >
              {SOLVER_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Parameter panel */}
        <div className="vis-params-panel">
          <div className="params-header" onClick={() => setPanelOpen(!panelOpen)}>
            <span className="params-title">⚙️ Parameters</span>
            <span className="params-toggle">{panelOpen ? '▼' : '▶'}</span>
          </div>

          {panelOpen && (
            <div className="params-body">
              <div className="params-actions">
                <button className="param-btn reset" onClick={resetParams}>Reset defaults</button>
                <button className="param-btn reheat" onClick={handleStabilize}>🔄 Re-stabilize</button>
              </div>

              <div className="params-section">
                <div className="section-title">Nodes</div>
                <label className="param-row">
                  <span className="param-label">Size <span className="param-value">{nodeSize}</span></span>
                  <input type="range" min="1" max="30" step="1" value={nodeSize}
                    onChange={(e) => setNodeSize(parseInt(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Border <span className="param-value">{borderWidth.toFixed(1)}</span></span>
                  <input type="range" min="0" max="5" step="0.5" value={borderWidth}
                    onChange={(e) => setBorderWidth(parseFloat(e.target.value))} />
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                  <span>Show labels</span>
                </label>
                <label className="param-row">
                  <span className="param-label">Label size <span className="param-value">{labelSize}</span></span>
                  <input type="range" min="6" max="20" step="1" value={labelSize}
                    onChange={(e) => setLabelSize(parseInt(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Physics</div>
                <label className="param-row">
                  <span className="param-label">Gravity <span className="param-value">{gravitationalConstant}</span></span>
                  <input type="range" min="-30000" max="-500" step="500" value={gravitationalConstant}
                    onChange={(e) => setGravitationalConstant(parseInt(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Central gravity <span className="param-value">{centralGravity.toFixed(2)}</span></span>
                  <input type="range" min="0" max="1" step="0.01" value={centralGravity}
                    onChange={(e) => setCentralGravity(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Spring length <span className="param-value">{springLength}</span></span>
                  <input type="range" min="10" max="400" step="10" value={springLength}
                    onChange={(e) => setSpringLength(parseInt(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Spring constant <span className="param-value">{springConstant.toFixed(3)}</span></span>
                  <input type="range" min="0.001" max="0.2" step="0.001" value={springConstant}
                    onChange={(e) => setSpringConstant(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Damping <span className="param-value">{damping.toFixed(2)}</span></span>
                  <input type="range" min="0.01" max="0.5" step="0.01" value={damping}
                    onChange={(e) => setDamping(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Max velocity <span className="param-value">{maxVelocity}</span></span>
                  <input type="range" min="10" max="150" step="5" value={maxVelocity}
                    onChange={(e) => setMaxVelocity(parseInt(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Stabilization</div>
                <label className="param-row">
                  <span className="param-label">Iterations <span className="param-value">{stabilizationIterations}</span></span>
                  <input type="range" min="50" max="2000" step="50" value={stabilizationIterations}
                    onChange={(e) => setStabilizationIterations(parseInt(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Edges</div>
                <label className="param-row">
                  <span className="param-label">Width <span className="param-value">{edgeWidth.toFixed(1)}</span></span>
                  <input type="range" min="0.1" max="5" step="0.1" value={edgeWidth}
                    onChange={(e) => setEdgeWidth(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Opacity <span className="param-value">{edgeOpacity.toFixed(2)}</span></span>
                  <input type="range" min="0.05" max="1" step="0.05" value={edgeOpacity}
                    onChange={(e) => setEdgeOpacity(parseFloat(e.target.value))} />
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showArrows} onChange={(e) => setShowArrows(e.target.checked)} />
                  <span>Show arrows</span>
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showEdgeLabels} onChange={(e) => setShowEdgeLabels(e.target.checked)} />
                  <span>Show edge labels</span>
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={edgeSmooth} onChange={(e) => setEdgeSmooth(e.target.checked)} />
                  <span>Smooth edges</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="vis-container" ref={containerRef} />

      {/* Stabilization overlay */}
      {stabilizing && (
        <div className="vis-stabilization-overlay">
          <div className="stabilization-content">
            <div className="stabilization-spinner" />
            <span>Stabilizing... {stabilizationProgress}%</span>
            <div className="stabilization-bar">
              <div className="stabilization-fill" style={{ width: `${stabilizationProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredNode && (
        <div className="vis-tooltip">
          <div className="tooltip-label">{hoveredNode.label}</div>
          <div className="tooltip-type">
            <span className="tooltip-color" style={{ backgroundColor: hoveredNode.color }} />
            {hoveredNode.type}
          </div>
          <div className="tooltip-degree">Connections: {hoveredNode.connections}</div>
          <div className="tooltip-id">ID: {hoveredNode.id}</div>
        </div>
      )}

      {/* Help */}
      <div className="vis-help">
        <div className="help-title">Controls</div>
        <ul>
          <li><strong>Scroll:</strong> Zoom in/out</li>
          <li><strong>Drag background:</strong> Pan view</li>
          {(data?.nodes?.length || 0) < 10000 && (
            <li><strong>Drag node:</strong> Move node</li>
          )}
          <li><strong>Hover node:</strong> Show details</li>
        </ul>
        <button className="fit-btn" onClick={handleFitView}>📐 Fit view</button>
      </div>

      <FpsCounter recording={stabilizing} />
    </div>
  );
};

export default VisNetworkViewer;
