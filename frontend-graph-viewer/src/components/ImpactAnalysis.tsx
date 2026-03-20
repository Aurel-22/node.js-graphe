import { useEffect, useRef, useState, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { createNodeCompoundProgram, EdgeArrowProgram } from 'sigma/rendering';
import { createNodeImageProgram } from '@sigma/node-image';
import { createNodeBorderProgram } from '@sigma/node-border';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { GraphData } from '../types/graph';

import { getNodeIcon as getNodeTypeIcon, getNodeColor } from './SigmaGraphViewer';
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

/** Contextual info displayed when clicking a CI */
interface CIContextInfo {
  id: string;
  label: string;
  nodeType: string;
  status: NodeStatus;
  inDegree: number;
  outDegree: number;
  impactingCIs: Array<{ id: string; label: string; blocking: boolean }>;
  impactedCIs: Array<{ id: string; label: string; blocking: boolean }>;
}

const STATUS_COLORS: Record<NodeStatus, string> = {
  healthy: '#4CAF50',
  blocking: '#F44336',
  impacted: '#FF9800',
};

// ── Current CI highlight: configurable opacity ──
const CURRENT_CI_OPACITY = 0.50;  // ← change this value (0–1) to adjust blue overlay transparency
const CURRENT_CI_COLOR = `rgba(33, 150, 243, ${CURRENT_CI_OPACITY})`;
const CURRENT_CI_COLOR_NONE = 'rgba(0, 0, 0, 0)'; // invisible
const CURRENT_CI_LEGEND = '#2196F3'; // opaque blue for legend/UI only

// Border program: outer blue ring (1/3 radius = 1.5× content) + status ring + fill
// Normal nodes: outer ring is transparent → invisible, apparent size = inner 2/3
// Current CI: outer ring is semi-transparent blue → visible blue circle at 1.5× content radius
const NodeBorderCustomProgram = createNodeBorderProgram({
  borders: [
    { size: { value: 0.33 }, color: { attribute: 'highlightColor' } },
    { size: { value: 0.05 }, color: { attribute: 'borderColor' } },
    { size: { fill: true }, color: { attribute: 'color' } },
  ],
});

// Icon with padding adjusted so icon fits within inner 2/3 of total radius
const NodePictogramProgram = createNodeImageProgram({
  padding: 0.53,
  size: { mode: 'force', value: 256 },
  drawingMode: 'color',
  colorAttribute: 'pictoColor',
});

// Compound: border (with highlight ring) + icon
const NodeProgram = createNodeCompoundProgram([NodeBorderCustomProgram, NodePictogramProgram]);

// Node sizes are 1.5× base values to compensate for the 33% outer highlight ring
// (visible content occupies inner 67% of the radius)
function getAdaptiveSizes(nodeCount: number) {
  if (nodeCount > 10000) {
    return { nodeSize: 5, edgeSize: 0.3, labelThreshold: 15, edgeColor: 'rgba(100,100,100,0.15)' };
  } else if (nodeCount > 5000) {
    return { nodeSize: 6, edgeSize: 0.5, labelThreshold: 10, edgeColor: 'rgba(100,100,100,0.25)' };
  } else if (nodeCount > 1000) {
    return { nodeSize: 9, edgeSize: 1, labelThreshold: 8, edgeColor: '#555' };
  }
  return { nodeSize: 15, edgeSize: 2, labelThreshold: 6, edgeColor: '#666' };
}

/** Check if an edge is blocking based on edge properties */
function isEdgeBlocking(edge: { edge_type: string; properties: Record<string, any> }): boolean {
  if (edge.properties?.blocking === true || edge.properties?.blocking === 'true') return true;
  if (edge.edge_type?.toLowerCase().includes('block')) return true;
  return !edge.edge_type?.toLowerCase().includes('non-block');
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const nodeStatesRef = useRef<Map<string, NodeState>>(new Map());
  const dashedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stats, setStats] = useState({ healthy: 0, blocking: 0, impacted: 0 });
  const [isAnimating, setIsAnimating] = useState(false);
  const [impactedNodesList, setImpactedNodesList] = useState<Array<{ id: string; label: string; status: NodeStatus }>>([]);
  const [showImpactedList, setShowImpactedList] = useState(false);
  const [propagationThreshold, setPropagationThreshold] = useState(0);
  const [edgeZoomThreshold, setEdgeZoomThreshold] = useState(0);
  const edgeZoomThresholdRef = useRef(0);
  useEffect(() => { edgeZoomThresholdRef.current = edgeZoomThreshold; }, [edgeZoomThreshold]);
  const visibleNodeSetRef = useRef<Set<string> | null>(null);

  // ── CMDB-style features ──
  const [currentCI, setCurrentCI] = useState<string | null>(null);       // CI courant (cercle bleu)
  const [initialCI, setInitialCI] = useState<string | null>(null);       // CI initial pour retour
  const [depthLevel, setDepthLevel] = useState(2);                       // Niveaux de profondeur
  const [contextInfo, setContextInfo] = useState<CIContextInfo | null>(null); // Info contextuelle

  /** Build contextual info for a CI */
  const buildContextInfo = useCallback((nodeId: string): CIContextInfo | null => {
    const graph = graphRef.current;
    const states = nodeStatesRef.current;
    if (!graph || !graph.hasNode(nodeId) || !data) return null;
    const attrs = graph.getNodeAttributes(nodeId);
    const state = states.get(nodeId);

    const impactingCIs: CIContextInfo['impactingCIs'] = [];
    const impactedCIs: CIContextInfo['impactedCIs'] = [];

    graph.forEachInEdge(nodeId, (_edge, edgeAttrs, source) => {
      const srcLabel = graph.getNodeAttribute(source, 'label') || source;
      impactingCIs.push({ id: source, label: srcLabel, blocking: edgeAttrs.blocking !== false });
    });
    graph.forEachOutEdge(nodeId, (_edge, edgeAttrs, _source, target) => {
      const tgtLabel = graph.getNodeAttribute(target, 'label') || target;
      impactedCIs.push({ id: target, label: tgtLabel, blocking: edgeAttrs.blocking !== false });
    });

    return {
      id: nodeId,
      label: attrs.label || nodeId,
      nodeType: attrs.nodeType || 'default',
      status: state?.status || 'healthy',
      inDegree: graph.inDegree(nodeId),
      outDegree: graph.outDegree(nodeId),
      impactingCIs,
      impactedCIs,
    };
  }, [data]);

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
    graph.setNodeAttribute(nodeId, 'borderColor', STATUS_COLORS.blocking);

    // BFS propagation via outgoing neighbors (with threshold)
    const queue: string[] = [];
    const visited = new Set<string>();
    visited.add(nodeId);
    const ratio = propagationThreshold / 100;

    graph.forEachOutNeighbor(nodeId, (neighbor) => {
      if (!visited.has(neighbor)) { queue.push(neighbor); visited.add(neighbor); }
    });

    let impactedCount = 0;
    const impactedNodes: Array<{ id: string; label: string; status: NodeStatus }> = [
      { id: nodeId, label: graph.getNodeAttribute(nodeId, 'label') || nodeId, status: 'blocking' },
    ];
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
        graph.setNodeAttribute(current, 'borderColor', STATUS_COLORS.impacted);
        impactedCount++;
        impactedNodes.push({ id: current, label: graph.getNodeAttribute(current, 'label') || current, status: 'impacted' });
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
    setImpactedNodesList(impactedNodes);
    setShowImpactedList(impactedNodes.length > 0);
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
    graph.setNodeAttribute(nodeId, 'borderColor', STATUS_COLORS.healthy);

    // Reset all impacted nodes to healthy first
    for (const [nId, nState] of states.entries()) {
      if (nState.status === 'impacted') {
        nState.status = 'healthy';
        graph.setNodeAttribute(nId, 'borderColor', STATUS_COLORS.healthy);
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
        graph.setNodeAttribute(current, 'borderColor', STATUS_COLORS.impacted);
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
  }, [updateStats]);

  const resetAll = useCallback(() => {
    if (!graphRef.current || !sigmaRef.current || isAnimating) return;
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    const states = nodeStatesRef.current;
    const sizes = getAdaptiveSizes(graph.order);

    for (const [nodeId, nodeState] of states.entries()) {
      nodeState.status = 'healthy';
      graph.setNodeAttribute(nodeId, 'borderColor', STATUS_COLORS.healthy);
      graph.setNodeAttribute(nodeId, 'size', sizes.nodeSize);
    }
    graph.forEachEdge((edge) => {
      graph.setEdgeAttribute(edge, 'color', sizes.edgeColor);
      graph.setEdgeAttribute(edge, 'size', sizes.edgeSize);
    });
    sigma.refresh();
    updateStats();
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
    // Set default viewport edge threshold based on graph size
    const defaultThreshold = nodeCount > 10000 ? 3 : nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 0;
    setEdgeZoomThreshold(defaultThreshold);
    edgeZoomThresholdRef.current = defaultThreshold;

    const graph = new Graph();
    graphRef.current = graph;

    const statesMap = new Map<string, NodeState>();

    // Add nodes
    data.nodes.forEach((node) => {
      const nodeType = node.node_type || 'default';
      graph.addNode(node.id, {
        label: node.label || node.id,
        x: Math.random() * 500,
        y: Math.random() * 500,
        size: sizes.nodeSize,
        color: getNodeColor(nodeType),
        borderColor: STATUS_COLORS.healthy,
        highlightColor: CURRENT_CI_COLOR_NONE,
        type: 'pictogram',
        image: getNodeTypeIcon(nodeType),
        pictoColor: '#000000',
        nodeType: nodeType,
        capacityExceeded: !!node.properties?.capacityExceeded,
        requestCount: node.properties?.requestCount || 0,
      });
      statesMap.set(node.id, { status: 'healthy', dependencies: [] });
    });

    // Set first node as initial & current CI
    if (data.nodes.length > 0) {
      const firstId = data.nodes[0].id;
      setInitialCI(firstId);
      setCurrentCI(firstId);
      graph.setNodeAttribute(firstId, 'highlightColor', CURRENT_CI_COLOR);
    }

    // Add edges with deduplication + blocking/non-blocking + labels
    const edgeSet = new Set<string>();
    let skippedEdges = 0;
    data.edges.forEach((edge) => {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
      const edgeKey = `${edge.source}->${edge.target}`;
      if (edgeSet.has(edgeKey)) { skippedEdges++; return; }
      edgeSet.add(edgeKey);
      const blocking = isEdgeBlocking(edge);
      try {
        graph.addEdge(edge.source, edge.target, {
          size: sizes.edgeSize,
          color: sizes.edgeColor,
          type: 'arrow',
          label: edge.label || edge.edge_type || '',
          blocking,
          forceLabel: !isLarge,
        });
        // Track dependencies: target depends on source (only for blocking relationships)
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
        renderEdgeLabels: !isLarge,
        defaultNodeType: 'pictogram',
        nodeProgramClasses: { pictogram: NodeProgram },
        edgeProgramClasses: { arrow: EdgeArrowProgram },
        defaultEdgeColor: sizes.edgeColor,
        labelSize: isLarge ? 10 : 12,
        labelWeight: '600',
        labelColor: { color: '#000000' },
        edgeLabelSize: 10,
        edgeLabelColor: { color: labelColorValue },
        labelRenderedSizeThreshold: sizes.labelThreshold,
        enableEdgeEvents: !isLarge,
        allowInvalidContainer: true,
        zIndex: true,
        minCameraRatio: 0.01,
        maxCameraRatio: 20,
        edgeReducer: (edge, attrs) => {
          // Viewport-based edge hiding
          const threshold = edgeZoomThresholdRef.current;
          if (threshold > 0 && visibleNodeSetRef.current && graphRef.current) {
            const src = graphRef.current.source(edge);
            const tgt = graphRef.current.target(edge);
            if (!visibleNodeSetRef.current.has(src) && !visibleNodeSetRef.current.has(tgt)) {
              return { ...attrs, hidden: true };
            }
          }
          // Non-blocking edges: hide from WebGL (drawn as dashed on 2D canvas overlay)
          if (graphRef.current && !graphRef.current.getEdgeAttribute(edge, 'blocking')) {
            return { ...attrs, hidden: true };
          }
          return attrs;
        },
      });

      sigmaRef.current = sigma;

      // ── Dashed edge overlay: draw non-blocking edges on a Canvas 2D layer ──
      let dashedCanvas = dashedCanvasRef.current;
      if (!dashedCanvas) {
        dashedCanvas = document.createElement('canvas');
        dashedCanvas.style.position = 'absolute';
        dashedCanvas.style.top = '0';
        dashedCanvas.style.left = '0';
        dashedCanvas.style.pointerEvents = 'none';
        dashedCanvas.style.zIndex = '1';
        containerRef.current!.appendChild(dashedCanvas);
        dashedCanvasRef.current = dashedCanvas;
      }

      const drawDashedEdges = () => {
        if (!dashedCanvas || !graphRef.current || !sigmaRef.current) return;
        const g = graphRef.current;
        const s = sigmaRef.current;
        const container = s.getContainer();
        const w = container.offsetWidth;
        const h = container.offsetHeight;
        const dpr = window.devicePixelRatio || 1;
        dashedCanvas.width = w * dpr;
        dashedCanvas.height = h * dpr;
        dashedCanvas.style.width = w + 'px';
        dashedCanvas.style.height = h + 'px';
        const ctx = dashedCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        g.forEachEdge((edge, attrs, src, tgt) => {
          if (attrs.blocking) return; // blocking edges rendered by WebGL
          // Viewport-based hiding (same logic as edgeReducer)
          const threshold = edgeZoomThresholdRef.current;
          if (threshold > 0 && visibleNodeSetRef.current) {
            if (!visibleNodeSetRef.current.has(src) && !visibleNodeSetRef.current.has(tgt)) return;
          }

          const srcPos = s.graphToViewport(g.getNodeAttributes(src) as {x: number; y: number});
          const tgtPos = s.graphToViewport(g.getNodeAttributes(tgt) as {x: number; y: number});

          const edgeColor = (attrs.color as string) || 'rgba(150,150,150,0.5)';
          const edgeWidth = Math.max((attrs.size as number) * 0.6, 0.5);

          // Draw dashed line
          ctx.beginPath();
          ctx.setLineDash([6, 4]);
          ctx.moveTo(srcPos.x, srcPos.y);
          ctx.lineTo(tgtPos.x, tgtPos.y);
          ctx.strokeStyle = edgeColor;
          ctx.lineWidth = edgeWidth;
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw arrowhead at target
          const angle = Math.atan2(tgtPos.y - srcPos.y, tgtPos.x - srcPos.x);
          const arrowLen = 8;
          ctx.beginPath();
          ctx.moveTo(tgtPos.x, tgtPos.y);
          ctx.lineTo(
            tgtPos.x - arrowLen * Math.cos(angle - Math.PI / 7),
            tgtPos.y - arrowLen * Math.sin(angle - Math.PI / 7),
          );
          ctx.lineTo(
            tgtPos.x - arrowLen * Math.cos(angle + Math.PI / 7),
            tgtPos.y - arrowLen * Math.sin(angle + Math.PI / 7),
          );
          ctx.closePath();
          ctx.fillStyle = edgeColor;
          ctx.fill();
        });

        // ── Draw exclamation badge on capacity-exceeded nodes (bottom-right) ──
        g.forEachNode((_, nodeAttrs) => {
          if (nodeAttrs.hidden) return;
          if (nodeAttrs.capacityExceeded !== true) return;
          const pos = s.graphToViewport(nodeAttrs as { x: number; y: number });
          const nodeSize = s.scaleSize(nodeAttrs.size as number);
          if (nodeSize < 4) return; // too small to show badge

          const badgeRadius = Math.max(nodeSize * 0.3, 4);
          const bx = pos.x + nodeSize * 0.65;
          const by = pos.y + nodeSize * 0.65;

          // Red circle
          ctx.beginPath();
          ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#F44336';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(badgeRadius * 0.15, 0.5);
          ctx.stroke();

          // "!" text
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.round(badgeRadius * 1.4)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', bx, by);
        });

        // ── Blue badge: request count (bottom-left) ──
        g.forEachNode((_, nodeAttrs) => {
          if (nodeAttrs.hidden) return;
          const count = nodeAttrs.requestCount as number;
          if (!count || count <= 0) return;
          const pos = s.graphToViewport(nodeAttrs as { x: number; y: number });
          const nodeSize = s.scaleSize(nodeAttrs.size as number);
          if (nodeSize < 4) return;

          const text = String(count);
          const badgeRadius = Math.max(nodeSize * 0.35, 6);
          const bx = pos.x - nodeSize * 0.65;
          const by = pos.y + nodeSize * 0.65;

          ctx.beginPath();
          ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#2196F3';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = Math.max(badgeRadius * 0.15, 0.5);
          ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.font = `bold ${Math.round(badgeRadius * 1.2)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, bx, by);
        });
      };

      sigma.on('afterRender', drawDashedEdges);

      // Re-compute visible node set on camera move (for viewport edge filtering)
      let edgeRefreshRaf = 0;
      const cam = sigma.getCamera();
      const updateVisibleNodes = () => {
        const threshold = edgeZoomThresholdRef.current;
        if (threshold <= 0) { visibleNodeSetRef.current = null; return; }
        const width = sigma.getContainer().offsetWidth;
        const height = sigma.getContainer().offsetHeight;
        const topLeft = sigma.viewportToGraph({ x: 0, y: 0 });
        const bottomRight = sigma.viewportToGraph({ x: width, y: height });
        const shrink = 1 - Math.min((threshold - 1) / 10, 0.9);
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);
        const gw = maxX - minX, gh = maxY - minY;
        const cx = minX + gw / 2, cy = minY + gh / 2;
        const hw = gw * shrink / 2, hh = gh * shrink / 2;
        const x1 = cx - hw, x2 = cx + hw;
        const y1 = cy - hh, y2 = cy + hh;
        const visible = new Set<string>();
        graph.forEachNode((nodeId, attrs) => {
          if (attrs.x >= x1 && attrs.x <= x2 && attrs.y >= y1 && attrs.y <= y2) visible.add(nodeId);
        });
        visibleNodeSetRef.current = visible;
      };
      cam.on('updated', () => {
        if (edgeZoomThresholdRef.current > 0) {
          cancelAnimationFrame(edgeRefreshRaf);
          edgeRefreshRaf = requestAnimationFrame(() => { updateVisibleNodes(); sigma.refresh(); });
        } else if (visibleNodeSetRef.current) {
          visibleNodeSetRef.current = null;
          sigma.refresh();
        }
      });

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

      // Click node: toggle blocking/healthy + set as current CI (skip if dragged)
      sigma.on('clickNode', ({ node }) => {
        if (hasDragged) { hasDragged = false; return; }
        const states = nodeStatesRef.current;
        const currentState = states.get(node);
        if (!currentState) return;

        // Update current CI highlight
        setCurrentCI((prevCI) => {
          if (prevCI && graph.hasNode(prevCI)) {
            graph.setNodeAttribute(prevCI, 'highlightColor', CURRENT_CI_COLOR_NONE);
          }
          graph.setNodeAttribute(node, 'highlightColor', CURRENT_CI_COLOR);
          return node;
        });

        setContextInfo(buildContextInfo(node));

        if (currentState.status === 'healthy') {
          propagateBlocking(node);
        } else {
          resetSingleNode(node);
        }
      });

      // Double-click node: set as current CI without toggling status
      sigma.on('doubleClickNode', ({ node }) => {
        setCurrentCI((prevCI) => {
          if (prevCI && graph.hasNode(prevCI)) {
            graph.setNodeAttribute(prevCI, 'highlightColor', CURRENT_CI_COLOR_NONE);
          }
          graph.setNodeAttribute(node, 'highlightColor', CURRENT_CI_COLOR);
          return node;
        });
        setContextInfo(buildContextInfo(node));
        // Zoom to the node
        const nodeAttrs = graph.getNodeAttributes(node);
        const vp = sigma.graphToViewport({ x: nodeAttrs.x, y: nodeAttrs.y });
        const fp = sigma.viewportToFramedGraph(vp);
        sigma.getCamera().animate({ x: fp.x, y: fp.y, ratio: 0.12 }, { duration: 400 });
      });

      // Click stage: hide context info
      sigma.on('clickStage', () => {
        setContextInfo(null);
      });

      // Hover highlight neighbors
      sigma.on('enterNode', ({ node }) => {
        if (!graph.hasNode(node)) return;
        const neighbors = new Set(graph.neighbors(node));
        neighbors.add(node);
        graph.forEachNode((n) => {
          if (!neighbors.has(n)) {
            graph.setNodeAttribute(n, 'borderColor', 'rgba(50,50,50,0.15)');
            graph.setNodeAttribute(n, 'color', 'rgba(80,80,80,0.2)');
          }
        });
        graph.forEachEdge((edge, _attrs, source, target) => {
          if (source !== node && target !== node) {
            graph.setEdgeAttribute(edge, 'color', 'rgba(50,50,50,0.05)');
          } else {
            const isBlocking = graph.getEdgeAttribute(edge, 'blocking');
            graph.setEdgeAttribute(edge, 'color', isBlocking ? '#fff' : 'rgba(255,255,255,0.5)');
            graph.setEdgeAttribute(edge, 'size', Math.max(sizes.edgeSize * 3, 1.5));
          }
        });
        sigma.refresh();
      });

      // Leave node: restore colors (respecting current CI blue border)
      sigma.on('leaveNode', () => {
        const states = nodeStatesRef.current;
        graph.forEachNode((n) => {
          const state = states.get(n);
          const status = state?.status || 'healthy';
          const nodeType = graph.getNodeAttribute(n, 'nodeType') || 'default';
          graph.setNodeAttribute(n, 'color', getNodeColor(nodeType));
          graph.setNodeAttribute(n, 'borderColor', STATUS_COLORS[status]);
          // Restore highlight overlay for current CI
          setCurrentCI((ci) => {
            graph.setNodeAttribute(n, 'highlightColor', n === ci ? CURRENT_CI_COLOR : CURRENT_CI_COLOR_NONE);
            return ci;
          });
        });
        graph.forEachEdge((edge) => {
          // Restore edge color based on impacted path
          const srcState = states.get(graph.source(edge));
          const tgtState = states.get(graph.target(edge));
          if (srcState && tgtState &&
              (srcState.status === 'blocking' || srcState.status === 'impacted') &&
              (tgtState.status === 'blocking' || tgtState.status === 'impacted')) {
            graph.setEdgeAttribute(edge, 'color', '#FF5722');
          } else {
            graph.setEdgeAttribute(edge, 'color', sizes.edgeColor);
          }
          graph.setEdgeAttribute(edge, 'size', sizes.edgeSize);
        });
        sigma.refresh();
      });

      // Drag'n'drop: move a single node without moving the others
      let draggedNode: string | null = null;
      let isDragging = false;
      let hasDragged = false;

      sigma.on('downNode', (e) => {
        isDragging = true;
        hasDragged = false;
        draggedNode = e.node;
        graph.setNodeAttribute(draggedNode, 'highlighted', true);
        if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
      });

      sigma.on('moveBody', ({ event }) => {
        if (!isDragging || !draggedNode) return;
        hasDragged = true;
        const pos = sigma.viewportToGraph(event);
        graph.setNodeAttribute(draggedNode, 'x', pos.x);
        graph.setNodeAttribute(draggedNode, 'y', pos.y);
        event.preventSigmaDefault();
        event.original.preventDefault();
        event.original.stopPropagation();
      });

      const handleDragUp = () => {
        if (draggedNode) {
          graph.removeNodeAttribute(draggedNode, 'highlighted');
        }
        isDragging = false;
        draggedNode = null;
      };
      sigma.on('upNode', handleDragUp);
      sigma.on('upStage', handleDragUp);

      const elapsed = performance.now() - startTime;
      console.info(`Impact: rendered in ${elapsed.toFixed(0)}ms`);
    } catch (error) {
      console.error('Sigma creation error:', error);
    }

    return () => {
      if (dashedCanvasRef.current && dashedCanvasRef.current.parentElement) {
        dashedCanvasRef.current.parentElement.removeChild(dashedCanvasRef.current);
        dashedCanvasRef.current = null;
      }
      if (sigmaRef.current) {
        try { sigmaRef.current.kill(); } catch (e) { /* ignore */ }
        sigmaRef.current = null;
      }
    };
  }, [data, propagateBlocking, resetSingleNode, updateStats, buildContextInfo]);

  // ── Navigation callbacks ──
  const handleFitView = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600 });
  }, []);

  const handleZoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300 });
  }, []);

  const handleZoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300 });
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    if (!sigmaRef.current || !graphRef.current) return;
    const graph = graphRef.current;
    if (!graph.hasNode(nodeId)) return;
    const sigma = sigmaRef.current;
    const attrs = graph.getNodeAttributes(nodeId);
    const viewportPos = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
    const framedPos = sigma.viewportToFramedGraph(viewportPos);
    sigma.getCamera().animate({ x: framedPos.x, y: framedPos.y, ratio: 0.08 }, { duration: 400 });
  }, []);

  /** Return to initial CI */
  const returnToInitialCI = useCallback(() => {
    if (!initialCI || !graphRef.current || !sigmaRef.current) return;
    const graph = graphRef.current;

    // Remove blue highlight from current CI
    setCurrentCI((prevCI) => {
      if (prevCI && graph.hasNode(prevCI)) {
        graph.setNodeAttribute(prevCI, 'highlightColor', CURRENT_CI_COLOR_NONE);
      }
      return initialCI;
    });

    // Add blue highlight to initial CI
    graph.setNodeAttribute(initialCI, 'highlightColor', CURRENT_CI_COLOR);
    sigmaRef.current.refresh();
    focusNode(initialCI);
    setContextInfo(buildContextInfo(initialCI));
  }, [initialCI, focusNode, buildContextInfo]);

  /** Export graph as PNG */
  const exportAsPNG = useCallback(() => {
    if (!sigmaRef.current) return;
    const sigma = sigmaRef.current;
    // Sigma uses multiple canvas layers — we need to composite them
    const canvases = sigma.getCanvases();
    const layers = Object.values(canvases);
    if (layers.length === 0) return;
    const w = layers[0].width;
    const h = layers[0].height;
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d');
    if (!ctx) return;
    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // Stack all sigma canvas layers
    for (const layer of layers) {
      ctx.drawImage(layer, 0, 0);
    }
    composite.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `impact-graph-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, []);

  /** Print graph */
  const printGraph = useCallback(() => {
    if (!sigmaRef.current) return;
    const sigma = sigmaRef.current;
    const canvases = sigma.getCanvases();
    const layers = Object.values(canvases);
    if (layers.length === 0) return;
    const w = layers[0].width;
    const h = layers[0].height;
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (const layer of layers) {
      ctx.drawImage(layer, 0, 0);
    }
    const dataUrl = composite.toDataURL('image/png');
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(`<html><head><title>CMDB Impact Graph</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f5f5f5"><img src="${dataUrl}" style="max-width:100%;max-height:100vh" onload="window.print()"/></body></html>`);
      win.document.close();
    }
  }, []);

  /** Change depth level visibility */
  const changeDepthLevel = useCallback((delta: number) => {
    setDepthLevel((prev) => Math.max(1, Math.min(10, prev + delta)));
  }, []);

  if (!data) {
    return (
      <div className="impact-analysis">
        <div className="empty-state">
          <i className="bi bi-diagram-3" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
          <h3>No graph selected</h3>
          <p>Select a graph to start impact analysis</p>
        </div>
      </div>
    );
  }

  return (
    <div className="impact-analysis">
      {/* ── Toolbar ── */}
      <div className="impact-controls">
        <div className="impact-toolbar-row">
          <button onClick={handleFitView} title="Fit view">
            <i className="bi bi-arrows-fullscreen"></i>
          </button>
          <button onClick={handleZoomIn} title="Zoom in">
            <i className="bi bi-zoom-in"></i>
          </button>
          <button onClick={handleZoomOut} title="Zoom out">
            <i className="bi bi-zoom-out"></i>
          </button>
          <button onClick={resetAll} disabled={isAnimating} title="Reset all statuses">
            <i className="bi bi-arrow-counterclockwise"></i>
          </button>
        </div>

        <div className="impact-toolbar-row">
          <button onClick={returnToInitialCI} title="Return to initial CI" disabled={!initialCI || currentCI === initialCI}>
            <i className="bi bi-house-door"></i>
          </button>
          <button onClick={exportAsPNG} title="Export as PNG">
            <i className="bi bi-image"></i>
          </button>
          <button onClick={printGraph} title="Print graph">
            <i className="bi bi-printer"></i>
          </button>
        </div>

        {/* Depth level selector */}
        <div className="depth-level-control">
          <label><i className="bi bi-layers"></i> Levels</label>
          <div className="depth-buttons">
            <button onClick={() => changeDepthLevel(-1)} disabled={depthLevel <= 1}>−</button>
            <span className="depth-value">{depthLevel}</span>
            <button onClick={() => changeDepthLevel(1)} disabled={depthLevel >= 10}>+</button>
          </div>
        </div>

        <div className="threshold-slider">
          <label title="Minimum percentage of impacted parents required to propagate impact">
            <i className="bi bi-sliders"></i> Threshold: {propagationThreshold}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={propagationThreshold}
            onChange={(e) => setPropagationThreshold(Number(e.target.value))}
            title={`${propagationThreshold}% — Impact propagates if ≥${propagationThreshold}% of incoming parents are impacted`}
          />
        </div>

        {data.nodes.length > 200 && (
          <div className="threshold-slider">
            <label title="Show edges only for visible viewport nodes">
              <i className="bi bi-bezier2"></i> Viewport edges: {edgeZoomThreshold === 0 ? 'All' : `×${edgeZoomThreshold}`}
            </label>
            <input
              type="range"
              min={0} max={10} step={0.5}
              value={edgeZoomThreshold}
              onChange={(e) => setEdgeZoomThreshold(Number(e.target.value))}
            />
          </div>
        )}

        {/* Legend */}
        <div className="impact-legend">
          <div className="legend-item">
            <span className="legend-dot" style={{ background: CURRENT_CI_COLOR, border: `2px solid ${CURRENT_CI_LEGEND}` }}></span>
            <span>Current CI</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: '#4CAF50' }}></span>
            <span>Available ({stats.healthy.toLocaleString()})</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: '#F44336' }}></span>
            <span>Blocking ({stats.blocking.toLocaleString()})</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: '#FF9800' }}></span>
            <span>Impacted ({stats.impacted.toLocaleString()})</span>
          </div>
          <div className="legend-divider"></div>
          <div className="legend-item">
            <span className="legend-line legend-line-solid"></span>
            <span>Blocking (straight)</span>
          </div>
          <div className="legend-item">
            <span className="legend-line legend-line-dashed"></span>
            <span>Non-blocking (dashed)</span>
          </div>
        </div>
      </div>

      {/* ── Graph container ── */}
      <div ref={containerRef} className="impact-container" />

      {/* ── Contextual info panel (click a CI) ── */}
      {contextInfo && (
        <div className="ci-context-panel">
          <div className="ci-context-header">
            <div className="ci-context-status">
              <span className="ci-status-dot" style={{ background: STATUS_COLORS[contextInfo.status] }}></span>
              <span className="ci-status-text">
                {contextInfo.status === 'healthy' ? 'Available' : contextInfo.status === 'blocking' ? 'Unavailable' : 'Impacted'}
              </span>
            </div>
            <button className="ci-context-close" onClick={() => setContextInfo(null)}>×</button>
          </div>

          <h4 className="ci-context-name">{contextInfo.label}</h4>
          <span className="ci-context-type">{contextInfo.nodeType}</span>

          <div className="ci-context-stats">
            <div className="ci-stat">
              <i className="bi bi-box-arrow-in-left"></i>
              <span>{contextInfo.inDegree} impacting</span>
            </div>
            <div className="ci-stat">
              <i className="bi bi-box-arrow-right"></i>
              <span>{contextInfo.outDegree} impacted</span>
            </div>
          </div>

          {contextInfo.impactingCIs.length > 0 && (
            <div className="ci-relations-section">
              <h5>Impacting CIs</h5>
              <ul className="ci-relations-list">
                {contextInfo.impactingCIs.map((ci) => (
                  <li key={ci.id} className="ci-relation-item" onClick={() => focusNode(ci.id)}>
                    <span className={`ci-relation-line ${ci.blocking ? 'blocking' : 'non-blocking'}`}></span>
                    <span className="ci-relation-label">{ci.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contextInfo.impactedCIs.length > 0 && (
            <div className="ci-relations-section">
              <h5>Impacted CIs</h5>
              <ul className="ci-relations-list">
                {contextInfo.impactedCIs.map((ci) => (
                  <li key={ci.id} className="ci-relation-item" onClick={() => focusNode(ci.id)}>
                    <span className={`ci-relation-line ${ci.blocking ? 'blocking' : 'non-blocking'}`}></span>
                    <span className="ci-relation-label">{ci.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="ci-context-form-btn" onClick={() => focusNode(contextInfo.id)}>
            <i className="bi bi-eye"></i> Focus on CI
          </button>
        </div>
      )}

      {/* ── Impacted nodes list ── */}
      {impactedNodesList.length > 0 && (
        <div className="server-impact-panel" style={{ top: 'auto', bottom: 60, left: 20 }}>
          <div className="impacted-list-section">
            <button
              className="impacted-list-toggle"
              onClick={() => setShowImpactedList(!showImpactedList)}
            >
              {showImpactedList ? '▾' : '▸'} {impactedNodesList.length} affected CIs
            </button>
            {showImpactedList && (
              <ul className="impacted-list">
                {impactedNodesList.map((n) => (
                  <li
                    key={n.id}
                    className="impacted-list-item"
                    onClick={() => focusNode(n.id)}
                    title={`Click to focus on ${n.label}`}
                  >
                    <i
                      className={`bi ${getNodeStatusIcon(n.status)}`}
                      style={{ color: STATUS_COLORS[n.status], fontSize: '0.9em' }}
                    />
                    <span className="impacted-list-label">{n.label}</span>
                    <span className="impacted-list-id">{n.id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="impact-stats-bar">
        <span>
          <i className="bi bi-circle-fill" style={{ fontSize: '0.6em' }}></i>{' '}
          {data.nodes.length.toLocaleString()} CIs
        </span>
        <span>—</span>
        <span>
          <i className="bi bi-arrow-right" style={{ fontSize: '0.8em' }}></i>{' '}
          {data.edges.length.toLocaleString()} relations
        </span>
        {currentCI && (
          <>
            <span>—</span>
            <span style={{ color: CURRENT_CI_LEGEND }}>
              <i className="bi bi-record-circle" style={{ fontSize: '0.8em' }}></i>{' '}
              {graphRef.current?.getNodeAttribute(currentCI, 'label') || currentCI}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

const getNodeStatusIcon = (status: NodeStatus) => {
  switch (status) {
    case 'blocking': return 'bi-x-octagon-fill';
    case 'impacted': return 'bi-exclamation-triangle-fill';
    default: return 'bi-check-circle-fill';
  }
};

export default ImpactAnalysis;
