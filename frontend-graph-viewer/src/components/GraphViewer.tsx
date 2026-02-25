import React, { useRef, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { ForceGraphData, ForceGraphNode, ForceGraphLink } from '../types/graph';
import FpsCounter from './FpsCounter';
import './GraphViewer.css';

interface GraphViewerProps {
  data: ForceGraphData | null;
  title: string;
  loading: boolean;
}

export const GraphViewer: React.FC<GraphViewerProps> = ({ data, title, loading }) => {
  const graphRef = useRef<any>();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<ForceGraphLink>>(new Set());
  const [hoverNode, setHoverNode] = useState<ForceGraphNode | null>(null);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [timingDetails, setTimingDetails] = useState<{
    dataPrep: number; simulation: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const startTimeRef = useRef<number>(0);
  const dataPrepTimeRef = useRef<number>(0);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; color: string; count: number }>>([]);

  // Mettre à jour les dimensions
  useEffect(() => {
    const updateDimensions = () => {
      const container = document.querySelector('.graph-viewer-container');
      if (container) {
        setDimensions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Centrer le graphe quand les données changent et mesurer le temps
  useEffect(() => {
    if (graphRef.current && data) {
      // Démarrer le chronomètre
      startTimeRef.current = performance.now();
      setRenderTime(null);
      setTimingDetails(null);
      
      // Calculer les types de nœuds pour la légende
      const typeMap = new Map<string, { color: string; count: number }>();
      data.nodes.forEach((node) => {
        const existing = typeMap.get(node.type);
        if (existing) {
          existing.count++;
        } else {
          typeMap.set(node.type, { color: node.color || '#9E9E9E', count: 1 });
        }
      });
      
      const typesArray = Array.from(typeMap.entries())
        .map(([type, { color, count }]) => ({ type, color, count }))
        .sort((a, b) => b.count - a.count);
      setNodeTypes(typesArray);
      
      dataPrepTimeRef.current = performance.now() - startTimeRef.current;

      setTimeout(() => {
        graphRef.current.zoomToFit(400, 50);
      }, 100);
    }
  }, [data]);

  const handleNodeHover = (node: ForceGraphNode | null) => {
    setHoverNode(node);
    
    if (node && data) {
      const neighbors = new Set<string>();
      const links = new Set<ForceGraphLink>();

      data.links.forEach((link) => {
        if (link.source === node.id) {
          neighbors.add(link.target as string);
          links.add(link);
        }
        if (link.target === node.id) {
          neighbors.add(link.source as string);
          links.add(link);
        }
      });

      neighbors.add(node.id);
      setHighlightNodes(neighbors);
      setHighlightLinks(links);
    } else {
      setHighlightNodes(new Set());
      setHighlightLinks(new Set());
    }
  };

  if (loading) {
    return (
      <div className="graph-viewer">
        <div className="loading-graph">
          <div className="spinner"></div>
          <p>Loading graph...</p>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="graph-viewer">
        <div className="no-graph">
          <h2>Graph Visualizer</h2>
          <p>Select a graph from the list to visualize it</p>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-viewer">
      <div className="graph-header">
        <h2>{title}</h2>
        <div className="graph-controls">
          <button onClick={() => graphRef.current?.zoomToFit(400, 50)}>
            Fit View
          </button>
          <button onClick={() => graphRef.current?.centerAt(0, 0, 400)}>
            Center
          </button>
        </div>
      </div>

      <div className="graph-viewer-container">
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          width={dimensions.width}
          height={dimensions.height}
          nodeLabel={(node: any) => `${node.name} (${node.type})`}
          nodeColor={(node: any) => {
            if (hoverNode === node) return '#FFD700';
            if (highlightNodes.size > 0 && !highlightNodes.has(node.id)) {
              return 'rgba(150, 150, 150, 0.3)';
            }
            return node.color;
          }}
          nodeRelSize={data && data.nodes.length > 10000 ? 3 : data && data.nodes.length > 1000 ? 2 : 6}
          nodeVal={(node: any) => {
            if (hoverNode === node) return data && data.nodes.length > 10000 ? 8 : 15;
            if (highlightNodes.has(node.id)) return data && data.nodes.length > 10000 ? 6 : 12;
            return node.val;
          }}
          linkColor={(link: any) => {
            if (highlightLinks.has(link)) return link.color;
            if (highlightLinks.size > 0) return 'rgba(200, 200, 200, 0.2)';
            return link.color;
          }}
          linkWidth={(link: any) => (highlightLinks.has(link) ? 3 : 1)}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link: any) => link.label || ''}
          onNodeHover={handleNodeHover}
          onNodeClick={(node: any) => {
            console.log('Clicked node:', node);
          }}
          cooldownTicks={100}
          onEngineStop={() => {
            graphRef.current?.zoomToFit(400, 50);
            // Calculer le temps de rendu
            if (startTimeRef.current > 0) {
              const elapsed = performance.now() - startTimeRef.current;
              setRenderTime(elapsed);
              setTimingDetails({
                dataPrep: dataPrepTimeRef.current,
                simulation: elapsed - dataPrepTimeRef.current,
              });
              startTimeRef.current = 0;
            }
          }}
        />
      </div>

      {hoverNode && (
        <div className="node-info">
          <strong>{hoverNode.name}</strong>
          <span className="node-type">{hoverNode.type}</span>
        </div>
      )}

      {renderTime !== null && (
        <div className="render-time">
          ⏱️ <strong>Force Graph:</strong> {renderTime.toFixed(0)}ms
        </div>
      )}

      {timingDetails && (
        <div className="render-time-details">
          <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
            ⏱️ Timing details {timingOpen ? '▼' : '▶'}
          </button>
          {timingOpen && (
            <div className="timing-breakdown">
              <span className="timing-badge data">Data prep: <strong>{timingDetails.dataPrep.toFixed(1)}ms</strong></span>
              <span className="timing-badge sim">Simulation: <strong>{timingDetails.simulation.toFixed(1)}ms</strong></span>
            </div>
          )}
        </div>
      )}

      <FpsCounter recording={renderTime === null && !!data} />

    </div>
  );
};
