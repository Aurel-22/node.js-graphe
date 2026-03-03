/**
 * Crée 4 graphes dans MSSQL via l'API REST :
 *   - 1 000  nœuds  (~3 000  arêtes)
 *   - 2 000  nœuds  (~6 000  arêtes)
 *   - 5 000  nœuds  (~15 000 arêtes)
 *   - 10 000 nœuds  (~30 000 arêtes)
 *
 * Structure multi-communautés réaliste (~3 arêtes par nœud en moyenne).
 * Utilise le endpoint POST /api/graphs?engine=mssql avec nodes/edges JSON.
 *
 * Usage :
 *   node create-mssql-graphs.mjs
 *   node create-mssql-graphs.mjs --sizes 1000,2000   # seulement certaines tailles
 */

const API_BASE = 'http://127.0.0.1:8080/api';
const ENGINE   = 'mssql';
const DATABASE = 'graph_db';

const NODE_TYPES = [
  'process', 'service', 'database', 'api', 'user',
  'system', 'queue', 'notification', 'validation', 'action',
];
const EDGE_TYPES = ['calls', 'depends_on', 'reads', 'writes', 'triggers', 'validates', 'notifies', 'queues'];

// ─── Sélection des tailles via argument CLI ───────────────────────────────────
const allSizes = [1_000, 2_000, 5_000, 10_000];
const sizesArg = process.argv.find(a => a.startsWith('--sizes='));
const SIZES = sizesArg
  ? sizesArg.replace('--sizes=', '').split(',').map(Number)
  : allSizes;

// ─── Générateur de graphe ─────────────────────────────────────────────────────

/**
 * Génère nodes + edges pour un graphe de `nodeCount` nœuds réparti en
 * communautés. Cible ~3 arêtes dirigées par nœud en moyenne.
 *
 * Règles de connexion (intra-communauté) :
 *   1. Chaîne avant     : i → i+1        (toujours)            ≈ 1.00/nœud
 *   2. Saut +3          : i → i+3        (toujours si dispo)   ≈ 0.97/nœud
 *   3. Saut +2          : i → i+2        (si i%2 == 0)         ≈ 0.47/nœud
 *   4. Saut +7          : i → i+7        (si i%3 == 0)         ≈ 0.30/nœud
 *   5. Saut +5          : i → i+5        (si i%4 == 0)         ≈ 0.23/nœud
 *   6. Raccourci hub    : C_N0 → C_Ni    (i multiple de 15)    ≈ 0.07/nœud
 *   7. Pont inter-comm. : Cx_N0 → Cy_N0 + quelques nœuds dans chaque paire
 *
 * Total ≈ 3.04 arêtes/nœud en moyenne
 */
