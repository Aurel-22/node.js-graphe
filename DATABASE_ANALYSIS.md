# Architecture Base de Données — Graph Visualizer

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Comparatif des trois moteurs](#2-comparatif-des-trois-moteurs)
3. [Analyse détaillée par moteur](#3-analyse-détaillée-par-moteur)
4. [Le problème des CTE récursives MSSQL](#4-le-problème-des-cte-récursives-mssql)
5. [Optimisations de l'affichage](#5-optimisations-de-laffichage)
6. [Implémentation du temps réel](#6-implémentation-du-temps-réel)
7. [Futures implémentations](#7-futures-implémentations)

---

## 1. Vue d'ensemble

Le projet utilise un **Strategy Pattern** : tous les moteurs implémentent l'interface `GraphDatabaseService` (15 méthodes), ce qui permet de les interchanger via un simple paramètre `?engine=neo4j|memgraph|mssql` dans chaque requête HTTP.

```
┌──────────────┐         ┌─────────────────────────────┐
│  Frontend    │──REST──▶│  Express (resolveEngine)    │
│  React/Vite  │         │  ?engine=xxx → dbService    │
└──────────────┘         └────────┬───────┬────────┬───┘
                                  │       │        │
                           ┌──────┴──┐ ┌──┴────┐ ┌─┴──────┐
                           │ Neo4j   │ │Memgraph│ │ MSSQL  │
                           │ Bolt 5  │ │ Bolt 4 │ │ TDS    │
                           └─────────┘ └────────┘ └────────┘
```

**Données stockées** : chaque moteur gère 3 entités :
| Entité | Neo4j/Memgraph | MSSQL |
|--------|----------------|-------|
| Métadonnées graphe | Label `:Graph` | Table `graphs` |
| Nœuds | Label `:GraphNode` | Table `graph_nodes` |
| Arêtes | Relation `:CONNECTED_TO` | Table `graph_edges` |

---

## 2. Comparatif des trois moteurs

### 2.1 Performances mesurées (graphes multi-communautés, ~3 arêtes/nœud)

| Opération | Neo4j 5.26 | Memgraph 2.x | MSSQL 2022 |
|-----------|-----------|--------------|------------|
| **Création 1K nœuds** | 1.1 s | 1.9 s | 1.8 s |
| **Création 2K nœuds** | 1.3 s | 6.1 s | 3.3 s |
| **Création 5K nœuds** | 3.3 s | 35.9 s | 8.1 s |
| **Création 10K nœuds** | 6.2 s | 139 s | 16 s |
| **Lecture graphe (cache miss)** | ~20–50 ms | ~20–50 ms | ~10–30 ms |
| **Lecture graphe (cache hit)** | < 1 ms | < 1 ms | < 1 ms |
| **Traversée voisins (depth=2)** | ~5–15 ms | ~5–15 ms | ~50–300 ms |
| **Traversée voisins (depth=5)** | ~10–40 ms | ~10–40 ms | **500 ms–10 s** |

### 2.2 Synthèse comparative

| Critère | Neo4j | Memgraph | MSSQL |
|---------|-------|----------|-------|
| **Type** | BD graphe native (disque) | BD graphe native (in-memory) | BD relationnelle |
| **Modèle de stockage** | Index-free adjacency (disque + cache) | Index-free adjacency (RAM) | Tables + index B-tree |
| **Protocole** | Bolt 5.x | Bolt 4.x | TDS (Tabular Data Stream) |
| **Langage de requête** | Cypher | Cypher (sous-ensemble) | T-SQL + CTE récursive |
| **Multi-database** | ✅ Oui | ❌ Non | ✅ Oui |
| **Authentification** | ✅ user/pass | ❌ Aucune par défaut | ✅ SA/user |
| **Traversée de graphe** | Native O(1) par saut | Native O(1) par saut | CTE récursive O(n·m) |
| **Écriture batch** | UNWIND (500/batch) | UNWIND (500/batch) hérité | Multi-value INSERT (500/batch) |
| **Clustering natif** | ✅ (algorithmes intégrés) | ✅ (MAGE: +130 algos) | ❌ Manuel uniquement |
| **Consommation RAM** | ~500 Mo (Docker) | ~200 Mo–2 Go (tout en RAM) | ~1.5 Go (Docker) |
| **Licence** | Community (GPLv3) / Enterprise | BSL → Apache2 | Propriétaire (Developer gratuit) |

---

## 3. Analyse détaillée par moteur

### 3.1 Neo4j

**Comment ça fonctionne dans le projet :**
- Le driver `neo4j-driver@5.28.3` communique en Bolt 5.x
- Les requêtes `getGraph()` lancent 2 sessions parallèles via `Promise.all()` (nœuds + arêtes)
- Les insertions utilisent `UNWIND $batch` pour envoyer 500 nœuds par requête Cypher
- Cache `NodeCache` avec TTL 5 min, clé : `graph:<database>:<graphId>`
- Index composite `(graph_id, node_id)` sur `:GraphNode`

**Avantages :**
- Traversée native : chaque nœud contient un pointeur direct vers ses voisins → O(1) par saut (pas de jointure)
- Langage Cypher expressif pour les patterns complexes (`MATCH path = (a)-[*1..5]->(b)`)
- Multi-database : chaque projet peut avoir sa propre base isolée
- Écosystème riche : APOC, GDS (Graph Data Science), Neo4j Bloom
- Plan d'exécution visualisable (`PROFILE / EXPLAIN`)

**Inconvénients :**
- Écriture plus lente que MSSQL pour les insertions massives (transactions ACID strictes)
- Consommation mémoire importante en production (recommandé 4 Go+ heap)
- Version Community limitée (pas de clustering, pas de Causal Cluster)
- Docker `--network=host` obligatoire dans certains environnements (proxy)
- Driver v6 incompatible (fallback v5.28.3 nécessaire)

### 3.2 Memgraph

**Comment ça fonctionne dans le projet :**
- Hérite de `Neo4jService` (extends) → même code Cypher
- Driver `neo4j-driver@4.4.x` aliasé en `neo4j-driver-memgraph` (Bolt 4.x uniquement)
- Pas d'authentification, pas de multi-database
- Toutes les données sont en RAM → lectures ultra-rapides sur des graphes chargés

**Avantages :**
- Toutes les données en RAM → latence de lecture la plus basse (sub-milliseconde)
- Compatible Cypher → héritage direct du code Neo4j (zéro réécriture)
- MAGE : 130+ algorithmes (PageRank, Louvain, Betweenness Centrality, communautés…)
- Streams Kafka/Pulsar natifs → idéal pour le temps réel
- Léger : ~200 Mo Docker de base

**Inconvénients :**
- **Écriture très lente** avec `UNWIND` + `MATCH` pour les arêtes : Memgraph effectue un full scan par MATCH dans chaque UNWIND car les **index composites ne sont pas supportés** en v2.x
  - 10K nœuds : 139 s contre 6 s sur Neo4j (×23 plus lent)
  - C'est le principal goulot sur ce projet
- Pas de multi-database → toutes les données dans un seul namespace
- Persistence désactivée par défaut (données perdues au redémarrage sauf config WAL)
- Pas de plan `PROFILE` aussi détaillé que Neo4j
- Bolt 4.x uniquement → ne supporte pas neo4j-driver v5/v6

### 3.3 MSSQL (SQL Server 2022)

**Comment ça fonctionne dans le projet :**
- Driver `mssql@12.2.0` avec connection pooling (`max: 10`, idle timeout 30s)
- Modèle relationnel : 3 tables (`graphs`, `graph_nodes`, `graph_edges`) avec FK + `ON DELETE CASCADE`
- Insertion batch : multi-value INSERT de 500 lignes par requête (limite SQL Server : 2100 paramètres)
- Traversée via **CTE récursive** (`WITH Traverse AS (... UNION ALL ...)`)
- Requêtes nœuds + arêtes en `Promise.all()` comme Neo4j

**Avantages :**
- SQL standard → toute l'équipe sait écrire des requêtes
- Facilité de jointure avec d'autres données métier (CMDB, ticketing, inventaire)
- Transactions ACID robustes, sauvegardes simples
- Multi-database natif avec `sys.databases`
- Insertion batch plus rapide que Memgraph (16 s pour 10K vs 139 s)
- Outils d'administration matures (SSMS, Azure Data Studio)

**Inconvénients :**
- **Pas de traversée native** → CTE récursive obligatoire (voir section 4)
- Pas de langage graphe → les patterns de traversée sont verbeux en T-SQL
- Pas d'algorithmes de graphe intégrés (clustering, PageRank, centralité)
- Consommation RAM élevée (~1.5 Go minimum Docker)
- Licence propriétaire (Developer gratuit uniquement pour le dev)

---

## 4. Le problème des CTE récursives MSSQL

### 4.1 Comment fonctionne la traversée actuelle

Quand le frontend demande les voisins d'un nœud (analyse d'impact, exploration), MSSQL utilise une **CTE récursive** :

```sql
WITH Traverse AS (
  -- Ancre : le nœud de départ
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @graphId AND node_id = @nodeId

  UNION ALL

  -- Récursion : pour chaque nœud trouvé, chercher ses voisins
  SELECT n.node_id, t.lvl + 1
  FROM Traverse t
  JOIN graph_edges e ON e.source_id = t.node_id
  JOIN graph_nodes n ON n.node_id = e.target_id
  WHERE t.lvl < @maxDepth
)
```

Le code actuel fait **deux CTE** (sortante + entrante) combinées par `UNION`, puis un second `SELECT` pour récupérer les arêtes, le tout dans une seule requête avec `OPTION (MAXRECURSION 200)`.

### 4.2 Pourquoi c'est un problème

| Aspect | Neo4j / Memgraph | MSSQL CTE récursive |
|--------|------------------|---------------------|
| **Complexité** | O(k^d) avec k = degré moyen, d = profondeur. Chaque saut est un pointer follow : O(1) | O(k^d × n) — chaque niveau refait un `JOIN` sur table complète |
| **Index** | Index-free adjacency : le nœud contient la liste de ses relations | INDEX B-tree sur `graph_id` : lookup O(log n) par jointure |
| **Profondeur 2** | ~5–15 ms | ~50–300 ms |
| **Profondeur 5+** | ~10–40 ms | **500 ms à 10+ s** — croissance exponentielle |
| **Détection de cycles** | Natif (`shortestPath`, flags visited) | Aucun : MSSQL peut boucler → il faut capper `MAXRECURSION` |
| **Mémoire** | Parcours en streaming | CTE matérialisée en `tempdb` → pression mémoire |

### 4.3 Impact sur les fonctionnalités

**Temps d'affichage :**
Pour `getGraph()` (charger un graphe entier), les 3 moteurs sont comparables (~10–50 ms) car c'est un simple `SELECT WHERE graph_id = X` et les résultats sont cachés. Le problème apparaît uniquement lors de la **traversée dynamique** (`getNodeNeighbors`).

**Analyse d'impact (ImpactAnalysis) :**
L'outil ImpactAnalysis du frontend charge d'abord le graphe entier en mémoire, puis calcule la propagation côté client avec `graphology`. La traversée MSSQL n'est donc pas utilisée ici → **pas de problème direct** pour l'impact. Mais si on voulait faire de l'analyse d'impact côté serveur (plus scalable), la CTE récursive deviendrait un vrai goulot.

**Clustering :**
MSSQL n'a **aucun algorithme de clustering natif**. Pour détecter des communautés (Louvain, Label Propagation), il faudrait :
- Soit extraire les données et les envoyer à une librairie externe (Python `igraph`, `networkx`)
- Soit dupliquer les données dans Neo4j/Memgraph pour utiliser leurs algorithmes natifs
- Neo4j dispose de GDS (Graph Data Science Library) avec Louvain, PageRank, WCC, etc.
- Memgraph dispose de MAGE avec 130+ algorithmes intégrés directement en Cypher

### 4.4 Comment optimiser MSSQL si on le conserve

1. **Index couvrant sur les arêtes** :
   ```sql
   CREATE INDEX IX_edges_source ON graph_edges (graph_id, source_id) INCLUDE (target_id, label, edge_type);
   CREATE INDEX IX_edges_target ON graph_edges (graph_id, target_id) INCLUDE (source_id, label, edge_type);
   ```

2. **Limiter la profondeur** : capper `depth` à 3 maximum en production (actuellement limité à 15 dans le code, mais 5+ est déjà problématique).

3. **Table temporaire avec dédoublonnage** : au lieu de laisser la CTE revisiter des nœuds, utiliser une table `#visited` et y insérer au fur et à mesure.

4. **Pré-calculer les chemins** : pour des patterns d'impact récurrents, stocker les résultats de traversée dans une table de cache.

5. **Graph Tables SQL Server 2017+** : SQL Server supporte `CREATE TABLE AS NODE` / `AS EDGE` + `MATCH (a)-(e)->(b)` — syntaxe dédiée graphe, mais limitée en fonctionnalités.

---

## 5. Optimisations de l'affichage

### 5.1 Optimisations backend déjà en place

| Optimisation | Détail |
|---|---|
| **Cache NodeCache** | TTL 5 min, invalidation sur write. Headers `X-Cache: HIT/MISS` |
| **Requêtes parallèles** | `Promise.all()` pour nœuds + arêtes (Neo4j, MSSQL) |
| **UNWIND batching** | Insertion par lots de 500 (Neo4j/Memgraph) ou 400–500 (MSSQL) |
| **Compression gzip** | Express `compression()` middleware |
| **Headers performance** | `X-Response-Time`, `X-Parallel-Queries`, `X-Engine` |

### 5.2 Optimisations frontend déjà en place

| Optimisation | Détail |
|---|---|
| **Rendu adaptatif** | Chaque viewer ajuste taille des nœuds, labels, physique selon le `nodeCount` (seuils : <500, 500–2K, 2K–5K, 5K–10K, >10K) |
| **FPS Counter** | Canvas sparkline pour monitorer les performances de rendu |
| **7 moteurs de visualisation** | Force-Graph 2D, 3D, Sigma.js, G6, D3, Cytoscape, vis-network — chacun avec ses compromis perf/qualité |
| **Impact Analysis** | Propagation calculée côté client avec `graphology` + ForceAtlas2 |

### 5.3 Pistes d'optimisation supplémentaires

#### Backend

1. **Pagination des graphes** : au lieu de renvoyer 10K nœuds d'un coup, implémenter un `GET /graphs/:id?limit=500&offset=0` avec chargement incrémental.

2. **Streaming JSON** : utiliser `res.write()` + `Transfer-Encoding: chunked` pour envoyer les nœuds au fur et à mesure au lieu d'attendre la sérialisation complète.

3. **Compression binaire** : remplacer JSON par **MessagePack** ou **Protocol Buffers** — réduction de ~60 % de la taille des payloads pour les gros graphes.

4. **Redis comme cache** : remplacer `NodeCache` (in-process) par Redis pour partager le cache entre plusieurs instances et survivre aux redémarrages.

5. **Index de voisinage** : stocker pour chaque nœud sa liste d'adjacence pré-calculée (JSON array de `node_id` voisins) pour éviter les traversées dynamiques.

#### Frontend

1. **WebGL obligatoire >5K nœuds** : forcer Sigma.js ou Force-Graph 3D au-delà de 5K nœuds (Canvas 2D est trop lent).

2. **Level-of-Detail (LOD)** : ne rendre les labels et les détails que quand le zoom dépasse un seuil. Sigma.js le fait déjà avec `labelRenderedSizeThreshold`.

3. **Chargement progressif** : charger d'abord les hubs (nœuds avec le plus de connexions), puis les détails à la demande.

4. **Web Workers** : déporter le layout (ForceAtlas2, force simulation) dans un Worker pour ne pas bloquer le thread principal.

5. **Virtualization** : pour les listes de graphes et les panneaux latéraux, utiliser `react-virtualized` pour ne rendre que les éléments visibles.

6. **Layout pré-calculé** : au lieu de calculer la physique côté client, envoyer les positions `(x, y)` depuis le serveur (calculées une seule fois et cachées).

---

## 6. Implémentation du temps réel

### 6.1 Architecture proposée

Pour ajouter/retirer des nœuds et voir les répercussions en temps réel, l'architecture suivante est recommandée :

```
┌──────────────┐                ┌──────────────────┐
│  Frontend    │◄──WebSocket──▶ │  Backend Express │
│  React SPA   │                │  + Socket.IO     │
│  Sigma/Force │                │                  │
└──────────────┘                └────────┬─────────┘
                                         │
                                ┌────────┴─────────┐
                                │  BD Graphe        │
                                │  (Neo4j/Memgraph) │
                                └──────────────────┘
```

### 6.2 Étapes d'implémentation

#### Étape 1 — WebSocket avec Socket.IO

```bash
# Backend
npm install socket.io

# Frontend
npm install socket.io-client
```

**Backend** — ajouter dans `index.ts` :
```typescript
import { Server } from 'socket.io';
import { createServer } from 'http';

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join-graph', (graphId: string) => {
    socket.join(`graph:${graphId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Exporter io pour l'utiliser dans les routes
export { io };
```

#### Étape 2 — API de mutations temps réel

Créer de nouvelles routes REST + émission WebSocket :

```typescript
// POST /api/graphs/:id/nodes — Ajouter un nœud
router.post('/graphs/:id/nodes', async (req, res) => {
  const { node } = req.body;  // { id, label, node_type, properties }
  await service.addNode(graphId, node, database);

  // Notifier tous les clients qui visualisent ce graphe
  io.to(`graph:${graphId}`).emit('node:added', { graphId, node });
  res.status(201).json(node);
});

// DELETE /api/graphs/:id/nodes/:nodeId — Retirer un nœud
router.delete('/graphs/:id/nodes/:nodeId', async (req, res) => {
  await service.removeNode(graphId, nodeId, database);

  io.to(`graph:${graphId}`).emit('node:removed', { graphId, nodeId });
  res.status(204).send();
});

// POST /api/graphs/:id/incidents — Créer un incident
router.post('/graphs/:id/incidents', async (req, res) => {
  const { nodeId, type, severity } = req.body;

  // Calculer la propagation d'impact
  const impacted = await service.getNodeNeighbors(graphId, nodeId, 3, database);

  io.to(`graph:${graphId}`).emit('incident:created', {
    graphId,
    source: nodeId,
    type,
    severity,
    impactedNodes: impacted.nodes.map(n => n.id),
  });

  res.json({ source: nodeId, impactedCount: impacted.nodes.length });
});
```

#### Étape 3 — Frontend : écouter les événements

```typescript
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:8080');

// Rejoindre la room du graphe affiché
useEffect(() => {
  if (selectedGraphId) {
    socket.emit('join-graph', selectedGraphId);

    socket.on('node:added', ({ node }) => {
      setGraphData(prev => ({
        ...prev!,
        nodes: [...prev!.nodes, node],
      }));
    });

    socket.on('node:removed', ({ nodeId }) => {
      setGraphData(prev => ({
        ...prev!,
        nodes: prev!.nodes.filter(n => n.id !== nodeId),
        edges: prev!.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      }));
    });

    socket.on('incident:created', ({ source, impactedNodes, severity }) => {
      // Mettre en surbrillance les nœuds impactés
      highlightNodes(impactedNodes, severity);
    });

    return () => {
      socket.off('node:added');
      socket.off('node:removed');
      socket.off('incident:created');
    };
  }
}, [selectedGraphId]);
```

#### Étape 4 — Simulation d'incidents

Ajouter un panneau UI "Incident Simulator" :

```
┌─────────────────────────────────┐
│  🔴 Incident Simulator          │
│                                  │
│  Nœud source : [dropdown]        │
│  Type :  ○ Panne  ○ Surcharge    │
│  Sévérité : [1] [2] [3] [4] [5] │
│  Profondeur propagation : [3]    │
│                                  │
│  [ Déclencher l'incident ]       │
│  [ Restaurer le nœud ]           │
│                                  │
│  Nœuds impactés : 47 / 1000     │
│  Temps de propagation : 12 ms    │
└─────────────────────────────────┘
```

### 6.3 Quel moteur pour le temps réel ?

| Critère | Neo4j | Memgraph | MSSQL |
|---------|-------|----------|-------|
| **Écriture unitaire (1 nœud)** | ~2–5 ms | ~1–3 ms | ~3–8 ms |
| **Traversée d'impact depth=3** | ~5–15 ms | ~5–15 ms | ~50–300 ms |
| **Streaming natif** | ❌ (Change Data Capture via connector) | ✅ Kafka/Pulsar natif | ❌ (CDC SQL Server) |
| **Recommandé pour temps réel** | ✅ Bon | ✅✅ Excellent | ⚠️ Acceptable si depth ≤ 2 |

**Recommandation** : Memgraph est le meilleur choix pour le temps réel grâce à son stockage tout-en-RAM et ses streams natifs. Neo4j est un bon second choix. MSSQL est utilisable mais la latence de traversée au-delà de depth=2 dégradera l'expérience temps réel.

---

## 7. Futures implémentations

### 7.1 Court terme (semaines)

| Fonctionnalité | Détail | Moteur concerné |
|---|---|---|
| **CRUD nœuds/arêtes unitaires** | `addNode()`, `removeNode()`, `addEdge()`, `removeEdge()` dans `GraphDatabaseService` | Tous |
| **WebSocket Socket.IO** | Notifications temps réel de mutations | Backend |
| **Incident Simulator** | Panneau UI pour déclencher/restaurer des pannes et voir la propagation | Frontend |
| **Index couvrants MSSQL** | `IX_edges_source`, `IX_edges_target` avec `INCLUDE` | MSSQL |
| **Pagination de graphes** | `?limit=500&offset=0` pour les gros graphes | Tous |

### 7.2 Moyen terme (mois)

| Fonctionnalité | Détail |
|---|---|
| **Algorithmes de graphe** | Intégrer GDS (Neo4j) ou MAGE (Memgraph) pour PageRank, Louvain, Shortest Path, Betweenness Centrality |
| **Layout serveur** | Calculer les positions `(x, y)` côté serveur avec ForceAtlas2, les cacher, et les envoyer au frontend (évite le lag initial) |
| **Diff de graphes** | Comparer deux versions d'un graphe et montrer les nœuds ajoutés/supprimés/modifiés |
| **RBAC** | Rôles et permissions par graphe/database (lecture seule, édition, admin) |
| **Import/Export** | Supporter GEXF, GraphML, CSV pour l'import/export de graphes |
| **Historique des mutations** | Event sourcing : stocker chaque mutation en append-only pour replay et undo |

### 7.3 Long terme (trimestre+)

| Fonctionnalité | Détail |
|---|---|
| **Multi-tenant** | Isoler les données par organisation (un namespace / database par tenant) |
| **Dashboard monitoring** | Graphiques Grafana/Prometheus des métriques : latence par engine, cache hit ratio, taille des graphes |
| **GraphQL API** | Remplacer ou compléter REST par GraphQL pour des requêtes plus flexibles côté frontend |
| **IA / LLM** | Requêtes en langage naturel ("montre-moi les services impactés par le serveur X") traduites en Cypher |
| **Benchmark automatisé** | CI pipeline qui exécute les mêmes opérations sur les 3 engines et génère un rapport comparatif |
| **3D immersif** | Visualisation VR/AR des graphes avec WebXR + Three.js |

---

## Annexe — Résumé des choix techniques

| Décision | Choix actuel | Justification |
|---|---|---|
| Cache | NodeCache in-process (5 min TTL) | Simple, zéro dépendance externe, suffisant en mono-instance |
| Batch insert Neo4j | UNWIND 500/batch | Optimal entre latence réseau et taille de transaction |
| Batch insert MSSQL | Multi-value INSERT 500 lignes | Limite SQL Server de 2100 paramètres → max 500 lignes × 4 cols |
| Traversée MSSQL | Double CTE récursive (out + in) | Seule option native T-SQL, cappée à depth=15, MAXRECURSION=200 |
| Docker networking | `--network=host` pour les 3 | Proxy réseau de l'environnement bloque le bridge Docker |
| Memgraph driver | neo4j-driver@4.4.x aliasé | Memgraph 2.x rejette Bolt 5.x, impose Bolt 4.x |
| Frontend viewers | 7 moteurs + ImpactAnalysis | Chaque viewer a des compromis perf/qualité différents selon la taille du graphe |
