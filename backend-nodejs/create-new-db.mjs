import neo4j from 'neo4j-driver';
import { config } from 'dotenv';

config();

const driver = neo4j.driver(
  process.env.NEO4J_URI.replace(':7687', ':7474'), // HTTP API
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function createNewDatabase() {
  const session = driver.session({ database: 'system' });
  
  try {
    console.log('🔧 Création de la nouvelle database "graphviz"...\n');
    
    // Créer la nouvelle database
    await session.run('CREATE DATABASE graphviz IF NOT EXISTS');
    
    console.log('✅ Database "graphviz" créée !');
    console.log('\n📝 Prochaines étapes:');
    console.log('1. Modifiez votre fichier .env :');
    console.log('   NEO4J_DATABASE=graphviz');
    console.log('2. Redémarrez le backend');
    console.log('3. Les graphes d\'exemple seront créés automatiquement\n');
    
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    console.log('\n💡 Astuce: Neo4j Community Edition ne supporte pas les multi-databases.');
    console.log('   Utilisez l\'Option 1 (nettoyage) à la place.');
  } finally {
    await session.close();
    await driver.close();
  }
}

createNewDatabase();
