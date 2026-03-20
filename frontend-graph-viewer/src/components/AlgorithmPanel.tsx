import { useState, useCallback, useMemo, useEffect } from 'react';
import { GraphData } from '../types/graph';
import {
  algorithmApi,
  AlgorithmResult,
  EngineType,
  TraversalResult,
  ShortestPathResult,
  CentralityResultData,
  CommunityResultData,
  TopologicalSortResult,
} from '../services/api';
import './AlgorithmPanel.css';

interface AlgorithmPanelProps {
  data: GraphData | null;
  graphId?: string;
  database?: string;
  engine?: string;
}

interface AlgorithmConfig {
  id: string;
  label: string;
  category: string;
  needsSource: boolean;
  needsTarget: boolean;
  description: string;
}

const ALGORITHMS: AlgorithmConfig[] = [
  // Traversal
  { id: 'bfs', label: 'BFS', category: 'Traversal', needsSource: true, needsTarget: false, description: 'Breadth-first search from a source node' },
  { id: 'dfs', label: 'DFS', category: 'Traversal', needsSource: true, needsTarget: false, description: 'Depth-first search from a source node' },
  { id: 'bidirectional-bfs', label: 'Bidirectional BFS', category: 'Traversal', needsSource: true, needsTarget: true, description: 'Shortest path between 2 nodes (bidirectional BFS)' },
  { id: 'dijkstra', label: 'Dijkstra', category: 'Traversal', needsSource: true, needsTarget: false, description: 'Weighted shortest path (optional: target node)' },
  // Centrality
  { id: 'degree-centrality', label: 'Degree Centrality', category: 'Centrality', needsSource: false, needsTarget: false, description: 'Degree centrality — most connected CIs' },
  { id: 'betweenness-centrality', label: 'Betweenness Centrality', category: 'Centrality', needsSource: false, needsTarget: false, description: 'Betweenness centrality (Brandes) — critical CIs' },
  { id: 'closeness-centrality', label: 'Closeness Centrality', category: 'Centrality', needsSource: false, needsTarget: false, description: 'Closeness centrality — CIs reaching others quickly' },
  { id: 'pagerank', label: 'PageRank', category: 'Centrality', needsSource: false, needsTarget: false, description: 'Iterative recursive importance' },
  // Communities
  { id: 'louvain', label: 'Louvain', category: 'Communities', needsSource: false, needsTarget: false, description: 'Community detection by modularity optimization' },
  { id: 'label-propagation', label: 'Label Propagation', category: 'Communities', needsSource: false, needsTarget: false, description: 'Fast clustering by label propagation' },
  { id: 'connected-components', label: 'Connected Components', category: 'Communities', needsSource: false, needsTarget: false, description: 'Weakly connected components (undirected)' },
  { id: 'strongly-connected-components', label: 'SCC (Tarjan)', category: 'Communities', needsSource: false, needsTarget: false, description: 'Strongly connected components — dependency cycles' },
  // Structure
  { id: 'topological-sort', label: 'Topological Sort', category: 'Structure', needsSource: false, needsTarget: false, description: 'Deployment order (DAG) + cycle detection' },
  { id: 'cascading-failure', label: 'Cascading Failure', category: 'Resilience', needsSource: true, needsTarget: false, description: 'Failure propagation simulation' },
];

const CATEGORIES = ['Traversal', 'Centrality', 'Communities', 'Structure', 'Resilience'];

