import React, { useMemo, useState, useCallback, useRef } from 'react';
import { CosmographProvider, Cosmograph } from '@cosmograph/react';
import type { CosmographRef } from '@cosmograph/react';
import type { GraphData } from '../types/graph';
import { generateColorFromString } from '../services/graphTransform';
import { graphApi } from '../services/api';
import type { ImpactResult } from '../services/api';
import FpsCounter from './FpsCounter';
import './CosmosViewer.css';

interface CosmosViewerProps {
  data: GraphData | null;
  graphId?: string;
  database?: string;
  engine?: string;
  onRenderComplete?: (renderTimeMs: number) => void;
}

function getAdaptiveParams(nodeCount: number) {
  if (nodeCount > 200000) {
    return { pointSize: 1, showLabels: false, repulsion: 0.2, gravity: 0.1, friction: 0.5, theta: 2.0, decay: 50000, renderLinks: false, pixelRatio: 1, labelsLimit: 5 };
  }
  if (nodeCount > 100000) {
    return { pointSize: 2, showLabels: false, repulsion: 0.3, gravity: 0.15, friction: 0.5, theta: 1.7, decay: 30000, renderLinks: false, pixelRatio: 1, labelsLimit: 8 };
  }
  if (nodeCount > 10000) {
    return { pointSize: 2, showLabels: false, repulsion: 0.5, gravity: 0.15, friction: 0.6, theta: 1.5, decay: 10000, renderLinks: true, pixelRatio: 1, labelsLimit: 15 };
  }
  if (nodeCount > 5000) {
    return { pointSize: 3, showLabels: false, repulsion: 0.8, gravity: 0.2, friction: 0.7, theta: 1.3, decay: 8000, renderLinks: true, pixelRatio: 1, labelsLimit: 20 };
  }
  if (nodeCount > 2000) {
    return { pointSize: 4, showLabels: false, repulsion: 1.0, gravity: 0.25, friction: 0.8, theta: 1.15, decay: 5000, renderLinks: true, pixelRatio: 2, labelsLimit: 25 };
  }
  if (nodeCount > 500) {
    return { pointSize: 5, showLabels: false, repulsion: 1.2, gravity: 0.25, friction: 0.85, theta: 1.15, decay: 5000, renderLinks: true, pixelRatio: 2, labelsLimit: 30 };
  }
  return { pointSize: 6, showLabels: true, repulsion: 1.5, gravity: 0.3, friction: 0.85, theta: 1.15, decay: 5000, renderLinks: true, pixelRatio: 2, labelsLimit: 30 };
}

type ImpactStatus = 'healthy' | 'source' | 'impacted';

interface ImpactState {
  sourceId: string;
  statuses: Map<string, ImpactStatus>;
  levels: Map<string, number>;
  maxLevel: number;
}

// BFS propagation: returns impacted nodes with levels
function bfsImpact(
  sourceId: string,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>,
  depth: number,
  threshold: number,
): ImpactState {
  const statuses = new Map<string, ImpactStatus>();
  const levels = new Map<string, number>();
  statuses.set(sourceId, 'source');
  levels.set(sourceId, 0);

  let currentLevel = new Set([sourceId]);
  let maxLevel = 0;

  for (let lvl = 1; lvl <= depth && currentLevel.size > 0; lvl++) {
    const nextLevel = new Set<string>();
    for (const nodeId of currentLevel) {
      const neighbors = outgoing.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (statuses.has(neighbor)) continue;
        // Check threshold: what % of incoming parents are already impacted
        if (threshold > 0) {
          const parents = incoming.get(neighbor) || [];
          if (parents.length > 0) {
            const impactedParents = parents.filter(p => statuses.has(p)).length;
            if ((impactedParents / parents.length) * 100 < threshold) continue;
          }
        }
        statuses.set(neighbor, 'impacted');
        levels.set(neighbor, lvl);
        nextLevel.add(neighbor);
        maxLevel = lvl;
      }
    }
    currentLevel = nextLevel;
  }

  return { sourceId, statuses, levels, maxLevel };
}

