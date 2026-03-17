import React, { useState, useMemo } from 'react';
import { graphApi, optimApi, GraphLoadResult, Database } from '../services/api';
import { GraphSummary } from '../types/graph';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { generateColorFromString } from '../services/graphTransform';
import './SimulationPanel.css';

interface SimulationPanelProps {
  graphId?: string;
  database?: string;
  engine?: string;
  graphs?: GraphSummary[];
  databases?: Database[];
}

interface ComboResult {
  label: string;
  options: { nocache: boolean; format: 'json' | 'msgpack'; enrich: boolean; nocompress: boolean };
  times: number[];
  avg: number;
  min: number;
  max: number;
  sizeKb: number | null;
  compressedKb: number | null;
  cacheStatus: string;
  rank?: number;
  graphLabel?: string;
}

interface LayoutResult {
  label: string;
  barnesHut: boolean;
  layoutIterations: number;
  times: number[];
  avg: number;
  min: number;
  max: number;
  nodeCount: number;
  edgeCount: number;
}

interface CosmosResult {
  label: string;
  nodeCount: number;
  edgeCount: number;
  prepTimeMs: number;
  graphLabel?: string;
}

interface ComboSpec {
  label: string;
  nocache: boolean;
  format: 'json' | 'msgpack';
  enrich: boolean;
  nocompress: boolean;
  compress?: 'gzip' | 'brotli';
  forjson?: boolean;
  stream?: boolean;
}

function buildCombos(includeCompression: boolean, includeForJson: boolean, includeStream: boolean): ComboSpec[] {
  const base: Array<{ label: string; nocache: boolean; format: 'json' | 'msgpack'; enrich: boolean }> = [
    // Avec cache
    { label: 'Cache + JSON',                  nocache: false, format: 'json',    enrich: false },
    { label: 'Cache + JSON + Enrich',         nocache: false, format: 'json',    enrich: true  },
    { label: 'Cache + MsgPack',               nocache: false, format: 'msgpack', enrich: false },
    { label: 'Cache + MsgPack + Enrich',      nocache: false, format: 'msgpack', enrich: true  },
    // Sans cache (SQL directe)
    { label: 'SQL + JSON',                    nocache: true,  format: 'json',    enrich: false },
    { label: 'SQL + JSON + Enrich',           nocache: true,  format: 'json',    enrich: true  },
    { label: 'SQL + MsgPack',                 nocache: true,  format: 'msgpack', enrich: false },
    { label: 'SQL + MsgPack + Enrich',        nocache: true,  format: 'msgpack', enrich: true  },
  ];

  let combos: ComboSpec[];
  if (!includeCompression) {
    combos = base.map(c => ({ ...c, nocompress: false }));
  } else {
    // Triple: Gzip + Brotli + brut
    combos = [];
    for (const c of base) {
      combos.push({ ...c, nocompress: false, compress: 'gzip', label: c.label + ' + Gzip' });
      combos.push({ ...c, nocompress: false, compress: 'brotli', label: c.label + ' + Brotli' });
      combos.push({ ...c, nocompress: true, label: c.label + ' (brut)' });
    }
  }

  // FOR JSON PATH combos (SQL-only, JSON format only)
  if (includeForJson) {
    combos.push({ label: 'FOR JSON PATH', nocache: true, format: 'json', enrich: false, nocompress: false, forjson: true });
    combos.push({ label: 'FOR JSON PATH + Enrich', nocache: true, format: 'json', enrich: true, nocompress: false, forjson: true });
  }

  // Streaming HTTP combos (SQL-only, JSON format only)
  if (includeStream) {
    combos.push({ label: 'Streaming HTTP', nocache: true, format: 'json', enrich: false, nocompress: false, stream: true });
  }

  return combos;
}

