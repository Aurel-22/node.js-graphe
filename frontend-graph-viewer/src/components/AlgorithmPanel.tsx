import { useState, useCallback, useMemo } from 'react';
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
  // Parcours
  { id: 'bfs', label: 'BFS', category: 'Parcours', needsSource: true, needsTarget: false, description: 'Parcours en largeur depuis un nœud source' },
  { id: 'dfs', label: 'DFS', category: 'Parcours', needsSource: true, needsTarget: false, description: 'Parcours en profondeur depuis un nœud source' },
  { id: 'bidirectional-bfs', label: 'BFS Bidirectionnel', category: 'Parcours', needsSource: true, needsTarget: true, description: 'Plus court chemin entre 2 nœuds (BFS bidirectionnel)' },
  { id: 'dijkstra', label: 'Dijkstra', category: 'Parcours', needsSource: true, needsTarget: false, description: 'Plus court chemin pondéré (optionnel: nœud cible)' },
  // Centralité
  { id: 'degree-centrality', label: 'Degree Centrality', category: 'Centralité', needsSource: false, needsTarget: false, description: 'Centralité de degré — CIs les plus connectés' },
  { id: 'betweenness-centrality', label: 'Betweenness Centrality', category: 'Centralité', needsSource: false, needsTarget: false, description: 'Centralité d\'intermédiarité (Brandes) — CIs critiques' },
  { id: 'closeness-centrality', label: 'Closeness Centrality', category: 'Centralité', needsSource: false, needsTarget: false, description: 'Centralité de proximité — CIs atteignant les autres rapidement' },
  { id: 'pagerank', label: 'PageRank', category: 'Centralité', needsSource: false, needsTarget: false, description: 'Importance récursive itérative' },
  // Communautés
  { id: 'louvain', label: 'Louvain', category: 'Communautés', needsSource: false, needsTarget: false, description: 'Détection de communautés par optimisation de modularité' },
  { id: 'label-propagation', label: 'Label Propagation', category: 'Communautés', needsSource: false, needsTarget: false, description: 'Clustering rapide par propagation d\'étiquettes' },
  { id: 'connected-components', label: 'Composantes Connexes', category: 'Communautés', needsSource: false, needsTarget: false, description: 'Composantes faiblement connexes (non-orienté)' },
  { id: 'strongly-connected-components', label: 'SCC (Tarjan)', category: 'Communautés', needsSource: false, needsTarget: false, description: 'Composantes fortement connexes — cycles de dépendances' },
  // Structure
  { id: 'topological-sort', label: 'Tri Topologique', category: 'Structure', needsSource: false, needsTarget: false, description: 'Ordre de déploiement (DAG) + détection de cycles' },
  { id: 'cascading-failure', label: 'Panne en Cascade', category: 'Résilience', needsSource: true, needsTarget: false, description: 'Simulation de propagation de panne' },
];

