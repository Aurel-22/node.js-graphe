import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cmdbApi } from '../services/api';
import type { GraphNode, GraphEdge, GraphData } from '../types/graph';
import './LevelExplorer.css';

interface LevelExplorerProps {
  onGraphData: (data: GraphData, title: string) => void;
  /** Si fourni, le composant démarre directement avec ces données (pas de recherche) */
  initialData?: GraphData | null;
  /** Label affiché pour la source des données */
  sourceLabel?: string;
}

interface LevelState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  frontierIds: number[]; // asset_ids of the last-added level
}

const LevelExplorer: React.FC<LevelExplorerProps> = ({ onGraphData, initialData, sourceLabel }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    asset_id: number; nom: string; nDeCI: string;
    type_label: string; type_id: number; degree: number;
  }>>([]);
  const [searching, setSearching] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [depth, setDepth] = useState(0);
  const [startNode, setStartNode] = useState<{ asset_id: number; nom: string } | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Accumulated state across levels
  const levelStateRef = useRef<LevelState>({
    nodes: new Map(),
    edges: new Map(),
    frontierIds: [],
  });
  // History for undo (-1)
  const historyRef = useRef<Array<{
    nodes: Map<string, GraphNode>;
    edges: Map<string, GraphEdge>;
    frontierIds: number[];
  }>>([]);

  // Initialize from external data (DATA_VALEO, subgraphs, etc.)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initialData || initialData.nodes.length === 0) return;
    // Only init once per initialData identity
    if (initializedRef.current) return;
    initializedRef.current = true;

    const state: LevelState = { nodes: new Map(), edges: new Map(), frontierIds: [] };
    for (const n of initialData.nodes) {
      state.nodes.set(n.id, n);
      const assetId = n.properties?.asset_id;
      if (assetId != null) state.frontierIds.push(assetId);
    }
    for (const e of initialData.edges) state.edges.set(`${e.source}->${e.target}`, e);

    levelStateRef.current = state;
    historyRef.current = [];
    setStartNode({ asset_id: 0, nom: sourceLabel || 'DATA_VALEO' });
    setDepth(0);
    setNodeCount(initialData.nodes.length);
    setEdgeCount(initialData.edges.length);
  }, [initialData, sourceLabel]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const results = await cmdbApi.searchCi(searchQuery.trim());
      setSearchResults(results);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erreur recherche');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const selectStartNode = useCallback(async (ci: { asset_id: number; nom: string }) => {
    setExpanding(true);
    setError(null);
    try {
      const result = await cmdbApi.expandCi([ci.asset_id]);
      const state: LevelState = {
        nodes: new Map(),
        edges: new Map(),
        frontierIds: [ci.asset_id],
      };
      for (const n of result.nodes) state.nodes.set(n.id, n);
      for (const e of result.edges) state.edges.set(`${e.source}->${e.target}`, e);

      levelStateRef.current = state;
      historyRef.current = [];
      setStartNode(ci);
      setDepth(0);
      setSearchResults([]);

      const nodes = Array.from(state.nodes.values());
      const nodeIdSet = new Set(nodes.map(n => n.id));
      const edges = Array.from(state.edges.values()).filter(
        e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
      );
      setNodeCount(nodes.length);
      setEdgeCount(edges.length);
      onGraphData({ nodes, edges }, `Explorer niv.0 — ${ci.nom} (${nodes.length} nœuds, ${edges.length} arêtes)`);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erreur chargement CI');
    } finally {
      setExpanding(false);
    }
  }, [onGraphData]);

  const expandLevel = useCallback(async () => {
    const state = levelStateRef.current;
    if (state.frontierIds.length === 0) return;
    setExpanding(true);
    setError(null);
    try {
      const result = await cmdbApi.expandCi(state.frontierIds);

      // Save history for undo
      historyRef.current.push({
        nodes: new Map(state.nodes),
        edges: new Map(state.edges),
        frontierIds: [...state.frontierIds],
      });

      // Find truly new nodes (not already in state)
      const newFrontierIds: number[] = [];
      for (const n of result.nodes) {
        if (!state.nodes.has(n.id)) {
          state.nodes.set(n.id, n);
          newFrontierIds.push(n.properties.asset_id);
        }
      }
      for (const e of result.edges) {
        const key = `${e.source}->${e.target}`;
        if (!state.edges.has(key)) state.edges.set(key, e);
      }
      state.frontierIds = newFrontierIds;

      const newDepth = depth + 1;
      setDepth(newDepth);

      const nodes = Array.from(state.nodes.values());
      const nodeIdSet = new Set(nodes.map(n => n.id));
      const edges = Array.from(state.edges.values()).filter(
        e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
      );
      setNodeCount(nodes.length);
      setEdgeCount(edges.length);
      onGraphData({ nodes, edges }, `Explorer niv.${newDepth} — ${startNode?.nom || '?'} (${nodes.length} nœuds, ${edges.length} arêtes)`);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erreur expansion');
    } finally {
      setExpanding(false);
    }
  }, [depth, startNode, onGraphData]);

  const collapseLevel = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    levelStateRef.current = {
      nodes: prev.nodes,
      edges: prev.edges,
      frontierIds: prev.frontierIds,
    };
    const newDepth = depth - 1;
    setDepth(newDepth);

    const nodes = Array.from(prev.nodes.values());
    const nodeIdSet = new Set(nodes.map(n => n.id));
    const edges = Array.from(prev.edges.values()).filter(
      e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    );
    setNodeCount(nodes.length);
    setEdgeCount(edges.length);
    onGraphData({ nodes, edges }, `Explorer niv.${newDepth} — ${startNode?.nom || '?'} (${nodes.length} nœuds, ${edges.length} arêtes)`);
  }, [depth, startNode, onGraphData]);

  const resetExplorer = useCallback(() => {
    levelStateRef.current = { nodes: new Map(), edges: new Map(), frontierIds: [] };
    historyRef.current = [];
    setStartNode(null);
    setDepth(0);
    setNodeCount(0);
    setEdgeCount(0);
    setSearchResults([]);
    setSearchQuery('');
    setError(null);
  }, []);

  const isExternalMode = !!initialData;

  return (
    <div className={`level-explorer ${isExternalMode ? 'le-compact' : ''}`}>
      <div className="level-explorer-header">
        <h3>{isExternalMode ? '📊 Expansion' : '🔎 Exploration par niveaux'}</h3>
        {startNode && !isExternalMode && (
          <button className="le-reset-btn" onClick={resetExplorer} title="Recommencer">
            ↺
          </button>
        )}
      </div>

      {error && <div className="le-error">{error}</div>}

      {!startNode && !isExternalMode ? (
        <div className="le-search">
          <div className="le-search-bar">
            <input
              type="text"
              placeholder="Rechercher un CI (nom ou tag)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            />
            <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? '...' : '🔍'}
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="le-results">
              {searchResults.map(ci => (
                <div
                  key={ci.asset_id}
                  className="le-result-item"
                  onClick={() => selectStartNode(ci)}
                >
                  <span className="le-ci-name">{ci.nom || ci.nDeCI}</span>
                  <span className="le-ci-meta">
                    {ci.type_label || 'CI'} — {ci.degree} liens
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : startNode ? (
        <div className="le-controls">
          {!isExternalMode && (
            <div className="le-start-info">
              CI départ : <strong>{startNode.nom}</strong>
            </div>
          )}
          <div className="le-depth-controls">
            <button
              className="le-btn le-btn-minus"
              onClick={collapseLevel}
              disabled={depth === 0 || expanding}
              title="Retirer le dernier niveau"
            >
              −1
            </button>
            <span className="le-depth-badge">
              Niveau {depth}
            </span>
            <button
              className="le-btn le-btn-plus"
              onClick={expandLevel}
              disabled={expanding}
              title="Ajouter les voisins du niveau suivant"
            >
              {expanding ? '⏳' : '+1'}
            </button>
          </div>
          <div className="le-stats">
            <span>{nodeCount} nœuds</span>
            <span>{edgeCount} arêtes</span>
            <span>= {nodeCount + edgeCount} total</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LevelExplorer;
