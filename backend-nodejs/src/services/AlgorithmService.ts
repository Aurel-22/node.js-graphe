/**
 * AlgorithmService — Pure TypeScript implementations of graph algorithms.
 * Operates on in-memory adjacency lists built from GraphData.
 * No database dependency — works with any engine.
 */

import { GraphData } from "../models/graph.js";

// ────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────

export interface TraversalResult {
  /** Nœuds visités dans l'ordre de parcours */
  visitedNodes: Array<{ nodeId: string; level: number; parent: string | null }>;
  /** Nombre total de nœuds visités */
  visitedCount: number;
  /** Profondeur maximale atteinte */
  maxDepth: number;
}

export interface ShortestPathResult {
  /** Chemin du nœud source au nœud cible */
  path: string[];
  /** Longueur / coût du chemin */
  cost: number;
  /** Nombre de nœuds explorés */
  exploredCount: number;
}

export interface CentralityResult {
  /** Scores de centralité par nœud (top N trié décroissant) */
  scores: Array<{ nodeId: string; score: number }>;
  /** Statistiques globales */
  stats: { min: number; max: number; avg: number; median: number };
}

export interface CommunityResult {
  /** Communautés détectées : communityId → liste de nodeIds */
  communities: Record<string, string[]>;
  /** Nombre de communautés */
  communityCount: number;
  /** Modularité (quand applicable) */
  modularity: number | null;
}

export interface TopologicalSortResult {
  /** Ordre topologique (ou vide si cycle détecté) */
  order: string[];
  /** True si le graphe contient des cycles */
  hasCycle: boolean;
}

export interface AlgorithmResult {
  algorithm: string;
  elapsed_ms: number;
  nodeCount: number;
  edgeCount: number;
  result:
    | { type: "traversal"; data: TraversalResult }
    | { type: "shortestPath"; data: ShortestPathResult }
    | { type: "centrality"; data: CentralityResult }
    | { type: "community"; data: CommunityResult }
    | { type: "topologicalSort"; data: TopologicalSortResult };
}

// ────────────────────────────────────────────
// Internal adjacency-list representation
// ────────────────────────────────────────────

interface AdjList {
  outgoing: Map<string, Array<{ target: string; weight: number }>>;
  incoming: Map<string, Array<{ source: string; weight: number }>>;
  nodes: Set<string>;
}

function buildAdjList(data: GraphData): AdjList {
  const outgoing = new Map<string, Array<{ target: string; weight: number }>>();
  const incoming = new Map<string, Array<{ source: string; weight: number }>>();
  const nodes = new Set<string>();

  for (const n of data.nodes) {
    nodes.add(n.id);
    if (!outgoing.has(n.id)) outgoing.set(n.id, []);
    if (!incoming.has(n.id)) incoming.set(n.id, []);
  }

  for (const e of data.edges) {
    const weight = e.properties?.weight ?? 1;
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push({ target: e.target, weight });
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push({ source: e.source, weight });
    nodes.add(e.source);
    nodes.add(e.target);
  }

  return { outgoing, incoming, nodes };
}

// ────────────────────────────────────────────
// Algorithm implementations
// ────────────────────────────────────────────

export class AlgorithmService {
  // ---- 1. BFS ----
  static bfs(data: GraphData, sourceNode: string, maxDepth: number = 100): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const visited: TraversalResult["visitedNodes"] = [];
    const seen = new Set<string>();
    const queue: Array<{ id: string; level: number; parent: string | null }> = [
      { id: sourceNode, level: 0, parent: null },
    ];
    seen.add(sourceNode);
    let maxD = 0;

