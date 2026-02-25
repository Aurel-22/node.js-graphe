/**
 * Crée 4 graphes multi-communautés via l'API REST sur n'importe quel engine.
 *
 *   - 1 000  nœuds  (~3 000  arêtes)
 *   - 2 000  nœuds  (~6 000  arêtes)
 *   - 5 000  nœuds  (~15 000 arêtes)
 *   - 10 000 nœuds  (~30 000 arêtes)
 *
 * Usage :
 *   node create-engine-graphs.mjs --engine=neo4j
 *   node create-engine-graphs.mjs --engine=memgraph
 *   node create-engine-graphs.mjs --engine=mssql
 *   node create-engine-graphs.mjs --engine=neo4j --sizes=1000,5000
 */

const API_BASE = 'http://127.0.0.1:8080/api';

// ─── CLI arguments ────────────────────────────────────────────────────────────
const engineArg = process.argv.find(a => a.startsWith('--engine='));
if (!engineArg) {
  console.error('Usage: node create-engine-graphs.mjs --engine=neo4j|memgraph|mssql [--sizes=1000,2000,5000,10000]');
  process.exit(1);
}
const ENGINE = engineArg.replace('--engine=', '');

// Database par défaut selon l'engine
const DB_MAP = { neo4j: 'neo4j', memgraph: '', mssql: 'graph_db', arangodb: '_system' };
const dbArg = process.argv.find(a => a.startsWith('--database='));
const DATABASE = dbArg ? dbArg.replace('--database=', '') : (DB_MAP[ENGINE] ?? '');

const allSizes = [1_000, 2_000, 5_000, 10_000];
const sizesArg = process.argv.find(a => a.startsWith('--sizes='));
const SIZES = sizesArg
  ? sizesArg.replace('--sizes=', '').split(',').map(Number)
  : allSizes;

// ─── Constantes de génération ─────────────────────────────────────────────────
const NODE_TYPES = [
  'process', 'service', 'database', 'api', 'user',
  'system', 'queue', 'notification', 'validation', 'action',
];
const EDGE_TYPES = ['calls', 'depends_on', 'reads', 'writes', 'triggers', 'validates', 'notifies', 'queues'];

// ─── Génération du graphe (~3 arêtes/nœud) ───────────────────────────────────
function generateGraph(nodeCount) {
  const communityCount = nodeCount <= 1_000 ? 5
                       : nodeCount <= 2_000 ? 8
                       : nodeCount <= 5_000 ? 10
                       : 15;
  const nodesPerCommunity = Math.floor(nodeCount / communityCount);

  const nodes = [];
  for (let c = 0; c < communityCount; c++) {
    const type = NODE_TYPES[c % NODE_TYPES.length];
    const count = (c === communityCount - 1)
      ? nodeCount - c * nodesPerCommunity
      : nodesPerCommunity;
    for (let i = 0; i < count; i++) {
      nodes.push({
        id:        `C${c}_N${i}`,
        label:     `${type.charAt(0).toUpperCase() + type.slice(1)} ${c}.${i}`,
        node_type: type,
        properties: { community: c, index: i },
      });
    }
  }

  const edgeSet = new Set();
  const edges   = [];
  function addEdge(src, tgt, type) {
    if (src === tgt) return;
    const key = `${src}→${tgt}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source: src, target: tgt, edge_type: type, label: type, properties: {} });
  }
  function commSize(c) {
    return (c === communityCount - 1)
      ? nodeCount - c * nodesPerCommunity
      : nodesPerCommunity;
  }

  for (let c = 0; c < communityCount; c++) {
    const sz = commSize(c);
    for (let i = 0; i < sz; i++) {
      const nodeId = `C${c}_N${i}`;
      const et = EDGE_TYPES[i % EDGE_TYPES.length];
      if (i + 1 < sz) addEdge(nodeId, `C${c}_N${i + 1}`, 'calls');
      if (i + 3 < sz) addEdge(nodeId, `C${c}_N${i + 3}`, 'depends_on');
      if (i % 2 === 0 && i + 2 < sz) addEdge(nodeId, `C${c}_N${i + 2}`, 'reads');
      if (i % 3 === 0 && i + 7 < sz) addEdge(nodeId, `C${c}_N${i + 7}`, et);
      if (i % 4 === 0 && i + 5 < sz) addEdge(nodeId, `C${c}_N${i + 5}`, 'writes');
      if (i > 0 && i % 15 === 0)     addEdge(`C${c}_N0`, nodeId, 'queues');
    }
  }
  for (let c = 0; c < communityCount; c++) {
    const nextC = (c + 1) % communityCount;
    const sz    = commSize(c);
    addEdge(`C${c}_N0`, `C${nextC}_N0`, 'calls');
    const step = Math.max(1, Math.floor(sz / 5));
    for (let i = step; i < sz; i += step) {
      addEdge(`C${c}_N${i}`, `C${nextC}_N${Math.min(i, commSize(nextC) - 1)}`, 'triggers');
    }
    const oppC = (c + 2) % communityCount;
    addEdge(`C${c}_N0`, `C${oppC}_N0`, 'notifies');
  }

  return { nodes, edges, communityCount };
}

// ─── API helpers ──────────────────────────────────────────────────────────────
function qs() {
  const params = [`engine=${ENGINE}`];
  if (DATABASE) params.push(`database=${DATABASE}`);
  return params.join('&');
}

async function deleteOldGraphsByTitle(title) {
  try {
    const r = await fetch(`${API_BASE}/graphs?${qs()}`);
    if (!r.ok) return;
    const graphs = await r.json();
    for (const g of graphs.filter(g => g.title === title)) {
      await fetch(`${API_BASE}/graphs/${g.id}?${qs()}`, { method: 'DELETE' });
      console.log(`   🗑️  Ancien graphe supprimé : ${g.id}`);
    }
  } catch { /* ignoré */ }
}

async function createGraphAPI(graphId, title, description, nodes, edges) {
  const url = `${API_BASE}/graphs?${qs()}`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title, description, graph_type: 'network', nodes, edges }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status} — ${txt}`);
  }
  return r.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const engineLabel = ENGINE.toUpperCase();