const AlgorithmPanel: React.FC<AlgorithmPanelProps> = ({ data, graphId, database, engine }) => {
  const [selectedAlgo, setSelectedAlgo] = useState<string>('bfs');
  const [sourceNode, setSourceNode] = useState<string>('');
  const [targetNode, setTargetNode] = useState<string>('');
  const [depth, setDepth] = useState<number>(100);
  const [iterations, setIterations] = useState<number>(20);
  const [damping, setDamping] = useState<number>(0.85);
  const [threshold, setThreshold] = useState<number>(0.5);
  const [sampleSize, setSampleSize] = useState<number>(100);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AlgorithmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const algoConfig = ALGORITHMS.find((a) => a.id === selectedAlgo);

  // Build searchable node list
  const nodeOptions = useMemo(() => {
    if (!data) return [];
    return data.nodes.map((n) => ({ id: n.id, label: n.label, type: n.node_type }));
  }, [data]);

  const filteredNodes = useMemo(() => {
    if (!searchFilter) return nodeOptions.slice(0, 50);
    const lower = searchFilter.toLowerCase();
    return nodeOptions
      .filter((n) => n.id.toLowerCase().includes(lower) || n.label.toLowerCase().includes(lower))
      .slice(0, 50);
  }, [nodeOptions, searchFilter]);

  const runAlgorithm = useCallback(async () => {
    if (!graphId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await algorithmApi.runAlgorithm(
        graphId,
        selectedAlgo,
        {
          sourceNode: algoConfig?.needsSource ? sourceNode : undefined,
          targetNode: algoConfig?.needsTarget || selectedAlgo === 'dijkstra' ? targetNode || undefined : undefined,
          depth,
          iterations,
          damping,
          threshold,
          sampleSize: selectedAlgo === 'betweenness-centrality' ? sampleSize : undefined,
        },
        database,
        engine as EngineType | undefined,
      );
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [graphId, selectedAlgo, sourceNode, targetNode, depth, iterations, damping, threshold, sampleSize, database, engine, algoConfig]);

  return (
    <div className="algorithm-panel">
      {/* Left: Algorithm selection */}
      <div className="algo-sidebar">
        <h3>Algorithms</h3>
        {CATEGORIES.map((cat) => (
          <div key={cat} className="algo-category">
            <h4>{cat}</h4>
            {ALGORITHMS.filter((a) => a.category === cat).map((algo) => (
              <button
                key={algo.id}
                className={`algo-btn ${selectedAlgo === algo.id ? 'active' : ''}`}
                onClick={() => setSelectedAlgo(algo.id)}
                title={algo.description}
              >
                {algo.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Center: Parameters + controls */}
      <div className="algo-main">
        <div className="algo-header">
          <h2>{algoConfig?.label || selectedAlgo}</h2>
          <p className="algo-description">{algoConfig?.description}</p>
        </div>

        <div className="algo-params">
          {/* Source node */}
          {algoConfig?.needsSource && (
            <div className="param-group">
              <label>Source node</label>
              <input
                type="text"
                value={sourceNode}
                onChange={(e) => setSourceNode(e.target.value)}
                placeholder="Source node ID..."
                list="source-nodes-list"
              />
              <datalist id="source-nodes-list">
                {filteredNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.type})
                  </option>
                ))}
              </datalist>
            </div>
          )}

          {/* Target node */}
          {(algoConfig?.needsTarget || selectedAlgo === 'dijkstra') && (
            <div className="param-group">
              <label>Target node {selectedAlgo === 'dijkstra' ? '(optional)' : ''}</label>
              <input
                type="text"
                value={targetNode}
                onChange={(e) => setTargetNode(e.target.value)}
                placeholder="Target node ID..."
                list="target-nodes-list"
              />
              <datalist id="target-nodes-list">
                {filteredNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.type})
                  </option>
                ))}
              </datalist>
            </div>
          )}

          {/* Depth */}
          {(selectedAlgo === 'bfs' || selectedAlgo === 'dfs') && (
            <div className="param-group">
              <label>Max depth: {depth}</label>
              <input
                type="range"
                min={1}
                max={200}
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value))}
              />
            </div>
          )}

          {/* Iterations (PageRank, Label Propagation) */}
          {(selectedAlgo === 'pagerank' || selectedAlgo === 'label-propagation') && (
            <div className="param-group">
              <label>Iterations: {iterations}</label>
              <input
                type="range"
                min={1}
                max={100}
                value={iterations}
                onChange={(e) => setIterations(parseInt(e.target.value))}
              />
            </div>
          )}

          {/* Damping (PageRank) */}
          {selectedAlgo === 'pagerank' && (
            <div className="param-group">
              <label>Damping factor: {damping}</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(damping * 100)}
                onChange={(e) => setDamping(parseInt(e.target.value) / 100)}
              />
            </div>
          )}

          {/* Threshold (Cascading failure) */}
          {selectedAlgo === 'cascading-failure' && (
            <div className="param-group">
              <label>Failure threshold: {threshold}</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(threshold * 100)}
                onChange={(e) => setThreshold(parseInt(e.target.value) / 100)}
              />
            </div>
          )}

          {/* Sample size (Betweenness) */}
          {selectedAlgo === 'betweenness-centrality' && (
            <div className="param-group">
              <label>Sample size (source nodes): {sampleSize}</label>
              <input
                type="range"
                min={10}
                max={Math.min(data?.nodes.length || 500, 500)}
                value={sampleSize}
                onChange={(e) => setSampleSize(parseInt(e.target.value))}
              />
            </div>
          )}

          {/* Node search filter */}
          {(algoConfig?.needsSource || algoConfig?.needsTarget) && (
            <div className="param-group">
              <label>Search for a node</label>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter nodes by id/label..."
              />
              <div className="node-chip-list">
                {filteredNodes.slice(0, 20).map((n) => (
                  <span
                    key={n.id}
                    className="node-chip"
                    onClick={() => {
                      if (algoConfig?.needsSource && !sourceNode) setSourceNode(n.id);
                      else if (algoConfig?.needsTarget || selectedAlgo === 'dijkstra') setTargetNode(n.id);
                      else setSourceNode(n.id);
                    }}
                    title={`${n.label} (${n.type})`}
                  >
                    {n.id}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          className="run-btn"
          onClick={runAlgorithm}
          disabled={loading || !graphId}
        >
          {loading ? '⏳ Computing...' : '▶ Run'}
        </button>

        {error && <div className="algo-error">{error}</div>}

        {/* Results */}
        {result && <AlgorithmResultView result={result} data={data} />}
      </div>
    </div>
  );
};

// ─── Result renderer ──────────────────────────────────

interface ResultViewProps {
  result: AlgorithmResult;
  data: GraphData | null;
}

const AlgorithmResultView: React.FC<ResultViewProps> = ({ result, data }) => {
  const nodeMap = useMemo(() => {
    const m = new Map<string, string>();
    if (data) {
      for (const n of data.nodes) m.set(n.id, n.label);
    }
    return m;
  }, [data]);

  return (
    <div className="algo-results">
      <div className="algo-results-header">
        <h3>Result — {result.algorithm}</h3>
        <div className="algo-meta">
          <span className="meta-chip">⏱ {result.elapsed_ms} ms</span>
          <span className="meta-chip">📊 {result.nodeCount} nodes</span>
          <span className="meta-chip">🔗 {result.edgeCount} edges</span>
        </div>
      </div>

      {result.result.type === 'traversal' && (
        <TraversalView data={result.result.data} nodeMap={nodeMap} algorithm={result.algorithm} />
      )}
      {result.result.type === 'shortestPath' && (
        <ShortestPathView data={result.result.data} nodeMap={nodeMap} />
      )}
      {result.result.type === 'centrality' && (
        <CentralityView data={result.result.data} nodeMap={nodeMap} />
      )}
      {result.result.type === 'community' && (
        <CommunityView data={result.result.data} nodeMap={nodeMap} />
      )}
      {result.result.type === 'topologicalSort' && (
        <TopologicalSortView data={result.result.data} nodeMap={nodeMap} />
      )}
    </div>
  );
};

// ─── Traversal view ──────────────────────────────────

const TraversalView: React.FC<{ data: TraversalResult; nodeMap: Map<string, string>; algorithm: string }> = ({
  data,
  nodeMap,
  algorithm,
}) => {
  const [showAll, setShowAll] = useState(false);
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set());
  const [expandedNodeChips, setExpandedNodeChips] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const displayed = showAll ? data.visitedNodes : data.visitedNodes.slice(0, 100);

  // Auto-clear toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const toggleLevel = useCallback((level: number) => {
    setExpandedLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  // Group by level
  const byLevel = useMemo(() => {
    const map = new Map<number, Array<{ nodeId: string; parent: string | null }>>();
    for (const v of data.visitedNodes) {
      if (!map.has(v.level)) map.set(v.level, []);
      map.get(v.level)!.push(v);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [data.visitedNodes]);

  // Build children lookup: parentId → list of children nodes
  const childrenMap = useMemo(() => {
    const map = new Map<string, Array<{ nodeId: string; level: number }>>();
    for (const v of data.visitedNodes) {
      if (v.parent) {
        if (!map.has(v.parent)) map.set(v.parent, []);
        map.get(v.parent)!.push({ nodeId: v.nodeId, level: v.level });
      }
    }
    return map;
  }, [data.visitedNodes]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    const children = childrenMap.get(nodeId);
    if (!children || children.length === 0) {
      setToastMessage('Pas de CI associé');
      return;
    }
    setExpandedNodeChips(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, [childrenMap]);

  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.visitedCount}</span>
          <span className="stat-label">Visited nodes</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.maxDepth}</span>
          <span className="stat-label">Max depth</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{byLevel.length}</span>
          <span className="stat-label">Levels</span>
        </div>
      </div>

      {algorithm === 'cascading-failure' && (
        <div className="cascade-summary">
          <p>
            <strong>{data.visitedCount}</strong> nodes failed across{' '}
            <strong>{data.maxDepth}</strong> propagation levels
          </p>
        </div>
      )}

      {/* Level breakdown */}
      <div className="level-breakdown">
        <h4>Breakdown by level <span className="level-hint">(click a level to expand nodes, double-click a node to show its neighbors)</span></h4>
        <div className="level-bars">
          {byLevel.map(([level, nodes]) => (
            <div key={level} className="level-group">
              <div
                className={`level-bar-row ${expandedLevels.has(level) ? 'expanded' : ''}`}
                onClick={() => toggleLevel(level)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && toggleLevel(level)}
              >
                <span className="level-expand-icon">{expandedLevels.has(level) ? '▾' : '▸'}</span>
                <span className="level-label">Lvl. {level}</span>
                <div className="level-bar-container">
                  <div
                    className="level-bar"
                    style={{
                      width: `${Math.min(100, (nodes.length / data.visitedCount) * 100)}%`,
                    }}
                  />
                </div>
                <span className="level-count">{nodes.length}</span>
              </div>
              {expandedLevels.has(level) && (
                <div className="level-nodes">
                  {nodes.map(n => (
                    <div key={n.nodeId} className="level-node-wrapper">
                      <span
                        className={`level-node-chip ${expandedNodeChips.has(n.nodeId) ? 'chip-expanded' : ''} ${childrenMap.has(n.nodeId) ? 'has-children' : ''}`}
                        title={`${nodeMap.get(n.nodeId) || n.nodeId} — double-click to expand neighbors`}
                        onDoubleClick={(e) => { e.stopPropagation(); handleNodeDoubleClick(n.nodeId); }}
                      >
                        <span className="node-chip-id">{n.nodeId}</span>
                        <span className="node-chip-label">{nodeMap.get(n.nodeId) || ''}</span>
                        {childrenMap.has(n.nodeId) && (
                          <span className="node-chip-expand-icon">{expandedNodeChips.has(n.nodeId) ? '▾' : '▸'}</span>
                        )}
                      </span>
                      {expandedNodeChips.has(n.nodeId) && childrenMap.get(n.nodeId) && (
                        <div className="node-children">
                          {childrenMap.get(n.nodeId)!.map(child => (
                            <span
                              key={child.nodeId}
                              className={`level-node-chip child-chip ${childrenMap.has(child.nodeId) ? 'has-children' : ''}`}
                              title={`${nodeMap.get(child.nodeId) || child.nodeId} (lvl ${child.level})`}
                              onDoubleClick={(e) => { e.stopPropagation(); handleNodeDoubleClick(child.nodeId); }}
                            >
                              <span className="node-chip-id">{child.nodeId}</span>
                              <span className="node-chip-label">{nodeMap.get(child.nodeId) || ''}</span>
                              {childrenMap.has(child.nodeId) && (
                                <span className="node-chip-expand-icon">▸</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Toast */}
        {toastMessage && (
          <div className="algo-toast">{toastMessage}</div>
        )}
      </div>

      {/* Table */}
      <div className="result-table-container">
        <table className="result-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Label</th>
              <th>Level</th>
              <th>Parent</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((v) => (
              <tr key={v.nodeId}>
                <td className="mono">{v.nodeId}</td>
                <td>{nodeMap.get(v.nodeId) || '—'}</td>
                <td className="center">{v.level}</td>
                <td className="mono">{v.parent || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.visitedCount > 100 && !showAll && (
          <button className="show-more-btn" onClick={() => setShowAll(true)}>
            Show {data.visitedCount - 100} remaining nodes
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Shortest path view ──────────────────────────────

const ShortestPathView: React.FC<{ data: ShortestPathResult; nodeMap: Map<string, string> }> = ({ data, nodeMap }) => {
  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.cost >= 0 ? data.cost : '∞'}</span>
          <span className="stat-label">Cost / Distance</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.path.length}</span>
          <span className="stat-label">Nodes on path</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.exploredCount}</span>
          <span className="stat-label">Explored nodes</span>
        </div>
      </div>

      {data.path.length === 0 ? (
        <div className="no-path">No path found between the two nodes.</div>
      ) : (
        <div className="path-chain">
          {data.path.map((nodeId, i) => (
            <span key={nodeId} className="path-node-wrapper">
              <span className="path-node">
                <span className="path-id">{nodeId}</span>
                <span className="path-label">{nodeMap.get(nodeId) || ''}</span>
              </span>
              {i < data.path.length - 1 && <span className="path-arrow">→</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Centrality view ─────────────────────────────────

const CentralityView: React.FC<{ data: CentralityResultData; nodeMap: Map<string, string> }> = ({ data, nodeMap }) => {
  const maxScore = data.scores.length > 0 ? data.scores[0].score : 1;

  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.stats.max.toFixed(4)}</span>
          <span className="stat-label">Max</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.stats.avg.toFixed(4)}</span>
          <span className="stat-label">Average</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.stats.median.toFixed(4)}</span>
          <span className="stat-label">Median</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.stats.min.toFixed(4)}</span>
          <span className="stat-label">Min</span>
        </div>
      </div>

      <h4>Top {data.scores.length} nodes</h4>
      <div className="centrality-bars">
        {data.scores.slice(0, 30).map((s, i) => (
          <div key={s.nodeId} className="centrality-row">
            <span className="centrality-rank">#{i + 1}</span>
            <span className="centrality-id mono" title={nodeMap.get(s.nodeId) || s.nodeId}>
              {nodeMap.get(s.nodeId) || s.nodeId}
            </span>
            <div className="centrality-bar-container">
              <div
                className="centrality-bar"
                style={{ width: `${maxScore > 0 ? (s.score / maxScore) * 100 : 0}%` }}
              />
            </div>
            <span className="centrality-score">{s.score.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {data.scores.length > 30 && (
        <details className="more-scores">
          <summary>Show next {data.scores.length - 30}</summary>
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Node</th>
                <th>Label</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {data.scores.slice(30).map((s, i) => (
                <tr key={s.nodeId}>
                  <td>{i + 31}</td>
                  <td className="mono">{s.nodeId}</td>
                  <td>{nodeMap.get(s.nodeId) || '—'}</td>
                  <td>{s.score.toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
};

// ─── Community view ──────────────────────────────────

const CommunityView: React.FC<{ data: CommunityResultData; nodeMap: Map<string, string> }> = ({ data, nodeMap }) => {
  const sortedCommunities = useMemo(() => {
    return Object.entries(data.communities)
      .sort((a, b) => b[1].length - a[1].length);
  }, [data.communities]);

  const COMMUNITY_COLORS = [
    '#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8',
    '#4dd0e1', '#aed581', '#ff8a65', '#f06292', '#7986cb',
    '#a1887f', '#90a4ae', '#dce775', '#ffd54f', '#4db6ac',
  ];

  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.communityCount}</span>
          <span className="stat-label">Communities</span>
        </div>
        {data.modularity !== null && (
          <div className="stat-card">
            <span className="stat-value">{data.modularity.toFixed(4)}</span>
            <span className="stat-label">Modularity</span>
          </div>
        )}
        <div className="stat-card">
          <span className="stat-value">
            {sortedCommunities.length > 0 ? sortedCommunities[0][1].length : 0}
          </span>
          <span className="stat-label">Largest</span>
        </div>
      </div>

      {/* Size distribution */}
      <h4>Size distribution</h4>
      <div className="community-grid">
        {sortedCommunities.map(([name, members], i) => (
          <details key={name} className="community-card">
            <summary>
              <span
                className="community-dot"
                style={{ backgroundColor: COMMUNITY_COLORS[i % COMMUNITY_COLORS.length] }}
              />
              {name} — <strong>{members.length}</strong> nodes
            </summary>
            <div className="community-members">
              {members.slice(0, 50).map((mId) => (
                <span key={mId} className="member-chip" title={nodeMap.get(mId) || mId}>
                  {nodeMap.get(mId) || mId}
                </span>
              ))}
              {members.length > 50 && (
                <span className="member-more">+{members.length - 50} more</span>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
};

// ─── Topological sort view ───────────────────────────

const TopologicalSortView: React.FC<{ data: TopologicalSortResult; nodeMap: Map<string, string> }> = ({
  data,
  nodeMap,
}) => {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? data.order : data.order.slice(0, 100);

  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.order.length}</span>
          <span className="stat-label">Ordered nodes</span>
        </div>
        <div className="stat-card">
          <span className={`stat-value ${data.hasCycle ? 'error' : 'success'}`}>
            {data.hasCycle ? 'YES' : 'NO'}
          </span>
          <span className="stat-label">Cycle detected</span>
        </div>
      </div>

      {data.hasCycle && (
        <div className="cycle-warning">
          ⚠️ The graph contains cycles — topological sort is partial ({data.order.length} nodes out of total).
        </div>
      )}

      <h4>Deployment order</h4>
      <div className="topo-order">
        {displayed.map((nodeId, i) => (
          <div key={nodeId} className="topo-item">
            <span className="topo-index">{i + 1}</span>
            <span className="topo-node mono">{nodeId}</span>
            <span className="topo-label">{nodeMap.get(nodeId) || ''}</span>
          </div>
        ))}
      </div>

      {data.order.length > 100 && !showAll && (
        <button className="show-more-btn" onClick={() => setShowAll(true)}>
          Show {data.order.length - 100} remaining nodes
        </button>
      )}
    </div>
  );
};

export default AlgorithmPanel;