    while (queue.length > 0) {
      const { id, level, parent } = queue.shift()!;
      if (level > maxDepth) break;
      visited.push({ nodeId: id, level, parent });
      maxD = Math.max(maxD, level);

      for (const { target } of adj.outgoing.get(id) || []) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push({ id: target, level: level + 1, parent: id });
        }
      }
    }

    return {
      algorithm: "bfs",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "traversal",
        data: { visitedNodes: visited, visitedCount: visited.length, maxDepth: maxD },
      },
    };
  }

  // ---- 2. DFS (détection de cycles) ----
  static dfs(data: GraphData, sourceNode: string, maxDepth: number = 100): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const visited: TraversalResult["visitedNodes"] = [];
    const seen = new Set<string>();
    let maxD = 0;

    function dfsVisit(id: string, level: number, parent: string | null) {
      if (level > maxDepth || seen.has(id)) return;
      seen.add(id);
      visited.push({ nodeId: id, level, parent });
      maxD = Math.max(maxD, level);
      for (const { target } of adj.outgoing.get(id) || []) {
        if (!seen.has(target)) {
          dfsVisit(target, level + 1, id);
        }
      }
    }

    dfsVisit(sourceNode, 0, null);

    return {
      algorithm: "dfs",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "traversal",
        data: { visitedNodes: visited, visitedCount: visited.length, maxDepth: maxD },
      },
    };
  }

  // ---- 3. BFS bidirectionnel ----
  static bidirectionalBfs(data: GraphData, sourceNode: string, targetNode: string): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);

    const parentFwd = new Map<string, string | null>();
    const parentBwd = new Map<string, string | null>();
    const queueFwd: string[] = [sourceNode];
    const queueBwd: string[] = [targetNode];
    parentFwd.set(sourceNode, null);
    parentBwd.set(targetNode, null);

    let meetingNode: string | null = null;
    let explored = 0;

    while (queueFwd.length > 0 || queueBwd.length > 0) {
      // Expand forward
      if (queueFwd.length > 0) {
        const current = queueFwd.shift()!;
        explored++;
        for (const { target } of adj.outgoing.get(current) || []) {
          if (!parentFwd.has(target)) {
            parentFwd.set(target, current);
            queueFwd.push(target);
          }
          if (parentBwd.has(target)) {
            meetingNode = target;
            break;
          }
        }
        if (meetingNode) break;
      }

      // Expand backward
      if (queueBwd.length > 0) {
        const current = queueBwd.shift()!;
        explored++;
        for (const { source } of adj.incoming.get(current) || []) {
          if (!parentBwd.has(source)) {
            parentBwd.set(source, current);
            queueBwd.push(source);
          }
          if (parentFwd.has(source)) {
            meetingNode = source;
            break;
          }
        }
        if (meetingNode) break;
      }
    }

    // Reconstruct path
    const path: string[] = [];
    if (meetingNode) {
      // Forward part
      const fwdPart: string[] = [];
      let cur: string | null = meetingNode;
      while (cur !== null) {
        fwdPart.unshift(cur);
        cur = parentFwd.get(cur) ?? null;
      }
      // Backward part (skip meeting node)
      cur = parentBwd.get(meetingNode) ?? null;
      const bwdPart: string[] = [];
      while (cur !== null) {
        bwdPart.push(cur);
        cur = parentBwd.get(cur) ?? null;
      }
      path.push(...fwdPart, ...bwdPart);
    }

    return {
      algorithm: "bidirectional-bfs",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "shortestPath",
        data: { path, cost: path.length > 0 ? path.length - 1 : -1, exploredCount: explored },
      },
    };
  }

  // ---- 4. Dijkstra ----
  static dijkstra(data: GraphData, sourceNode: string, targetNode?: string): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    // Simple priority queue (array-based, fine for moderate graph sizes)
    const pq: Array<{ node: string; cost: number }> = [];

    dist.set(sourceNode, 0);
    prev.set(sourceNode, null);
    pq.push({ node: sourceNode, cost: 0 });

    let explored = 0;

    while (pq.length > 0) {
      // Extract min
      pq.sort((a, b) => a.cost - b.cost);
      const { node: u, cost: uCost } = pq.shift()!;

      if (visited.has(u)) continue;
      visited.add(u);
      explored++;

      if (targetNode && u === targetNode) break;

      for (const { target, weight } of adj.outgoing.get(u) || []) {
        if (visited.has(target)) continue;
        const newDist = uCost + weight;
        if (!dist.has(target) || newDist < dist.get(target)!) {
          dist.set(target, newDist);
          prev.set(target, u);
          pq.push({ node: target, cost: newDist });
        }
      }
    }

    // If targetNode specified, reconstruct path
    if (targetNode) {
      const path: string[] = [];
      let cur: string | null = targetNode;
      while (cur !== null && prev.has(cur)) {
        path.unshift(cur);
        cur = prev.get(cur) ?? null;
      }
      if (path.length > 0 && path[0] !== sourceNode) {
        path.unshift(sourceNode);
      }
      const cost = dist.get(targetNode) ?? -1;

      return {
        algorithm: "dijkstra",
        elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
        result: {
          type: "shortestPath",
          data: { path: cost >= 0 ? path : [], cost, exploredCount: explored },
        },
      };
    }

    // No target → return as traversal (all reachable nodes with distances)
    const visitedNodes: TraversalResult["visitedNodes"] = [];
    let maxD = 0;
    for (const [nodeId, d] of dist.entries()) {
      visitedNodes.push({ nodeId, level: d, parent: prev.get(nodeId) ?? null });
      maxD = Math.max(maxD, d);
    }
    visitedNodes.sort((a, b) => a.level - b.level);

    return {
      algorithm: "dijkstra",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "traversal",
        data: { visitedNodes, visitedCount: visitedNodes.length, maxDepth: maxD },
      },
    };
  }

  // ---- 5. Degree Centrality ----
  static degreeCentrality(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const n = adj.nodes.size;

    const scores: CentralityResult["scores"] = [];
    for (const nodeId of adj.nodes) {
      const inDeg = (adj.incoming.get(nodeId) || []).length;
      const outDeg = (adj.outgoing.get(nodeId) || []).length;
      const total = inDeg + outDeg;
      scores.push({ nodeId, score: n > 1 ? total / (n - 1) : 0 });
    }

    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 100);
    const vals = scores.map((s) => s.score);

    return {
      algorithm: "degree-centrality",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "centrality",
        data: { scores: topScores, stats: computeStats(vals) },
      },
    };
  }

  // ---- 6. Betweenness Centrality (Brandes algorithm) ----
  static betweennessCentrality(data: GraphData, sampleSize?: number): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);
    const n = nodeArray.length;

    const cb = new Map<string, number>();
    for (const v of nodeArray) cb.set(v, 0);

    // Sample nodes for large graphs
    let sources = nodeArray;
    if (sampleSize && sampleSize < n) {
      sources = shuffleArray(nodeArray).slice(0, sampleSize);
    }

    for (const s of sources) {
      const stack: string[] = [];
      const pred = new Map<string, string[]>();
      const sigma = new Map<string, number>();
      const dist = new Map<string, number>();
      const delta = new Map<string, number>();

      for (const v of nodeArray) {
        pred.set(v, []);
        sigma.set(v, 0);
        dist.set(v, -1);
        delta.set(v, 0);
      }
      sigma.set(s, 1);
      dist.set(s, 0);

      const queue: string[] = [s];
      while (queue.length > 0) {
        const v = queue.shift()!;
        stack.push(v);
        for (const { target: w } of adj.outgoing.get(v) || []) {
          if (dist.get(w)! < 0) {
            queue.push(w);
            dist.set(w, dist.get(v)! + 1);
          }
          if (dist.get(w) === dist.get(v)! + 1) {
            sigma.set(w, sigma.get(w)! + sigma.get(v)!);
            pred.get(w)!.push(v);
          }
        }
      }

      while (stack.length > 0) {
        const w = stack.pop()!;
        for (const v of pred.get(w)!) {
          delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
        }
        if (w !== s) {
          cb.set(w, cb.get(w)! + delta.get(w)!);
        }
      }
    }

    // Normalize
    const factor = sampleSize ? n / (sampleSize || 1) : 1;
    const scores: CentralityResult["scores"] = [];
    for (const [nodeId, val] of cb) {
      scores.push({ nodeId, score: Math.round(val * factor * 1000) / 1000 });
    }
    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 100);
    const vals = scores.map((s) => s.score);

    return {
      algorithm: "betweenness-centrality",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "centrality",
        data: { scores: topScores, stats: computeStats(vals) },
      },
    };
  }

  // ---- 7. Closeness Centrality ----
  static closenessCentrality(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);
    const n = nodeArray.length;

    const scores: CentralityResult["scores"] = [];

    for (const s of nodeArray) {
      // BFS from s
      const dist = new Map<string, number>();
      dist.set(s, 0);
      const queue: string[] = [s];
      let totalDist = 0;
      let reachable = 0;

      while (queue.length > 0) {
        const v = queue.shift()!;
        for (const { target: w } of adj.outgoing.get(v) || []) {
          if (!dist.has(w)) {
            dist.set(w, dist.get(v)! + 1);
            totalDist += dist.get(w)!;
            reachable++;
            queue.push(w);
          }
        }
      }

      // Wasserman-Faust normalized closeness
      const closeness = reachable > 0 ? (reachable / (n - 1)) * (reachable / totalDist) : 0;
      scores.push({ nodeId: s, score: Math.round(closeness * 10000) / 10000 });
    }

    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 100);
    const vals = scores.map((s) => s.score);

    return {
      algorithm: "closeness-centrality",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "centrality",
        data: { scores: topScores, stats: computeStats(vals) },
      },
    };
  }

  // ---- 8. PageRank ----
  static pageRank(data: GraphData, iterations: number = 20, damping: number = 0.85): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);
    const n = nodeArray.length;
    if (n === 0) {
      return {
        algorithm: "pagerank",
        elapsed_ms: 0,
        nodeCount: 0,
        edgeCount: 0,
        result: { type: "centrality", data: { scores: [], stats: { min: 0, max: 0, avg: 0, median: 0 } } },
      };
    }

    let rank = new Map<string, number>();
    const initVal = 1 / n;
    for (const v of nodeArray) rank.set(v, initVal);

    for (let iter = 0; iter < iterations; iter++) {
      const newRank = new Map<string, number>();
      const sinkRank: number = nodeArray
        .filter((v) => (adj.outgoing.get(v) || []).length === 0)
        .reduce((sum, v) => sum + rank.get(v)!, 0);

      for (const v of nodeArray) {
        let incoming = 0;
        for (const { source } of adj.incoming.get(v) || []) {
          const outDeg = (adj.outgoing.get(source) || []).length;
          if (outDeg > 0) incoming += rank.get(source)! / outDeg;
        }
        newRank.set(v, (1 - damping) / n + damping * (incoming + sinkRank / n));
      }
      rank = newRank;
    }

    const scores: CentralityResult["scores"] = [];
    for (const [nodeId, val] of rank) {
      scores.push({ nodeId, score: Math.round(val * 100000) / 100000 });
    }
    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, 100);
    const vals = scores.map((s) => s.score);

    return {
      algorithm: "pagerank",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "centrality",
        data: { scores: topScores, stats: computeStats(vals) },
      },
    };
  }

  // ---- 9. Louvain Community Detection ----
  static louvain(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);
    const n = nodeArray.length;

    // Treat as undirected for Louvain
    const neighbors = new Map<string, Map<string, number>>();
    for (const v of nodeArray) neighbors.set(v, new Map());

    let totalWeight = 0;
    for (const e of data.edges) {
      const w = e.properties?.weight ?? 1;
      totalWeight += w;
      const a = neighbors.get(e.source)!;
      const b = neighbors.get(e.target)!;
      a.set(e.target, (a.get(e.target) || 0) + w);
      b.set(e.source, (b.get(e.source) || 0) + w);
    }

    const m = totalWeight || 1; // Total edge weight

    // Node → community
    const community = new Map<string, string>();
    for (const v of nodeArray) community.set(v, v);

    // Sum of weights of edges incident to node
    const kNode = new Map<string, number>();
    for (const v of nodeArray) {
      let k = 0;
      for (const [, w] of neighbors.get(v)!) k += w;
      kNode.set(v, k);
    }

    // Iterate
    let improved = true;
    let maxIter = 20;
    while (improved && maxIter-- > 0) {
      improved = false;
      for (const v of nodeArray) {
        const currentComm = community.get(v)!;

        // Compute weights to neighboring communities
        const commWeights = new Map<string, number>();
        let selfWeight = 0;
        for (const [nb, w] of neighbors.get(v)!) {
          const c = community.get(nb)!;
          if (c === currentComm) selfWeight += w;
          commWeights.set(c, (commWeights.get(c) || 0) + w);
        }

        // Compute sum_tot for each community candidate
        const commTot = new Map<string, number>();
        for (const u of nodeArray) {
          const c = community.get(u)!;
          if (commWeights.has(c) || c === currentComm) {
            commTot.set(c, (commTot.get(c) || 0) + kNode.get(u)!);
          }
        }

        const ki = kNode.get(v)!;
        let bestComm = currentComm;
        let bestDelta = 0;

        for (const [c, kIn] of commWeights) {
          if (c === currentComm) continue;
          const sumTotC = commTot.get(c) || 0;
          const sumTotCurr = commTot.get(currentComm) || 0;

          // ΔQ for moving v from currentComm to c
          const delta =
            (kIn - selfWeight) / m - ki * (sumTotC - (sumTotCurr - ki)) / (2 * m * m);

          if (delta > bestDelta) {
            bestDelta = delta;
            bestComm = c;
          }
        }

        if (bestComm !== currentComm) {
          community.set(v, bestComm);
          improved = true;
        }
      }
    }

    // Build communities map
    const communities: Record<string, string[]> = {};
    for (const [nodeId, comm] of community) {
      if (!communities[comm]) communities[comm] = [];
      communities[comm].push(nodeId);
    }

    // Number communities sequentially
    const renumbered: Record<string, string[]> = {};
    let idx = 0;
    for (const [, members] of Object.entries(communities)) {
      renumbered[`community_${idx}`] = members;
      idx++;
    }

    // Compute modularity
    let Q = 0;
    for (const e of data.edges) {
      if (community.get(e.source) === community.get(e.target)) {
        const w = e.properties?.weight ?? 1;
        Q += w - (kNode.get(e.source)! * kNode.get(e.target)!) / (2 * m);
      }
    }
    Q /= m;

    return {
      algorithm: "louvain",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "community",
        data: {
          communities: renumbered,
          communityCount: idx,
          modularity: Math.round(Q * 10000) / 10000,
        },
      },
    };
  }

  // ---- 10. Label Propagation ----
  static labelPropagation(data: GraphData, iterations: number = 10): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);

    // Initialize: each node is its own label
    const label = new Map<string, string>();
    for (const v of nodeArray) label.set(v, v);

    for (let iter = 0; iter < iterations; iter++) {
      let changed = false;
      // Random order each iteration
      const shuffled = shuffleArray([...nodeArray]);
      for (const v of shuffled) {
        // Count neighbor labels (undirected)
        const labelCount = new Map<string, number>();
        for (const { target } of adj.outgoing.get(v) || []) {
          const l = label.get(target)!;
          labelCount.set(l, (labelCount.get(l) || 0) + 1);
        }
        for (const { source } of adj.incoming.get(v) || []) {
          const l = label.get(source)!;
          labelCount.set(l, (labelCount.get(l) || 0) + 1);
        }

        if (labelCount.size === 0) continue;

        // Pick label with highest frequency
        let bestLabel = label.get(v)!;
        let bestCount = 0;
        for (const [l, c] of labelCount) {
          if (c > bestCount) {
            bestCount = c;
            bestLabel = l;
          }
        }

        if (bestLabel !== label.get(v)) {
          label.set(v, bestLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Build communities
    const communities: Record<string, string[]> = {};
    for (const [nodeId, l] of label) {
      if (!communities[l]) communities[l] = [];
      communities[l].push(nodeId);
    }

    const renumbered: Record<string, string[]> = {};
    let idx = 0;
    for (const [, members] of Object.entries(communities)) {
      renumbered[`community_${idx}`] = members;
      idx++;
    }

    return {
      algorithm: "label-propagation",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "community",
        data: { communities: renumbered, communityCount: idx, modularity: null },
      },
    };
  }

  // ---- 11. Connected Components (weak) ----
  static connectedComponents(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);
    const visited = new Set<string>();

    const communities: Record<string, string[]> = {};
    let compIdx = 0;

    for (const start of nodeArray) {
      if (visited.has(start)) continue;
      const members: string[] = [];
      const queue = [start];
      visited.add(start);

      while (queue.length > 0) {
        const v = queue.shift()!;
        members.push(v);
        // Undirected: follow both outgoing and incoming
        for (const { target } of adj.outgoing.get(v) || []) {
          if (!visited.has(target)) {
            visited.add(target);
            queue.push(target);
          }
        }
        for (const { source } of adj.incoming.get(v) || []) {
          if (!visited.has(source)) {
            visited.add(source);
            queue.push(source);
          }
        }
      }
      communities[`component_${compIdx}`] = members;
      compIdx++;
    }

    return {
      algorithm: "connected-components",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "community",
        data: { communities, communityCount: compIdx, modularity: null },
      },
    };
  }

  // ---- 12. Strongly Connected Components (Tarjan) ----
  static stronglyConnectedComponents(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);

    let index = 0;
    const nodeIndex = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const communities: Record<string, string[]> = {};
    let compIdx = 0;

    function strongConnect(v: string) {
      nodeIndex.set(v, index);
      lowLink.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);

      for (const { target: w } of adj.outgoing.get(v) || []) {
        if (!nodeIndex.has(w)) {
          strongConnect(w);
          lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
        } else if (onStack.has(w)) {
          lowLink.set(v, Math.min(lowLink.get(v)!, nodeIndex.get(w)!));
        }
      }

      if (lowLink.get(v) === nodeIndex.get(v)) {
        const members: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          members.push(w);
        } while (w !== v);
        communities[`scc_${compIdx}`] = members;
        compIdx++;
      }
    }

    for (const v of nodeArray) {
      if (!nodeIndex.has(v)) strongConnect(v);
    }

    return {
      algorithm: "strongly-connected-components",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "community",
        data: { communities, communityCount: compIdx, modularity: null },
      },
    };
  }

  // ---- 13. Topological Sort (Kahn's algorithm) ----
  static topologicalSort(data: GraphData): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);
    const nodeArray = Array.from(adj.nodes);

    const inDegree = new Map<string, number>();
    for (const v of nodeArray) inDegree.set(v, 0);
    for (const e of data.edges) {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }

    const queue: string[] = [];
    for (const [v, deg] of inDegree) {
      if (deg === 0) queue.push(v);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const v = queue.shift()!;
      order.push(v);
      for (const { target } of adj.outgoing.get(v) || []) {
        const newDeg = inDegree.get(target)! - 1;
        inDegree.set(target, newDeg);
        if (newDeg === 0) queue.push(target);
      }
    }

    const hasCycle = order.length < nodeArray.length;

    return {
      algorithm: "topological-sort",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "topologicalSort",
        data: { order, hasCycle },
      },
    };
  }

  // ---- 14. Cascading Failure Simulation ----
  static cascadingFailure(data: GraphData, sourceNode: string, threshold: number = 0.5): AlgorithmResult {
    const t0 = performance.now();
    const adj = buildAdjList(data);

    // Track failed nodes and propagation levels
    const failed = new Map<string, number>(); // nodeId → level at which it failed
    let currentFailed = [sourceNode];
    failed.set(sourceNode, 0);
    let level = 0;

    while (currentFailed.length > 0) {
      level++;
      const newFailed: string[] = [];

      for (const v of currentFailed) {
        for (const { target } of adj.outgoing.get(v) || []) {
          if (failed.has(target)) continue;
          // A node fails if >= threshold fraction of its incoming neighbors have failed
          const inNeighbors = adj.incoming.get(target) || [];
          const failedIncoming = inNeighbors.filter((n) => failed.has(n.source)).length;
          const ratio = inNeighbors.length > 0 ? failedIncoming / inNeighbors.length : 0;

          if (ratio >= threshold) {
            failed.set(target, level);
            newFailed.push(target);
          }
        }
      }
      currentFailed = newFailed;
    }

    const visitedNodes: TraversalResult["visitedNodes"] = [];
    for (const [nodeId, lvl] of failed) {
      visitedNodes.push({ nodeId, level: lvl, parent: null });
    }
    visitedNodes.sort((a, b) => a.level - b.level);

    return {
      algorithm: "cascading-failure",
      elapsed_ms: Math.round((performance.now() - t0) * 100) / 100,
      nodeCount: data.nodes.length,
      edgeCount: data.edges.length,
      result: {
        type: "traversal",
        data: {
          visitedNodes,
          visitedCount: visitedNodes.length,
          maxDepth: level > 0 ? level - 1 : 0,
        },
      },
    };
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function computeStats(values: number[]): { min: number; max: number; avg: number; median: number } {
  if (values.length === 0) return { min: 0, max: 0, avg: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10000) / 10000;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min, max, avg, median: Math.round(median * 10000) / 10000 };
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
