import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { GraphData } from '../types/graph';
import { getNodeColor, getEdgeColor, generateColorFromString } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './ForceGraph3DViewer.css';

interface ForceGraph3DViewerProps {
  data: GraphData | null;
  graphId?: string;
}

interface Node3D {
  id: string;
  name: string;
  type: string;
  color: string;
  val: number;
  x?: number;
  y?: number;
  z?: number;
}

interface Link3D {
  source: string | Node3D;
  target: string | Node3D;
  label?: string;
  type: string;
  color: string;
}

interface GraphData3D {
  nodes: Node3D[];
  links: Link3D[];
}

const ForceGraph3DViewer: React.FC<ForceGraph3DViewerProps> = ({ data, graphId }) => {
  const graphRef = useRef<any>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoverNode, setHoverNode] = useState<Node3D | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<Link3D>>(new Set());

  // Timing
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [timingDetails, setTimingDetails] = useState<{
    dataPrep: number;
    simulation: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const startTimeRef = useRef<number>(0);
  const dataPrepTimeRef = useRef<number>(0);

  // Settings
  const [showLabels, setShowLabels] = useState(true);
  const [showArrows, setShowArrows] = useState(true);
  const [nodeOpacity, setNodeOpacity] = useState(0.9);
  const [linkOpacity, setLinkOpacity] = useState(0.4);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Legend
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; color: string; count: number }>>([]);

  // Neighbor map for hover highlight
  const neighborMap = useRef<Map<string, Set<string>>>(new Map());

  // Transform raw GraphData → internal 3D format
  const graphData3D: GraphData3D | null = useMemo(() => {
    if (!data) return null;

    startTimeRef.current = performance.now();

    const nodeCount = data.nodes.length;

    const nodes: Node3D[] = data.nodes.map((node) => ({
      id: node.id,
      name: node.label,
      type: node.node_type,
      color: getNodeColor(node.node_type),
      val: nodeCount > 10000 ? 2 : nodeCount > 5000 ? 4 : nodeCount > 1000 ? 6 : 10,
    }));

    const links: Link3D[] = data.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.edge_type,
      color: getEdgeColor(edge.edge_type),
    }));

    // Build neighbor map
    const nMap = new Map<string, Set<string>>();
    data.edges.forEach((edge) => {
      if (!nMap.has(edge.source)) nMap.set(edge.source, new Set());
      if (!nMap.has(edge.target)) nMap.set(edge.target, new Set());
      nMap.get(edge.source)!.add(edge.target);
      nMap.get(edge.target)!.add(edge.source);
    });
    neighborMap.current = nMap;

    // Compute legend
    const typeMap = new Map<string, { color: string; count: number }>();
    nodes.forEach((node) => {
      const existing = typeMap.get(node.type);
      if (existing) {
        existing.count++;
      } else {
        typeMap.set(node.type, { color: node.color, count: 1 });
      }
    });

    const typesArray = Array.from(typeMap.entries())
      .map(([type, { color, count }]) => ({ type, color, count }))
      .sort((a, b) => b.count - a.count);

    // Set legend outside render
    setTimeout(() => setNodeTypes(typesArray), 0);

    dataPrepTimeRef.current = performance.now() - startTimeRef.current;

    return { nodes, links };
  }, [data]);

  // Dimensions tracking
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Reset timer on data change + zoom to fit
  useEffect(() => {
    if (graphRef.current && graphData3D) {
      setRenderTime(null);
      setTimingDetails(null);

      setTimeout(() => {
        graphRef.current?.zoomToFit(400, 80);
      }, 500);
    }
  }, [graphData3D]);

  // Hover handler
  const handleNodeHover = useCallback(
    (node: Node3D | null) => {
      setHoverNode(node);

      if (node) {
        const neighbors = new Set<string>();
        neighbors.add(node.id);
        const nSet = neighborMap.current.get(node.id);
        if (nSet) {
          nSet.forEach((n) => neighbors.add(n));
        }
        setHighlightNodes(neighbors);

        if (graphData3D) {
          const links = new Set<Link3D>();
          graphData3D.links.forEach((link) => {
            const srcId = typeof link.source === 'object' ? (link.source as Node3D).id : link.source;
            const tgtId = typeof link.target === 'object' ? (link.target as Node3D).id : link.target;
            if (srcId === node.id || tgtId === node.id) {
              links.add(link);
            }
          });
          setHighlightLinks(links);
        }
      } else {
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
      }
    },
    [graphData3D]
  );

  // Adaptive settings
  const nodeCount = graphData3D?.nodes.length || 0;
  const adaptiveShowLabels = nodeCount > 5000 ? false : showLabels;
  const adaptiveArrowLength = showArrows ? (nodeCount > 5000 ? 2 : nodeCount > 1000 ? 3 : 5) : 0;
  const warmupTicks = nodeCount > 10000 ? 50 : nodeCount > 5000 ? 80 : 100;
  const cooldownTicks = nodeCount > 10000 ? 50 : nodeCount > 5000 ? 80 : 150;

  // Node rendering with Three.js
  const nodeThreeObject = useCallback(
    (node: any) => {
      const isHighlighted = highlightNodes.size > 0 && highlightNodes.has(node.id);
      const isDimmed = highlightNodes.size > 0 && !highlightNodes.has(node.id);
      const isHovered = hoverNode?.id === node.id;

      const radius = isHovered
        ? (nodeCount > 5000 ? 3 : 6)
        : isHighlighted
        ? (nodeCount > 5000 ? 2.5 : 5)
        : (nodeCount > 10000 ? 1 : nodeCount > 5000 ? 1.5 : nodeCount > 1000 ? 2 : 3);

      const color = isHovered ? '#FFD700' : node.color;
      const opacity = isDimmed ? 0.15 : nodeOpacity;

      const geometry = new THREE.SphereGeometry(radius, 16, 12);
      const material = new THREE.MeshLambertMaterial({
        color,
        transparent: true,
        opacity,
      });
      const sphere = new THREE.Mesh(geometry, material);

      // Glow effect on hover
      if (isHovered) {
        const glowGeometry = new THREE.SphereGeometry(radius * 1.5, 16, 12);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: '#FFD700',
          transparent: true,
          opacity: 0.2,
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        sphere.add(glow);
      }

      // Label sprite
      if (adaptiveShowLabels && !isDimmed) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const fontSize = isHovered ? 32 : 24;
        canvas.width = 256;
        canvas.height = 64;
        ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px Arial`;
        ctx.fillStyle = isHovered ? '#FFD700' : '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.name || node.id, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: isDimmed ? 0.2 : 0.9,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(radius * 6, radius * 1.5, 1);
        sprite.position.set(0, radius + 3, 0);
        sphere.add(sprite);
      }

      return sphere;
    },
    [highlightNodes, hoverNode, nodeOpacity, nodeCount, adaptiveShowLabels]
  );

  // Loading state
  if (!data) {
    return (
      <div className="force-graph-3d-viewer">
        <div className="empty-state">
          <h2>3D Graph Viewer</h2>
          <p>Sélectionnez un graphe pour le visualiser en 3D</p>
        </div>
      </div>
    );
  }

  if (!graphData3D) return null;

  return (
    <div className="force-graph-3d-viewer">
      <div className="graph-header">
        <h2>
          <span className="badge-3d">3D</span>
          Three.js Force Graph
          <span style={{ fontSize: 13, opacity: 0.6, fontWeight: 400 }}>
            — {graphData3D.nodes.length.toLocaleString()} nodes, {graphData3D.links.length.toLocaleString()} edges
          </span>
        </h2>
        <div className="graph-controls">
          <button onClick={() => graphRef.current?.zoomToFit(400, 80)}>
            Fit View
          </button>
          <button onClick={() => {
            graphRef.current?.cameraPosition({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, 1000);
          }}>
            Reset Camera
          </button>
          <button
            className={settingsOpen ? 'active' : ''}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      <div className="force-graph-3d-canvas" ref={containerRef}>
        <ForceGraph3D
          ref={graphRef}
          graphData={graphData3D}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="#0a0e14"
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          linkColor={(link: any) => {
            if (highlightLinks.has(link)) return link.color || '#ffffff';
            if (highlightLinks.size > 0) return 'rgba(100, 100, 100, 0.1)';
            return link.color || '#666666';
          }}
          linkWidth={(link: any) => (highlightLinks.has(link) ? 2 : 0.5)}
          linkOpacity={linkOpacity}
          linkDirectionalArrowLength={adaptiveArrowLength}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link: any) => link.label || ''}
          onNodeHover={handleNodeHover}
          onNodeClick={(node: any) => {
            // Zoom vers le nœud cliqué
            const distance = 120;
            const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
            graphRef.current?.cameraPosition(
              {
                x: (node.x || 0) * distRatio,
                y: (node.y || 0) * distRatio,
                z: (node.z || 0) * distRatio,
              },
              node,
              1000
            );
          }}
          warmupTicks={warmupTicks}
          cooldownTicks={cooldownTicks}
          onEngineStop={() => {
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

      {/* Hover info */}
      {hoverNode && (
        <div className="node-info-3d">
          <strong>{hoverNode.name}</strong>
          <span className="node-type">{hoverNode.type}</span>
        </div>
      )}

      {/* Settings panel */}
      {settingsOpen && (
        <div className="settings-panel">
          <h4>⚙️ 3D Settings</h4>
          <label>
            Labels
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
          </label>
          <label>
            Arrows
            <input
              type="checkbox"
              checked={showArrows}
              onChange={(e) => setShowArrows(e.target.checked)}
            />
          </label>
          <label>
            Node Opacity
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={nodeOpacity}
              onChange={(e) => setNodeOpacity(parseFloat(e.target.value))}
            />
          </label>
          <label>
            Link Opacity
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={linkOpacity}
              onChange={(e) => setLinkOpacity(parseFloat(e.target.value))}
            />
          </label>
        </div>
      )}

      {/* Render time */}
      {renderTime !== null && (
        <div className="render-time">
          ⏱️ <strong>3D Force Graph:</strong> {renderTime.toFixed(0)}ms
        </div>
      )}

      {/* Timing details */}
      {timingDetails && (
        <div className="render-time-details">
          <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
            ⏱️ Timing details {timingOpen ? '▼' : '▶'}
          </button>
          {timingOpen && (
            <div className="timing-breakdown">
              <span className="timing-badge data">
                Data prep: <strong>{timingDetails.dataPrep.toFixed(1)}ms</strong>
              </span>
              <span className="timing-badge sim">
                Simulation: <strong>{timingDetails.simulation.toFixed(1)}ms</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* FPS Counter */}
      <FpsCounter recording={renderTime === null && !!graphData3D} />

      {/* Legend */}
      {nodeTypes.length > 0 && (
        <div className="graph-legend">
          <h3>Types ({nodeTypes.length})</h3>
          <div className="legend-items-scroll">
            <div className="legend-items">
              {nodeTypes.slice(0, 30).map(({ type, color, count }) => (
                <div key={type} className="legend-item">
                  <div
                    className="legend-color"
                    style={{ backgroundColor: color }}
                  />
                  <span className="legend-label">{type}</span>
                  <span className="legend-count">{count}</span>
                </div>
              ))}
              {nodeTypes.length > 30 && (
                <div className="legend-item" style={{ opacity: 0.5, fontSize: 11 }}>
                  +{nodeTypes.length - 30} more types...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ForceGraph3DViewer;