const SimulationPanel: React.FC<SimulationPanelProps> = ({ graphId, database, engine, graphs = [], databases = [] }) => {
  const [iterations, setIterations] = useState(5);
  const [results, setResults] = useState<ComboResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [coveringIndexes, setCoveringIndexes] = useState<boolean | null>(null);
  const [testCovering, setTestCovering] = useState(false);
  const [sortBy, setSortBy] = useState<'avg' | 'min' | 'max'>('avg');
  const [testBarnesHut, setTestBarnesHut] = useState(false);
  const [layoutResults, setLayoutResults] = useState<LayoutResult[]>([]);
  const [layoutIterations, setLayoutIterations] = useState(30);
  const [testCompression, setTestCompression] = useState(false);
  const [testCosmos, setTestCosmos] = useState(false);
  const [cosmosResults, setCosmosResults] = useState<CosmosResult[]>([]);
  const [multiGraph, setMultiGraph] = useState(false);
  const [selectedGraphIds, setSelectedGraphIds] = useState<string[]>([]);
  const [testMultiDatabase, setTestMultiDatabase] = useState(false);
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [testForJson, setTestForJson] = useState(false);
  const [testStream, setTestStream] = useState(false);

  const combos = useMemo(() => buildCombos(testCompression, testForJson, testStream), [testCompression, testForJson, testStream]);
  const sqlComboCount = combos.filter(c => c.nocache).length;
  const comboCount = combos.length + (testCovering ? sqlComboCount : 0);
  const graphsToTest = multiGraph && selectedGraphIds.length > 0
    ? selectedGraphIds
    : graphId ? [graphId] : [];
  const databasesToTest = testMultiDatabase && selectedDatabases.length > 0
    ? selectedDatabases
    : database ? [database] : ['default'];
  const totalCalls = comboCount * iterations * graphsToTest.length * databasesToTest.length;

  // Yield to browser so React can render progress & page stays responsive
  const yieldToBrowser = () => new Promise<void>(r => setTimeout(r, 0));

  const runSimulation = async () => {
    if (graphsToTest.length === 0) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setLayoutResults([]);
    setCosmosResults([]);

    try {
      // Check covering indexes status
      let hasIndexes = false;
      try {
        const ci = await optimApi.hasCoveringIndexes(database);
        hasIndexes = ci.coveringIndexes;
        setCoveringIndexes(hasIndexes);
      } catch { setCoveringIndexes(null); }

      const allResults: ComboResult[] = [];

      // Helper: find graph title
      const graphLabel = (gid: string) => {
        const g = graphs.find(gr => gr.id === gid);
        return g ? `${g.title} (${g.node_count}n/${g.edge_count}e)` : gid;
      };

      const multiDb = databasesToTest.length > 1;
      const totalCombosPerDb = combos.length * graphsToTest.length;
      let globalStep = 0;

      for (let di = 0; di < databasesToTest.length; di++) {
        const db = databasesToTest[di];
        const dbTag = multiDb ? `[${db}]` : undefined;

        for (let gi = 0; gi < graphsToTest.length; gi++) {
          const gid = graphsToTest[gi];
          const gName = graphsToTest.length > 1 ? graphLabel(gid) : undefined;
          const prefix = [dbTag, gName].filter(Boolean).join(' ');

          // Warm up cache
          setProgress(`${prefix ? prefix + ' — ' : ''}Préchauffage du cache…`);
          await graphApi.getGraph(gid, db, { nocache: true, engine: engine as any });

          for (let c = 0; c < combos.length; c++) {
            const combo = combos[c];
            globalStep++;
            const label = prefix ? `${prefix} | ${combo.label}` : combo.label;
            setProgress(`${globalStep}/${totalCombosPerDb * databasesToTest.length} — ${combo.label} (0/${iterations})`);

            const times: number[] = [];
            let lastResult: GraphLoadResult | null = null;

            for (let i = 0; i < iterations; i++) {
              setProgress(`${globalStep}/${totalCombosPerDb * databasesToTest.length} — ${combo.label} (${i + 1}/${iterations})`);
              await yieldToBrowser();
              const result = await graphApi.getGraph(gid, db, {
                nocache: combo.nocache,
                format: combo.format,
                enrich: combo.enrich,
                nocompress: combo.nocompress,
                compress: combo.compress,
                forjson: combo.forjson,
                stream: combo.stream,
                engine: engine as any,
              });
              times.push(result.timeMs);
              lastResult = result;
            }

            const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
            allResults.push({
              label,
              options: { nocache: combo.nocache, format: combo.format, enrich: combo.enrich, nocompress: combo.nocompress },
              times,
              avg,
              min: Math.min(...times),
              max: Math.max(...times),
              sizeKb: lastResult?.rawContentLength ? Math.round(lastResult.rawContentLength / 1024 * 10) / 10 : null,
              compressedKb: lastResult?.contentLength ? Math.round(lastResult.contentLength / 1024 * 10) / 10 : null,
              cacheStatus: lastResult?.cacheStatus ?? 'unknown',
              graphLabel: gName,
            });
          }

          // Covering index test for this graph on this database
          if (testCovering && !hasIndexes) {
            setProgress('Création des covering indexes…');
            await optimApi.createCoveringIndexes(db);

            const sqlCombos = combos.filter(c => c.nocache);
            for (let c = 0; c < sqlCombos.length; c++) {
              const combo = sqlCombos[c];
              const label = prefix ? `${prefix} | ${combo.label} + CovIdx` : `${combo.label} + CovIdx`;
              setProgress(`Covering indexes — ${combo.label} (0/${iterations})`);

              await optimApi.clearCache();

              const times: number[] = [];
              let lastResult: GraphLoadResult | null = null;
              for (let i = 0; i < iterations; i++) {
                setProgress(`Covering indexes — ${combo.label} (${i + 1}/${iterations})`);
                await yieldToBrowser();
                const result = await graphApi.getGraph(gid, db, {
                  nocache: true,
                  format: combo.format,
                  enrich: combo.enrich,
                  nocompress: combo.nocompress,
                  compress: combo.compress,
                  forjson: combo.forjson,
                  stream: combo.stream,
                  engine: engine as any,
                });
                times.push(result.timeMs);
                lastResult = result;
              }

              const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
              allResults.push({
                label,
                options: { nocache: true, format: combo.format, enrich: combo.enrich, nocompress: combo.nocompress },
                times,
                avg,
                min: Math.min(...times),
                max: Math.max(...times),
                sizeKb: lastResult?.rawContentLength ? Math.round(lastResult.rawContentLength / 1024 * 10) / 10 : null,
                compressedKb: lastResult?.contentLength ? Math.round(lastResult.contentLength / 1024 * 10) / 10 : null,
                cacheStatus: lastResult?.cacheStatus ?? 'unknown',
                graphLabel: gName,
              });
            }

            setProgress('Suppression des covering indexes…');
            await optimApi.dropCoveringIndexes(db);
          }
        }
      }

      // Rank by avg time
      const sorted = [...allResults].sort((a, b) => a.avg - b.avg);
      sorted.forEach((r, i) => r.rank = i + 1);

      setResults(allResults.sort((a, b) => a.avg - b.avg));

      // Cosmos rendering benchmark
      if (testCosmos) {
        const cosmosRes: CosmosResult[] = [];
        for (const gid of graphsToTest) {
          const gName = graphsToTest.length > 1 ? graphLabel(gid) : undefined;
          setProgress(`Cosmos — chargement ${gName || gid}…`);
          await yieldToBrowser();

          const graphResult = await graphApi.getGraph(gid, database, {
            nocache: false, format: 'json', engine: engine as any,
          });
          const gData = graphResult.data;

          // Measure Cosmos data preparation (node colors, link arrays, etc.)
          setProgress(`Cosmos — préparation données (${gData.nodes.length} nœuds)…`);
          await yieldToBrowser();

          const t0 = performance.now();
          // Simulate what Cosmos needs: node positions, colors, sizes
          const _nodes = gData.nodes.map(n => ({
            id: n.id,
            label: n.label ?? n.id,
            color: generateColorFromString(n.node_type ?? 'default'),
            size: 5,
          }));
          // Edge source/target index map
          const nodeIndex = new Map<string, number>();
          _nodes.forEach((n, i) => nodeIndex.set(n.id, i));
          const _links = gData.edges
            .map(e => {
              const src = typeof e.source === 'string' ? e.source : String(e.source);
              const tgt = typeof e.target === 'string' ? e.target : String(e.target);
              return { source: nodeIndex.get(src) ?? -1, target: nodeIndex.get(tgt) ?? -1 };
            })
            .filter(l => l.source >= 0 && l.target >= 0);
          // Force JS engine to materialize (avoid dead code elimination)
          void _nodes.length;
          void _links.length;
          const prepMs = Math.round(performance.now() - t0);

          cosmosRes.push({
            label: gName || 'Cosmos GPU prep',
            nodeCount: gData.nodes.length,
            edgeCount: gData.edges.length,
            prepTimeMs: prepMs,
            graphLabel: gName,
          });
        }
        setCosmosResults(cosmosRes);
      }

      // Barnes-Hut layout benchmark
      if (testBarnesHut) {
        const gid = graphsToTest[0]; // Use first graph for layout
        setProgress('Benchmark layout Barnes-Hut…');
        const graphResult = await graphApi.getGraph(gid, database, {
          nocache: false, format: 'json', engine: engine as any,
        });
        const graphData = graphResult.data;

        const buildGraph = () => {
          const g = new Graph();
          graphData.nodes.forEach(n => {
            g.addNode(n.id, {
              x: Math.random() * 1000,
              y: Math.random() * 1000,
              size: 5,
              label: n.label ?? n.id,
            });
          });
          graphData.edges.forEach(e => {
            const src = typeof e.source === 'string' ? e.source : (e.source as any).id ?? String(e.source);
            const tgt = typeof e.target === 'string' ? e.target : (e.target as any).id ?? String(e.target);
            if (g.hasNode(src) && g.hasNode(tgt) && !g.hasEdge(src, tgt)) {
              g.addEdge(src, tgt);
            }
          });
          return g;
        };

        const layoutBenchResults: LayoutResult[] = [];

        for (const bh of [false, true]) {
          const label = bh ? 'ForceAtlas2 + Barnes-Hut' : 'ForceAtlas2 (brut O(n²))';
          setProgress(`Layout — ${label} (0/${iterations})`);
          await yieldToBrowser();
          const times: number[] = [];

          for (let i = 0; i < iterations; i++) {
            setProgress(`Layout — ${label} (${i + 1}/${iterations})`);
            // Yield to let React render the progress update before heavy computation
            await yieldToBrowser();
            const g = buildGraph();
            const inferredSettings = forceAtlas2.inferSettings(g);
            const start = performance.now();
            forceAtlas2.assign(g, {
              iterations: layoutIterations,
              settings: {
                ...inferredSettings,
                barnesHutOptimize: bh,
              },
            });
            times.push(Math.round(performance.now() - start));
            // Yield again after heavy computation so browser stays responsive
            await yieldToBrowser();
          }

          const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          layoutBenchResults.push({
            label,
            barnesHut: bh,
            layoutIterations,
            times,
            avg,
            min: Math.min(...times),
            max: Math.max(...times),
            nodeCount: graphData.nodes.length,
            edgeCount: graphData.edges.length,
          });
        }

        setLayoutResults(layoutBenchResults);
      }

      setProgress('');
    } catch (e: any) {
      setError(e?.message ?? 'Erreur simulation');
    } finally {
      setRunning(false);
    }
  };

  const fastest = results.length > 0 ? results[0] : null;
  const slowest = results.length > 0 ? results[results.length - 1] : null;
  const maxAvg = slowest?.avg ?? 1;

  const sorted = [...results].sort((a, b) =>
    sortBy === 'avg' ? a.avg - b.avg : sortBy === 'min' ? a.min - b.min : a.max - b.max
  );

  return (
    <div className="simulation-panel">
      <div className="simulation-header">
        <h2>🧪 Simulation de performance</h2>
        <p className="simulation-subtitle">
          Compare toutes les combinaisons d'optimisations pour trouver la plus rapide
        </p>
      </div>

      <div className="simulation-config">
        {/* Multi-graph selection */}
        <div className="simulation-config-row">
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={multiGraph}
              onChange={(e) => setMultiGraph(e.target.checked)}
              disabled={running}
            />
            Multi-graphe
            <small>(comparer plusieurs graphes)</small>
          </label>
        </div>
        {multiGraph && graphs.length > 0 && (
          <div className="simulation-graph-select">
            {graphs.map(g => (
              <label key={g.id} className="simulation-graph-option">
                <input
                  type="checkbox"
                  checked={selectedGraphIds.includes(g.id)}
                  onChange={(e) => {
                    setSelectedGraphIds(prev =>
                      e.target.checked
                        ? [...prev, g.id]
                        : prev.filter(id => id !== g.id)
                    );
                  }}
                  disabled={running}
                />
                <span className="graph-option-title">{g.title}</span>
                <span className="graph-option-meta">{g.node_count}n / {g.edge_count}e</span>
              </label>
            ))}
          </div>
        )}
        {!multiGraph && (
          <div className="simulation-config-row">
            <label>Graphe :</label>
            <span className="simulation-value">{graphId ? <code>{graphId}</code> : <em>Aucun sélectionné</em>}</span>
          </div>
        )}

        {/* Multi-database selection */}
        <div className="simulation-config-row">
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testMultiDatabase}
              onChange={(e) => setTestMultiDatabase(e.target.checked)}
              disabled={running}
            />
            Multi-base
            <small>(comparer plusieurs bases de données — double le temps)</small>
          </label>
        </div>
        {testMultiDatabase && databases.length > 0 && (
          <div className="simulation-graph-select">
            {databases.map(db => (
              <label key={db.name} className="simulation-graph-option">
                <input
                  type="checkbox"
                  checked={selectedDatabases.includes(db.name)}
                  onChange={(e) => {
                    setSelectedDatabases(prev =>
                      e.target.checked
                        ? [...prev, db.name]
                        : prev.filter(n => n !== db.name)
                    );
                  }}
                  disabled={running}
                />
                <span className="graph-option-title">{db.name}</span>
                <span className="graph-option-meta">{db.default ? '(défaut)' : ''} {db.status}</span>
              </label>
            ))}
          </div>
        )}
        {!testMultiDatabase && (
          <div className="simulation-config-row">
            <label>Base :</label>
            <span className="simulation-value"><code>{database ?? 'default'}</code></span>
          </div>
        )}
        <div className="simulation-config-row">
          <label>Itérations par combo :</label>
          <input
            type="number"
            min={1}
            max={50}
            value={iterations}
            onChange={(e) => setIterations(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            disabled={running}
          />
        </div>

        <div className="simulation-options-grid">
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testCompression}
              onChange={(e) => setTestCompression(e.target.checked)}
              disabled={running}
            />
            Tester compression (Gzip vs Brotli vs brut)
            <small>(triple le nombre de combos)</small>
          </label>
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testCovering}
              onChange={(e) => setTestCovering(e.target.checked)}
              disabled={running}
            />
            Tester Covering Indexes
            <small>(crée puis supprime les indexes)</small>
          </label>
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testBarnesHut}
              onChange={(e) => setTestBarnesHut(e.target.checked)}
              disabled={running}
            />
            Tester Barnes-Hut (layout ForceAtlas2)
            <small>(O(n²) vs O(n log n))</small>
          </label>
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testCosmos}
              onChange={(e) => setTestCosmos(e.target.checked)}
              disabled={running}
            />
            Tester rendu Cosmos (GPU)
            <small>(temps de préparation données)</small>
          </label>
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testForJson}
              onChange={(e) => setTestForJson(e.target.checked)}
              disabled={running}
            />
            Tester FOR JSON PATH SQL
            <small>(JSON construit côté SQL Server)</small>
          </label>
          <label className="simulation-checkbox">
            <input
              type="checkbox"
              checked={testStream}
              onChange={(e) => setTestStream(e.target.checked)}
              disabled={running}
            />
            Tester Streaming HTTP
            <small>(Transfer-Encoding: chunked)</small>
          </label>
        </div>
        {testBarnesHut && (
          <div className="simulation-config-row">
            <label>Itérations ForceAtlas2 :</label>
            <input
              type="number"
              min={5}
              max={200}
              step={5}
              value={layoutIterations}
              onChange={(e) => setLayoutIterations(Math.max(5, Math.min(200, parseInt(e.target.value) || 30)))}
              disabled={running}
            />
          </div>
        )}

        <div className="simulation-combos-info">
          <strong>{comboCount} combinaisons</strong> × {iterations} itérations
          × {graphsToTest.length} graphe{graphsToTest.length > 1 ? 's' : ''}
          × {databasesToTest.length} base{databasesToTest.length > 1 ? 's' : ''}
          = <strong>{totalCalls} appels API</strong>
          {testBarnesHut && (
            <span> + <strong>2 layouts</strong> × {iterations} passes</span>
          )}
          {testCosmos && (
            <span> + <strong>{graphsToTest.length} test{graphsToTest.length > 1 ? 's' : ''} Cosmos</strong></span>
          )}
        </div>

        <button
          className="simulation-btn"
          onClick={runSimulation}
          disabled={running || graphsToTest.length === 0}
        >
          {running ? `⏳ ${progress}` : '🚀 Lancer la simulation'}
        </button>

        {error && <div className="simulation-error">{error}</div>}
      </div>

      {results.length > 0 && (
        <div className="simulation-results">
          <h3>📊 Résultats (triés par temps {sortBy === 'avg' ? 'moyen' : sortBy === 'min' ? 'minimum' : 'maximum'})</h3>

          <div className="simulation-sort-btns">
            <button className={sortBy === 'avg' ? 'active' : ''} onClick={() => setSortBy('avg')}>Moy.</button>
            <button className={sortBy === 'min' ? 'active' : ''} onClick={() => setSortBy('min')}>Min</button>
            <button className={sortBy === 'max' ? 'active' : ''} onClick={() => setSortBy('max')}>Max</button>
          </div>

          {/* Visual bar chart */}
          <div className="simulation-chart">
            {sorted.map((r, i) => {
              const pct = maxAvg > 0 ? (r.avg / maxAvg) * 100 : 0;
              const isFastest = r === fastest;
              const isSlowest = r === slowest;
              return (
                <div key={i} className={`simulation-bar-row ${isFastest ? 'fastest' : ''} ${isSlowest ? 'slowest' : ''}`}>
                  <div className="simulation-bar-label">
                    {isFastest && '🏆 '}
                    {r.label}
                  </div>
                  <div className="simulation-bar-track">
                    <div
                      className={`simulation-bar-fill ${isFastest ? 'bar-fastest' : isSlowest ? 'bar-slowest' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                    <span className="simulation-bar-value">{r.avg} ms</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Details table */}
          <table className="simulation-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Combinaison</th>
                <th>Moy.</th>
                <th>Min</th>
                <th>Max</th>
                <th>Taille brute</th>
                {testCompression && <th>Taille Gzip</th>}
                <th>Gain vs pire</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const gainVsSlowest = slowest && slowest.avg > 0
                  ? Math.round((1 - r.avg / slowest.avg) * 100)
                  : 0;
                const isFastest = i === 0;
                return (
                  <tr key={i} className={isFastest ? 'row-fastest' : ''}>
                    <td className="rank">{isFastest ? '🏆' : i + 1}</td>
                    <td>{r.label}</td>
                    <td><strong>{r.avg} ms</strong></td>
                    <td>{r.min} ms</td>
                    <td>{r.max} ms</td>
                    <td>{r.sizeKb != null ? `${r.sizeKb} Ko` : '—'}</td>
                    {testCompression && <td>{r.compressedKb != null ? `${r.compressedKb} Ko` : '—'}</td>}
                    <td className={gainVsSlowest > 0 ? 'gain-positive' : ''}>
                      {gainVsSlowest > 0 ? `−${gainVsSlowest}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Summary */}
          {fastest && slowest && (
            <div className="simulation-summary">
              <div className="summary-winner">
                <span className="summary-icon">🏆</span>
                <div>
                  <strong>{fastest.label}</strong>
                  <span className="summary-detail">
                    {fastest.avg} ms en moyenne — {Math.round((1 - fastest.avg / slowest.avg) * 100)}% plus rapide que le pire cas
                  </span>
                </div>
              </div>
              <div className="summary-details">
                <div className="summary-card">
                  <span className="summary-card-title">⚡ Le plus rapide</span>
                  <strong>{fastest.label}</strong>
                  <span>{fastest.avg} ms (moy.) / {fastest.min} ms (min)</span>
                </div>
                <div className="summary-card slowest">
                  <span className="summary-card-title">🐢 Le plus lent</span>
                  <strong>{slowest.label}</strong>
                  <span>{slowest.avg} ms (moy.) / {slowest.max} ms (max)</span>
                </div>
                <div className="summary-card">
                  <span className="summary-card-title">📦 Taille min</span>
                  {(() => {
                    const withSize = results.filter(r => r.sizeKb != null);
                    const smallest = withSize.length > 0 ? withSize.reduce((a, b) => (a.sizeKb ?? Infinity) < (b.sizeKb ?? Infinity) ? a : b) : null;
                    return smallest ? (
                      <>
                        <strong>{smallest.label}</strong>
                        <span>{smallest.sizeKb} Ko</span>
                      </>
                    ) : <span>—</span>;
                  })()}
                </div>
              </div>
              {coveringIndexes !== null && (
                <div className="summary-note">
                  Covering Indexes : {coveringIndexes ? '✅ actifs pendant le test' : '❌ inactifs pendant le test'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cosmos rendering benchmark */}
      {cosmosResults.length > 0 && (
        <div className="simulation-results simulation-cosmos-results">
          <h3>🚀 Cosmos GPU — Préparation des données pour le rendu WebGL</h3>
          <table className="simulation-table">
            <thead>
              <tr>
                <th>Graphe</th>
                <th>Nœuds</th>
                <th>Arêtes</th>
                <th>Temps de préparation</th>
              </tr>
            </thead>
            <tbody>
              {cosmosResults.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td>{r.nodeCount.toLocaleString()}</td>
                  <td>{r.edgeCount.toLocaleString()}</td>
                  <td><strong>{r.prepTimeMs} ms</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cosmos-note">
            Le rendu GPU (WebGL) par Cosmos est quasi-instantané après la préparation des données.
            Le temps affiché est uniquement le coût CPU de transformation (couleurs, index, tailles).
          </div>
        </div>
      )}

      {/* Barnes-Hut layout benchmark results */}
      {layoutResults.length > 0 && (
        <div className="simulation-results simulation-layout-results">
          <h3>🌳 Barnes-Hut — Benchmark layout ForceAtlas2</h3>
          <p className="layout-info">
            {layoutResults[0].nodeCount} nœuds, {layoutResults[0].edgeCount} arêtes — {layoutResults[0].layoutIterations} itérations ForceAtlas2
          </p>

          {/* Layout bar chart */}
          <div className="simulation-chart">
            {layoutResults.map((r, i) => {
              const maxLayout = Math.max(...layoutResults.map(l => l.avg));
              const pct = maxLayout > 0 ? (r.avg / maxLayout) * 100 : 0;
              const isFastest = r.avg === Math.min(...layoutResults.map(l => l.avg));
              return (
                <div key={i} className={`simulation-bar-row ${isFastest ? 'fastest' : 'slowest'}`}>
                  <div className="simulation-bar-label">
                    {isFastest && '🏆 '}{r.label}
                  </div>
                  <div className="simulation-bar-track">
                    <div
                      className={`simulation-bar-fill ${isFastest ? 'bar-fastest' : 'bar-slowest'}`}
                      style={{ width: `${pct}%` }}
                    />
                    <span className="simulation-bar-value">{r.avg} ms</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Layout table */}
          <table className="simulation-table">
            <thead>
              <tr>
                <th>Algorithme</th>
                <th>Moy.</th>
                <th>Min</th>
                <th>Max</th>
                <th>Gain</th>
              </tr>
            </thead>
            <tbody>
              {layoutResults.map((r, i) => {
                const other = layoutResults.find(l => l.barnesHut !== r.barnesHut);
                const gain = other && other.avg > 0
                  ? Math.round((1 - r.avg / other.avg) * 100)
                  : 0;
                return (
                  <tr key={i} className={r.avg <= (other?.avg ?? Infinity) ? 'row-fastest' : ''}>
                    <td>{r.barnesHut ? '🌳' : '🔢'} {r.label}</td>
                    <td><strong>{r.avg} ms</strong></td>
                    <td>{r.min} ms</td>
                    <td>{r.max} ms</td>
                    <td className={gain > 0 ? 'gain-positive' : gain < 0 ? 'gain-negative' : ''}>
                      {gain > 0 ? `−${gain}%` : gain < 0 ? `+${Math.abs(gain)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Layout summary */}
          {(() => {
            const fastest = layoutResults.reduce((a, b) => a.avg < b.avg ? a : b);
            const slowest = layoutResults.reduce((a, b) => a.avg > b.avg ? a : b);
            const speedup = slowest.avg > 0 ? (slowest.avg / fastest.avg).toFixed(1) : '?';
            return (
              <div className="simulation-summary">
                <div className="summary-winner">
                  <span className="summary-icon">🌳</span>
                  <div>
                    <strong>{fastest.label}</strong>
                    <span className="summary-detail">
                      {fastest.avg} ms en moyenne — {speedup}× plus rapide
                    </span>
                    <span className="summary-detail">
                      Barnes-Hut réduit la complexité du calcul de forces de O(n²) à O(n log n).
                      {fastest.nodeCount > 1000
                        ? ` Avec ${fastest.nodeCount.toLocaleString()} nœuds, le gain est significatif.`
                        : ` Avec seulement ${fastest.nodeCount} nœuds, le gain peut être faible.`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default SimulationPanel;
