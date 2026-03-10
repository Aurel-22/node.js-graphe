import React, { useState, useCallback } from 'react';
import { graphApi, BenchmarkResult } from '../services/api';
import { GraphData } from '../types/graph';
import './LoadBenchmarkPanel.css';

interface Props {
  graphId?: string;
  database?: string;
  engine?: string;
  rawGraphData: GraphData | null;
}

const LoadBenchmarkPanel: React.FC<Props> = ({ graphId, database, engine, rawGraphData }) => {
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterations, setIterations] = useState(3);
  const [clientJsonTime, setClientJsonTime] = useState<number | null>(null);

  const runBenchmark = useCallback(async () => {
    if (!graphId) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Server-side benchmark (SQL vs Cache vs JSON.parse)
      const res = await graphApi.benchmarkGraph(graphId, database, engine as any, iterations);
      setResult(res);

      // 2. Client-side JSON measurement: re-serialize + parse from React state
      if (rawGraphData) {
        const jsonStr = JSON.stringify(rawGraphData);
        const times: number[] = [];
        for (let i = 0; i < iterations; i++) {
          const t0 = performance.now();
          JSON.parse(jsonStr);
          times.push(Math.round((performance.now() - t0) * 100) / 100);
        }
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        setClientJsonTime(Math.round(avg * 100) / 100);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Erreur benchmark');
    } finally {
      setLoading(false);
    }
  }, [graphId, database, engine, iterations, rawGraphData]);

  const formatMs = (ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const barWidth = (ms: number, maxMs: number) => {
    if (maxMs <= 0) return '2%';
    return `${Math.max(2, (ms / maxMs) * 100)}%`;
  };

  if (!graphId) {
    return (
      <div className="benchmark-panel">
        <div className="benchmark-empty">
          Sélectionnez un graphe pour exécuter le benchmark SQL vs JSON.
        </div>
      </div>
    );
  }

  return (
    <div className="benchmark-panel">
      <div className="benchmark-header">
        <h2>⏱ Benchmark : SQL vs Cache vs JSON</h2>
        <p className="benchmark-description">
          Compare le temps de chargement d'un graphe selon trois méthodes :
          <strong> requête SQL directe</strong> (bypass cache, interrogation BD à chaque appel),
          <strong> cache serveur</strong> (NodeCache en mémoire, TTL 5 min),
          et <strong> JSON mémoire</strong> (désérialisation JSON.parse uniquement, sans réseau).
        </p>
      </div>

      <div className="benchmark-controls">
        <label>
          Itérations :
          <input
            type="number"
            min={1}
            max={10}
            value={iterations}
            onChange={(e) => setIterations(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
          />
        </label>
        <button onClick={runBenchmark} disabled={loading}>
          {loading ? 'Benchmark en cours…' : 'Lancer le benchmark'}
        </button>
      </div>

      {error && <div className="benchmark-error">{error}</div>}

      {result && (
        <div className="benchmark-results">
          <div className="benchmark-meta">
            <span>Graphe : <strong>{result.graphId}</strong></span>
            <span>Moteur : <strong>{result.engine}</strong></span>
            <span>Base : <strong>{result.database}</strong></span>
            <span>Nœuds : <strong>{result.nodeCount.toLocaleString()}</strong></span>
            <span>Arêtes : <strong>{result.edgeCount.toLocaleString()}</strong></span>
            <span>Taille JSON : <strong>{result.jsonSizeKB} KB</strong></span>
          </div>

          {/* Bar chart comparison */}
          <div className="benchmark-chart">
            <h3>Temps moyen par méthode ({result.iterations} itérations)</h3>
            {(() => {
              const maxMs = Math.max(result.sql.avg, result.cache.avg, result.json.avg, clientJsonTime || 0);
              const methods = [
                { label: '🗄️ SQL direct', avg: result.sql.avg, min: result.sql.min, max: result.sql.max, color: '#e74c3c' },
                { label: '💾 Cache serveur', avg: result.cache.avg, min: result.cache.min, max: result.cache.max, color: '#f39c12' },
                { label: '📦 JSON serveur', avg: result.json.avg, min: result.json.min, max: result.json.max, color: '#2ecc71' },
              ];
              if (clientJsonTime !== null) {
                methods.push({ label: '🌐 JSON client', avg: clientJsonTime, min: clientJsonTime, max: clientJsonTime, color: '#3498db' });
              }
              return methods.map((m, i) => (
                <div key={i} className="benchmark-bar-row">
                  <div className="benchmark-bar-label">{m.label}</div>
                  <div className="benchmark-bar-container">
                    <div
                      className="benchmark-bar"
                      style={{ width: barWidth(m.avg, maxMs), backgroundColor: m.color }}
                    >
                      <span className="benchmark-bar-value">{formatMs(m.avg)}</span>
                    </div>
                  </div>
                  <div className="benchmark-bar-range">
                    min {formatMs(m.min)} — max {formatMs(m.max)}
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* Speedup indicators */}
          <div className="benchmark-speedup">
            <h3>Facteurs d'accélération</h3>
            <div className="speedup-cards">
              <div className="speedup-card">
                <div className="speedup-value">{result.speedup.cacheVsSql}×</div>
                <div className="speedup-label">Cache vs SQL</div>
                <div className="speedup-detail">
                  {formatMs(result.sql.avg)} → {formatMs(result.cache.avg)}
                </div>
              </div>
              <div className="speedup-card">
                <div className="speedup-value">{result.speedup.jsonVsSql}×</div>
                <div className="speedup-label">JSON vs SQL</div>
                <div className="speedup-detail">
                  {formatMs(result.sql.avg)} → {formatMs(result.json.avg)}
                </div>
              </div>
              {clientJsonTime !== null && result.sql.avg > 0 && (
                <div className="speedup-card">
                  <div className="speedup-value">
                    {Math.round(result.sql.avg / Math.max(clientJsonTime, 0.01) * 10) / 10}×
                  </div>
                  <div className="speedup-label">Client JSON vs SQL</div>
                  <div className="speedup-detail">
                    {formatMs(result.sql.avg)} → {formatMs(clientJsonTime)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Detail tables */}
          <div className="benchmark-detail-tables">
            <h3>Détail des itérations (ms)</h3>
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SQL direct</th>
                  <th>Cache serveur</th>
                  <th>JSON serveur</th>
                  {clientJsonTime !== null && <th>JSON client</th>}
                </tr>
              </thead>
              <tbody>
                {result.sql.times.map((_, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="time-sql">{formatMs(result.sql.times[i])}</td>
                    <td className="time-cache">{formatMs(result.cache.times[i])}</td>
                    <td className="time-json">{formatMs(result.json.times[i])}</td>
                    {clientJsonTime !== null && <td className="time-client">—</td>}
                  </tr>
                ))}
                <tr className="row-avg">
                  <td>Moy.</td>
                  <td className="time-sql">{formatMs(result.sql.avg)}</td>
                  <td className="time-cache">{formatMs(result.cache.avg)}</td>
                  <td className="time-json">{formatMs(result.json.avg)}</td>
                  {clientJsonTime !== null && <td className="time-client">{formatMs(clientJsonTime)}</td>}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Explanation */}
          <div className="benchmark-explanation">
            <h3>📊 Analyse des résultats</h3>
            <div className="explanation-content">
              <p>
                <strong>SQL direct</strong> est la méthode la plus lente car elle implique :
                requête SQL compilée et exécutée par le moteur de base de données,
                transfert des lignes résultat via le protocole TDS/Bolt,
                désérialisation des propriétés JSON côté serveur (<code>JSON.parse</code> par ligne),
                sérialisation de la réponse HTTP complète, puis transfert réseau.
              </p>
              <p>
                <strong>Cache serveur</strong> (NodeCache) élimine la requête SQL : les données
                sont directement récupérées depuis la mémoire du processus Node.js.
                Il reste la sérialisation JSON + le transfert HTTP.
              </p>
              <p>
                <strong>JSON mémoire</strong> est le plus rapide car il n'implique qu'une
                opération <code>JSON.parse</code> sur une chaîne déjà en mémoire — aucun réseau,
                aucune base de données, aucune compilation de requête.
              </p>
              <p className="conclusion">
                <strong>Conclusion :</strong> Pour un affichage interactif, pré-charger le graphe en JSON
                et le conserver en mémoire client est la stratégie optimale (pas de latence réseau).
                Le cache serveur est un bon compromis pour les premières charges. La requête SQL
                n'est nécessaire que lorsque les données doivent être fraîches.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoadBenchmarkPanel;
