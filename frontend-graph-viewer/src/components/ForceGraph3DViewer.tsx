import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import { GraphData } from '../types/graph';
import { getNodeColor, getEdgeColor } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './ForceGraph3DViewer.css';

interface ForceGraph3DViewerProps {
  data: GraphData | null;
  graphId?: string;
  onRenderComplete?: (renderTimeMs: number) => void;
}

interface Node3D {
  id: string;
  name: string;
  type: string;
  color: string;
  val: number;
  capacityExceeded?: boolean;
  requestCount?: number;
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

const ForceGraph3DViewer: React.FC<ForceGraph3DViewerProps> = ({ data, onRenderComplete }) => {
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
  const [nodeListOpen, setNodeListOpen] = useState(false);
  const [nodeListFilter, setNodeListFilter] = useState('');

  // Neighbor map for hover highlight
  const neighborMap = useRef<Map<string, Set<string>>>(new Map());

  // Transform raw GraphData → internal 3D format
  const graphData3D: GraphData3D | null = useMemo(() => {
    if (!data) return null;

    startTimeRef.current = performance.now();
    performance.mark('ForceGraph3D:start');

    const nodeCount = data.nodes.length;

    const nodes: Node3D[] = data.nodes.map((node) => ({
      id: node.id,
      name: node.label,
      type: node.node_type,
      color: getNodeColor(node.node_type),
      val: nodeCount > 10000 ? 2 : nodeCount > 5000 ? 4 : nodeCount > 1000 ? 6 : 10,
      capacityExceeded: !!node.properties?.capacityExceeded,
      requestCount: node.properties?.requestCount || 0,
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

    dataPrepTimeRef.current = performance.now() - startTimeRef.current;
    performance.mark('ForceGraph3D:dataReady');
    performance.measure('ForceGraph3D:dataPrep', 'ForceGraph3D:start', 'ForceGraph3D:dataReady');

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

  // Filtered + sorted node list for the panel
  const filteredNodes = useMemo(() => {
    if (!graphData3D) return [];
    const filter = nodeListFilter.toLowerCase();
    const list = filter
      ? graphData3D.nodes.filter(n => n.name.toLowerCase().includes(filter) || n.id.toLowerCase().includes(filter) || n.type.toLowerCase().includes(filter))
      : graphData3D.nodes;
    return [...list].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
  }, [graphData3D, nodeListFilter]);

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

      // Badge for capacity exceeded
      if (node.capacityExceeded) {
        const badgeRadius = radius * 0.45;
        const badgeGeometry = new THREE.SphereGeometry(badgeRadius, 12, 8);
        const badgeMaterial = new THREE.MeshBasicMaterial({ color: '#F44336' });
        const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
        badge.position.set(radius * 0.7, -radius * 0.7, radius * 0.5);

        const bCanvas = document.createElement('canvas');
        bCanvas.width = 64;
        bCanvas.height = 64;
        const bCtx = bCanvas.getContext('2d')!;
        bCtx.font = 'bold 48px sans-serif';
        bCtx.fillStyle = '#ffffff';
        bCtx.textAlign = 'center';
        bCtx.textBaseline = 'middle';
        bCtx.fillText('!', 32, 32);
        const bTexture = new THREE.CanvasTexture(bCanvas);
        const bSpriteMat = new THREE.SpriteMaterial({ map: bTexture, transparent: true });
        const bSprite = new THREE.Sprite(bSpriteMat);
        bSprite.scale.set(badgeRadius * 2.5, badgeRadius * 2.5, 1);
        bSprite.position.set(radius * 0.7, -radius * 0.7, radius * 0.5);
        sphere.add(badge);
        sphere.add(bSprite);
      }

      // Badge for request count (bottom-left, blue)
      if (node.requestCount && node.requestCount > 0) {
        const rcBadgeRadius = radius * 0.45;
        const rcGeometry = new THREE.SphereGeometry(rcBadgeRadius, 12, 8);
        const rcMaterial = new THREE.MeshBasicMaterial({ color: '#2196F3' });
        const rcBadge = new THREE.Mesh(rcGeometry, rcMaterial);
        rcBadge.position.set(-radius * 0.7, -radius * 0.7, radius * 0.5);

        const rcCanvas = document.createElement('canvas');
        rcCanvas.width = 64;
        rcCanvas.height = 64;
        const rcCtx = rcCanvas.getContext('2d')!;
        rcCtx.font = 'bold 40px sans-serif';
        rcCtx.fillStyle = '#ffffff';
        rcCtx.textAlign = 'center';
        rcCtx.textBaseline = 'middle';
        rcCtx.fillText(String(node.requestCount), 32, 32);
        const rcTexture = new THREE.CanvasTexture(rcCanvas);
        const rcSpriteMat = new THREE.SpriteMaterial({ map: rcTexture, transparent: true });
        const rcSprite = new THREE.Sprite(rcSpriteMat);
        rcSprite.scale.set(rcBadgeRadius * 2.5, rcBadgeRadius * 2.5, 1);
        rcSprite.position.set(-radius * 0.7, -radius * 0.7, radius * 0.5);
        sphere.add(rcBadge);
        sphere.add(rcSprite);
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
          <p>Select a graph to visualize it in 3D</p>
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
          backgroundColor={getComputedStyle(document.documentElement).getPropertyValue('--graph-bg').trim() || '#0a0e14'}
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
              performance.mark('ForceGraph3D:rendered');
              performance.measure('ForceGraph3D:layout', 'ForceGraph3D:dataReady', 'ForceGraph3D:rendered');
              performance.measure('ForceGraph3D:total', 'ForceGraph3D:start', 'ForceGraph3D:rendered');
              setRenderTime(elapsed);
              setTimingDetails({
                dataPrep: dataPrepTimeRef.current,
                simulation: elapsed - dataPrepTimeRef.current,
              });
              startTimeRef.current = 0;
              onRenderComplete?.(elapsed);
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

    

      {/* FPS Counter */}
      <FpsCounter recording={renderTime === null && !!graphData3D} />

      {/* Collapsible node list panel */}
      <div className={`node-list-panel-3d ${nodeListOpen ? 'open' : ''}`}>
        <button className="node-list-toggle-3d" onClick={() => setNodeListOpen(!nodeListOpen)}>
          <i className={`bi bi-chevron-${nodeListOpen ? 'down' : 'up'}`}></i>
          {' '}Nodes ({graphData3D.nodes.length.toLocaleString()})
        </button>
        {nodeListOpen && (
          <div className="node-list-body-3d">
            <input
              type="text"
              className="node-list-search-3d"
              placeholder="Filtrer par nom, id ou type..."
              value={nodeListFilter}
              onChange={e => setNodeListFilter(e.target.value)}
            />
            <div className="node-list-scroll-3d">
              {filteredNodes.map(node => (
                <div
                  key={node.id}
                  className="node-list-item-3d"
                  onClick={() => {
                    const n = graphData3D.nodes.find(n => n.id === node.id);
                    if (n && graphRef.current) {
                      const distance = 120;
                      const distRatio = 1 + distance / Math.hypot(n.x || 0, n.y || 0, n.z || 0);
                      graphRef.current.cameraPosition(
                        { x: (n.x || 0) * distRatio, y: (n.y || 0) * distRatio, z: (n.z || 0) * distRatio },
                        n, 1000
                      );
                    }
                  }}
                >
                  <span className="node-list-color-3d" style={{ background: node.color }}></span>
                  <span className="node-list-name-3d">{node.name}</span>
                  <span className="node-list-type-3d">{node.type}</span>
                </div>
              ))}
              {filteredNodes.length === 0 && (
                <div className="node-list-empty-3d">Aucun nœud trouvé</div>
              )}
              {graphData3D.nodes.length > 500 && !nodeListFilter && (
                <div className="node-list-truncated-3d">Affichage limité à 500 / {graphData3D.nodes.length.toLocaleString()}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForceGraph3DViewer;
