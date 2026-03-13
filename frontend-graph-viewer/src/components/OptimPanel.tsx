import React, { useState, useEffect, useCallback } from 'react';
import { graphApi, optimApi, GraphLoadResult, CacheStats, BenchmarkResult } from '../services/api';
import './OptimPanel.css';

interface OptimPanelProps {
  currentGraphId?: string;
  currentDatabase?: string;
}

interface BenchRow {
  label: string;
  timeMs: number;
  cacheStatus: string;
  sizeKb: string;
  rawSizeKb: string;
}

interface BenchResult {
  optimized: BenchRow;
  raw: BenchRow;
  gzipGainPct: number | null;
  cacheGainPct: number | null;
  runAt: string;
}

export const OptimPanel: React.FC<OptimPanelProps> = ({ currentGraphId, currentDatabase }) => {
  const [open, setOpen] = useState(false);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [benchResult, setBenchResult] = useState<BenchResult | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const [lastLoadInfo, setLastLoadInfo] = useState<GraphLoadResult | null>(null);

  // ── 3 optimization toggles ──
  const [useMsgpack, setUseMsgpack] = useState(false);
  const [useEnrich, setUseEnrich] = useState(false);
  const [coveringIndexes, setCoveringIndexes] = useState<boolean | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);

  // ── Server benchmark (full) ──
  const [serverBench, setServerBench] = useState<BenchmarkResult | null>(null);
  const [serverBenchRunning, setServerBenchRunning] = useState(false);
  const [benchIterations, setBenchIterations] = useState(10);

  // Expose toggles globally so App.tsx can read them
  useEffect(() => {
    (window as any).__optimSetLastLoad = (r: GraphLoadResult) => setLastLoadInfo(r);
    (window as any).__optimGetFormat = () => useMsgpack ? 'msgpack' as const : undefined;
    (window as any).__optimGetEnrich = () => useEnrich;
    return () => {
      delete (window as any).__optimSetLastLoad;
      delete (window as any).__optimGetFormat;
      delete (window as any).__optimGetEnrich;
    };
  }, [useMsgpack, useEnrich]);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await optimApi.getCacheStats();
      setCacheStats(stats);
    } catch { /* backend may not be running */ }
  }, []);

  const refreshCoveringIndexes = useCallback(async () => {
    try {
      const res = await optimApi.hasCoveringIndexes(currentDatabase);
      setCoveringIndexes(res.coveringIndexes);
    } catch { setCoveringIndexes(null); }
  }, [currentDatabase]);

  useEffect(() => {
    if (open) { refreshStats(); refreshCoveringIndexes(); }
  }, [open, refreshStats, refreshCoveringIndexes]);

  const handleClearCache = async () => {
    const result = await optimApi.clearCache();
    setClearMsg(`✅ ${result.cleared.length} entrée(s) supprimée(s)`);
    setTimeout(() => setClearMsg(null), 3000);
    refreshStats();
  };

  const handleToggleCoveringIndexes = async () => {
    setIndexLoading(true);
    try {
      if (coveringIndexes) {
        await optimApi.dropCoveringIndexes(currentDatabase);
      } else {
        await optimApi.createCoveringIndexes(currentDatabase);
      }
      await refreshCoveringIndexes();
    } catch (e: any) {
      setBenchError(e?.message ?? 'Erreur indexes');
    } finally {
      setIndexLoading(false);
    }
  };

  const runServerBenchmark = async () => {
    if (!currentGraphId) return;
    setServerBenchRunning(true);
    setBenchError(null);
    try {
      const result = await graphApi.benchmarkGraph(currentGraphId, currentDatabase, undefined, benchIterations);
      setServerBench(result);
    } catch (e: any) {
      setBenchError(e?.message ?? 'Erreur benchmark serveur');
    } finally {
      setServerBenchRunning(false);
    }
  };

  const runBenchmark = async () => {
    if (!currentGraphId) {
      setBenchError('Sélectionnez un graphe avant de lancer le benchmark');
      return;
    }
    setBenchRunning(true);
    setBenchError(null);
    try {
      await graphApi.getGraph(currentGraphId, currentDatabase, { nocache: true });
      const withOptim = await graphApi.getGraph(currentGraphId, currentDatabase, {});

      const withoutOptim = await graphApi.getGraph(currentGraphId, currentDatabase, {
        nocache: true,
        nocompress: true,
      });

      const fmt = (r: GraphLoadResult): BenchRow => ({
        label: '',
        timeMs: r.timeMs,
        cacheStatus: r.cacheStatus,
        sizeKb: r.contentLength != null ? (r.contentLength / 1024).toFixed(1) : '—',
        rawSizeKb: r.rawContentLength != null ? (r.rawContentLength / 1024).toFixed(1) : '—',
      });

      const opt = fmt(withOptim);
      const raw = fmt(withoutOptim);

      const gzipGain = opt.rawSizeKb !== '—' && opt.sizeKb !== '—' && parseFloat(opt.rawSizeKb) > 0
        ? Math.round((1 - parseFloat(opt.sizeKb) / parseFloat(opt.rawSizeKb)) * 100)
        : (raw.rawSizeKb !== '—' && opt.sizeKb !== '—' && parseFloat(raw.rawSizeKb) > 0
          ? Math.round((1 - parseFloat(opt.sizeKb) / parseFloat(raw.rawSizeKb)) * 100)
          : null);

      const cacheGain = raw.timeMs > 0
        ? Math.round((1 - opt.timeMs / raw.timeMs) * 100)
        : null;

      setBenchResult({
        optimized: { ...opt, label: 'Cache HIT + Gzip' },
        raw: { ...raw, label: 'Sans cache + Sans gzip' },
        gzipGainPct: gzipGain,
        cacheGainPct: cacheGain,
        runAt: new Date().toLocaleTimeString(),
      });

      refreshStats();
    } catch (e: any) {
      setBenchError(e?.message ?? 'Erreur lors du benchmark');
    } finally {
      setBenchRunning(false);
    }
  };

  const hitRate = cacheStats && (cacheStats.hits + cacheStats.misses) > 0
    ? Math.round(cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100)
    : null;

  return (
    <>
      <button className="optim-fab" onClick={() => setOpen(o => !o)} title="Panneau Optimisations">
        ⚡
      </button>

      {open && (
        <div className="optim-panel">
          <div className="optim-header">
            <span>⚡ Optimisations</span>
            <button className="optim-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* ── 3 Optimisations toggleables ── */}
          <div className="optim-section">
            <div className="optim-section-title">Activer / désactiver</div>
            <div className="optim-toggles">
              <label className="optim-toggle">
                <input
                  type="checkbox"
                  checked={useMsgpack}
                  onChange={(e) => setUseMsgpack(e.target.checked)}
                />
                <span className="toggle-label">
                  <strong>MessagePack</strong>
                  <small>Format binaire au lieu de JSON (plus compact, plus rapide à décoder)</small>
                </span>
              </label>

              <label className="optim-toggle">
                <input
                  type="checkbox"
                  checked={useEnrich}
                  onChange={(e) => setUseEnrich(e.target.checked)}
                />
                <span className="toggle-label">
                  <strong>Enrichissement EasyVista</strong>
                  <small>Enrichit les nœuds CI_ avec les données live (nom, type, famille)</small>
                </span>
              </label>

              <label className="optim-toggle optim-toggle-action">
                <input
                  type="checkbox"
                  checked={coveringIndexes === true}
                  disabled={indexLoading || coveringIndexes === null}
                  onChange={handleToggleCoveringIndexes}
                />
                <span className="toggle-label">
                  <strong>Covering Indexes SQL</strong>
                  <small>
                    {indexLoading
                      ? '⏳ En cours…'
                      : coveringIndexes === null
                        ? 'Statut inconnu'
                        : coveringIndexes
                          ? 'Actifs — accélèrent les lectures SQL'
                          : 'Inactifs — cliquer pour créer'}
                  </small>
                </span>
              </label>
            </div>
            <div className="optim-muted" style={{ marginTop: 6 }}>
              Cochez une option puis rechargez un graphe pour appliquer.
            </div>
          </div>

          {/* Dernier chargement */}
          {lastLoadInfo && (
            <div className="optim-section">
              <div className="optim-section-title">Dernier chargement</div>
              <div className="optim-kv-grid">
                <span>Temps total</span><span>{lastLoadInfo.timeMs} ms</span>
                <span>Cache</span>
                <span className={`cache-badge ${lastLoadInfo.cacheStatus === 'HIT' ? 'hit' : lastLoadInfo.cacheStatus === 'MISS' ? 'miss' : lastLoadInfo.cacheStatus === 'BYPASS' ? 'bypass' : ''}`}>
                  {lastLoadInfo.cacheStatus}
                </span>
                <span>Taille brute</span>
                <span>{lastLoadInfo.rawContentLength != null ? `${(lastLoadInfo.rawContentLength / 1024).toFixed(1)} Ko` : '—'}</span>
                <span>Taille gzip</span>
                <span>{lastLoadInfo.contentLength != null ? `${(lastLoadInfo.contentLength / 1024).toFixed(1)} Ko` : '—'}</span>
                {lastLoadInfo.rawContentLength != null && lastLoadInfo.contentLength != null && lastLoadInfo.contentLength < lastLoadInfo.rawContentLength && (
                  <>
                    <span>Ratio gzip</span>
                    <span className="gain-inline">
                      −{Math.round((1 - lastLoadInfo.contentLength / lastLoadInfo.rawContentLength) * 100)}%
                    </span>
                  </>
                )}
                <span>Temps serveur</span><span>{lastLoadInfo.responseTimeHeader ?? '—'}</span>
                <span>Requêtes //</span><span>{lastLoadInfo.parallelQueries ? '✅ Oui' : '❌ Non'}</span>
                <span>Format</span><span>{lastLoadInfo.format === 'msgpack' ? '📦 MsgPack' : '📄 JSON'}</span>
                <span>Enrichi</span><span>{lastLoadInfo.enriched ? '✅ Oui' : '❌ Non'}</span>
              </div>
            </div>
          )}

          {/* Stats du cache */}
          <div className="optim-section">
            <div className="optim-section-title">
              Cache backend
              <button className="optim-btn-sm" onClick={refreshStats}>↻</button>
            </div>
            {cacheStats ? (
              <div className="optim-kv-grid">
                <span>Graphes en cache</span><span>{cacheStats.cachedGraphs}</span>
                <span>Hits / Misses</span><span>{cacheStats.hits} / {cacheStats.misses}</span>
                <span>Contournements</span><span>{cacheStats.bypasses}</span>
                <span>Taux de hit</span>
                <span className={`hitrate ${hitRate != null && hitRate > 50 ? 'good' : 'neutral'}`}>
                  {hitRate != null ? `${hitRate}%` : '—'}
                </span>
              </div>
            ) : <div className="optim-muted">Chargement…</div>}
            <button className="optim-btn optim-btn-danger" onClick={handleClearCache}>
              🗑 Vider le cache
            </button>
            {clearMsg && <div className="optim-clear-msg">{clearMsg}</div>}
          </div>

          {/* Benchmark client */}
          <div className="optim-section">
            <div className="optim-section-title">Benchmark comparatif</div>
            {currentGraphId
              ? <div className="optim-muted">Graphe : <code>{currentGraphId}</code></div>
              : <div className="optim-muted warn">⚠ Sélectionnez d'abord un graphe</div>
            }
            <button
              className="optim-btn optim-btn-primary"
              onClick={runBenchmark}
              disabled={benchRunning || !currentGraphId}
            >
              {benchRunning ? '⏳ Mesure en cours…' : '▶ Lancer le benchmark'}
            </button>

            {benchError && <div className="optim-error">{benchError}</div>}

            {benchResult && (
              <div className="bench-result">
                <div className="bench-run-at">Exécuté à {benchResult.runAt}</div>
                <table className="bench-table">
                  <thead>
                    <tr>
                      <th>Scénario</th><th>Temps</th><th>Cache</th><th>Brut</th><th>Gzip</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="row-optimized">
                      <td>{benchResult.optimized.label}</td>
                      <td><strong>{benchResult.optimized.timeMs} ms</strong></td>
                      <td>
                        <span className={`cache-badge ${benchResult.optimized.cacheStatus === 'HIT' ? 'hit' : 'miss'}`}>
                          {benchResult.optimized.cacheStatus}
                        </span>
                      </td>
                      <td>{benchResult.optimized.rawSizeKb} Ko</td>
                      <td>{benchResult.optimized.sizeKb} Ko</td>
                    </tr>
                    <tr className="row-raw">
                      <td>{benchResult.raw.label}</td>
                      <td>{benchResult.raw.timeMs} ms</td>
                      <td><span className="cache-badge bypass">{benchResult.raw.cacheStatus}</span></td>
                      <td>{benchResult.raw.rawSizeKb} Ko</td>
                      <td>{benchResult.raw.sizeKb !== '—' ? `${benchResult.raw.sizeKb} Ko` : '—'}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="bench-gains">
                  {benchResult.cacheGainPct != null && (
                    <div className={`gain-chip ${benchResult.cacheGainPct > 0 ? 'positive' : 'negative'}`}>
                      ⚡ Cache : <strong>{benchResult.cacheGainPct > 0 ? '-' : '+'}{Math.abs(benchResult.cacheGainPct)}%</strong> de temps
                    </div>
                  )}
                  {benchResult.gzipGainPct != null && (
                    <div className={`gain-chip ${benchResult.gzipGainPct > 0 ? 'positive' : 'negative'}`}>
                      🗜 Gzip : <strong>{benchResult.gzipGainPct > 0 ? '-' : '+'}{Math.abs(benchResult.gzipGainPct)}%</strong> de taille
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Benchmark serveur (5 stratégies) ── */}
          <div className="optim-section">
            <div className="optim-section-title">Benchmark serveur (5 stratégies)</div>
            {currentGraphId
              ? <div className="optim-muted">Graphe : <code>{currentGraphId}</code></div>
              : <div className="optim-muted warn">⚠ Sélectionnez d'abord un graphe</div>
            }
            <div className="bench-iterations">
              <label>Itérations :</label>
              <input
                type="number"
                min={1}
                max={50}
                value={benchIterations}
                onChange={(e) => setBenchIterations(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              />
            </div>
            <button
              className="optim-btn optim-btn-primary"
              onClick={runServerBenchmark}
              disabled={serverBenchRunning || !currentGraphId}
            >
              {serverBenchRunning ? '⏳ Benchmark serveur…' : '📊 Benchmark complet (serveur)'}
            </button>

            {serverBench && (
              <div className="bench-result">
                <div className="bench-run-at">
                  {serverBench.nodeCount} nœuds / {serverBench.edgeCount} arêtes — {serverBench.iterations} itérations
                </div>
                <table className="bench-table">
                  <thead>
                    <tr><th>Stratégie</th><th>Moy.</th><th>Min</th><th>Max</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{serverBench.sql.label}</td>
                      <td><strong>{serverBench.sql.avg} ms</strong></td>
                      <td>{serverBench.sql.min} ms</td>
                      <td>{serverBench.sql.max} ms</td>
                    </tr>
                    <tr className="row-optimized">
                      <td>{serverBench.cache.label}</td>
                      <td><strong>{serverBench.cache.avg} ms</strong></td>
                      <td>{serverBench.cache.min} ms</td>
                      <td>{serverBench.cache.max} ms</td>
                    </tr>
                    <tr>
                      <td>{serverBench.json.label}</td>
                      <td><strong>{serverBench.json.avg} ms</strong></td>
                      <td>{serverBench.json.min} ms</td>
                      <td>{serverBench.json.max} ms</td>
                    </tr>
                    <tr>
                      <td>{serverBench.msgpack.label}</td>
                      <td><strong>{serverBench.msgpack.avg} ms</strong></td>
                      <td>{serverBench.msgpack.min} ms</td>
                      <td>{serverBench.msgpack.max} ms</td>
                    </tr>
                    {serverBench.enrich && (
                      <tr>
                        <td>{serverBench.enrich.label}</td>
                        <td><strong>{serverBench.enrich.avg} ms</strong></td>
                        <td>{serverBench.enrich.min} ms</td>
                        <td>{serverBench.enrich.max} ms</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="bench-gains">
                  <div className="gain-chip positive">
                    JSON : {serverBench.jsonSizeKB} Ko → MsgPack : {serverBench.msgpackSizeKB} Ko (−{serverBench.compressionRatio}%)
                  </div>
                  <div className="gain-chip positive">
                    ⚡ Cache {serverBench.speedup.cacheVsSql}× plus rapide que SQL
                  </div>
                  {serverBench.coveringIndexes !== undefined && (
                    <div className={`gain-chip ${serverBench.coveringIndexes ? 'positive' : 'neutral'}`}>
                      Covering Indexes : {serverBench.coveringIndexes ? '✅ actifs' : '❌ inactifs'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Légende */}
          <div className="optim-section optim-footer">
            <div className="optim-muted">
              Bypass : <code>?nocache=true</code> et <code>?nocompress=true</code>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
