import { useState, useEffect, useCallback } from 'react';
import { GraphList } from './components/GraphList';
import { GraphViewer } from './components/GraphViewer';
import SigmaGraphViewer from './components/SigmaGraphViewer';
import G6GraphViewer from './components/G6GraphViewer';
import D3GraphViewer from './components/D3GraphViewer';
import CytoscapeGraphViewer from './components/CytoscapeGraphViewer';
import VisNetworkViewer from './components/VisNetworkViewer';
import ForceGraph3DViewer from './components/ForceGraph3DViewer';
import ImpactAnalysis from './components/ImpactAnalysis';
import QueryPanel from './components/QueryPanel';
import AlgorithmPanel from './components/AlgorithmPanel';
import LoadBenchmarkPanel from './components/LoadBenchmarkPanel';
import { OptimPanel } from './components/OptimPanel';
import ExportPanel from './components/ExportPanel';
import GraphFormModal from './components/GraphFormModal';
import { graphApi, databaseApi, engineApi, cmdbApi, Database } from './services/api';
import { transformGraphData } from './services/graphTransform';
import { GraphSummary, ForceGraphData, GraphData } from './types/graph';
import { useTheme } from './hooks/useTheme';
import { useWebSocket, WsMessage } from './hooks/useWebSocket';
import './App.css';

