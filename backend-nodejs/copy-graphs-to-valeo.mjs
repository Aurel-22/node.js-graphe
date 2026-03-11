/**
 * copy-graphs-to-valeo.mjs
 *
 * Copie tous les graphes de la base dev-11 vers DATA_VALEO
 * (sans modifier les données existantes dans DATA_VALEO).
 *
 * Les graphes copiés reçoivent le préfixe "[dev-11] " dans le titre
 * et un suffixe "-dev11" dans l'id pour éviter les collisions.
 *
 * Usage :  cd backend-nodejs && node copy-graphs-to-valeo.mjs
 * Rollback : node copy-graphs-to-valeo.mjs --rollback
 */

import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const config = {
  server: process.env.MSSQL_HOST,
  port: parseInt(process.env.MSSQL_PORT || '1433'),
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 600_000,
  connectionTimeout: 15_000,
};

const SOURCE_DB = 'dev-11';
const TARGET_DB = 'DATA_VALEO';
const ID_SUFFIX = '-dev11';
const TITLE_PREFIX = '[dev-11] ';
const BATCH_NODES = 500;
const BATCH_EDGES = 400;

async function main() {
  const rollback = process.argv.includes('--rollback');

  const srcPool = new sql.ConnectionPool({ ...config, database: SOURCE_DB });
  const tgtPool = new sql.ConnectionPool({ ...config, database: TARGET_DB });
  await srcPool.connect();
  await tgtPool.connect();
  console.log(`✅ Connecté à ${SOURCE_DB} et ${TARGET_DB}`);

  if (rollback) {
    await doRollback(tgtPool);
    await srcPool.close();
    await tgtPool.close();
    return;
  }

  // Créer les tables si elles n'existent pas dans DATA_VALEO
  await tgtPool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graphs')
    CREATE TABLE graphs (
      id           NVARCHAR(255) NOT NULL PRIMARY KEY,
      title        NVARCHAR(255),
      description  NVARCHAR(MAX),
      graph_type   NVARCHAR(50),
      node_count   INT DEFAULT 0,
      edge_count   INT DEFAULT 0,
      created_at   DATETIME2 DEFAULT GETDATE()
    )
  `);
  await tgtPool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_nodes')
    BEGIN
      CREATE TABLE graph_nodes (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        graph_id    NVARCHAR(255) NOT NULL,
        node_id     NVARCHAR(255) NOT NULL,
        label       NVARCHAR(255),
        node_type   NVARCHAR(100),
        properties  NVARCHAR(MAX) DEFAULT '{}',
        CONSTRAINT UQ_graph_nodes UNIQUE (graph_id, node_id),
        CONSTRAINT FK_graph_nodes_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
      )
      CREATE INDEX IX_graph_nodes_graph_id ON graph_nodes (graph_id)
    END
  `);
  await tgtPool.request().query(`
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'graph_edges')
    BEGIN
      CREATE TABLE graph_edges (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        graph_id    NVARCHAR(255) NOT NULL,
        source_id   NVARCHAR(255) NOT NULL,
        target_id   NVARCHAR(255) NOT NULL,
        label       NVARCHAR(255),
        edge_type   NVARCHAR(100),
        properties  NVARCHAR(MAX) DEFAULT '{}',
        CONSTRAINT FK_graph_edges_graph FOREIGN KEY (graph_id) REFERENCES graphs(id) ON DELETE CASCADE
      )
      CREATE INDEX IX_graph_edges_graph_id ON graph_edges (graph_id)
      CREATE INDEX IX_graph_edges_source   ON graph_edges (graph_id, source_id)
      CREATE INDEX IX_graph_edges_target   ON graph_edges (graph_id, target_id)
    END
  `);
  console.log('📊 Tables graphs/graph_nodes/graph_edges vérifiées dans DATA_VALEO');

  // Lire les graphes sources
  const graphsRes = await srcPool.request().query(`
    SELECT id, title, description, graph_type, node_count, edge_count, created_at
    FROM graphs ORDER BY created_at
  `);
  const graphs = graphsRes.recordset;
  console.log(`📋 ${graphs.length} graphe(s) trouvé(s) dans ${SOURCE_DB}`);

  let copied = 0;
  for (const g of graphs) {
    const newId = g.id + ID_SUFFIX;
    const newTitle = TITLE_PREFIX + g.title;

    // Vérifier si déjà copié
    const exists = await tgtPool.request()
      .input('id', sql.NVarChar(255), newId)
      .query(`SELECT COUNT(*) AS cnt FROM graphs WHERE id = @id`);
    if (exists.recordset[0].cnt > 0) {
      console.log(`⏭️  "${g.title}" déjà présent → skip`);
      continue;
    }

    console.log(`\n🔄 Copie : "${g.title}" (${g.node_count} nœuds, ${g.edge_count} arêtes)`);
    const t0 = performance.now();

    // 1) Insérer le graphe
    await tgtPool.request()
      .input('id', sql.NVarChar(255), newId)
      .input('title', sql.NVarChar(255), newTitle)
      .input('description', sql.NVarChar(sql.MAX), g.description)
      .input('graphType', sql.NVarChar(50), g.graph_type)
      .input('nodeCount', sql.Int, g.node_count)
      .input('edgeCount', sql.Int, g.edge_count)
      .input('createdAt', sql.DateTime2, g.created_at)
      .query(`INSERT INTO graphs (id, title, description, graph_type, node_count, edge_count, created_at)
              VALUES (@id, @title, @description, @graphType, @nodeCount, @edgeCount, @createdAt)`);

    // 2) Copier les nœuds
    const nodesRes = await srcPool.request()
      .input('graphId', sql.NVarChar(255), g.id)
      .query(`SELECT node_id, label, node_type, properties FROM graph_nodes WHERE graph_id = @graphId`);
    const nodes = nodesRes.recordset;

    for (let i = 0; i < nodes.length; i += BATCH_NODES) {
      const batch = nodes.slice(i, i + BATCH_NODES);
      const req = tgtPool.request().input('graphId', sql.NVarChar(255), newId);
      const rows = batch.map((n, idx) => {
        req.input(`nid${idx}`, sql.NVarChar(255), n.node_id);
        req.input(`nlbl${idx}`, sql.NVarChar(255), n.label);
        req.input(`ntyp${idx}`, sql.NVarChar(100), n.node_type);
        req.input(`nprop${idx}`, sql.NVarChar(sql.MAX), n.properties);
        return `(@graphId, @nid${idx}, @nlbl${idx}, @ntyp${idx}, @nprop${idx})`;
      });
      await req.query(
        `INSERT INTO graph_nodes (graph_id, node_id, label, node_type, properties) VALUES ${rows.join(',')}`
      );
    }

    // 3) Copier les arêtes
    const edgesRes = await srcPool.request()
      .input('graphId', sql.NVarChar(255), g.id)
      .query(`SELECT source_id, target_id, label, edge_type, properties FROM graph_edges WHERE graph_id = @graphId`);
    const edges = edgesRes.recordset;

    for (let i = 0; i < edges.length; i += BATCH_EDGES) {
      const batch = edges.slice(i, i + BATCH_EDGES);
      const req = tgtPool.request().input('graphId', sql.NVarChar(255), newId);
      const rows = batch.map((e, idx) => {
        req.input(`esrc${idx}`, sql.NVarChar(255), e.source_id);
        req.input(`etgt${idx}`, sql.NVarChar(255), e.target_id);
        req.input(`elbl${idx}`, sql.NVarChar(255), e.label ?? '');
        req.input(`etyp${idx}`, sql.NVarChar(100), e.edge_type);
        req.input(`eprop${idx}`, sql.NVarChar(sql.MAX), e.properties);
        return `(@graphId, @esrc${idx}, @etgt${idx}, @elbl${idx}, @etyp${idx}, @eprop${idx})`;
      });
      await req.query(
        `INSERT INTO graph_edges (graph_id, source_id, target_id, label, edge_type, properties) VALUES ${rows.join(',')}`
      );
    }

    const elapsed = Math.round(performance.now() - t0);
    console.log(`   ✅ Copié en ${elapsed} ms`);
    copied++;
  }

  console.log(`\n🎉 ${copied} graphe(s) copié(s) de ${SOURCE_DB} → ${TARGET_DB}`);
  console.log(`   Pour annuler : node copy-graphs-to-valeo.mjs --rollback`);

  await srcPool.close();
  await tgtPool.close();
}

async function doRollback(tgtPool) {
  console.log(`🗑️  Suppression des graphes copiés (suffixe "${ID_SUFFIX}") de ${TARGET_DB}...`);
  const res = await tgtPool.request().query(`
    SELECT id, title FROM graphs WHERE id LIKE '%${ID_SUFFIX}'
  `);
  if (res.recordset.length === 0) {
    console.log('   Aucun graphe copié trouvé.');
    return;
  }
  for (const g of res.recordset) {
    await tgtPool.request()
      .input('id', sql.NVarChar(255), g.id)
      .query(`DELETE FROM graphs WHERE id = @id`);
    console.log(`   🗑️  Supprimé : "${g.title}"`);
  }
  console.log(`✅ ${res.recordset.length} graphe(s) supprimé(s)`);
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
