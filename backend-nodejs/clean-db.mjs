import neo4j from 'neo4j-driver';
import { config } from 'dotenv';
import readline from 'readline';

config();

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  const session = driver.session();

  try {
    console.log('🔍 Analyse de la base de données...\n');
    
    // Compter les nœuds à supprimer
    const toDelete = await session.run(`
      MATCH (n) 
      WHERE NOT n:GraphNode AND NOT n:Graph
      RETURN count(n) as count
    `);
    const deleteCountRaw = toDelete.records[0].get('count');
    const deleteCount = Number(deleteCountRaw.toString());
    
    // Compter les nœuds à garder
    const toKeep = await session.run(`
      MATCH (n) 
      WHERE n:GraphNode OR n:Graph
      RETURN count(n) as count
    `);
    const keepCountRaw = toKeep.records[0].get('count');
    const keepCount = Number(keepCountRaw.toString());
    
    console.log(`✅ Nœuds à garder (GraphNode, Graph): ${keepCount}`);
    console.log(`❌ Nœuds à supprimer (autres): ${deleteCount}\n`);
    
    if (deleteCount === 0) {
      console.log('✨ Rien à supprimer ! La base est déjà propre.');
      return;
    }
    
    const answer = await question(`⚠️  Voulez-vous supprimer ${deleteCount} nœuds et leurs relations ? (oui/non): `);
    
    if (answer.toLowerCase() !== 'oui') {
      console.log('❌ Opération annulée.');
      return;
    }
  
  console.log('\n🗑️  Suppression en cours...');
  
  // Supprimer par lots de 10000 pour éviter les timeouts
  let totalDeleted = 0;
  while (true) {
    const result = await session.run(`
      MATCH (n) 
      WHERE NOT n:GraphNode AND NOT n:Graph
      WITH n LIMIT 10000
      DETACH DELETE n
      RETURN count(n) as deleted
    `);
    
    const deletedRaw = result.records[0].get('deleted');
    const deleted = Number(deletedRaw.toString());
    totalDeleted += deleted;
    
    if (deleted === 0) break;
    
    console.log(`  ✓ ${totalDeleted} nœuds supprimés...`);
  }
  
  console.log(`\n✅ Nettoyage terminé ! ${totalDeleted} nœuds supprimés.\n`);
  
  // Vérification finale
  const final = await session.run('MATCH (n) RETURN count(n) as count');
  const finalCountRaw = final.records[0].get('count');
  const finalCount = Number(finalCountRaw.toString());
  
  console.log(`📊 Total nœuds restants: ${finalCount}`);
  console.log('🎉 Base de données nettoyée !');
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    rl.close();
    await session.close();
    await driver.close();
  }
}

main();
