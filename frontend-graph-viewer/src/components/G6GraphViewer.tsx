import React, { useEffect, useRef, useState } from 'react';
import { Graph } from '@antv/g6';
import { GraphData as AppGraphData } from '../types/graph';
import { transformGraphData, generateColorFromString } from '../services/graphTransform';
import './G6GraphViewer.css';

interface G6GraphViewerProps {
  graphData: AppGraphData;
}

const G6GraphViewer: React.FC<G6GraphViewerProps> = ({ graphData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const [renderTime, setRenderTime] = useState<number>(0);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; count: number; color: string }>>([]);

  useEffect(() => {
    if (!containerRef.current || !graphData) return;

    const startTime = performance.now();
    
    // Transform data
    const transformed = transformGraphData(graphData.nodes || [], graphData.edges || []);
    const nodeCount = transformed.nodes.length;

    // Extract node types with counts
    const typeCounts = new Map<string, number>();
    transformed.nodes.forEach(node => {
      const type = node.type || 'default';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });

    const types = Array.from(typeCounts.entries()).map(([type, count]) => ({
      type,
      count,
      color: generateColorFromString(type)
    }));
    setNodeTypes(types);

    // Prepare G6 v5 data format
    const g6Data = {
      nodes: transformed.nodes.map((node) => ({
        id: node.id,
        data: {
          label: nodeCount < 5000 ? node.name : '',
          nodeType: node.type || 'default',
          color: generateColorFromString(node.type || 'default'),
        },
      })),
      edges: transformed.links.map((link, index) => ({
        id: `edge-${index}`,
        source: link.source,
        target: link.target,
        data: {},
      })),
    };

    // Adaptive configuration based on graph size
    const nodeSize = nodeCount > 10000 ? 8 : nodeCount > 1000 ? 12 : 16;
    const showLabels = nodeCount < 5000;
    const enableDrag = nodeCount < 10000;

    // Layout configuration
    let layoutConfig: any = {
      type: 'd3force',
      preventOverlap: true,
      nodeSize: nodeSize * 2,
      linkDistance: nodeCount > 5000 ? 100 : 150,
      nodeStrength: -200,
      edgeStrength: 100,
      center: [containerRef.current.offsetWidth / 2, containerRef.current.offsetHeight / 2],
    };

    // Create G6 v5 graph
    const graph = new Graph({
      container: containerRef.current,
      width: containerRef.current.offsetWidth,
      height: containerRef.current.offsetHeight,
      autoFit: 'view',
      data: g6Data,
      layout: layoutConfig,
      node: {
        style: (model: any) => {
          return {
            size: nodeSize,
            fill: model.data?.color || '#999',
            stroke: '#fff',
            lineWidth: 2,
            labelText: showLabels ? model.data?.label || '' : '',
            labelFontSize: 12,
            labelFill: '#000',
            labelPosition: 'bottom',
            labelOffsetY: 8,
          };
        },
        state: {
          selected: {
            lineWidth: 3,
            stroke: '#1890ff',
          },
          hover: {
            lineWidth: 3,
            stroke: '#333',
          },
        },
      },
      edge: {
        style: {
          stroke: '#bbb',
          lineWidth: 1,
          endArrow: true,
        },
        state: {
          selected: {
            lineWidth: 2,
            stroke: '#1890ff',
          },
        },
      },
      behaviors: enableDrag 
        ? ['drag-canvas', 'zoom-canvas', 'drag-element', 'click-select']
        : ['drag-canvas', 'zoom-canvas', 'click-select'],
    });

    graph.render();

    const endTime = performance.now();
    setRenderTime(endTime - startTime);

    graphRef.current = graph;

    // Handle window resize
    const handleResize = () => {
      if (graph && containerRef.current) {
        graph.setSize(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight
        );
        graph.fitView();
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (graphRef.current) {
        graphRef.current.destroy();
        graphRef.current = null;
      }
    };
  }, [graphData]);

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
          <span className="stat-badge-info">
            G6 (AntV)
          </span>
        </div>

        {/* Legend */}
        {nodeTypes.length > 0 && (
          <div className="g6-legend">
            <div className="legend-title">Node Types ({nodeTypes.length})</div>
            <div className="legend-items">
              {nodeTypes.map(({ type, count, color }) => (
                <div key={type} className="legend-item">
                  <span 
                    className="legend-color" 
                    style={{ backgroundColor: color }}
                  />
                  <span className="legend-label">{type}</span>
                  <span className="legend-count">({count})</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
    </div>
  );
};

export default G6GraphViewer;