const CATEGORIES = ['Parcours', 'Centralité', 'Communautés', 'Structure', 'Résilience'];

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
      setError(err?.response?.data?.error || err.message || 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [graphId, selectedAlgo, sourceNode, targetNode, depth, iterations, damping, threshold, sampleSize, database, engine, algoConfig]);

  return (
    <div className="algorithm-panel">
      {/* Left: Algorithm selection */}
      <div className="algo-sidebar">
        <h3>Algorithmes</h3>
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
              <label>Nœud source</label>
              <input
                type="text"
                value={sourceNode}
                onChange={(e) => setSourceNode(e.target.value)}
                placeholder="ID du nœud source..."
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
              <label>Nœud cible {selectedAlgo === 'dijkstra' ? '(optionnel)' : ''}</label>
              <input
                type="text"
                value={targetNode}
                onChange={(e) => setTargetNode(e.target.value)}
                placeholder="ID du nœud cible..."
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
              <label>Profondeur max: {depth}</label>
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
              <label>Itérations: {iterations}</label>
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
              <label>Seuil de défaillance: {threshold}</label>
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
              <label>Échantillon (nœuds sources): {sampleSize}</label>
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
              <label>Rechercher un nœud</label>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filtrer les nœuds par id/label..."
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
          {loading ? '⏳ Calcul en cours...' : '▶ Exécuter'}
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
        <h3>Résultat — {result.algorithm}</h3>
        <div className="algo-meta">
          <span className="meta-chip">⏱ {result.elapsed_ms} ms</span>
          <span className="meta-chip">📊 {result.nodeCount} nœuds</span>
          <span className="meta-chip">🔗 {result.edgeCount} arêtes</span>
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
  const displayed = showAll ? data.visitedNodes : data.visitedNodes.slice(0, 100);

  // Group by level
  const byLevel = useMemo(() => {
    const map = new Map<number, Array<{ nodeId: string; parent: string | null }>>();
    for (const v of data.visitedNodes) {
      if (!map.has(v.level)) map.set(v.level, []);
      map.get(v.level)!.push(v);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [data.visitedNodes]);

  return (
    <div className="result-section">
      <div className="result-stats">
        <div className="stat-card">
          <span className="stat-value">{data.visitedCount}</span>
          <span className="stat-label">Nœuds visités</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.maxDepth}</span>
          <span className="stat-label">Profondeur max</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{byLevel.length}</span>
          <span className="stat-label">Niveaux</span>
        </div>
      </div>

      {algorithm === 'cascading-failure' && (
        <div className="cascade-summary">
          <p>
            <strong>{data.visitedCount}</strong> nœuds tombés sur{' '}
            <strong>{data.maxDepth}</strong> niveaux de propagation
          </p>
        </div>
      )}

      {/* Level breakdown */}
      <div className="level-breakdown">
        <h4>Répartition par niveau</h4>
        <div className="level-bars">
          {byLevel.map(([level, nodes]) => (
            <div key={level} className="level-bar-row">
              <span className="level-label">Niv. {level}</span>
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
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="result-table-container">
        <table className="result-table">
          <thead>
            <tr>
              <th>Nœud</th>
              <th>Label</th>
              <th>Niveau</th>
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
            Afficher les {data.visitedCount - 100} nœuds restants
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
          <span className="stat-label">Coût / Distance</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.path.length}</span>
          <span className="stat-label">Nœuds sur le chemin</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.exploredCount}</span>
          <span className="stat-label">Nœuds explorés</span>
        </div>
      </div>

      {data.path.length === 0 ? (
        <div className="no-path">Aucun chemin trouvé entre les deux nœuds.</div>
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
          <span className="stat-label">Moyenne</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.stats.median.toFixed(4)}</span>
          <span className="stat-label">Médiane</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{data.stats.min.toFixed(4)}</span>
          <span className="stat-label">Min</span>
        </div>
      </div>

      <h4>Top {data.scores.length} nœuds</h4>
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
          <summary>Voir les {data.scores.length - 30} suivants</summary>
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Nœud</th>
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
          <span className="stat-label">Communautés</span>
        </div>
        {data.modularity !== null && (
          <div className="stat-card">
            <span className="stat-value">{data.modularity.toFixed(4)}</span>
            <span className="stat-label">Modularité</span>
          </div>
        )}
        <div className="stat-card">
          <span className="stat-value">
            {sortedCommunities.length > 0 ? sortedCommunities[0][1].length : 0}
          </span>
          <span className="stat-label">Plus grande</span>
        </div>
      </div>

      {/* Size distribution */}
      <h4>Distribution des tailles</h4>
      <div className="community-grid">
        {sortedCommunities.map(([name, members], i) => (
          <details key={name} className="community-card">
            <summary>
              <span
                className="community-dot"
                style={{ backgroundColor: COMMUNITY_COLORS[i % COMMUNITY_COLORS.length] }}
              />
              {name} — <strong>{members.length}</strong> nœuds
            </summary>
            <div className="community-members">
              {members.slice(0, 50).map((mId) => (
                <span key={mId} className="member-chip" title={nodeMap.get(mId) || mId}>
                  {nodeMap.get(mId) || mId}
                </span>
              ))}
              {members.length > 50 && (
                <span className="member-more">+{members.length - 50} de plus</span>
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
          <span className="stat-label">Nœuds ordonnés</span>
        </div>
        <div className="stat-card">
          <span className={`stat-value ${data.hasCycle ? 'error' : 'success'}`}>
            {data.hasCycle ? 'OUI' : 'NON'}
          </span>
          <span className="stat-label">Cycle détecté</span>
        </div>
      </div>

      {data.hasCycle && (
        <div className="cycle-warning">
          ⚠️ Le graphe contient des cycles — le tri topologique est partiel ({data.order.length} nœuds sur le total).
        </div>
      )}

      <h4>Ordre de déploiement</h4>
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
          Afficher les {data.order.length - 100} nœuds restants
        </button>
      )}
    </div>
  );
};

export default AlgorithmPanel;