console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`  Création de graphes — engine: ${ENGINE}` + (DATABASE ? ` / ${DATABASE}` : ''));
console.log(`  Tailles : ${SIZES.map(s => s.toLocaleString()).join(', ')} nœuds`);
console.log(`══════════════════════════════════════════════════════════\n`);

for (const nodeCount of SIZES) {
  const sizeLabel = nodeCount >= 1000 ? `${nodeCount / 1000}k` : String(nodeCount);
  const graphId     = `${ENGINE}_${sizeLabel}`;
  const title       = `${engineLabel} Graph ${nodeCount.toLocaleString()} nodes`;
  const description = `Graphe multi-communautés de ${nodeCount.toLocaleString()} nœuds (~3 arêtes/nœud) — ${ENGINE}`;

  console.log(`▶  ${title}`);
  console.log(`   Génération des nœuds et arêtes...`);

  const t0 = Date.now();
  const { nodes, edges, communityCount } = generateGraph(nodeCount);
  const genMs = Date.now() - t0;
  const ratio = (edges.length / nodes.length).toFixed(2);
  console.log(`   ✅ ${nodes.length.toLocaleString()} nœuds, ${edges.length.toLocaleString()} arêtes (${ratio}/nœud) — ${genMs} ms`);

  await deleteOldGraphsByTitle(title);

  console.log(`   📤 Envoi API (${ENGINE})...`);
  const tApi = Date.now();
  try {
    const result = await createGraphAPI(graphId, title, description, nodes, edges);
    const apiMs  = Date.now() - tApi;
    console.log(`   ✅ Créé — id: ${result.id ?? graphId}  (API: ${(apiMs/1000).toFixed(1)}s)\n`);
  } catch (err) {
    console.error(`   ❌ Erreur : ${err.message}\n`);
    process.exitCode = 1;
  }
}

// ─── Vérification finale ──────────────────────────────────────────────────────
console.log(`── Vérification (${ENGINE}) ──────────────────────────────`);
try {
  const r = await fetch(`${API_BASE}/graphs?${qs()}`);
  const graphs = await r.json();
  console.log(`   ${graphs.length} graphe(s) :\n`);
  for (const g of graphs) {
    console.log(`   • ${(g.id ?? '').padEnd(24)} ${String(g.node_count ?? '?').padStart(7)} nœuds  ${String(g.edge_count ?? '?').padStart(7)} arêtes  — ${g.title}`);
  }
} catch (err) {
  console.error(`   ❌ ${err.message}`);
}
console.log('');
