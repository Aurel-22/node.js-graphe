import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphData } from '../types/graph';
import { generateColorFromString, getEdgeColor } from '../services/graphTransform';
import FpsCounter from './FpsCounter';
import './D3GraphViewer.css';

interface D3GraphViewerProps {
  data: GraphData | null;
  graphId?: string;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  color: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  label?: string;
  type: string;
  color: string;
}

// Presets adaptatifs selon la taille du graphe
function getDefaultParams(nodeCount: number) {
  if (nodeCount > 10000) {
    return {
      nodeRadius: 2,
      chargeStrength: -15,
      linkDistance: 25,
      collisionRadius: 3,
      centerStrength: 0.05,
      linkStrength: 0.3,
      alphaDecay: 0.05,
      velocityDecay: 0.5,
      showLabels: false,
      showEdgeLabels: false,
      showArrows: false,
      linkOpacity: 0.2,
      linkWidth: 0.5,
      labelSize: 6,
    };
  }
  if (nodeCount > 5000) {
    return {
      nodeRadius: 3,
      chargeStrength: -25,
      linkDistance: 35,
      collisionRadius: 4,
      centerStrength: 0.08,
      linkStrength: 0.4,
      alphaDecay: 0.04,
      velocityDecay: 0.45,
      showLabels: false,
      showEdgeLabels: false,
      showArrows: false,
      linkOpacity: 0.3,
      linkWidth: 0.5,
      labelSize: 7,
    };
  }
  if (nodeCount > 2000) {
    return {
      nodeRadius: 4,
      chargeStrength: -50,
      linkDistance: 45,
      collisionRadius: 6,
      centerStrength: 0.1,
      linkStrength: 0.5,
      alphaDecay: 0.03,
      velocityDecay: 0.4,
      showLabels: false,
      showEdgeLabels: false,
      showArrows: true,
      linkOpacity: 0.4,
      linkWidth: 0.8,
      labelSize: 8,
    };
  }
  if (nodeCount > 500) {
    return {
      nodeRadius: 6,
      chargeStrength: -100,
      linkDistance: 60,
      collisionRadius: 8,
      centerStrength: 0.1,
      linkStrength: 0.6,
      alphaDecay: 0.023,
      velocityDecay: 0.4,
      showLabels: true,
      showEdgeLabels: false,
      showArrows: true,
      linkOpacity: 0.5,
      linkWidth: 1,
      labelSize: 9,
    };
  }
  // < 500 nœuds
  return {
    nodeRadius: 10,
    chargeStrength: -200,
    linkDistance: 90,
    collisionRadius: 14,
    centerStrength: 0.1,
    linkStrength: 0.7,
    alphaDecay: 0.023,
    velocityDecay: 0.4,
    showLabels: true,
    showEdgeLabels: true,
    showArrows: true,
    linkOpacity: 0.6,
    linkWidth: 1.5,
    labelSize: 11,
  };
}

