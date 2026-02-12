import { useState, useEffect } from 'react';
import { GraphList } from './components/GraphList';
import { GraphViewer } from './components/GraphViewer';
import SigmaGraphViewer from './components/SigmaGraphViewer';
import G6GraphViewer from './components/G6GraphViewer';
import ImpactAnalysis from './components/ImpactAnalysis';
import { graphApi, databaseApi, Database } from './services/api';
import { transformGraphData } from './services/graphTransform';
import { GraphSummary, ForceGraphData, GraphData } from './types/graph';
import './App.css';

type ViewerType = 'force-graph' | 'sigma' | 'g6' | 'impact';

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

  // Charger la liste des databases et graphes au démarrage
  useEffect(() => {
    loadDatabases();
    loadGraphs();
  }, []);

  // Recharger les graphes quand la database change
  useEffect(() => {
    if (selectedDatabase) {
      loadGraphs();
    }
  }, [selectedDatabase]);

  const loadDatabases = async () => {
    try {
      const data = await databaseApi.listDatabases();
      // Filtrer uniquement les databases online
      const onlineDatabases = data.filter(db => db.status === 'online');
      setDatabases(onlineDatabases);
    } catch (err) {
      console.error('Failed to load databases:', err);
      // En cas d'erreur, utiliser neo4j par défaut
      setDatabases([{ name: 'neo4j', default: true, status: 'online' }]);
    }
  };

  const loadGraphs = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await graphApi.listGraphs(selectedDatabase);
      setGraphs(data);
      
      // Sélectionner automatiquement le premier graphe (example)
      if (data.length > 0) {
        const exampleGraph = data.find(g => g.id === 'example') || data[0];
        handleSelectGraph(exampleGraph.id);
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
      
      const data = await graphApi.getGraph(id, selectedDatabase);
      setRawGraphData(data); // Stocker les données brutes pour sigma.js
      const transformedData = transformGraphData(data.nodes, data.edges);
      setGraphData(transformedData);
    } catch (err) {
      console.error('Failed to load graph:', err);
      setError('Failed to load graph data');
      setGraphData(null);
      setRawGraphData(null);
    } finally {
      setGraphLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>version demo</h1>
        <div className="header-center">
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
          <div className="viewer-toggle">
            <button
              className={viewerType === 'force-graph' ? 'active' : ''}
              onClick={() => setViewerType('force-graph')}
            >
              Force Graph
            </button>
            <button
              className={viewerType === 'sigma' ? 'active' : ''}
              onClick={() => setViewerType('sigma')}
            >
              Sigma.js
            </button>
            <button
              className={viewerType === 'g6' ? 'active' : ''}
              onClick={() => setViewerType('g6')}
            >
              G6 (AntV)
            </button>
            <button
              className={viewerType === 'impact' ? 'active' : ''}
              onClick={() => setViewerType('impact')}
            >
              Analyse d'impact
            </button>
          </div>
        </div>
        <div className="header-info">
          <span className="status">
            {error ? ' Disconnected' : ' Connected'}
          </span>
          <span className="backend-url">Backend: http://127.0.0.1:8080</span>
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
        />
        {viewerType === 'force-graph' ? (
          <GraphViewer
            data={graphData}
            title={selectedGraphTitle}
            loading={graphLoading}
          />
        ) : viewerType === 'sigma' ? (
          <div className="graph-viewer-container">
            {graphLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Chargement du graphe...</p>
              </div>
            ) : (
              <SigmaGraphViewer data={rawGraphData} graphId={selectedGraphId || undefined} />
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
              <ImpactAnalysis data={rawGraphData} graphId={selectedGraphId || undefined} />
            )}
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
    </div>
  );
}

export default App;
