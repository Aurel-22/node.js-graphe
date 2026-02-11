# 🔍 Analyse d'Impact - Guide Complet

Guide pour réaliser des analyses d'impact sur les graphes Neo4j et identifier les dépendances, propagations et impacts de changements.

---

## 📋 Table des Matières

1. [Introduction](#introduction)
2. [Concepts Fondamentaux](#concepts-fondamentaux)
3. [Types d'Analyse d'Impact](#types-danalyse-dimpact)
4. [Requêtes Cypher](#requêtes-cypher)
5. [Algorithmes de Graphe Neo4j](#algorithmes-de-graphe-neo4j)
6. [Implémentation Backend](#implémentation-backend)
7. [Visualisation Frontend](#visualisation-frontend)
8. [Cas d'Usage Pratiques](#cas-dusage-pratiques)
9. [Exemples Concrets](#exemples-concrets)

---

## 🎯 Introduction

### Qu'est-ce que l'Analyse d'Impact ?

L'**analyse d'impact** consiste à identifier et évaluer les conséquences d'un changement (modification, suppression, ajout) sur un système représenté par un graphe.

### Pourquoi sur Neo4j ?

Neo4j excelle dans l'analyse d'impact grâce à :
- **Traversées rapides** de relations
- **Algorithmes de graphe** intégrés (GDS)
- **Requêtes récursives** natives (WITH RECURSIVE)
- **Pattern matching** puissant avec Cypher

### Applications

- **Systèmes IT** : Impact de mise à jour de services/APIs
- **Réseaux sociaux** : Propagation d'information
- **Supply chain** : Ruptures de chaîne logistique
- **Applications** : Dépendances entre modules
- **Données** : Impact de modification de schéma

---

## 📚 Concepts Fondamentaux

### 1. Types de Dépendances

#### Dépendances Directes
Relations immédiates entre deux nœuds.

```cypher
// Exemple: Service A dépend directement de Service B
(ServiceA)-[:DEPENDS_ON]->(ServiceB)
```

#### Dépendances Transitives
Relations indirectes via des nœuds intermédiaires.

```cypher
// Service A dépend de B qui dépend de C
(ServiceA)-[:DEPENDS_ON]->(ServiceB)-[:DEPENDS_ON]->(ServiceC)
```

#### Dépendances Circulaires
Cycles de dépendances (à identifier et résoudre).

```cypher
(A)-[:DEPENDS_ON]->(B)-[:DEPENDS_ON]->(C)-[:DEPENDS_ON]->(A)
```

### 2. Directions d'Analyse

#### Analyse Descendante (Downstream)
**Question** : "Quels éléments seront impactés si je modifie ce nœud ?"

```
        A (modifié)
       / \
      B   C  ← Impactés
     / \   \
    D   E   F ← Impactés également
```

#### Analyse Ascendante (Upstream)
**Question** : "Quels éléments dépendent de ce nœud ?"

```
    D   E
     \ /
      B  ← Dépend de A
       \
        A (analysé)
```

#### Analyse Bidirectionnelle
Combinaison des deux approches.

### 3. Profondeur d'Impact

- **Profondeur 1** : Voisins directs uniquement
- **Profondeur N** : Jusqu'à N niveaux de relations
- **Profondeur infinie** : Tous les nœuds accessibles

---

## 🔎 Types d'Analyse d'Impact

### 1. Analyse de Dépendances Directes

**Objectif** : Identifier les dépendances immédiates.

**Cas d'usage** :
- Validation avant suppression
- Gestion de permissions
- Planification de maintenance

### 2. Analyse de Propagation

**Objectif** : Tracer la propagation d'un changement dans le réseau.

**Cas d'usage** :
- Impact de panne système
- Diffusion d'information
- Contagion dans un réseau

### 3. Analyse de Criticité

**Objectif** : Identifier les nœuds critiques (SPOF - Single Point Of Failure).

**Cas d'usage** :
- Analyse de risque
- Priorisation de maintenance
- Planification de redondance

### 4. Analyse de Chemins Critiques

**Objectif** : Trouver les chemins de dépendances les plus longs ou les plus courts.

**Cas d'usage** :
- Optimisation de processus
- Estimation de temps
- Planification de déploiement

### 5. Analyse de Cycles

**Objectif** : Détecter les dépendances circulaires.

**Cas d'usage** :
- Résolution de deadlocks
- Validation d'architecture
- Refactoring de code

---

## 💻 Requêtes Cypher

### 1. Dépendances Directes (Downstream)

```cypher
// Trouver tous les nœuds impactés directement par un nœud donné
MATCH (source {id: 'node-123'})-[r:DEPENDS_ON|USES|CALLS*1..1]->(impacted)
RETURN source, r, impacted
```

### 2. Dépendances Transitives avec Profondeur Limitée

```cypher
// Impact jusqu'à 3 niveaux de profondeur
MATCH path = (source {id: 'node-123'})-[r:DEPENDS_ON*1..3]->(impacted)
RETURN path, length(path) as depth
ORDER BY depth
```

### 3. Dépendances Complètes (Tous Niveaux)

```cypher
// Tous les nœuds impactés, quelle que soit la profondeur
MATCH path = (source {id: 'node-123'})-[r:DEPENDS_ON*]->(impacted)
RETURN DISTINCT impacted.id as impactedId, 
       impacted.label as name,
       MIN(length(path)) as shortestDistance,
       COUNT(path) as numberOfPaths
ORDER BY shortestDistance
```

### 4. Analyse Bidirectionnelle

```cypher
// Upstream (qui dépend de moi) + Downstream (de qui je dépends)
MATCH (node {id: 'node-123'})
OPTIONAL MATCH upstream = (dependent)-[r1:DEPENDS_ON*1..3]->(node)
OPTIONAL MATCH downstream = (node)-[r2:DEPENDS_ON*1..3]->(impacted)
RETURN node, 
       COLLECT(DISTINCT dependent) as upstreamNodes,
       COLLECT(DISTINCT impacted) as downstreamNodes
```

### 5. Calcul du Rayon d'Impact

```cypher
// Compter le nombre de nœuds impactés par niveau
MATCH path = (source {id: 'node-123'})-[r:DEPENDS_ON*]->(impacted)
WITH length(path) as depth, COUNT(DISTINCT impacted) as impactedCount
RETURN depth, impactedCount
ORDER BY depth
```

### 6. Détection de Cycles

```cypher
// Trouver les cycles de dépendances
MATCH cycle = (n)-[r:DEPENDS_ON*2..10]->(n)
WHERE n.id = 'node-123'
RETURN cycle, length(cycle) as cycleLength
LIMIT 10
```

### 7. Points de Défaillance Uniques (SPOF)

```cypher
// Nœuds sans redondance (un seul fournisseur)
MATCH (node)
WHERE NOT (node)<-[:DEPENDS_ON]-()
  AND (node)-[:DEPENDS_ON]->()
WITH node, COUNT{(node)-[:DEPENDS_ON]->()} as dependencyCount
RETURN node.id, node.label, dependencyCount
ORDER BY dependencyCount DESC
```

### 8. Nœuds les Plus Critiques (Hub Analysis)

```cypher
// Nœuds avec le plus grand nombre de dépendants
MATCH (node)<-[r:DEPENDS_ON]-()
WITH node, COUNT(r) as dependentCount
WHERE dependentCount > 5
RETURN node.id, node.label, dependentCount
ORDER BY dependentCount DESC
LIMIT 20
```

### 9. Analyse de Chemin le Plus Court

```cypher
// Quel est le chemin de dépendance le plus court entre A et B ?
MATCH path = shortestPath((a {id: 'node-A'})-[r:DEPENDS_ON*]-(b {id: 'node-B'}))
RETURN path, length(path) as distance
```

### 10. Simulation de Suppression

```cypher
// Simuler la suppression d'un nœud et voir l'impact
MATCH (toDelete {id: 'node-123'})
MATCH (toDelete)-[r:DEPENDS_ON*]->(impacted)
WITH COLLECT(DISTINCT impacted) as affectedNodes, COUNT(DISTINCT impacted) as impactCount
RETURN impactCount as totalImpact,
       [node IN affectedNodes | node.id] as affectedNodeIds
```

---

## 🧮 Algorithmes de Graphe Neo4j

### Installation Neo4j GDS (Graph Data Science)

```cypher
// Vérifier si GDS est installé
CALL gds.version()
```

Si non installé, télécharger depuis : https://neo4j.com/download-center/#gds

### 1. PageRank - Importance des Nœuds

```cypher
// Identifier les nœuds les plus critiques
CALL gds.pageRank.stream('myGraph')
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).id AS nodeId, score
ORDER BY score DESC
LIMIT 20
```

### 2. Betweenness Centrality - Points de Passage Obligés

```cypher
// Nœuds qui sont sur le plus de chemins critiques
CALL gds.betweenness.stream('myGraph')
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).id AS nodeId, score
ORDER BY score DESC
LIMIT 20
```

### 3. Community Detection - Groupes de Dépendances

```cypher
// Identifier les clusters de dépendances
CALL gds.louvain.stream('myGraph')
YIELD nodeId, communityId
RETURN communityId, COLLECT(gds.util.asNode(nodeId).id) AS members
ORDER BY SIZE(members) DESC
```

### 4. Shortest Path - Chemin d'Impact le Plus Court

```cypher
// Chemin le plus court entre deux nœuds
MATCH (source {id: 'node-A'}), (target {id: 'node-B'})
CALL gds.shortestPath.dijkstra.stream('myGraph', {
    sourceNode: source,
    targetNode: target
})
YIELD path, totalCost
RETURN path, totalCost
```

### 5. Weakly Connected Components - Îlots de Dépendances

```cypher
// Identifier les composants isolés
CALL gds.wcc.stream('myGraph')
YIELD nodeId, componentId
WITH componentId, COLLECT(gds.util.asNode(nodeId).id) AS members
WHERE SIZE(members) > 1
RETURN componentId, members, SIZE(members) AS size
ORDER BY size DESC
```

---

## 🛠️ Implémentation Backend

### Extension du Service Neo4j

Ajouter dans `backend-nodejs/src/services/Neo4jService.ts` :

```typescript
/**
 * Analyse d'impact downstream (nœuds impactés)
 */
async getDownstreamImpact(
  nodeId: string,
  maxDepth: number = 5,
  relationTypes: string[] = ['DEPENDS_ON', 'USES', 'CALLS'],
  database?: string
): Promise<{
  impactedNodes: any[];
  impactGraph: { nodes: any[]; edges: any[] };
  statistics: {
    totalImpacted: number;
    maxDepth: number;
    avgDepth: number;
  };
}> {
  const session = this.getSession(database);
  
  try {
    const relationPattern = relationTypes.map(t => `:${t}`).join('|');
    const query = `
      MATCH path = (source {id: $nodeId})-[r${relationPattern}*1..${maxDepth}]->(impacted)
      WITH source, impacted, path, length(path) as depth
      RETURN 
        source,
        COLLECT(DISTINCT impacted) as impactedNodes,
        COLLECT(DISTINCT path) as paths,
        MIN(depth) as minDepth,
        MAX(depth) as maxDepth,
        AVG(depth) as avgDepth,
        COUNT(DISTINCT impacted) as totalImpacted
    `;

    const result = await session.run(query, { nodeId });
    
    if (result.records.length === 0) {
      return {
        impactedNodes: [],
        impactGraph: { nodes: [], edges: [] },
        statistics: { totalImpacted: 0, maxDepth: 0, avgDepth: 0 }
      };
    }

    const record = result.records[0];
    const impactedNodes = record.get('impactedNodes');
    const paths = record.get('paths');
    
    // Construire le graphe d'impact
    const nodes = new Map();
    const edges = new Map();
    
    // Ajouter le nœud source
    const source = record.get('source');
    nodes.set(source.properties.id, {
      id: source.properties.id,
      label: source.properties.label || source.properties.name,
      type: 'source',
      properties: source.properties
    });
    
    // Parcourir tous les chemins
    for (const path of paths) {
      for (let i = 0; i < path.length; i++) {
        const segment = path.segments[i];
        const startNode = segment.start;
        const endNode = segment.end;
        const relationship = segment.relationship;
        
        // Ajouter les nœuds
        if (!nodes.has(startNode.properties.id)) {
          nodes.set(startNode.properties.id, {
            id: startNode.properties.id,
            label: startNode.properties.label || startNode.properties.name,
            type: 'intermediate',
            properties: startNode.properties
          });
        }
        
        if (!nodes.has(endNode.properties.id)) {
          nodes.set(endNode.properties.id, {
            id: endNode.properties.id,
            label: endNode.properties.label || endNode.properties.name,
            type: 'impacted',
            properties: endNode.properties
          });
        }
        
        // Ajouter la relation
        const edgeKey = `${startNode.properties.id}-${endNode.properties.id}`;
        if (!edges.has(edgeKey)) {
          edges.set(edgeKey, {
            source: startNode.properties.id,
            target: endNode.properties.id,
            type: relationship.type,
            properties: relationship.properties
          });
        }
      }
    }
    
    return {
      impactedNodes: Array.from(nodes.values()),
      impactGraph: {
        nodes: Array.from(nodes.values()),
        edges: Array.from(edges.values())
      },
      statistics: {
        totalImpacted: record.get('totalImpacted').toNumber(),
        maxDepth: record.get('maxDepth').toNumber(),
        avgDepth: parseFloat(record.get('avgDepth').toFixed(2))
      }
    };
    
  } finally {
    await session.close();
  }
}

/**
 * Détection de cycles de dépendances
 */
async detectCycles(
  nodeId: string,
  maxDepth: number = 10,
  database?: string
): Promise<any[]> {
  const session = this.getSession(database);
  
  try {
    const query = `
      MATCH cycle = (n {id: $nodeId})-[r:DEPENDS_ON*2..${maxDepth}]->(n)
      RETURN cycle, length(cycle) as cycleLength
      ORDER BY cycleLength
      LIMIT 10
    `;

    const result = await session.run(query, { nodeId });
    
    return result.records.map(record => ({
      cycle: record.get('cycle'),
      length: record.get('cycleLength').toNumber()
    }));
    
  } finally {
    await session.close();
  }
}

/**
 * Identifier les nœuds critiques (SPOF)
 */
async getCriticalNodes(
  minDependents: number = 3,
  database?: string
): Promise<any[]> {
  const session = this.getSession(database);
  
  try {
    const query = `
      MATCH (node)<-[r:DEPENDS_ON]-(dependent)
      WITH node, COUNT(DISTINCT dependent) as dependentCount
      WHERE dependentCount >= $minDependents
      RETURN node, dependentCount
      ORDER BY dependentCount DESC
      LIMIT 50
    `;

    const result = await session.run(query, { minDependents });
    
    return result.records.map(record => ({
      node: record.get('node').properties,
      dependentCount: record.get('dependentCount').toNumber()
    }));
    
  } finally {
    await session.close();
  }
}
```

### Nouvelles Routes API

Créer `backend-nodejs/src/routes/impactRoutes.ts` :

```typescript
import { Router } from 'express';
import { Neo4jService } from '../services/Neo4jService';

const router = Router();
const neo4jService = new Neo4jService();

/**
 * GET /api/impact/downstream/:nodeId
 * Analyse d'impact downstream
 */
router.get('/downstream/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { maxDepth = 5, relationTypes, database } = req.query;
    
    const relations = relationTypes 
      ? (relationTypes as string).split(',')
      : ['DEPENDS_ON', 'USES', 'CALLS'];
    
    const impact = await neo4jService.getDownstreamImpact(
      nodeId,
      parseInt(maxDepth as string),
      relations,
      database as string
    );
    
    res.json(impact);
  } catch (error) {
    console.error('Error analyzing downstream impact:', error);
    res.status(500).json({ error: 'Failed to analyze impact' });
  }
});

/**
 * GET /api/impact/cycles/:nodeId
 * Détection de cycles
 */
router.get('/cycles/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const { maxDepth = 10, database } = req.query;
    
    const cycles = await neo4jService.detectCycles(
      nodeId,
      parseInt(maxDepth as string),
      database as string
    );
    
    res.json(cycles);
  } catch (error) {
    console.error('Error detecting cycles:', error);
    res.status(500).json({ error: 'Failed to detect cycles' });
  }
});

/**
 * GET /api/impact/critical
 * Nœuds critiques (SPOF)
 */
router.get('/critical', async (req, res) => {
  try {
    const { minDependents = 3, database } = req.query;
    
    const criticalNodes = await neo4jService.getCriticalNodes(
      parseInt(minDependents as string),
      database as string
    );
    
    res.json(criticalNodes);
  } catch (error) {
    console.error('Error finding critical nodes:', error);
    res.status(500).json({ error: 'Failed to find critical nodes' });
  }
});

export default router;
```

Ajouter dans `backend-nodejs/src/index.ts` :

```typescript
import impactRoutes from './routes/impactRoutes';

// ... autres imports

app.use('/api/impact', impactRoutes);
```

---

## 🎨 Visualisation Frontend

### Composant d'Analyse d'Impact

Créer `frontend-graph-viewer/src/components/ImpactAnalysis.tsx` :

```typescript
import React, { useState } from 'react';
import { impactApi } from '../services/api';
import './ImpactAnalysis.css';

interface ImpactAnalysisProps {
  nodeId: string;
  database?: string;
  onClose: () => void;
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ 
  nodeId, 
  database, 
  onClose 
}) => {
  const [loading, setLoading] = useState(false);
  const [impactData, setImpactData] = useState<any>(null);
  const [maxDepth, setMaxDepth] = useState(5);

  const analyzeImpact = async () => {
    setLoading(true);
    try {
      const data = await impactApi.getDownstreamImpact(nodeId, maxDepth, database);
      setImpactData(data);
    } catch (error) {
      console.error('Impact analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="impact-analysis-modal">
      <div className="modal-content">
        <div className="modal-header">
          <h2>🔍 Impact Analysis</h2>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="controls">
            <label>
              Max Depth:
              <input 
                type="number" 
                value={maxDepth} 
                onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                min={1}
                max={10}
              />
            </label>
            <button onClick={analyzeImpact} disabled={loading}>
              {loading ? 'Analyzing...' : 'Analyze Impact'}
            </button>
          </div>

          {impactData && (
            <div className="results">
              <div className="statistics">
                <h3>📊 Statistics</h3>
                <div className="stat-grid">
                  <div className="stat-item">
                    <span className="stat-label">Total Impacted:</span>
                    <span className="stat-value">{impactData.statistics.totalImpacted}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Max Depth:</span>
                    <span className="stat-value">{impactData.statistics.maxDepth}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Avg Depth:</span>
                    <span className="stat-value">{impactData.statistics.avgDepth}</span>
                  </div>
                </div>
              </div>

              <div className="impacted-nodes">
                <h3>🎯 Impacted Nodes ({impactData.impactedNodes.length})</h3>
                <ul>
                  {impactData.impactedNodes.map((node: any) => (
                    <li key={node.id}>
                      <span className={`node-type ${node.type}`}>{node.type}</span>
                      <span className="node-label">{node.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImpactAnalysis;
```

### Extension de l'API Frontend

Ajouter dans `frontend-graph-viewer/src/services/api.ts` :

```typescript
export const impactApi = {
  async getDownstreamImpact(
    nodeId: string, 
    maxDepth: number = 5, 
    database?: string
  ) {
    const params = new URLSearchParams({
      maxDepth: maxDepth.toString(),
      ...(database && { database })
    });
    const response = await fetch(
      `${API_BASE_URL}/impact/downstream/${nodeId}?${params}`
    );
    return response.json();
  },

  async detectCycles(nodeId: string, maxDepth: number = 10, database?: string) {
    const params = new URLSearchParams({
      maxDepth: maxDepth.toString(),
      ...(database && { database })
    });
    const response = await fetch(
      `${API_BASE_URL}/impact/cycles/${nodeId}?${params}`
    );
    return response.json();
  },

  async getCriticalNodes(minDependents: number = 3, database?: string) {
    const params = new URLSearchParams({
      minDependents: minDependents.toString(),
      ...(database && { database })
    });
    const response = await fetch(
      `${API_BASE_URL}/impact/critical?${params}`
    );
    return response.json();
  }
};
```

---

## 💼 Cas d'Usage Pratiques

### 1. Architecture Microservices

**Scénario** : Vous devez mettre à jour un service critique.

**Analyse** :
```cypher
// Identifier tous les services qui dépendent du service à mettre à jour
MATCH (service:Service {name: 'auth-service'})<-[:DEPENDS_ON*]-(dependent:Service)
RETURN DISTINCT dependent.name as dependentService,
       COUNT(*) as numberOfPaths
ORDER BY numberOfPaths DESC
```

**Résultat** : Liste des services à tester après la mise à jour.

### 2. Base de Données

**Scénario** : Modification d'un schéma de table.

**Analyse** :
```cypher
// Trouver toutes les applications impactées par le changement de table
MATCH (table:Table {name: 'users'})<-[:USES]-(query:Query)<-[:EXECUTES]-(app:Application)
RETURN DISTINCT app.name, COUNT(query) as affectedQueries
ORDER BY affectedQueries DESC
```

**Résultat** : Applications nécessitant des modifications.

### 3. Code Source

**Scénario** : Refactoring d'une fonction critique.

**Analyse** :
```cypher
// Identifier toutes les fonctions qui appellent la fonction à refactorer
MATCH (func:Function {name: 'calculatePrice'})<-[:CALLS*]-(caller)
RETURN caller.name, caller.file, caller.line
ORDER BY caller.file
```

**Résultat** : Emplacements à mettre à jour dans le code.

### 4. Infrastructure

**Scénario** : Panne d'un serveur.

**Analyse** :
```cypher
// Simuler l'impact d'une panne de serveur
MATCH (server:Server {name: 'prod-server-01'})<-[:HOSTED_ON]-(service)
MATCH (service)<-[:DEPENDS_ON*]-(impactedService)
RETURN DISTINCT impactedService.name, impactedService.type
```

**Résultat** : Services qui seront indisponibles.

### 5. Supply Chain

**Scénario** : Rupture d'approvisionnement d'un fournisseur.

**Analyse** :
```cypher
// Identifier les produits affectés par la rupture
MATCH (supplier:Supplier {name: 'ChipManufacturer'})-[:SUPPLIES]->(component)
MATCH (component)<-[:REQUIRES]-(product)
RETURN product.name, COUNT(component) as criticalComponents
ORDER BY criticalComponents DESC
```

**Résultat** : Produits en risque de rupture.

---

## 🧪 Exemples Concrets

### Exemple 1 : Workflow de Déploiement

**Graphe** :
```
    [Dev DB] ─depends─> [Dev API] ─depends─> [Dev Frontend]
       │                    │                      │
    migrates             deploys                deploys
       │                    │                      │
       ↓                    ↓                      ↓
    [QA DB] ─depends─> [QA API] ─depends─> [QA Frontend]
       │                    │                      │
    migrates             deploys                deploys
       │                    │                      │
       ↓                    ↓                      ↓
   [Prod DB] ─depends─> [Prod API] ─depends─> [Prod Frontend]
```

**Requête d'impact** :
```cypher
// Si je modifie Dev DB, quels environnements sont impactés ?
MATCH path = (db:Database {env: 'dev'})-[:MIGRATES*]->(target)
RETURN target.name, target.env, length(path) as stepsToImpact
ORDER BY stepsToImpact
```

### Exemple 2 : Réseau Social

**Graphe** :
```
  Alice ─follows─> Bob ─follows─> Charlie
    │               │                │
  posts           likes            shares
    │               │                │
    ↓               ↓                ↓
  [Post1]       [Post1]          [Post1]
```

**Requête d'impact** :
```cypher
// Si Alice publie un post, qui peut le voir ?
MATCH (alice:User {name: 'Alice'})-[:POSTS]->(post)
MATCH (post)<-[:CAN_SEE]-(viewer)
OPTIONAL MATCH path = (alice)-[:FOLLOWS*]->(viewer)
RETURN viewer.name, length(path) as degrees
ORDER BY degrees
```

### Exemple 3 : Système de Permissions

**Graphe** :
```
  [Admin] ─grants─> [Moderator] ─grants─> [User]
     │                  │                   │
  can_delete        can_edit            can_view
     │                  │                   │
     └─────────────────┴───────────────────┘
                       ↓
                   [Resource]
```

**Requête d'impact** :
```cypher
// Si je révoque le rôle Moderator, qui perd l'accès ?
MATCH (mod:Role {name: 'Moderator'})<-[:HAS_ROLE]-(user)
MATCH (user)-[:HAS_PERMISSION]->(resource)
WHERE NOT (user)-[:HAS_ROLE]->(:Role {name: 'Admin'})
RETURN user.name, COUNT(resource) as lostResources
```

---

## 📊 Métriques d'Impact

### Métriques Essentielles

1. **Blast Radius** : Nombre total de nœuds impactés
2. **Max Depth** : Profondeur maximale de propagation
3. **Critical Path Length** : Longueur du chemin le plus critique
4. **Dependency Fan-out** : Nombre moyen de dépendances par nœud
5. **Cycle Count** : Nombre de cycles détectés

### Calcul des Métriques

```cypher
// Dashboard complet d'analyse d'impact
MATCH (source {id: 'node-123'})

// Blast Radius
OPTIONAL MATCH (source)-[r:DEPENDS_ON*]->(impacted)
WITH source, COUNT(DISTINCT impacted) as blastRadius

// Max Depth
OPTIONAL MATCH path = (source)-[r:DEPENDS_ON*]->(impacted)
WITH source, blastRadius, MAX(length(path)) as maxDepth

// Cycles
OPTIONAL MATCH cycle = (source)-[r:DEPENDS_ON*2..10]->(source)
WITH source, blastRadius, maxDepth, COUNT(cycle) as cycleCount

// Fan-out
MATCH (source)-[r:DEPENDS_ON]->(direct)
WITH source, blastRadius, maxDepth, cycleCount, COUNT(direct) as fanOut

RETURN {
  nodeId: source.id,
  blastRadius: blastRadius,
  maxDepth: maxDepth,
  cycleCount: cycleCount,
  fanOut: fanOut,
  riskLevel: CASE 
    WHEN blastRadius > 100 THEN 'CRITICAL'
    WHEN blastRadius > 50 THEN 'HIGH'
    WHEN blastRadius > 20 THEN 'MEDIUM'
    ELSE 'LOW'
  END
} as impactMetrics
```

---

## 🚀 Prochaines Étapes

### Phase 1 : Backend
- [ ] Implémenter les méthodes d'analyse dans Neo4jService
- [ ] Créer les routes API d'impact
- [ ] Ajouter des tests unitaires

### Phase 2 : Frontend
- [ ] Créer le composant ImpactAnalysis
- [ ] Intégrer dans les viewers de graphes
- [ ] Ajouter des visualisations d'impact (heatmap, sunburst)

### Phase 3 : Optimisation
- [ ] Mettre en cache les résultats d'analyse fréquents
- [ ] Implémenter des analyses asynchrones pour grands graphes
- [ ] Ajouter des algorithmes GDS avancés

### Phase 4 : Améliorations
- [ ] Export des rapports d'impact (PDF, CSV)
- [ ] Alertes automatiques sur nœuds critiques
- [ ] Simulation de scénarios "what-if"
- [ ] Timeline de propagation d'impact

---

## 📚 Ressources

### Documentation
- **Neo4j Cypher** : https://neo4j.com/docs/cypher-manual/
- **Neo4j GDS** : https://neo4j.com/docs/graph-data-science/
- **Impact Analysis Theory** : https://en.wikipedia.org/wiki/Impact_analysis

### Livres Recommandés
- "Graph Algorithms" by Mark Needham & Amy E. Hodler
- "Neo4j in Action" by Aleksa Vukotic
- "Impact Analysis in Software Engineering" by Steffen M. Olbrich

### Outils Complémentaires
- **Neo4j Bloom** : Visualisation et exploration
- **Neo4j Desktop** : Environnement de développement
- **Apache AGE** : Alternative PostgreSQL pour graphes

---

## ✅ Checklist d'Implémentation

- [ ] Définir les types de relations à analyser
- [ ] Créer les requêtes Cypher d'analyse
- [ ] Implémenter les méthodes backend
- [ ] Créer les endpoints API REST
- [ ] Développer l'interface utilisateur
- [ ] Ajouter des visualisations
- [ ] Tester sur des graphes réels
- [ ] Optimiser les performances
- [ ] Documenter les cas d'usage
- [ ] Former les utilisateurs

---

## 🎯 Résumé

L'**analyse d'impact** est essentielle pour :
- ✅ Anticiper les conséquences de modifications
- ✅ Identifier les risques et points critiques
- ✅ Optimiser les processus de déploiement
- ✅ Maintenir la stabilité des systèmes
- ✅ Prendre des décisions éclairées

Avec **Neo4j**, vous disposez d'outils puissants pour réaliser des analyses d'impact sophistiquées rapidement et efficacement.

**🚀 Commencez dès maintenant à analyser vos dépendances !**