const D3GraphViewer: React.FC<D3GraphViewerProps> = ({ data, graphId }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null);
  const [renderTime, setRenderTime] = useState<number>(0);
  const [timingDetails, setTimingDetails] = useState<{
    dataTransform: number; svgSetup: number; domElements: number; simulation: number;
  } | null>(null);
  const [timingOpen, setTimingOpen] = useState(false);
  const [nodeTypes, setNodeTypes] = useState<Array<{ type: string; count: number; color: string }>>([]);
  const [hoveredNode, setHoveredNode] = useState<D3Node | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  // Paramètres interactifs
  const nodeCount = data?.nodes?.length || 0;
  const defaults = getDefaultParams(nodeCount);

  const [nodeRadius, setNodeRadius] = useState(defaults.nodeRadius);
  const [chargeStrength, setChargeStrength] = useState(defaults.chargeStrength);
  const [linkDistance, setLinkDistance] = useState(defaults.linkDistance);
  const [collisionRadius, setCollisionRadius] = useState(defaults.collisionRadius);
  const [centerStrength, setCenterStrength] = useState(defaults.centerStrength);
  const [linkStrength, setLinkStrength] = useState(defaults.linkStrength);
  const [alphaDecay, setAlphaDecay] = useState(defaults.alphaDecay);
  const [velocityDecay, setVelocityDecay] = useState(defaults.velocityDecay);
  const [showLabels, setShowLabels] = useState(defaults.showLabels);
  const [showEdgeLabels, setShowEdgeLabels] = useState(defaults.showEdgeLabels);
  const [showArrows, setShowArrows] = useState(defaults.showArrows);
  const [linkOpacity, setLinkOpacity] = useState(defaults.linkOpacity);
  const [linkWidth, setLinkWidth] = useState(defaults.linkWidth);
  const [labelSize, setLabelSize] = useState(defaults.labelSize);

  // Reset les paramètres quand le graphe change
  useEffect(() => {
    const nc = data?.nodes?.length || 0;
    const d = getDefaultParams(nc);
    setNodeRadius(d.nodeRadius);
    setChargeStrength(d.chargeStrength);
    setLinkDistance(d.linkDistance);
    setCollisionRadius(d.collisionRadius);
    setCenterStrength(d.centerStrength);
    setLinkStrength(d.linkStrength);
    setAlphaDecay(d.alphaDecay);
    setVelocityDecay(d.velocityDecay);
    setShowLabels(d.showLabels);
    setShowEdgeLabels(d.showEdgeLabels);
    setShowArrows(d.showArrows);
    setLinkOpacity(d.linkOpacity);
    setLinkWidth(d.linkWidth);
    setLabelSize(d.labelSize);
  }, [data, graphId]);

  // Reheat simulation
  const reheat = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.alpha(0.8).restart();
    }
  }, []);

  // Rendu D3
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !data) return;

    const t0 = performance.now();
    const width = containerRef.current.offsetWidth;
    const height = containerRef.current.offsetHeight;

    d3.select(svgRef.current).selectAll('*').remove();

    const nc = data.nodes.length;

    const nodes: D3Node[] = data.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.node_type,
      color: generateColorFromString(n.node_type),
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: D3Link[] = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        label: e.label,
        type: e.edge_type,
        color: getEdgeColor(e.edge_type),
      }));

    // Légende
    const typeCounts = new Map<string, number>();
    nodes.forEach((n) => typeCounts.set(n.type, (typeCounts.get(n.type) || 0) + 1));
    setNodeTypes(
      Array.from(typeCounts.entries())
        .map(([type, count]) => ({ type, count, color: generateColorFromString(type) }))
        .sort((a, b) => b.count - a.count)
    );

    const t1 = performance.now(); // End data transform

    // SVG + zoom
    const svg = d3.select(svgRef.current).attr('width', width).attr('height', height);
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 20])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Defs: arrowhead + glow filter
    const defs = svg.append('defs');

    defs.append('marker')
      .attr('id', 'd3-arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', nodeRadius + 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');

    // Glow filter for hover
    const filter = defs.append('filter').attr('id', 'd3-glow');
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const t2 = performance.now(); // End SVG setup

    // Links
    const link = g.append('g').attr('class', 'd3-links')
      .selectAll('line').data(links).join('line')
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', linkWidth)
      .attr('stroke-opacity', linkOpacity)
      .attr('marker-end', showArrows ? 'url(#d3-arrowhead)' : '');

    // Edge labels
    let edgeLabel: any = null;
    if (showEdgeLabels) {
      edgeLabel = g.append('g').attr('class', 'd3-edge-labels')
        .selectAll('text').data(links.filter((l) => l.label)).join('text')
        .attr('font-size', Math.max(7, labelSize - 2))
        .attr('fill', '#666')
        .attr('text-anchor', 'middle')
        .text((d) => d.label || '');
    }

    // Nodes
    const node = g.append('g').attr('class', 'd3-nodes')
      .selectAll('circle').data(nodes).join('circle')
      .attr('r', nodeRadius)
      .attr('fill', (d) => d.color)
      .attr('stroke', '#fff')
      .attr('stroke-width', Math.max(0.5, nodeRadius / 5))
      .attr('cursor', 'pointer')
      .on('mouseover', function (_event, d) {
        d3.select(this)
          .transition().duration(120)
          .attr('r', nodeRadius * 1.8)
          .attr('stroke', '#333')
          .attr('stroke-width', 2.5)
          .attr('filter', 'url(#d3-glow)');
        // Highlight connected edges
        link.attr('stroke-opacity', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? 1 : linkOpacity * 0.3
        ).attr('stroke-width', (l: any) =>
          l.source.id === d.id || l.target.id === d.id ? linkWidth * 2.5 : linkWidth
        );
        // Fade non-neighbors
        const neighborIds = new Set<string>();
        links.forEach((l: any) => {
          if (l.source.id === d.id || l.source === d.id) neighborIds.add(typeof l.target === 'string' ? l.target : l.target.id);
          if (l.target.id === d.id || l.target === d.id) neighborIds.add(typeof l.source === 'string' ? l.source : l.source.id);
        });
        neighborIds.add(d.id);
        node.attr('opacity', (n: any) => neighborIds.has(n.id) ? 1 : 0.15);
        setHoveredNode(d);
      })
      .on('mouseout', function () {
        d3.select(this)
          .transition().duration(120)
          .attr('r', nodeRadius)
          .attr('stroke', '#fff')
          .attr('stroke-width', Math.max(0.5, nodeRadius / 5))
          .attr('filter', null);
        link.attr('stroke-opacity', linkOpacity).attr('stroke-width', linkWidth);
        node.attr('opacity', 1);
        setHoveredNode(null);
      });

    // Drag
    if (nc < 10000) {
      (node as any).call(
        d3.drag<SVGCircleElement, D3Node>()
          .on('start', (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => {
            if (!event.active) simulationRef.current?.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );
    }

    // Labels
    let label: any = null;
    if (showLabels) {
      label = g.append('g').attr('class', 'd3-labels')
        .selectAll('text').data(nodes).join('text')
        .attr('font-size', labelSize)
        .attr('fill', '#333')
        .attr('text-anchor', 'middle')
        .attr('dy', nodeRadius + labelSize + 3)
        .attr('pointer-events', 'none')
        .text((d) => d.label);
    }

    const t3 = performance.now(); // End DOM elements

    // Simulation
    const simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links).id((d) => d.id).distance(linkDistance).strength(linkStrength))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(centerStrength))
      .force('collision', d3.forceCollide().radius(collisionRadius))
      .force('x', d3.forceX(width / 2).strength(centerStrength * 0.3))
      .force('y', d3.forceY(height / 2).strength(centerStrength * 0.3))
      .alphaDecay(alphaDecay)
      .velocityDecay(velocityDecay);

    simulationRef.current = simulation;

    const t4 = performance.now(); // End simulation setup
    setRenderTime(t4 - t0);
    setTimingDetails({
      dataTransform: t1 - t0,
      svgSetup: t2 - t1,
      domElements: t3 - t2,
      simulation: t4 - t3,
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      if (edgeLabel) {
        edgeLabel
          .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
          .attr('y', (d: any) => (d.source.y + d.target.y) / 2);
      }
      node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
      if (label) {
        label.attr('x', (d: any) => d.x).attr('y', (d: any) => d.y);
      }
    });

    simulation.on('end', () => {
      const bounds = (g.node() as SVGGElement)?.getBBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        const padding = 50;
        const scale = Math.min(
          width / (bounds.width + padding * 2),
          height / (bounds.height + padding * 2),
          2
        );
        const tx = width / 2 - scale * (bounds.x + bounds.width / 2);
        const ty = height / 2 - scale * (bounds.y + bounds.height / 2);
        svg.transition().duration(600).call(
          zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale)
        );
      }
    });

    return () => { simulation.stop(); simulationRef.current = null; };
  }, [data, graphId, nodeRadius, chargeStrength, linkDistance, collisionRadius,
      centerStrength, linkStrength, alphaDecay, velocityDecay, showLabels,
      showEdgeLabels, showArrows, linkOpacity, linkWidth, labelSize]);

  const resetParams = () => {
    const nc = data?.nodes?.length || 0;
    const d = getDefaultParams(nc);
    setNodeRadius(d.nodeRadius);
    setChargeStrength(d.chargeStrength);
    setLinkDistance(d.linkDistance);
    setCollisionRadius(d.collisionRadius);
    setCenterStrength(d.centerStrength);
    setLinkStrength(d.linkStrength);
    setAlphaDecay(d.alphaDecay);
    setVelocityDecay(d.velocityDecay);
    setShowLabels(d.showLabels);
    setShowEdgeLabels(d.showEdgeLabels);
    setShowArrows(d.showArrows);
    setLinkOpacity(d.linkOpacity);
    setLinkWidth(d.linkWidth);
    setLabelSize(d.labelSize);
  };

  return (
    <div className="d3-graph-viewer">
      <div className="d3-controls">
        <div className="d3-stats">
          <span className="stat-badge">
            <strong>{data?.nodes?.length || 0}</strong> nodes
          </span>
          <span className="stat-badge">
            <strong>{data?.edges?.length || 0}</strong> edges
          </span>
          <span className="stat-badge render-time">
            Render: <strong>{renderTime.toFixed(0)}ms</strong>
          </span>
          <span className="stat-badge-info">D3.js</span>
        </div>

        {timingDetails && (
          <div className="timing-details-bar">
            <button className="timing-toggle" onClick={() => setTimingOpen(!timingOpen)}>
              ⏱️ Timing details {timingOpen ? '▼' : '▶'}
            </button>
            {timingOpen && (
              <div className="timing-breakdown">
                <span className="timing-badge data">Data: <strong>{timingDetails.dataTransform.toFixed(1)}ms</strong></span>
                <span className="timing-badge svg">SVG setup: <strong>{timingDetails.svgSetup.toFixed(1)}ms</strong></span>
                <span className="timing-badge dom">DOM elements: <strong>{timingDetails.domElements.toFixed(1)}ms</strong></span>
                <span className="timing-badge sim">Simulation init: <strong>{timingDetails.simulation.toFixed(1)}ms</strong></span>
              </div>
            )}
          </div>
        )}

        {/* Parameter panel */}
        <div className="d3-params-panel">
          <div className="params-header" onClick={() => setPanelOpen(!panelOpen)}>
            <span className="params-title">⚙️ Parameters</span>
            <span className="params-toggle">{panelOpen ? '▼' : '▶'}</span>
          </div>

          {panelOpen && (
            <div className="params-body">
              <div className="params-actions">
                <button className="param-btn reset" onClick={resetParams}>Reset defaults</button>
                <button className="param-btn reheat" onClick={reheat}>🔥 Reheat</button>
              </div>

              <div className="params-section">
                <div className="section-title">Nodes</div>
                <label className="param-row">
                  <span className="param-label">Radius <span className="param-value">{nodeRadius}</span></span>
                  <input type="range" min="1" max="25" step="0.5" value={nodeRadius}
                    onChange={(e) => setNodeRadius(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Collision <span className="param-value">{collisionRadius}</span></span>
                  <input type="range" min="0" max="40" step="1" value={collisionRadius}
                    onChange={(e) => setCollisionRadius(parseFloat(e.target.value))} />
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
                  <span>Show labels</span>
                </label>
                <label className="param-row">
                  <span className="param-label">Label size <span className="param-value">{labelSize}</span></span>
                  <input type="range" min="4" max="18" step="1" value={labelSize}
                    onChange={(e) => setLabelSize(parseInt(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Forces</div>
                <label className="param-row">
                  <span className="param-label">Charge <span className="param-value">{chargeStrength}</span></span>
                  <input type="range" min="-500" max="0" step="5" value={chargeStrength}
                    onChange={(e) => setChargeStrength(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Link distance <span className="param-value">{linkDistance}</span></span>
                  <input type="range" min="5" max="200" step="5" value={linkDistance}
                    onChange={(e) => setLinkDistance(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Link strength <span className="param-value">{linkStrength.toFixed(2)}</span></span>
                  <input type="range" min="0" max="2" step="0.05" value={linkStrength}
                    onChange={(e) => setLinkStrength(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Center gravity <span className="param-value">{centerStrength.toFixed(2)}</span></span>
                  <input type="range" min="0" max="1" step="0.01" value={centerStrength}
                    onChange={(e) => setCenterStrength(parseFloat(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Simulation</div>
                <label className="param-row">
                  <span className="param-label">Alpha decay <span className="param-value">{alphaDecay.toFixed(3)}</span></span>
                  <input type="range" min="0.001" max="0.1" step="0.001" value={alphaDecay}
                    onChange={(e) => setAlphaDecay(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Velocity decay <span className="param-value">{velocityDecay.toFixed(2)}</span></span>
                  <input type="range" min="0.05" max="0.9" step="0.05" value={velocityDecay}
                    onChange={(e) => setVelocityDecay(parseFloat(e.target.value))} />
                </label>
              </div>

              <div className="params-section">
                <div className="section-title">Edges</div>
                <label className="param-row">
                  <span className="param-label">Opacity <span className="param-value">{linkOpacity.toFixed(2)}</span></span>
                  <input type="range" min="0" max="1" step="0.05" value={linkOpacity}
                    onChange={(e) => setLinkOpacity(parseFloat(e.target.value))} />
                </label>
                <label className="param-row">
                  <span className="param-label">Width <span className="param-value">{linkWidth.toFixed(1)}</span></span>
                  <input type="range" min="0.1" max="5" step="0.1" value={linkWidth}
                    onChange={(e) => setLinkWidth(parseFloat(e.target.value))} />
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showArrows} onChange={(e) => setShowArrows(e.target.checked)} />
                  <span>Show arrows</span>
                </label>
                <label className="param-row checkbox">
                  <input type="checkbox" checked={showEdgeLabels} onChange={(e) => setShowEdgeLabels(e.target.checked)} />
                  <span>Show edge labels</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="d3-container" ref={containerRef}>
        <svg ref={svgRef} />
      </div>

      {hoveredNode && (
        <div className="d3-tooltip">
          <div className="tooltip-label">{hoveredNode.label}</div>
          <div className="tooltip-type">
            <span className="tooltip-color" style={{ backgroundColor: hoveredNode.color }} />
            {hoveredNode.type}
          </div>
          <div className="tooltip-id">ID: {hoveredNode.id}</div>
        </div>
      )}

      <div className="d3-help">
        <div className="help-title">Controls</div>
        <ul>
          <li><strong>Scroll:</strong> Zoom in/out</li>
          <li><strong>Drag background:</strong> Pan view</li>
          {(data?.nodes?.length || 0) < 10000 && (
            <li><strong>Drag node:</strong> Move node</li>
          )}
          <li><strong>Hover node:</strong> Show details</li>
        </ul>
      </div>

      <FpsCounter recording={renderTime > 0} />
    </div>
  );
};

export default D3GraphViewer;