// Impact color: source=red, impacted=orange gradient by level, healthy=green
function getImpactColor(status: ImpactStatus | undefined, level: number, maxLevel: number, impactMode: boolean): string {
  if (!impactMode) return '';
  if (!status) return '#2d8a4e'; // healthy green
  if (status === 'source') return '#e53e3e'; // red
  // Orange gradient: level 1 = bright orange, deeper = darker
  const t = maxLevel > 1 ? (level - 1) / (maxLevel - 1) : 0;
  const r = Math.round(255 - t * 60);
  const g = Math.round(160 - t * 80);
  const b = Math.round(50 + t * 30);
  return `rgb(${r},${g},${b})`;
}

const CosmosViewer: React.FC<CosmosViewerProps> = ({ data, graphId, database, engine, onRenderComplete }) => {
  const nodeCount = data?.nodes?.length ?? 0;
  const edgeCount = data?.edges?.length ?? 0;
  const defaults = useMemo(() => getAdaptiveParams(nodeCount), [nodeCount]);

  const [repulsion, setRepulsion] = useState(defaults.repulsion);
  const [gravity, setGravity] = useState(defaults.gravity);
  const [showLabels, setShowLabels] = useState(defaults.showLabels);
  const [renderLinks, setRenderLinks] = useState(defaults.renderLinks);
  const [theta, setTheta] = useState(defaults.theta);
  const [decay, setDecay] = useState(defaults.decay);
  const [friction, setFriction] = useState(defaults.friction);

  // Simulation control state
  const [paused, setPaused] = useState(false);
  const [simulationDone, setSimulationDone] = useState(false);
  const renderStartRef = useRef<number>(0);

  const handlePause = useCallback(() => {
    cosmographRef.current?.pause();
    setPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    cosmographRef.current?.unpause();
    setPaused(false);
    setSimulationDone(false);
  }, []);

  const handleRestart = useCallback(() => {
    cosmographRef.current?.start(1);
    setPaused(false);
    setSimulationDone(false);
  }, []);

  const handleSimulationEnd = useCallback(() => {
    setSimulationDone(true);
    setPaused(true);
    if (renderStartRef.current > 0) {
      const elapsed = performance.now() - renderStartRef.current;
      performance.mark('Cosmos:rendered');
      performance.measure('Cosmos:total', 'Cosmos:start', 'Cosmos:rendered');
      renderStartRef.current = 0;
      onRenderComplete?.(elapsed);
    }
  }, [onRenderComplete]);

  // Impact analysis state
  const [impactMode, setImpactMode] = useState(false);
  const [impactState, setImpactState] = useState<ImpactState | null>(null);
  const [impactDepth, setImpactDepth] = useState(5);
  const [impactThreshold, setImpactThreshold] = useState(0);
  const [serverResult, setServerResult] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const cosmographRef = useRef<CosmographRef>(undefined);

  // Build adjacency maps for BFS
  const adjacency = useMemo(() => {
    if (!data?.edges || !data?.nodes) return { outgoing: new Map<string, string[]>(), incoming: new Map<string, string[]>() };
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    const nodeIds = new Set(data.nodes.map(n => n.id));
    for (const e of data.edges) {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
      if (!outgoing.has(e.source)) outgoing.set(e.source, []);
      outgoing.get(e.source)!.push(e.target);
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }
    return { outgoing, incoming };
  }, [data]);

  // Handle label click → run impact BFS
  const handleLabelClick = useCallback((_index: number, id: string) => {
    if (!impactMode || !data) return;
    const impact = bfsImpact(id, adjacency.outgoing, adjacency.incoming, impactDepth, impactThreshold);
    setImpactState(impact);
    setServerResult(null);
  }, [impactMode, data, adjacency, impactDepth, impactThreshold]);

  // Server-side impact
  const runServerImpact = useCallback(async () => {
    if (!impactState || !graphId) return;
    setImpactLoading(true);
    try {
      const result = await graphApi.computeImpact(
        graphId,
        impactState.sourceId,
        impactDepth,
        database,
        engine as any,
        impactThreshold,
      );
      setServerResult(result);
    } catch (err) {
      console.error('Server impact failed:', err);
    } finally {
      setImpactLoading(false);
    }
  }, [impactState, graphId, impactDepth, database, engine, impactThreshold]);

  // Reset impact when mode is toggled off
  const toggleImpactMode = useCallback(() => {
    if (impactMode) {
      setImpactState(null);
      setServerResult(null);
    }
    setImpactMode(!impactMode);
  }, [impactMode]);

  // Transform nodes → points array for Cosmograph
  const points = useMemo(() => {
    if (!data?.nodes) return [];
    renderStartRef.current = performance.now();
    performance.mark('Cosmos:start');
    return data.nodes.map((n, i) => {
      let color: string;
      if (impactMode && impactState) {
        const status = impactState.statuses.get(n.id);
        const level = impactState.levels.get(n.id) ?? 0;
        color = getImpactColor(status, level, impactState.maxLevel, true);
      } else {
        color = generateColorFromString(n.node_type);
      }
      return {
        index: i,
        id: n.id,
        label: n.label,
        type: n.node_type,
        color,
      };
    });
  }, [data, impactMode, impactState]);

  // Transform edges → links array for Cosmograph
  const links = useMemo(() => {
    if (!data?.edges) return [];
    const nodeIds = new Set(data.nodes.map(n => n.id));
    const nodeIndexMap = new Map(data.nodes.map((n, i) => [n.id, i]));
    return data.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({
        source: e.source,
        target: e.target,
        sourceIndex: nodeIndexMap.get(e.source)!,
        targetIndex: nodeIndexMap.get(e.target)!,
      }));
  }, [data]);

  if (!data || points.length === 0) {
    return (
      <div className="cosmos-viewer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
          Aucun graphe sélectionné
        </div>
      </div>
    );
  }

  return (
    <div className="cosmos-viewer">
      <div className="cosmos-controls">
        <div className="cosmos-stats">
          <span className="stat"><strong>{nodeCount.toLocaleString()}</strong> nœuds</span>
          <span className="stat"><strong>{edgeCount.toLocaleString()}</strong> arêtes</span>
          <span className="stat">🚀 GPU</span>
        </div>

        <div className="cosmos-panel">
          <h4>Simulation</h4>
          <div className="cosmos-sim-btns">
            {paused ? (
              <button className="cosmos-btn cosmos-btn-sm" onClick={handleResume} title="Reprendre">
                ▶ Play
              </button>
            ) : (
              <button className="cosmos-btn cosmos-btn-sm" onClick={handlePause} title="Immobiliser les nœuds">
                ⏸ Pause
              </button>
            )}
            <button className="cosmos-btn cosmos-btn-sm" onClick={handleRestart} title="Relancer la simulation">
              ↻ Restart
            </button>
            {simulationDone && <span className="cosmos-sim-done">Stabilisé</span>}
          </div>
          <label>
            Répulsion <span className="cosmos-value">{repulsion}</span>
            <input type="range" min="0.1" max="5" step="0.1" value={repulsion} onChange={e => setRepulsion(Number(e.target.value))} />
          </label>
          <label>
            Gravité <span className="cosmos-value">{gravity}</span>
            <input type="range" min="0" max="1" step="0.05" value={gravity} onChange={e => setGravity(Number(e.target.value))} />
          </label>
          <label>
            Friction <span className="cosmos-value">{friction}</span>
            <input type="range" min="0.1" max="1" step="0.05" value={friction} onChange={e => setFriction(Number(e.target.value))} />
          </label>
          <label>
            Theta (Barnes-Hut) <span className="cosmos-value">{theta}</span>
            <input type="range" min="0.5" max="3" step="0.05" value={theta} onChange={e => setTheta(Number(e.target.value))} />
          </label>
          <label>
            Decay <span className="cosmos-value">{decay}</span>
            <input type="range" min="1000" max="100000" step="1000" value={decay} onChange={e => setDecay(Number(e.target.value))} />
          </label>
          <h4>Rendu</h4>
          <label>
            Afficher les liens
            <input type="checkbox" checked={renderLinks} onChange={e => setRenderLinks(e.target.checked)} />
          </label>
          <label>
            Labels
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
          </label>
          <h4>Analyse d'impact</h4>
          <label>
            Mode impact
            <input type="checkbox" checked={impactMode} onChange={toggleImpactMode} />
          </label>
          {impactMode && (
            <>
              <label>
                Profondeur <span className="cosmos-value">{impactDepth}</span>
                <input type="range" min="1" max="20" step="1" value={impactDepth} onChange={e => setImpactDepth(Number(e.target.value))} />
              </label>
              <label>
                Seuil (%) <span className="cosmos-value">{impactThreshold}</span>
                <input type="range" min="0" max="100" step="5" value={impactThreshold} onChange={e => setImpactThreshold(Number(e.target.value))} />
              </label>
              <p className="cosmos-hint">
                {impactState
                  ? <>Cliquez un label pour changer la source</>
                  : <>Cliquez sur un label de nœud pour lancer l'analyse</>
                }
              </p>
            </>
          )}
        </div>
      </div>

      {/* Impact results overlay */}
      {impactMode && impactState && (
        <div className="cosmos-impact-panel">
          <h4>Résultat d'impact</h4>
          <div className="impact-summary">
            <div className="impact-stat">
              <span className="impact-dot source"></span>
              Source : <strong>{data?.nodes.find(n => n.id === impactState.sourceId)?.label ?? impactState.sourceId}</strong>
            </div>
            <div className="impact-stat">
              <span className="impact-dot impacted"></span>
              Nœuds impactés : <strong>{impactState.statuses.size - 1}</strong>
            </div>
            <div className="impact-stat">
              Profondeur max : <strong>{impactState.maxLevel}</strong>
            </div>
            <div className="impact-stat">
              <span className="impact-dot healthy"></span>
              Non impactés : <strong>{nodeCount - impactState.statuses.size}</strong>
            </div>
          </div>

          {graphId && (
            <button
              className="cosmos-btn"
              onClick={runServerImpact}
              disabled={impactLoading}
            >
              {impactLoading ? 'Calcul serveur...' : 'Comparer avec le serveur'}
            </button>
          )}

          {serverResult && (
            <div className="impact-server-result">
              <h5>Résultat serveur ({serverResult.engine})</h5>
              <div className="impact-stat">Nœuds impactés : <strong>{serverResult.impactedNodes.length}</strong></div>
              <div className="impact-stat">Temps : <strong>{serverResult.elapsed_ms} ms</strong></div>
              <div className="impact-stat">
                {serverResult.impactedNodes.length === impactState.statuses.size - 1
                  ? <span className="match-ok">Résultats identiques</span>
                  : <span className="match-diff">Diff : {Math.abs(serverResult.impactedNodes.length - (impactState.statuses.size - 1))} nœuds</span>
                }
              </div>
            </div>
          )}
        </div>
      )}

      <div className="cosmos-container">
        <CosmographProvider>
          <Cosmograph
            ref={cosmographRef}
            points={points}
            pointIdBy="id"
            pointIndexBy="index"
            pointColorBy="color"
            pointLabelBy={(showLabels || impactMode) ? "label" : undefined}
            pointDefaultSize={defaults.pointSize}
            pointSizeScale={1}
            scalePointsOnZoom={false}
            links={links}
            linkSourceBy="source"
            linkTargetBy="target"
            linkSourceIndexBy="sourceIndex"
            linkTargetIndexBy="targetIndex"
            renderLinks={renderLinks}
            curvedLinks={false}
            linkDefaultWidth={1}
            linkOpacity={0.3}
            linkVisibilityDistanceRange={[30, 100]}
            linkVisibilityMinTransparency={0.05}
            simulationRepulsion={repulsion}
            simulationRepulsionTheta={theta}
            simulationGravity={gravity}
            simulationFriction={friction}
            simulationDecay={decay}
            enableSimulationDuringZoom={false}
            enableDrag={paused}
            onSimulationEnd={handleSimulationEnd}
            showDynamicLabelsLimit={impactMode ? 50 : defaults.labelsLimit}
            showTopLabelsLimit={impactMode ? 50 : defaults.labelsLimit}
            pixelRatio={defaults.pixelRatio}
            fitViewOnInit={true}
            backgroundColor="#0a0a0a"
            onLabelClick={handleLabelClick}
            selectPointOnClick={impactMode ? 'single' : undefined}
            focusPointOnClick={impactMode}
            renderHoveredPointRing={true}
          />
        </CosmographProvider>
      </div>

      <FpsCounter />
    </div>
  );
};

export default CosmosViewer;
