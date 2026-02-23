import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core, NodeSingular } from 'cytoscape';
import type { GraphData } from '../types/graph';
import { generateColorFromString, getEdgeColor } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './CytoscapeGraphViewer.css';

interface CytoscapeGraphViewerProps {
  data: GraphData | null;
  graphId?: string;
}

const CytoscapeGraphViewer: React.FC<CytoscapeGraphViewerProps> = ({ data, graphId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const layoutRef = useRef<cytoscape.Layouts | null>(null);
  const mountedRef = useRef<boolean>(true);
  const [renderTime, setRenderTime] = useState<number>(0);
  const [timingDetails, setTimingDetails] = useState<{
    dataTransform: number; cytoInit: number; events: number; layout: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; count: number; color: string }>>([]);
  const [hoveredNode, setHoveredNode] = useState<{ label: string; type: string; color: string; id: string; degree: number } | null>(null);
  const [layoutName, setLayoutName] = useState<string>('cose');

  const buildGraph = useCallback(() => {
    if (!containerRef.current || !data) return;

    const startTime = performance.now();
    const nodeCount = data.nodes.length;

    // Stop any running layout and destroy previous instance
    if (layoutRef.current) {
      try { layoutRef.current.stop(); } catch (_) { /* already stopped */ }
      layoutRef.current = null;
    }
    if (cyRef.current) {
      cyRef.current.removeAllListeners();
      cyRef.current.destroy();
      cyRef.current = null;
    }

    // Extract node types for legend
    const typeCounts = new Map<string, number>();
    data.nodes.forEach((n) => {
      typeCounts.set(n.node_type, (typeCounts.get(n.node_type) || 0) + 1);
    });
    const types = Array.from(typeCounts.entries())
      .map(([type, count]) => ({
        type,
        count,
        color: generateColorFromString(type),
      }))
      .sort((a, b) => b.count - a.count);
    setNodeTypes(types);

    // Build elements
    const nodeSet = new Set(data.nodes.map((n) => n.id));
    const elements = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.id,
          label: nodeCount < 3000 ? n.label : '',
          nodeType: n.node_type,
          color: generateColorFromString(n.node_type),
        },
      })),
      ...data.edges
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .map((e, i) => ({
          data: {
            id: e.id || `edge-${i}`,
            source: e.source,
            target: e.target,
            label: nodeCount < 500 ? (e.label || '') : '',
            edgeType: e.edge_type,
            color: getEdgeColor(e.edge_type),
          },
        })),
    ];

    // Adaptive node size
    const nodeSize = nodeCount > 10000 ? 8 : nodeCount > 1000 ? 14 : 22;
    const fontSize = nodeCount > 1000 ? 8 : 11;

    // Default layout config (cose) - animate: false to avoid async rAF issues
    // with React StrictMode double-mount. Animation is only used in handleLayoutChange.
    const layoutConfig: cytoscape.LayoutOptions = {
      name: 'cose',
      animate: false,
      nodeRepulsion: () => nodeCount > 5000 ? 8000 : 4500,
      idealEdgeLength: () => nodeCount > 5000 ? 50 : 80,
      gravity: 0.25,
      numIter: nodeCount > 5000 ? 100 : 300,
      nodeDimensionsIncludeLabels: true,
    } as any;

    const t1 = performance.now(); // End data transform

    // Create Cytoscape instance
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            'font-size': fontSize,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 6,
            color: '#333',
            width: nodeSize,
            height: nodeSize,
            'border-width': 2,
            'border-color': '#fff',
            'overlay-opacity': 0,
            'text-max-width': '80px',
            'text-wrap': 'ellipsis',
          } as any,
        },
        {
          selector: 'node:active',
          style: {
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            width: 1.5,
            opacity: 0.6,
            label: 'data(label)',
            'font-size': 9,
            'text-rotation': 'autorotate',
            color: '#666',
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-color': '#333',
            'border-width': 3,
            'font-weight': 'bold',
            'z-index': 10,
          } as any,
        },
        {
          selector: 'node.neighbor',
          style: {
            'border-color': '#666',
            'border-width': 2,
            opacity: 1,
          } as any,
        },
        {
          selector: 'node.faded',
          style: {
            opacity: 0.15,
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            width: 3,
            opacity: 1,
          },
        },
        {
          selector: 'edge.faded',
          style: {
            opacity: 0.08,
          },
        },
      ],
      layout: { name: 'preset' },
      minZoom: 0.05,
      maxZoom: 10,
    });

    // Hover interactions
    const t2 = performance.now(); // End Cytoscape init
    cy.on('mouseover', 'node', (evt) => {
      if (!mountedRef.current) return;
      const node = evt.target;
      setHoveredNode({
        label: node.data('label') || node.data('id'),
        type: node.data('nodeType'),
        color: node.data('color'),
        id: node.data('id'),
        degree: node.degree(),
      });

      // Highlight neighbors
      const neighborhood = node.neighborhood().add(node);
      cy.elements().addClass('faded');
      neighborhood.removeClass('faded');
      node.addClass('highlighted');
      neighborhood.nodes().not(node).addClass('neighbor');
      neighborhood.edges().addClass('highlighted');
    });

    cy.on('mouseout', 'node', () => {
      if (!mountedRef.current) return;
      setHoveredNode(null);
      cy.elements().removeClass('faded highlighted neighbor');
    });

    cyRef.current = cy;

    const t3 = performance.now(); // End events setup

    // Run layout synchronously (animate: false), then fit
    const layout = cy.layout(layoutConfig);
    layoutRef.current = layout;
    layout.run();

    // Fit after synchronous layout completes
    cy.fit(undefined, 40);

    const endTime = performance.now();
    setRenderTime(endTime - startTime);
    setTimingDetails({
      dataTransform: t1 - startTime,
      cytoInit: t2 - t1,
      events: t3 - t2,
      layout: endTime - t3,
    });
  }, [data, graphId]);

  useEffect(() => {
    mountedRef.current = true;
    buildGraph();

    return () => {
      mountedRef.current = false;
      if (layoutRef.current) {
        try { layoutRef.current.stop(); } catch (_) { /* already stopped */ }
        layoutRef.current = null;
      }
      if (cyRef.current) {
        cyRef.current.removeAllListeners();
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [buildGraph]);

  const handleLayoutChange = (newLayout: string) => {
    setLayoutName(newLayout);
    if (!cyRef.current) return;

    // Stop any running layout
    if (layoutRef.current) {
      try { layoutRef.current.stop(); } catch (_) { /* already stopped */ }
      layoutRef.current = null;
    }

    const nodeCount = data?.nodes?.length || 0;
    let layoutConfig: cytoscape.LayoutOptions;

    switch (newLayout) {
      case 'cose':
        layoutConfig = {
          name: 'cose',
          animate: nodeCount < 2000,
          animationDuration: 500,
          nodeRepulsion: () => nodeCount > 5000 ? 8000 : 4500,
          idealEdgeLength: () => nodeCount > 5000 ? 50 : 80,
          gravity: 0.25,
          numIter: nodeCount > 5000 ? 100 : 300,
          nodeDimensionsIncludeLabels: true,
        } as any;
        break;
      case 'breadthfirst':
        layoutConfig = { name: 'breadthfirst', directed: true, spacingFactor: 1.25, animate: nodeCount < 2000 };
        break;
      case 'circle':
        layoutConfig = { name: 'circle', animate: nodeCount < 2000, spacingFactor: 1.2 };
        break;
      case 'concentric':
        layoutConfig = {
          name: 'concentric',
          animate: nodeCount < 2000,
          concentric: (node: NodeSingular) => node.degree(),
          levelWidth: () => 2,
          minNodeSpacing: 30,
        };
        break;
      case 'grid':
        layoutConfig = { name: 'grid', animate: nodeCount < 2000, condense: true };
        break;
      default:
        layoutConfig = { name: 'cose', animate: false } as any;
    }

    const layout = cyRef.current.layout(layoutConfig);
    layoutRef.current = layout;

    layout.on('layoutstop', () => {
      if (!mountedRef.current || !cyRef.current) return;
      try { cyRef.current.fit(undefined, 40); } catch (_) { /* destroyed */ }
    });

    layout.run();
  };

  return (
    <div className="cytoscape-graph-viewer">
      <div className="cytoscape-controls">
        <div className="cytoscape-stats">
          <span className="stat-badge">
            <strong>{data?.nodes?.length || 0}</strong> nodes
          </span>
          <span className="stat-badge">
            <strong>{data?.edges?.length || 0}</strong> edges
          </span>
          <span className="stat-badge render-time">
            Render: <strong>{renderTime.toFixed(0)}ms</strong>
          </span>
          <span className="stat-badge-info">Cytoscape.js</span>
        </div>

        {timingDetails && (
          <div className="timing-details-bar">
            <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
              ⏱️ Timing details {timingOpen ? '▼' : '▶'}
            </button>
            {timingOpen && (
              <div className="timing-breakdown">
                <span className="timing-badge data">Data: <strong>{timingDetails.dataTransform.toFixed(1)}ms</strong></span>
                <span className="timing-badge init">Cytoscape init: <strong>{timingDetails.cytoInit.toFixed(1)}ms</strong></span>
                <span className="timing-badge events">Events: <strong>{timingDetails.events.toFixed(1)}ms</strong></span>
                <span className="timing-badge layout">Layout: <strong>{timingDetails.layout.toFixed(1)}ms</strong></span>
              </div>
            )}
          </div>
        )}

        <div className="cytoscape-layout-selector">
          <span className="layout-label">Layout:</span>
          {['cose', 'breadthfirst', 'circle', 'concentric', 'grid'].map((l) => (
            <button
              key={l}
              className={`layout-btn ${layoutName === l ? 'active' : ''}`}
              onClick={() => handleLayoutChange(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="cytoscape-container" ref={containerRef} />

      {hoveredNode && (
        <div className="cytoscape-tooltip">
          <div className="tooltip-label">{hoveredNode.label}</div>
          <div className="tooltip-type">
            <span className="tooltip-color" style={{ backgroundColor: hoveredNode.color }} />
            {hoveredNode.type}
          </div>
          <div className="tooltip-degree">Connections: {hoveredNode.degree}</div>
          <div className="tooltip-id">ID: {hoveredNode.id}</div>
        </div>
      )}

      <div className="cytoscape-help">
        <div className="help-title">Controls</div>
        <ul>
          <li><strong>Scroll:</strong> Zoom in/out</li>
          <li><strong>Drag background:</strong> Pan view</li>
          <li><strong>Drag node:</strong> Move node</li>
          <li><strong>Hover node:</strong> Highlight neighbors</li>
        </ul>
      </div>

      <FpsCounter recording={renderTime > 0} />
    </div>
  );
};

export default CytoscapeGraphViewer;
