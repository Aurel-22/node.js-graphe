/**
 * resume-copy-valeo.mjs
 *
 * Reprend la copie du graphe incomplet dans DATA_VALEO.
 * Lit tous les graphes de dev-11 et insère ce qui manque dans DATA_VALEO
 * en paginant les lectures SQL pour éviter les OOM.
 *
 * Usage: cd backend-nodejs && node resume-copy-valeo.mjs
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
const PAGE_SIZE = 5000; // read in pages of 5000
const BATCH_INSERT_NODES = 400; // 400 × 5 params = 2000 < 2100
const BATCH_INSERT_EDGES = 330; // 330 × 6 params = 1980 < 2100

async function main() {
  const srcPool = new sql.ConnectionPool({ ...config, database: SOURCE_DB });
  const tgtPool = new sql.ConnectionPool({ ...config, database: TARGET_DB });
  await srcPool.connect();
  await tgtPool.connect();
  console.log(`✅ Connecté à ${SOURCE_DB} et ${TARGET_DB}`);

  // List all source graphs
  const graphsRes = await srcPool.request().query(`
    SELECT id, title, description, graph_type, node_count, edge_count, created_at
    FROM graphs ORDER BY node_count ASC
  `);
  const graphs = graphsRes.recordset;
  console.log(`📋 ${graphs.length} graphe(s) dans ${SOURCE_DB}\n`);

  for (const g of graphs) {
    const newId = g.id + ID_SUFFIX;
    const newTitle = TITLE_PREFIX + g.title;

    // Check current state in target
    const existsRes = await tgtPool.request()
      .input('id', sql.NVarChar(255), newId)
      .query(`SELECT COUNT(*) as cnt FROM graphs WHERE id = @id`);
    const graphExists = existsRes.recordset[0].cnt > 0;

    const actualNodesRes = await tgtPool.request()
      .input('id', sql.NVarChar(255), newId)
      .query(`SELECT COUNT(*) as cnt FROM graph_nodes WHERE graph_id = @id`);
    const actualNodes = actualNodesRes.recordset[0].cnt;

    const actualEdgesRes = await tgtPool.request()
      .input('id', sql.NVarChar(255), newId)
      .query(`SELECT COUNT(*) as cnt FROM graph_edges WHERE graph_id = @id`);
    const actualEdges = actualEdgesRes.recordset[0].cnt;

    const nodesOk = actualNodes >= g.node_count;
    const edgesOk = actualEdges >= g.edge_count;

    if (graphExists && nodesOk && edgesOk) {
      console.log(`✅ "${g.title}" — complet (${actualNodes} nœuds, ${actualEdges} arêtes)`);
      continue;
    }

    console.log(`\n🔄 "${g.title}" — attendu: ${g.node_count}N/${g.edge_count}E, actuel: ${actualNodes}N/${actualEdges}E`);
    const t0 = performance.now();

    // Create graph entry if missing
    if (!graphExists) {
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
      console.log(`   📝 Entrée graphe créée`);
    }

    // Copy missing nodes using pagination
    if (!nodesOk) {
      // Delete partial nodes and re-insert from scratch for this graph
      if (actualNodes > 0) {
        console.log(`   🗑️  Suppression de ${actualNodes} nœuds partiels...`);
        await tgtPool.request()
          .input('graphId', sql.NVarChar(255), newId)
          .query(`DELETE FROM graph_nodes WHERE graph_id = @graphId`);
      }

      console.log(`   📥 Copie de ${g.node_count} nœuds (pages de ${PAGE_SIZE})...`);
      let offset = 0;
      let totalInserted = 0;
      while (true) {
        const pageRes = await srcPool.request()
          .input('graphId', sql.NVarChar(255), g.id)
          .input('offset', sql.Int, offset)
          .input('pageSize', sql.Int, PAGE_SIZE)
          .query(`SELECT node_id, label, node_type, properties 
                  FROM graph_nodes WHERE graph_id = @graphId
                  ORDER BY id
                  OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`);
        
        const rows = pageRes.recordset;
        if (rows.length === 0) break;

        // Insert this page in sub-batches
        for (let i = 0; i < rows.length; i += BATCH_INSERT_NODES) {
          const batch = rows.slice(i, i + BATCH_INSERT_NODES);
          const req = tgtPool.request().input('graphId', sql.NVarChar(255), newId);
          const vals = batch.map((n, idx) => {
            req.input(`nid${idx}`, sql.NVarChar(255), n.node_id);
            req.input(`nlbl${idx}`, sql.NVarChar(255), n.label);
            req.input(`ntyp${idx}`, sql.NVarChar(100), n.node_type);
            req.input(`nprop${idx}`, sql.NVarChar(sql.MAX), n.properties);
            return `(@graphId, @nid${idx}, @nlbl${idx}, @ntyp${idx}, @nprop${idx})`;
          });
          await req.query(`INSERT INTO graph_nodes (graph_id, node_id, label, node_type, properties) VALUES ${vals.join(',')}`);
          totalInserted += batch.length;
        }
        
        process.stdout.write(`\r   📥 Nœuds : ${totalInserted}/${g.node_count}`);
        offset += PAGE_SIZE;
      }
      console.log(`\n   ✅ ${totalInserted} nœuds copiés`);
    }

    // Copy missing edges using pagination
    if (!edgesOk) {
      if (actualEdges > 0) {
        console.log(`   🗑️  Suppression de ${actualEdges} arêtes partielles...`);
        await tgtPool.request()
          .input('graphId', sql.NVarChar(255), newId)
          .query(`DELETE FROM graph_edges WHERE graph_id = @graphId`);
      }

      console.log(`   📥 Copie de ${g.edge_count} arêtes (pages de ${PAGE_SIZE})...`);
      let offset = 0;
      let totalInserted = 0;
      while (true) {
        const pageRes = await srcPool.request()
          .input('graphId', sql.NVarChar(255), g.id)
          .input('offset', sql.Int, offset)
          .input('pageSize', sql.Int, PAGE_SIZE)
          .query(`SELECT source_id, target_id, label, edge_type, properties
                  FROM graph_edges WHERE graph_id = @graphId
                  ORDER BY id
                  OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`);
        
        const rows = pageRes.recordset;
        if (rows.length === 0) break;

        for (let i = 0; i < rows.length; i += BATCH_INSERT_EDGES) {
          const batch = rows.slice(i, i + BATCH_INSERT_EDGES);
          const req = tgtPool.request().input('graphId', sql.NVarChar(255), newId);
          const vals = batch.map((e, idx) => {
            req.input(`esrc${idx}`, sql.NVarChar(255), e.source_id);
            req.input(`etgt${idx}`, sql.NVarChar(255), e.target_id);
            req.input(`elbl${idx}`, sql.NVarChar(255), e.label ?? '');
            req.input(`etyp${idx}`, sql.NVarChar(100), e.edge_type);
            req.input(`eprop${idx}`, sql.NVarChar(sql.MAX), e.properties);
            return `(@graphId, @esrc${idx}, @etgt${idx}, @elbl${idx}, @etyp${idx}, @eprop${idx})`;
          });
          await req.query(`INSERT INTO graph_edges (graph_id, source_id, target_id, label, edge_type, properties) VALUES ${vals.join(',')}`);
          totalInserted += batch.length;
        }

        process.stdout.write(`\r   📥 Arêtes : ${totalInserted}/${g.edge_count}`);
        offset += PAGE_SIZE;
      }
      console.log(`\n   ✅ ${totalInserted} arêtes copiées`);
    }

    const elapsed = Math.round(performance.now() - t0);
    console.log(`   ⏱️ Terminé en ${(elapsed / 1000).toFixed(1)}s`);
  }

  console.log(`\n🎉 Synchronisation terminée !`);
  await srcPool.close();
  await tgtPool.close();
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