function generateGraph(nodeCount) {
  const communityCount = nodeCount <= 1_000 ? 5
                       : nodeCount <= 2_000 ? 8
                       : nodeCount <= 5_000 ? 10
                       : 15;
  const nodesPerCommunity = Math.floor(nodeCount / communityCount);

  // ── Nœuds ──
  const nodes = [];
  for (let c = 0; c < communityCount; c++) {
    const type = NODE_TYPES[c % NODE_TYPES.length];
    const count = (c === communityCount - 1)
      ? nodeCount - c * nodesPerCommunity   // dernière communauté absorbe le reste
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

  // ── Arêtes ──
  const edgeSet = new Set();
  const edges   = [];

  function addEdge(src, tgt, type) {
    if (src === tgt) return;
    const key = `${src}→${tgt}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({
      source:    src,
      target:    tgt,
      edge_type: type,
      label:     type,
      properties: {},
    });
  }

  // Taille réelle de chaque communauté
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

      // Règle 1 — chaîne avant
      if (i + 1 < sz) addEdge(nodeId, `C${c}_N${i + 1}`, 'calls');

      // Règle 2 — saut +3
      if (i + 3 < sz) addEdge(nodeId, `C${c}_N${i + 3}`, 'depends_on');

      // Règle 3 — saut +2 (1 nœud sur 2)
      if (i % 2 === 0 && i + 2 < sz) addEdge(nodeId, `C${c}_N${i + 2}`, 'reads');

      // Règle 4 — saut +7 (1 nœud sur 3)
      if (i % 3 === 0 && i + 7 < sz) addEdge(nodeId, `C${c}_N${i + 7}`, et);

      // Règle 5 — saut +5 (1 nœud sur 4)
      if (i % 4 === 0 && i + 5 < sz) addEdge(nodeId, `C${c}_N${i + 5}`, 'writes');

      // Règle 6 — hub radial (hub → nœud tous les 15)
      if (i > 0 && i % 15 === 0) addEdge(`C${c}_N0`, nodeId, 'queues');
    }
  }

  // Règle 5 — ponts inter-communautés
  for (let c = 0; c < communityCount; c++) {
    const nextC = (c + 1) % communityCount;
    const sz    = commSize(c);

    // Hub ↔ hub adjacents
    addEdge(`C${c}_N0`, `C${nextC}_N0`, 'calls');

    // Quelques nœuds pivot (tous les ~20 % de la communauté)
    const step = Math.max(1, Math.floor(sz / 5));
    for (let i = step; i < sz; i += step) {
      addEdge(`C${c}_N${i}`, `C${nextC}_N${Math.min(i, commSize(nextC) - 1)}`, 'triggers');
    }

    // Pont vers communauté opposée (skip 2)
    const oppC = (c + 2) % communityCount;
    addEdge(`C${c}_N0`, `C${oppC}_N0`, 'notifies');
  }

  return { nodes, edges, communityCount };
}

// ─── Appel API ────────────────────────────────────────────────────────────────

async function deleteOldGraphsByTitle(title) {
  try {
    const r = await fetch(`${API_BASE}/graphs?engine=${ENGINE}&database=${DATABASE}`);
    if (!r.ok) return;
    const graphs = await r.json();
    const toDelete = graphs.filter(g => g.title === title);
    for (const g of toDelete) {
      await fetch(`${API_BASE}/graphs/${g.id}?engine=${ENGINE}&database=${DATABASE}`, { method: 'DELETE' });
      console.log(`   🗑️  Ancien graphe supprimé : ${g.id}`);
    }
  } catch {
    // ignoré
  }
}

async function createGraph(graphId, title, description, nodes, edges) {
  const body = {
    title,
    description,
    graph_type: 'network',
    nodes,
    edges,
  };

  const url = `${API_BASE}/graphs?engine=${ENGINE}&database=${DATABASE}`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status} — ${txt}`);
  }
  return r.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Création de graphes MSSQL — moteur : mssql / graph_db');
console.log(`  Tailles : ${SIZES.join(', ')} nœuds`);
console.log('══════════════════════════════════════════════════════════\n');

for (const nodeCount of SIZES) {
  const graphId    = `mssql_${nodeCount}k`.replace('000k', 'k');
  const title      = `MSSQL Graph ${nodeCount.toLocaleString()} nodes`;
  const description = `Graphe multi-communautés de ${nodeCount.toLocaleString()} nœuds (~3 arêtes/nœud) généré pour MSSQL`;

  console.log(`▶  ${title}`);
  console.log(`   Génération des nœuds et arêtes...`);

  const t0 = Date.now();
  const { nodes, edges, communityCount } = generateGraph(nodeCount);
  const genMs = Date.now() - t0;

  const edgesPerNode = (edges.length / nodes.length).toFixed(2);
  console.log(`   ✅ ${nodes.length.toLocaleString()} nœuds, ${edges.length.toLocaleString()} arêtes (${edgesPerNode}/nœud) — généré en ${genMs} ms`);
  console.log(`   📤 Envoi à l'API...`);

  // Supprimer les anciens s'ils existent (idempotent)
  await deleteOldGraphsByTitle(title);

  const tApi = Date.now();
  try {
    const result = await createGraph(graphId, title, description, nodes, edges);
    const apiMs  = Date.now() - tApi;
    console.log(`   ✅ Créé — id: ${result.id ?? graphId}  (API: ${apiMs} ms)\n`);
  } catch (err) {
    console.error(`   ❌ Erreur : ${err.message}\n`);
    process.exitCode = 1;
  }
}

// ─── Vérification finale ──────────────────────────────────────────────────────
console.log('── Vérification finale ────────────────────────────────────');
try {
  const r = await fetch(`${API_BASE}/graphs?engine=${ENGINE}&database=${DATABASE}`);
  const graphs = await r.json();
  console.log(`   ${graphs.length} graphe(s) trouvé(s) dans graph_db :\n`);
  for (const g of graphs) {
    console.log(`   • ${g.id.padEnd(20)} ${String(g.node_count ?? '?').padStart(7)} nœuds   ${String(g.edge_count ?? '?').padStart(7)} arêtes   — ${g.title}`);
  }
} catch (err) {
  console.error(`   ❌ Vérification impossible : ${err.message}`);
}
console.log('');
