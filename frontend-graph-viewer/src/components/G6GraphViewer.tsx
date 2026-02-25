import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Graph } from '@antv/g6';
import { GraphData as AppGraphData } from '../types/graph';
import { transformGraphData, generateColorFromString } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './G6GraphViewer.css';

interface G6GraphViewerProps {
  graphData: AppGraphData;
}

type LayoutType = 'circular' | 'grid' | 'concentric' | 'radial' | 'force';

/**
 * Pre-compute positions so nodes never overlap regardless of G6 layout engine.
 * Uses a simple packed-circle placement grouped by node type.
 */
function precomputePositions(
  nodes: Array<{ id: string; type?: string }>,
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  const n = nodes.length;

  if (n === 0) return positions;

  // Place nodes in a spiral layout – simple, deterministic, no overlap
  const spacing = Math.max(20, Math.min(60, Math.sqrt((width * height) / n) * 0.6));
  let angle = 0;
  let radius = 0;
  const angleStep = 2.4; // golden angle in radians ≈ 137.5°

  for (let i = 0; i < n; i++) {
    radius = spacing * Math.sqrt(i + 1);
    angle = i * angleStep;
    positions.set(nodes[i].id, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  return positions;
}

const LAYOUT_LABELS: Record<LayoutType, string> = {
  circular: '🔵 Circular',
  grid: '📐 Grid',
  concentric: '🎯 Concentric',
  radial: '☀️ Radial',
  force: '⚡ Force',
};

const G6GraphViewer: React.FC<G6GraphViewerProps> = ({ graphData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const [renderTime, setRenderTime] = useState<number>(0);
  const [timingDetails, setTimingDetails] = useState<{
    dataTransform: number; positions: number; graphCreate: number; render: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; count: number; color: string }>>([]);
  const [layout, setLayout] = useState<LayoutType>('circular');

  const buildGraph = useCallback((selectedLayout: LayoutType) => {
    if (!containerRef.current || !graphData) return;

    // Destroy previous graph
    if (graphRef.current) {
      try { graphRef.current.destroy(); } catch (_) { /* noop */ }
      graphRef.current = null;
    }

    // Clear container
    const container = containerRef.current;
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Per-invocation flag (not a ref) to guard async render
    let destroyed = false;

    const startTime = performance.now();

    // Transform data
    const transformed = transformGraphData(graphData.nodes || [], graphData.edges || []);
    const nodeCount = transformed.nodes.length;
    const w = container.offsetWidth;
    const h = container.offsetHeight;

    // Type stats
    const typeCounts = new Map<string, number>();
    transformed.nodes.forEach(node => {
      const type = node.type || 'default';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    setNodeTypes(
      Array.from(typeCounts.entries()).map(([type, count]) => ({
        type,
        count,
        color: generateColorFromString(type),
      }))
    );

    const t1 = performance.now(); // End data transform

    // Pre-compute positions to guarantee no overlap
    const positions = precomputePositions(transformed.nodes, w, h);

    const t2 = performance.now(); // End position computation

    // G6 data with initial positions baked in
    const g6Data = {
      nodes: transformed.nodes.map((node) => {
        const pos = positions.get(node.id) || { x: w / 2, y: h / 2 };
        return {
          id: node.id,
          style: { x: pos.x, y: pos.y },
          data: {
            label: nodeCount < 5000 ? node.name : '',
            nodeType: node.type || 'default',
            color: generateColorFromString(node.type || 'default'),
          },
        };
      }),
      edges: transformed.links.map((link, i) => ({
        id: `edge-${i}`,
        source: link.source,
        target: link.target,
        data: {},
      })),
    };

    // Adaptive sizing
    const nodeSize = nodeCount > 10000 ? 4 : nodeCount > 5000 ? 6 : nodeCount > 1000 ? 8 : 12;
    const showLabels = nodeCount < 3000;
    const enableDrag = nodeCount < 10000;

    // Build layout config
    let layoutConfig: any;
    switch (selectedLayout) {
      case 'grid':
        layoutConfig = { type: 'grid', preventOverlap: true, nodeSize: nodeSize * 4 };
        break;
      case 'concentric':
        layoutConfig = {
          type: 'concentric',
          preventOverlap: true,
          nodeSize: nodeSize * 4,
          sortBy: 'degree',
        };
        break;
      case 'radial':
        layoutConfig = {
          type: 'radial',
          preventOverlap: true,
          nodeSize: nodeSize * 4,
          unitRadius: nodeCount > 1000 ? 150 : 200,
        };
        break;
      case 'force':
        layoutConfig = {
          type: 'force',
          preventOverlap: true,
          nodeSize: nodeSize * 4,
          linkDistance: nodeCount > 5000 ? 120 : nodeCount > 1000 ? 200 : 300,
          nodeStrength: nodeCount > 5000 ? -400 : nodeCount > 1000 ? -600 : -800,
          edgeStrength: 0.05,
          collideStrength: 1,
          alphaDecay: 0.02,
          velocityDecay: 0.4,
        };
        break;
      case 'circular':
      default:
        layoutConfig = {
          type: 'circular',
          radius: Math.min(w, h) * 0.4,
          divisions: typeCounts.size,
          ordering: 'degree',
        };
        break;
    }

    // Create graph — no animation
    const graph = new Graph({
      container,
      width: w,
      height: h,
      autoFit: 'view',
      animation: false,
      data: g6Data,
      layout: layoutConfig,
      node: {
        style: (model: any) => ({
          size: nodeSize,
          fill: model.data?.color || '#999',
          stroke: '#fff',
          lineWidth: nodeCount > 5000 ? 0.5 : 1.5,
          labelText: showLabels ? (model.data?.label || '') : '',
          labelFontSize: nodeCount > 1000 ? 9 : 12,
          labelFill: '#333',
          labelPosition: 'bottom',
          labelOffsetY: 6,
        }),
        state: {
          selected: { lineWidth: 3, stroke: '#1890ff' },
          hover: { lineWidth: 3, stroke: '#333' },
        },
      },
      edge: {
        style: {
          stroke: '#ccc',
          lineWidth: nodeCount > 5000 ? 0.3 : 0.8,
          endArrow: nodeCount < 2000,
        },
        state: {
          selected: { lineWidth: 2, stroke: '#1890ff' },
        },
      },
      behaviors: enableDrag
        ? ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select']
        : ['drag-canvas', 'zoom-canvas', 'click-select'],
    });

    graphRef.current = graph;

    const t3 = performance.now(); // End graph creation

    // Async render – guarded by per-invocation flag
    graph
      .render()
      .then(() => {
        if (destroyed) return;
        const t4 = performance.now();
        setRenderTime(t4 - startTime);
        setTimingDetails({
          dataTransform: t1 - startTime,
          positions: t2 - t1,
          graphCreate: t3 - t2,
          render: t4 - t3,
        });
      })
      .catch(() => {
        // Silently swallow – graph was destroyed (StrictMode double-mount)
      });

    // Resize handler
    const handleResize = () => {
      if (!destroyed && graphRef.current && container) {
        graphRef.current.setSize(container.offsetWidth, container.offsetHeight);
        graphRef.current.fitView();
      }
    };
    window.addEventListener('resize', handleResize);

    // Return cleanup
    return () => {
      destroyed = true;
      window.removeEventListener('resize', handleResize);
      if (graphRef.current) {
        try { graphRef.current.destroy(); } catch (_) { /* noop */ }
        graphRef.current = null;
      }
    };
  }, [graphData]);

  // Build/rebuild when data or layout changes
  useEffect(() => {
    const cleanup = buildGraph(layout);
    return cleanup;
  }, [graphData, layout, buildGraph]);

  return (
    <div className="g6-graph-viewer">
      <div className="g6-controls">
        <div className="g6-stats">
          <span className="stat-badge">
            <strong>{graphData.nodes?.length || 0}</strong> nodes
          </span>
          <span className="stat-badge">
            <strong>{graphData.edges?.length || 0}</strong> edges
          </span>
          <span className="stat-badge render-time">
            Render: <strong>{renderTime.toFixed(0)}ms</strong>
          </span>
          <span className="stat-badge-info">G6 (AntV)</span>
        </div>

        {timingDetails && (
          <div className="timing-details-bar">
            <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
              ⏱️ Timing details {timingOpen ? '▼' : '▶'}
            </button>
            {timingOpen && (
              <div className="timing-breakdown">
                <span className="timing-badge data">Data: <strong>{timingDetails.dataTransform.toFixed(1)}ms</strong></span>
                <span className="timing-badge positions">Positions: <strong>{timingDetails.positions.toFixed(1)}ms</strong></span>
                <span className="timing-badge graph">Graph init: <strong>{timingDetails.graphCreate.toFixed(1)}ms</strong></span>
                <span className="timing-badge render">Render: <strong>{timingDetails.render.toFixed(1)}ms</strong></span>
              </div>
            )}
          </div>
        )}

        {/* Layout selector */}
        <div className="g6-layout-selector">
          {(Object.keys(LAYOUT_LABELS) as LayoutType[]).map((l) => (
            <button
              key={l}
              className={`layout-btn ${layout === l ? 'active' : ''}`}
              onClick={() => setLayout(l)}
            >
              {LAYOUT_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="g6-container" ref={containerRef} />

      <div className="g6-help">
        <div className="help-title">Controls</div>
        <ul>
          <li><strong>Scroll:</strong> Zoom in/out</li>
          <li><strong>Drag background:</strong> Pan view</li>
          {(graphData.nodes?.length || 0) < 10000 && (
            <li><strong>Drag node:</strong> Move node</li>
          )}
          <li><strong>Click node:</strong> Select</li>
        </ul>
      </div>

      <FpsCounter recording={renderTime > 0} />
    </div>
  );
};

export default G6GraphViewer;
