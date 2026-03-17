import { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { GraphList } from './components/GraphList';
import { OptimPanel } from './components/OptimPanel';
import ClassificationFilterPanel from './components/ClassificationFilterPanel';
import { graphApi, databaseApi, engineApi, cmdbApi, Database } from './services/api';
import { transformGraphData } from './services/graphTransform';
import { GraphSummary, ForceGraphData, GraphData } from './types/graph';
import { useTheme } from './hooks/useTheme';
import { useWebSocket, WsMessage } from './hooks/useWebSocket';
import './App.css';

// ── Lazy-loaded viewers (code splitting) ──
const GraphViewer = lazy(() => import('./components/GraphViewer').then(m => ({ default: m.GraphViewer })));
const SigmaGraphViewer = lazy(() => import('./components/SigmaGraphViewer'));
const D3GraphViewer = lazy(() => import('./components/D3GraphViewer'));
const VisNetworkViewer = lazy(() => import('./components/VisNetworkViewer'));
const ForceGraph3DViewer = lazy(() => import('./components/ForceGraph3DViewer'));
const ImpactAnalysis = lazy(() => import('./components/ImpactAnalysis'));
const QueryPanel = lazy(() => import('./components/QueryPanel'));
const AlgorithmPanel = lazy(() => import('./components/AlgorithmPanel'));
const CosmosViewer = lazy(() => import('./components/CosmosViewer'));
const SimulationPanel = lazy(() => import('./components/SimulationPanel'));
const LevelExplorer = lazy(() => import('./components/LevelExplorer'));
const GraphFormModal = lazy(() => import('./components/GraphFormModal'));

type ViewerType = 'force-graph' | '3d' | 'sigma' | 'sigma-optim' | 'cosmos' | 'd3' | 'vis-network' | 'impact' | 'query' | 'algorithms' | 'explorer' | 'simulation';

function App() {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<ForceGraphData | null>(null);
  const [rawGraphData, setRawGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [graphLoading, setGraphLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGraphTitle, setSelectedGraphTitle] = useState<string>('');
  const [viewerType, setViewerType] = useState<ViewerType>('force-graph');
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('graph_db');
  const [availableEngines, setAvailableEngines] = useState<string[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [lastLoadTime, setLastLoadTime] = useState<number | null>(null);
  const [lastLoadSource, setLastLoadSource] = useState<string>('');
  const [filteredGraphData, setFilteredGraphData] = useState<GraphData | null>(null);

  // ── Detailed timing breakdown ──
  const [timingBreakdown, setTimingBreakdown] = useState<{
    apiCall: number;
    transform: number;
    viewerRender: number | null;
  } | null>(null);
  const timingRef = useRef<{ apiCall: number; transform: number } | null>(null);

  // ── Theme toggle ──
  const { theme, toggleTheme } = useTheme();

  // ── WebSocket — rafraîchir la liste quand un graphe est créé/supprimé ──
  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'graph:created' || msg.type === 'graph:deleted') {
      // Recharger la liste si le message concerne la même engine/database
      loadGraphs();
    }
  }, []);
  useWebSocket(handleWsMessage);

  // Charger les engines disponibles au démarrage
  useEffect(() => {
    loadEngines();
  }, []);

  // Recharger databases quand l'engine change, puis les graphes se rechargeront
  // via l'effet [selectedDatabase] une fois la DB par défaut sélectionnée
  useEffect(() => {
    if (selectedEngine) {
      setSelectedDatabase('');  // reset pour forcer le rechargement même si même nom de DB
      loadDatabases();
    }
  }, [selectedEngine]);

  // Recharger les graphes quand la database change
  useEffect(() => {
    if (selectedDatabase) {
      loadGraphs();
    }
  }, [selectedDatabase]);

  const loadEngines = async () => {
    try {
      const info = await engineApi.getEngines();
      setAvailableEngines(info.available);
      setSelectedEngine(info.default);
    } catch (err) {
      console.error('Failed to load engines:', err);
      setError('Failed to connect to backend. Make sure the server is running on http://127.0.0.1:8080');
    }
  };

  const loadDatabases = async () => {
    try {
      const data = await databaseApi.listDatabases(selectedEngine as any);
      // Filtrer uniquement les databases online
      const onlineDatabases = data.filter(db => db.status === 'online');
      setDatabases(onlineDatabases);
      // Sélectionner la database par défaut de ce moteur
      const defaultDb = onlineDatabases.find(db => db.default) || onlineDatabases[0];
      if (defaultDb) {
        setSelectedDatabase(defaultDb.name);
      } else {
        // Pas de DB trouvée, utiliser un défaut raisonnable pour déclencher loadGraphs
        setSelectedDatabase('graph_db');
      }
    } catch (err) {
      console.error('Failed to load databases:', err);
      // En cas d'erreur, utiliser une DB par défaut pour que les graphes se chargent quand même
      setDatabases([]);
      setSelectedDatabase('graph_db');
    }
  };

  const loadGraphs = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await graphApi.listGraphs(selectedDatabase, selectedEngine as any);
      // Dédoublonner par id (les doublons peuvent exister côté DB)
      const seen = new Set<string>();
      const uniqueData = data.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });
      setGraphs(uniqueData);
      
      // Sélectionner automatiquement le premier graphe (example)
      if (data.length > 0) {
        const exampleGraph = data.find(g => g.id === 'example') || data[0];
        handleSelectGraph(exampleGraph.id);
      } else {
        setSelectedGraphId(null);
        setGraphData(null);
        setRawGraphData(null);
      }
    } catch (err) {
      console.error('Failed to load graphs:', err);
      setError('Failed to connect to backend. Make sure the server is running on http://127.0.0.1:8080');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGraph = async (id: string) => {
    try {
      setSelectedGraphId(id);
      setGraphLoading(true);
      setError(null);
      
      const selectedGraph = graphs.find(g => g.id === id);
      setSelectedGraphTitle(selectedGraph?.title || '');

      const t0 = performance.now();
      // Read optimization toggles from OptimPanel
      const isSigmaOptim = viewerType === 'sigma-optim';
      const optFormat = isSigmaOptim ? 'msgpack' as const : (window as any).__optimGetFormat?.();
      const optEnrich = isSigmaOptim ? true : ((window as any).__optimGetEnrich?.() || false);
      const result = await graphApi.getGraph(id, selectedDatabase, {
        nocache: true,
        engine: selectedEngine as any,
        format: optFormat,
        enrich: optEnrich,
      });
      const tApi = performance.now();

      // Envoyer le résultat au panneau d'optimisations
      (window as any).__optimSetLastLoad?.(result);
      setRawGraphData(result.data);
      const transformedData = transformGraphData(result.data.nodes, result.data.edges);
      setGraphData(transformedData);
      const tTransform = performance.now();

      const apiCall = Math.round(tApi - t0);
      const transform = Math.round(tTransform - tApi);
      const elapsed = apiCall + transform;

      timingRef.current = { apiCall, transform };
      setTimingBreakdown({ apiCall, transform, viewerRender: null });
      setLastLoadTime(elapsed);
      setLastLoadSource(`${result.cacheStatus === 'HIT' ? 'Cache' : 'SQL'} ${result.responseTimeHeader || ''} — ${selectedDatabase}`);
    } catch (err) {
      console.error('Failed to load graph:', err);
      setError('Failed to load graph data');
      setGraphData(null);
      setRawGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  };

  const handleRenderComplete = useCallback((renderTimeMs: number) => {
    const prev = timingRef.current;
    if (prev) {
      const total = prev.apiCall + prev.transform + Math.round(renderTimeMs);
      setTimingBreakdown({ ...prev, viewerRender: Math.round(renderTimeMs) });
      setLastLoadTime(total);
    }
  }, []);

  const handleDeleteGraph = async (id: string, _title: string) => {
    try {
      await graphApi.deleteGraph(id, selectedDatabase, selectedEngine as any);
      // Si le graphe supprimé est celui sélectionné, déselectionner
      if (selectedGraphId === id) {
        setSelectedGraphId(null);
        setGraphData(null);
        setRawGraphData(null);
      }
      await loadGraphs();
    } catch (err) {
      console.error('Failed to delete graph:', err);
      setError('Échec de la suppression du graphe');
    }
  };

  const handleDeduplicateGraphs = async () => {
    // Garder le premier occurrence de chaque titre, supprimer les suivantes
    const seen = new Map<string, string>(); // title → first id kept
    const toDelete: string[] = [];
    for (const g of graphs) {
      const key = g.title.trim().toLowerCase();
      if (seen.has(key)) {
        toDelete.push(g.id);
      } else {
        seen.set(key, g.id);
      }
    }
    if (toDelete.length === 0) return;
    if (!window.confirm(`Supprimer ${toDelete.length} graphe(s) en double ?`)) return;
    try {
      for (const id of toDelete) {
        await graphApi.deleteGraph(id, selectedDatabase, selectedEngine as any);
        if (selectedGraphId === id) {
          setSelectedGraphId(null);
          setGraphData(null);
          setRawGraphData(null);
        }
      }
      await loadGraphs();
    } catch (err) {
      console.error('Failed to deduplicate graphs:', err);
      setError('Échec de la déduplication');
    }
  };

  const handleGraphCreated = async () => {
    await loadGraphs();
  };

  const [valeoLoading, setValeoLoading] = useState(false);
  const handleViewValeo = async () => {
    setValeoLoading(true);
    setError(null);
    setGraphs([]);
    setSelectedGraphId(null);
    try {
      const t0 = performance.now();
      const result = await cmdbApi.viewValeo('cluster', 10, 800);
      const elapsed = Math.round(performance.now() - t0);
      setRawGraphData({ nodes: result.nodes, edges: result.edges });
      setGraphData(transformGraphData(result.nodes, result.edges));
      setSelectedGraphId(null);
      setSelectedGraphTitle(`DATA_VALEO live (${result.nodes.length} nœuds, ${result.edges.length} relations) — ${elapsed} ms`);
      setLastLoadTime(elapsed);
      setLastLoadSource('DATA_VALEO direct');
      setFilteredGraphData(null);
      setViewerType('sigma');
    } catch (err: any) {
      console.error('DATA_VALEO view failed:', err);
      setError(err?.response?.data?.error || 'Échec lecture DATA_VALEO');
    } finally {
      setValeoLoading(false);
    }
  };

  const handleViewValeoSubgraph = async (types: string) => {
    setValeoLoading(true);
    setError(null);
    try {
      const t0 = performance.now();
      const result = await cmdbApi.viewValeo('subgraph', 10, 600000, types);
      const elapsed = Math.round(performance.now() - t0);
      setRawGraphData({ nodes: result.nodes, edges: result.edges });
      setGraphData(transformGraphData(result.nodes, result.edges));
      setSelectedGraphId(null);
      setSelectedGraphTitle(`DATA_VALEO sous-graphe (${result.nodes.length} nœuds, ${result.edges.length} arêtes) — ${elapsed} ms`);
      setLastLoadTime(elapsed);
      setLastLoadSource('DATA_VALEO subgraph');
      setFilteredGraphData(null);
      setViewerType('sigma');
    } catch (err: any) {
      console.error('DATA_VALEO subgraph failed:', err);
      setError(err?.response?.data?.error || 'Échec chargement sous-graphe');
    } finally {
      setValeoLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>version demo</h1>
        <div className="header-center">
          <div className="engine-selector">
            <label htmlFor="engine-select">Engine:</label>
            <select
              id="engine-select"
              value={selectedEngine}
              onChange={(e) => setSelectedEngine(e.target.value)}
            >
              {availableEngines.map((eng) => (
                <option key={eng} value={eng}>
                  {eng}
                </option>
              ))}
            </select>
          </div>
          <div className="database-selector">
            <label htmlFor="database-select">Database:</label>
            <select
              id="database-select"
              value={selectedDatabase}
              onChange={(e) => setSelectedDatabase(e.target.value)}
            >
              {databases.map((db) => (
                <option key={db.name} value={db.name}>
                  {db.name} {db.default ? '(default)' : ''}
                </option>
              ))}
            </select>
          </div>
          {/* Sélecteur de mode de chargement — temporairement masqué
          <div className="database-selector">
            <label htmlFor="load-mode-select">Chargement:</label>
            <select
              id="load-mode-select"
              value={loadMode}
              onChange={(e) => setLoadMode(e.target.value as LoadMode)}
            >
              <option value="sql">SQL direct</option>
              <option value="cache">Cache serveur</option>
              <option value="json">JSON mémoire</option>
            </select>
            {lastLoadTime !== null && (
              <span className="load-timing" title={lastLoadSource}>
                {lastLoadTime} ms
              </span>
            )}
          </div>
          */}
          <div className="viewer-toggle">
            <button
              className={viewerType === 'force-graph' ? 'active' : ''}
              onClick={() => setViewerType('force-graph')}
            >
              Force Graph
            </button>
            <button
              className={viewerType === '3d' ? 'active' : ''}
              onClick={() => setViewerType('3d')}
            >
              3D Graph
            </button>
            <button
              className={viewerType === 'sigma' ? 'active' : ''}
              onClick={() => setViewerType('sigma')}
            >
              Sigma.js
            </button>
            <button
              className={viewerType === 'sigma-optim' ? 'active' : ''}
              onClick={() => setViewerType('sigma-optim')}
              title="Sigma.js + MessagePack + Enrichissement + Covering Indexes"
            >
              Sigma ⚡
            </button>
            <button
              className={viewerType === 'cosmos' ? 'active' : ''}
              onClick={() => setViewerType('cosmos')}
            >
              Cosmos (GPU)
            </button>
            <button
              className={viewerType === 'd3' ? 'active' : ''}
              onClick={() => setViewerType('d3')}
            >
              D3.js
            </button>
            <button
              className={viewerType === 'vis-network' ? 'active' : ''}
              onClick={() => setViewerType('vis-network')}
            >
              vis-network
            </button>
            <button
              className={viewerType === 'impact' ? 'active' : ''}
              onClick={() => setViewerType('impact')}
            >
              Analyse d'impact
            </button>
            <button
              className={viewerType === 'query' ? 'active' : ''}
              onClick={() => setViewerType('query')}
            >
              SQL Query
            </button>
            <button
              className={viewerType === 'algorithms' ? 'active' : ''}
              onClick={() => setViewerType('algorithms')}
            >
              Algorithmes
            </button>
            <button
              className={viewerType === 'explorer' ? 'active' : ''}
              onClick={() => setViewerType('explorer')}
            >
              Explorer
            </button>
            <button
              className={viewerType === 'simulation' ? 'active' : ''}
              onClick={() => setViewerType('simulation')}
              title="Compare toutes les combinaisons d'optimisations"
            >
              🧪 Simulation
            </button>
          </div>
        </div>
        <div className="header-info">
          {selectedDatabase === 'DATA_VALEO' && (
          <select
            className="subgraph-select"
            onChange={(e) => {
              if (e.target.value) handleViewValeoSubgraph(e.target.value);
              e.target.value = '';
            }}
            disabled={valeoLoading}
            title="Charger un sous-graphe DATA_VALEO (20K-53K éléments)"
          >
            <option value="">📊 Sous-graphes</option>
            <option value="318,317,262,347,346,343,359">B — 22K (7 types connectés)</option>
            <option value="318,317,262,347,346,246,343,359">A — 30K (8 types connectés)</option>
            <option value="318,317,262,347,346,246,343,359,321,293,291,342,308,358">C — 53K (tous petits types)</option>
          </select>
          )}
          {lastLoadTime !== null && (
            <span className="load-timing" title={lastLoadSource}>
              ⏱ {lastLoadTime} ms
              {timingBreakdown && (
                <small style={{ marginLeft: 6, opacity: 0.85 }}>
                  (API {timingBreakdown.apiCall}ms + Transform {timingBreakdown.transform}ms
                  {timingBreakdown.viewerRender !== null
                    ? ` + Render ${timingBreakdown.viewerRender}ms`
                    : ' + Render...'}
                  )
                </small>
              )}
              {!timingBreakdown && lastLoadSource && <small> ({lastLoadSource})</small>}
            </span>
          )}
          <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <span className="status">
            {error ? ' Disconnected' : ' Connected'}
          </span>
          <span className="backend-url">Backend: http://172.23.0.162:8080</span>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span> {error}</span>
          <button onClick={() => selectedDatabase === 'DATA_VALEO' ? handleViewValeo() : loadGraphs()}>Retry</button>
        </div>
      )}

      <div className="app-content">
        <GraphList
          graphs={graphs}
          selectedGraphId={selectedGraphId}
          onSelectGraph={handleSelectGraph}
          loading={loading}
          onCreateGraph={() => setShowCreateModal(true)}
          onDeleteGraph={handleDeleteGraph}
            onDeduplicateGraphs={graphs.some((g, i) => graphs.findIndex(x => x.title.trim().toLowerCase() === g.title.trim().toLowerCase()) !== i) ? handleDeduplicateGraphs : undefined}
        />
        <Suspense fallback={<div className="graph-viewer-container"><div className="loading-state"><div className="spinner"></div><p>Chargement du viewer...</p></div></div>}>
        {viewerType === 'force-graph' ? (
          <GraphViewer
            data={filteredGraphData ? transformGraphData(filteredGraphData.nodes, filteredGraphData.edges) : graphData}
            title={selectedGraphTitle}
            loading={graphLoading}
            onRenderComplete={handleRenderComplete}
          />
        ) : viewerType === '3d' ? (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe 3D...</p>
              </div>
            ) : (
              <ForceGraph3DViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} onRenderComplete={handleRenderComplete} />
            )}
          </div>
        ) : viewerType === 'sigma' || viewerType === 'sigma-optim' ? (
          <div className="graph-viewer-container">
            {graphLoading || valeoLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>{valeoLoading ? 'Chargement DATA_VALEO...' : viewerType === 'sigma-optim' ? 'Chargement optimisé (MsgPack + Enrichissement)...' : 'Chargement du graphe...'}</p>
              </div>
            ) : (
              <SigmaGraphViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} onRenderComplete={handleRenderComplete} />
            )}
            {selectedGraphTitle.includes('DATA_VALEO') && rawGraphData && rawGraphData.nodes.length > 0 && (
              <LevelExplorer
                initialData={rawGraphData}
                sourceLabel={selectedGraphTitle}
                onGraphData={(data, title) => {
                  setRawGraphData(data);
                  setGraphData(transformGraphData(data.nodes, data.edges));
                  setSelectedGraphId(null);
                  setSelectedGraphTitle(title);
                  setFilteredGraphData(null);
                }}
              />
            )}
          </div>
        ) : viewerType === 'cosmos' ? (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe (GPU)...</p>
              </div>
            ) : (
              <CosmosViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} database={selectedDatabase || undefined} engine={selectedEngine || undefined} onRenderComplete={handleRenderComplete} />
            )}
          </div>
        ) : viewerType === 'd3' ? (
          <div className="graph-viewer-container">
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <D3GraphViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} onRenderComplete={handleRenderComplete} />
            )}
          </div>
        ) : viewerType === 'vis-network' ? (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <VisNetworkViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} onRenderComplete={handleRenderComplete} />
            )}
          </div>
        ) : viewerType === 'impact' ? (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <ImpactAnalysis
                data={filteredGraphData || rawGraphData}
                graphId={selectedGraphId || undefined}
                database={selectedDatabase || undefined}
                engine={selectedEngine || undefined}
              />
            )}
          </div>
        ) : viewerType === 'query' ? (
          <div className="graph-viewer-container">
            <QueryPanel
              graphId={selectedGraphId || undefined}
              database={selectedDatabase || undefined}
              engine={selectedEngine || undefined}
            />
          </div>
        ) : viewerType === 'algorithms' ? (
          <div className="graph-viewer-container">
            <AlgorithmPanel
              data={filteredGraphData || rawGraphData}
              graphId={selectedGraphId || undefined}
              database={selectedDatabase || undefined}
              engine={selectedEngine || undefined}
            />
          </div>
        ) : viewerType === 'explorer' ? (
          <div className="graph-viewer-container">
            <LevelExplorer
              onGraphData={(data, title) => {
                setRawGraphData(data);
                setGraphData(transformGraphData(data.nodes, data.edges));
                setSelectedGraphId(null);
                setSelectedGraphTitle(title);
                setFilteredGraphData(null);
              }}
            />
            {rawGraphData && rawGraphData.nodes.length > 0 ? (
              <SigmaGraphViewer data={filteredGraphData || rawGraphData} graphId={selectedGraphId || undefined} onRenderComplete={handleRenderComplete} />
            ) : (
              <div className="loading-state">
                <p>🔎 Recherchez un CI pour commencer l'exploration</p>
              </div>
            )}
          </div>
        ) : viewerType === 'simulation' ? (
          <div className="graph-viewer-container">
            <SimulationPanel
              graphId={selectedGraphId || undefined}
              database={selectedDatabase || undefined}
              engine={selectedEngine || undefined}
              graphs={graphs}
              databases={databases}
            />
          </div>
        ) : null}
        </Suspense>
      </div>

      {/* Panneau de filtrage par classification */}
      <ClassificationFilterPanel
        data={rawGraphData}
        onFilteredData={setFilteredGraphData}
      />

      {/* Panneau flottant des optimisations */}
      <OptimPanel
        currentGraphId={selectedGraphId ?? undefined}
        currentDatabase={selectedDatabase}
      />

      {/* Modal de création de graphe */}
      {showCreateModal && (
        <Suspense fallback={null}>
          <GraphFormModal
            open={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onCreated={handleGraphCreated}
            database={selectedDatabase}
            engine={selectedEngine}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