type ViewerType = 'force-graph' | '3d' | 'sigma' | 'g6' | 'd3' | 'cytoscape' | 'vis-network' | 'impact' | 'query' | 'algorithms' | 'benchmark';
type LoadMode = 'sql' | 'cache' | 'json';

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
  const [selectedDatabase, setSelectedDatabase] = useState<string>('neo4j');
  const [availableEngines, setAvailableEngines] = useState<string[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [cmdbImporting, setCmdbImporting] = useState(false);
  const [loadMode, setLoadMode] = useState<LoadMode>('cache');
  const [lastLoadTime, setLastLoadTime] = useState<number | null>(null);
  const [lastLoadSource, setLastLoadSource] = useState<string>('');

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
        setSelectedDatabase(selectedEngine === 'mssql' ? 'graph_db' : 'neo4j');
      }
    } catch (err) {
      console.error('Failed to load databases:', err);
      // En cas d'erreur, utiliser une DB par défaut pour que les graphes se chargent quand même
      setDatabases([]);
      setSelectedDatabase(selectedEngine === 'mssql' ? 'graph_db' : 'neo4j');
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

      // Mode JSON mémoire : si les données sont déjà chargées pour ce graphe, on ne refait pas de requête
      if (loadMode === 'json' && rawGraphData && selectedGraphId === id) {
        const t0 = performance.now();
        const transformedData = transformGraphData(rawGraphData.nodes, rawGraphData.edges);
        setGraphData(transformedData);
        const elapsed = Math.round(performance.now() - t0);
        setLastLoadTime(elapsed);
        setLastLoadSource('JSON mémoire (aucun appel réseau)');
        setGraphLoading(false);
        return;
      }

      // Mode SQL : forcer nocache pour requêter la BDD à chaque fois
      // Mode Cache : utiliser le cache backend (comportement par défaut)
      const nocache = loadMode === 'sql';
      const t0 = performance.now();
      const result = await graphApi.getGraph(id, selectedDatabase, { nocache, engine: selectedEngine as any });
      const elapsed = Math.round(performance.now() - t0);

      // Envoyer le résultat au panneau d'optimisations
      (window as any).__optimSetLastLoad?.(result);
      setRawGraphData(result.data);
      const transformedData = transformGraphData(result.data.nodes, result.data.edges);
      setGraphData(transformedData);

      setLastLoadTime(elapsed);
      if (loadMode === 'sql') {
        setLastLoadSource(`SQL direct (${result.responseTimeHeader || elapsed + 'ms'} serveur, nocache)`);
      } else {
        setLastLoadSource(`Cache ${result.cacheStatus} (${result.responseTimeHeader || elapsed + 'ms'} serveur)`);
      }
    } catch (err) {
      console.error('Failed to load graph:', err);
      setError('Failed to load graph data');
      setGraphData(null);
      setRawGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  };

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

  const handleCmdbImport = async () => {
    setCmdbImporting(true);
    try {
      const result = await cmdbApi.importCmdb(800, selectedDatabase, selectedEngine as any);
      await loadGraphs();
      // Sélectionner le graphe importé automatiquement
      if (result?.id) {
        handleSelectGraph(result.id);
      }
      // Basculer en Sigma.js pour visualiser
      setViewerType('sigma');
    } catch (err: any) {
      console.error('CMDB import failed:', err);
      setError(err?.response?.data?.error || 'Échec de l\'import CMDB');
    } finally {
      setCmdbImporting(false);
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
            {/* G6 (AntV) — temporairement masqué
            <button
              className={viewerType === 'g6' ? 'active' : ''}
              onClick={() => setViewerType('g6')}
            >
              G6 (AntV)
            </button>
            */}
            <button
              className={viewerType === 'd3' ? 'active' : ''}
              onClick={() => setViewerType('d3')}
            >
              D3.js
            </button>
            {/* Cytoscape — temporairement masqué
            <button
              className={viewerType === 'cytoscape' ? 'active' : ''}
              onClick={() => setViewerType('cytoscape')}
            >
              Cytoscape
            </button>
            */}
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
              SQL / Cypher
            </button>
            <button
              className={viewerType === 'algorithms' ? 'active' : ''}
              onClick={() => setViewerType('algorithms')}
            >
              Algorithmes
            </button>
            {/* Benchmark tab — temporairement masqué
            <button
              className={viewerType === 'benchmark' ? 'active' : ''}
              onClick={() => setViewerType('benchmark')}
            >
              Benchmark
            </button>
            */}
          </div>
        </div>
        <div className="header-info">
          {/* Bouton Importer CMDB — temporairement masqué
          <button
            className="cmdb-import-btn"
            onClick={handleCmdbImport}
            disabled={cmdbImporting}
            title="Importer les CIs EasyVista comme graphe"
          >
            {cmdbImporting ? '⏳ Import...' : '📦 Importer CMDB'}
          </button>
          */}
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
          <button onClick={loadGraphs}>Retry</button>
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
        {viewerType === 'force-graph' ? (
          <GraphViewer
            data={graphData}
            title={selectedGraphTitle}
            loading={graphLoading}
          />
        ) : viewerType === '3d' ? (
          <div className="graph-viewer-container">
            {/* ExportPanel — temporairement masqué */}
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe 3D...</p>
              </div>
            ) : (
              <ForceGraph3DViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
            )}
          </div>
        ) : viewerType === 'sigma' ? (
          <div className="graph-viewer-container">
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <SigmaGraphViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
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
              <D3GraphViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
            )}
          </div>
        ) : viewerType === 'cytoscape' ? (
          <div className="graph-viewer-container">
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <CytoscapeGraphViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
            )}
          </div>
        ) : viewerType === 'vis-network' ? (
          <div className="graph-viewer-container">
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <VisNetworkViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
            )}
          </div>
        ) : viewerType === 'impact' ? (
          <div className="graph-viewer-container">
            {/* <ExportPanel data={rawGraphData} graphId={selectedGraphId || undefined} graphTitle={selectedGraphTitle} /> */}
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <ImpactAnalysis
                data={rawGraphData}
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
              data={rawGraphData}
              graphId={selectedGraphId || undefined}
              database={selectedDatabase || undefined}
              engine={selectedEngine || undefined}
            />
          </div>
        ) : viewerType === 'benchmark' ? (
          <div className="graph-viewer-container">
            <LoadBenchmarkPanel
              graphId={selectedGraphId || undefined}
              database={selectedDatabase || undefined}
              engine={selectedEngine || undefined}
              rawGraphData={rawGraphData}
            />
          </div>
        ) : (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <G6GraphViewer graphData={rawGraphData!} />
            )}
          </div>
        )}
      </div>

      {/* Panneau flottant des optimisations */}
      <OptimPanel
        currentGraphId={selectedGraphId ?? undefined}
        currentDatabase={selectedDatabase}
      />

      {/* Modal de création de graphe */}
      <GraphFormModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleGraphCreated}
        database={selectedDatabase}
        engine={selectedEngine}
      />
    </div>
  );
}

export default App;
