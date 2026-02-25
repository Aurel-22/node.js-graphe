import React, { useState, useEffect, useCallback } from 'react';
import { graphApi, optimApi, GraphLoadResult, CacheStats } from '../services/api';
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

  // Expose callback for App to push last load result
  useEffect(() => {
    (window as any).__optimSetLastLoad = (r: GraphLoadResult) => setLastLoadInfo(r);
    return () => { delete (window as any).__optimSetLastLoad; };
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await optimApi.getCacheStats();
      setCacheStats(stats);
    } catch { /* backend may not be running */ }
  }, []);

  useEffect(() => {
    if (open) refreshStats();
  }, [open, refreshStats]);

  const handleClearCache = async () => {
    const result = await optimApi.clearCache();
    setClearMsg(`✅ ${result.cleared.length} entrée(s) supprimée(s)`);
    setTimeout(() => setClearMsg(null), 3000);
    refreshStats();
  };

  const runBenchmark = async () => {
    if (!currentGraphId) {
      setBenchError('Sélectionnez un graphe avant de lancer le benchmark');
      return;
    }
    setBenchRunning(true);
    setBenchError(null);
    try {
      // 1) Warm up: charger avec cache actif (2ème appel = HIT garanti)
      await graphApi.getGraph(currentGraphId, currentDatabase, { nocache: true }); // MISS, remplit le cache
      const withOptim = await graphApi.getGraph(currentGraphId, currentDatabase, {}); // HIT + gzip

      // 2) Sans cache + sans gzip (raw)
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

      // Gzip gain: comparer la taille compressée vs la taille brute du même appel optimisé
      const gzipGain = opt.rawSizeKb !== '—' && opt.sizeKb !== '—' && parseFloat(opt.rawSizeKb) > 0
        ? Math.round((1 - parseFloat(opt.sizeKb) / parseFloat(opt.rawSizeKb)) * 100)
        // Fallback: comparer compressed opt vs raw (no gzip)
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
            <span>⚡ Optimisations actives</span>
            <button className="optim-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          {/* Badges d'état */}
          <div className="optim-badges">
            <span className="badge badge-on">✅ Gzip</span>
            <span className="badge badge-on">✅ Requêtes parallèles</span>
            <span className="badge badge-on">✅ Cache mémoire</span>
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

          {/* Benchmark */}
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
                      <th>Scénario</th>
                      <th>Temps</th>
                      <th>Cache</th>
                      <th>Brut</th>
                      <th>Gzip</th>
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
                      <td>
                        <span className="cache-badge bypass">{benchResult.raw.cacheStatus}</span>
                      </td>
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

          {/* Légende des bypasses */}
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
