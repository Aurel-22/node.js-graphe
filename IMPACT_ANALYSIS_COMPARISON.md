# Analyse d'Impact — Comparaison MSSQL vs Neo4j

Comparaison détaillée de l'analyse d'impact côté serveur et côté client,
avec benchmarks réels sur des graphes de 1 000 à 30 000 nœuds (~3 arêtes/nœud).

---

## 1. Ce que fait l'analyse d'impact

À partir d'un nœud « bloquant » (en panne), on propage l'impact vers tous les
nœuds accessibles en suivant les **arêtes sortantes** (downstream).
Le résultat est la liste des nœuds impactés avec leur **niveau** (distance BFS
depuis la source).

---

## 2. Côté client vs côté serveur — comment ça marche

### 2.1 Côté client (navigateur)

Le frontend charge la totalité du graphe (`GET /api/graphs/:id`) puis construit
un graphe **graphology** en mémoire JavaScript. Quand l'utilisateur clique sur
un nœud, un BFS pur JavaScript parcourt les voisins sortants :

```javascript
// ImpactAnalysis.tsx — BFS client (simplifié)
const bfsStart = performance.now();
const visited = new Set([nodeId]);
const queue = [...graph.outNeighbors(nodeId)];

while (queue.length > 0) {
  const current = queue.shift();
  if (hasDependencyBlocked(current)) {
    markImpacted(current);
    graph.forEachOutNeighbor(current, (n) => {
      if (!visited.has(n)) { queue.push(n); visited.add(n); }
    });
  }
}
clientTime = performance.now() - bfsStart;  // sub-milliseconde
```

**Données déjà en RAM** → le BFS ne fait aucun I/O, aucune requête réseau.

### 2.2 Côté serveur — Neo4j (Cypher)

Neo4j exécute une requête Cypher de traversée variable-length :

```cypher
MATCH path = (source:GraphNode {graph_id: $graphId, node_id: $nodeId})
             -[:CONNECTED_TO*1..5]->
             (n:GraphNode {graph_id: $graphId})
RETURN n.node_id AS nodeId, min(length(path)) AS level
```

Neo4j utilise l'**index-free adjacency** : chaque nœud stocke physiquement un
pointeur mémoire vers ses voisins. Pas de scan de table, pas de JOIN. La
traversée est un simple parcours de pointeurs en mémoire, identique à un BFS
sur une structure de données chaînée.

**Complexité** : O(k^d) où k = degré moyen (~3), d = profondeur.

### 2.3 Côté serveur — MSSQL (CTE récursive)

MSSQL n'a pas de structure de graphe native. Les données sont stockées dans des
tables relationnelles classiques :

```
graph_nodes (graph_id, node_id, label, node_type, properties)
graph_edges (graph_id, source_id, target_id, edge_type, label)
```

La traversée utilise une **CTE récursive** (Common Table Expression) :

```sql
WITH Impact AS (
  -- Ancre : le nœud source
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @graphId AND node_id = @nodeId

  UNION ALL

  -- Récursion : tous les voisins sortants de chaque nœud trouvé
  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @graphId AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @graphId AND n.node_id   = e.target_id
  WHERE i.lvl < @maxDepth
)
SELECT node_id AS nodeId, MIN(lvl) AS level
FROM Impact
WHERE node_id <> @nodeId
GROUP BY node_id
OPTION (MAXRECURSION 200)
```

**À chaque niveau de profondeur**, SQL Server doit :
1. Prendre tous les nœuds du niveau courant
2. Faire un **JOIN** sur toute la table `graph_edges` pour trouver les voisins
3. Faire un **JOIN** sur `graph_nodes` pour valider l'existence
4. Matérialiser toutes les lignes intermédiaires (y compris les doublons)
5. Ne dédupliquer qu'à la fin avec `GROUP BY` + `MIN(lvl)`

**Complexité** : O(k^d × n) par niveau, où n = taille de la table scannée.

---

## 3. Benchmarks réels

Tous les graphes ont la **même topologie** (même script de génération, ~3.15
arêtes/nœud, même nœud source `C0_N0`). Les résultats sont identiques en nombre
de nœuds impactés — seul le temps diffère.

### 3.1 Depth = 3

| Nœuds | Impactés | Neo4j | MSSQL | Ratio |
|------:|--------:|------:|------:|------:|
| 1 000 | 326 | **7 ms** | 29 ms | 4× |
| 2 000 | 402 | **7 ms** | 33 ms | 5× |
| 5 000 | 772 | **8 ms** | 65 ms | 8× |
| 10 000 | 1 020 | **11 ms** | 58 ms | 5× |
| 20 000 | 1 513 | **14 ms** | 65 ms | 5× |
| 30 000 | 1 803 | **22 ms** | 63 ms | 3× |

À faible profondeur, MSSQL reste raisonnable (3-8× plus lent). La CTE ne
matérialise que ~3^3 = 27 chemins par nœud, le JOIN est contenu.

### 3.2 Depth = 5

| Nœuds | Impactés | Neo4j | MSSQL | Ratio |
|------:|--------:|------:|------:|------:|
| 1 000 | 878 | **10 ms** | 154 ms | 15× |
| 2 000 | 1 292 | **18 ms** | 182 ms | 10× |
| 5 000 | 2 587 | **30 ms** | 302 ms | 10× |
| 10 000 | 3 437 | **24 ms** | 382 ms | 16× |
| 20 000 | 5 139 | **87 ms** | 537 ms | 6× |
| 30 000 | 6 149 | **40 ms** | 637 ms | 16× |

Le gap commence à se creuser. MSSQL dépasse la demi-seconde sur 30K.

### 3.3 Depth = 8 — la divergence explose

| Nœuds | Impactés | Neo4j | MSSQL | Ratio |
|------:|--------:|------:|------:|------:|
| 1 000 | 1 000 | **7 ms** | 4 122 ms | **589×** |
| 5 000 | 4 815 | **37 ms** | 8 168 ms | **221×** |
| 10 000 | 7 433 | **58 ms** | 10 788 ms | **186×** |
| 20 000 | 11 139 | **85 ms** | 15 045 ms | **177×** |
| 30 000 | 13 349 | **97 ms** | 18 637 ms | **192×** |

À depth=8, MSSQL met **18.6 secondes** là où Neo4j répond en **97 ms**.
La CTE matérialise des millions de lignes intermédiaires dupliquées avant
le `GROUP BY` final.

### 3.4 Visualisation de la courbe

```
Temps (ms)     Neo4j ●    MSSQL ■
  18 637 │                                              ■ 30K d=8
  15 045 │                                         ■ 20K d=8
  10 788 │                                    ■ 10K d=8
   8 168 │                               ■ 5K d=8
   4 122 │                          ■ 1K d=8
         │
     637 │                     ■ 30K d=5
     382 │                ■ 10K d=5
      97 │  ● 30K d=8
      65 │  ● 5K d=5      ■ 30K d=3
      22 │  ● 30K d=3
       7 │  ● 1K d=3
         └──────────────────────────────────────────→ taille × profondeur
```

---

## 4. Pourquoi MSSQL est exponentiellement plus lent

### 4.1 Pas de pointeurs directs (index-free adjacency)

Neo4j stocke sur chaque nœud un **pointeur physique** vers ses relations.
Passer d'un nœud à ses voisins = déréférencer un pointeur en mémoire (O(1)).

MSSQL doit **chercher dans une table** les arêtes correspondantes :
```
Pour chaque nœud du front BFS :
  → lire l'index sur (graph_id, source_id)
  → faire un nested loop join sur graph_edges
  → faire un second join sur graph_nodes
```

### 4.2 Explosion combinatoire de la CTE

La CTE SQL produit **toutes les lignes intermédiaires** avant déduplication :

```
Depth 1 :     3 lignes   (3 voisins)
Depth 2 :     9 lignes   (3 × 3)
Depth 3 :    27 lignes   (3^3)
Depth 5 :   243 lignes   (3^5)
Depth 8 : 6 561 lignes   (3^8)
```

Et c'est **par nœud source**. Avec 1 000 nœuds qui atteignent tous des voisins,
la CTE peut matérialiser **des millions de lignes** (chemins vers le même nœud
par des routes différentes). Neo4j gère ça en interne avec un `min(length)`
qui élague les chemins redondants pendant la traversée.

### 4.3 UNION ALL sans déduplication

`UNION ALL` dans la CTE conserve les doublons. Si un nœud N est atteint par 50
chemins différents, il apparaît 50 fois dans la table intermédiaire. La
déduplication (`GROUP BY`, `MIN(lvl)`) n'arrive qu'à la toute fin.

### 4.4 Pas de cache de traversée

Neo4j maintient un cache de traversée (traversal cache) qui mémorise les nœuds
déjà visités pendant l'exécution de la requête. SQL Server n'a pas ce concept
dans une CTE — chaque niveau repart de zéro.

---

## 5. Côté client vs côté serveur — avantages et inconvénients

### 5.1 Analyse côté client (graphology BFS dans le navigateur)

| | |
|---|---|
| **✅ Instantané** | BFS en mémoire JavaScript, < 1 ms même sur 30K nœuds |
| **✅ Pas de latence réseau** | Aucun round-trip HTTP |
| **✅ Interactif** | L'utilisateur peut cliquer/réinitialiser/re-propager en temps réel |
| **✅ Indépendant du moteur** | Fonctionne identiquement quel que soit le backend |
| **❌ Données pré-chargées** | Le graphe complet doit être téléchargé avant l'analyse (latence initiale) |
| **❌ Limité par la RAM navigateur** | Au-delà de ~100K nœuds, le navigateur ralentit ou crashe |
| **❌ Pas vérifiable côté serveur** | Le résultat n'est pas auditable (pas de log serveur) |
| **❌ Topologie figée** | Si le graphe change en base pendant l'analyse, le client a une vue obsolète |

### 5.2 Analyse côté serveur (requête DB)

| | |
|---|---|
| **✅ Données toujours à jour** | La requête lit l'état actuel de la base |
| **✅ Pas de transfert préalable** | Pas besoin de charger le graphe complet côté client |
| **✅ Auditable** | Le résultat est loggable, cachable, reproductible |
| **✅ Scalable (Neo4j)** | Reste < 100 ms même sur 30K nœuds à depth=8 |
| **❌ Latence réseau** | Surcoût HTTP (10-50 ms selon l'infrastructure) |
| **❌ Dépendant du moteur** | Performance très variable (Neo4j vs MSSQL : 192× sur depth=8) |
| **❌ MSSQL : coût exponentiel** | CTE récursive ≥ 4 secondes dès depth=8 sur 1K nœuds |
| **❌ Charge serveur** | Chaque requête mobilise CPU/mémoire sur le serveur de base de données |

### 5.3 Quand utiliser lequel ?

| Cas d'usage | Recommandation |
|-------------|---------------|
| Exploration interactive (clic → impact visuel) | **Client** |
| Profondeur ≤ 5 avec retour rapide | **Serveur (tout moteur)** |
| Profondeur > 5, graphe > 10K nœuds | **Serveur Neo4j uniquement** |
| Audit / traçabilité de l'impact | **Serveur** |
| Application mobile / client léger | **Serveur** |
| Graphe > 100K nœuds, navigateur limité | **Serveur** |
| Comparaison moteurs / benchmarking | **Les deux** (c'est ce que fait notre panel) |

---

## 6. Comment optimiser MSSQL pour l'analyse d'impact

### 6.1 Index dédiés (impact immédiat)

Créer des index couvrants sur les colonnes utilisées par la CTE :

```sql
-- Index principal pour la traversée BFS
CREATE NONCLUSTERED INDEX IX_edges_source
ON graph_edges (graph_id, source_id)
INCLUDE (target_id, edge_type);

-- Index inverse pour la traversée upstream
CREATE NONCLUSTERED INDEX IX_edges_target
ON graph_edges (graph_id, target_id)
INCLUDE (source_id, edge_type);

-- Index sur les nœuds pour le JOIN
CREATE NONCLUSTERED INDEX IX_nodes_graphid_nodeid
ON graph_nodes (graph_id, node_id)
INCLUDE (label, node_type);
```

**Gain estimé** : 20-40% sur les petites profondeurs (le scan d'index remplace
le scan de table dans le JOIN).

### 6.2 CTE avec déduplication par niveau (anti-explosion)

Remplacer la CTE simple par une approche qui élimine les doublons **à chaque
niveau** au lieu d'attendre le `GROUP BY` final :

```sql
-- ❌ Actuel : accumule tous les chemins puis déduplique
WITH Impact AS (
  SELECT node_id, 0 AS lvl FROM graph_nodes WHERE ...
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM Impact i JOIN graph_edges e ...
  WHERE i.lvl < @maxDepth
)
SELECT node_id, MIN(lvl) FROM Impact GROUP BY node_id

-- ✅ Optimisé : BFS itératif niveau par niveau dans une procédure stockée
CREATE PROCEDURE sp_impact_bfs
  @graphId NVARCHAR(255), @nodeId NVARCHAR(255), @maxDepth INT
AS BEGIN
  CREATE TABLE #frontier (node_id NVARCHAR(255) PRIMARY KEY);
  CREATE TABLE #visited  (node_id NVARCHAR(255) PRIMARY KEY, lvl INT);

  -- Niveau 0
  INSERT INTO #frontier VALUES (@nodeId);
  INSERT INTO #visited  VALUES (@nodeId, 0);

  DECLARE @d INT = 1;
  WHILE @d <= @maxDepth AND EXISTS (SELECT 1 FROM #frontier)
  BEGIN
    -- Trouver les voisins non encore visités
    INSERT INTO #visited (node_id, lvl)
    SELECT DISTINCT e.target_id, @d
    FROM #frontier f
    JOIN graph_edges e ON e.graph_id = @graphId AND e.source_id = f.node_id
    WHERE NOT EXISTS (SELECT 1 FROM #visited v WHERE v.node_id = e.target_id);

    -- Le nouveau frontier = les nœuds juste insérés
    TRUNCATE TABLE #frontier;
    INSERT INTO #frontier
    SELECT node_id FROM #visited WHERE lvl = @d;

    SET @d = @d + 1;
  END

  SELECT node_id AS nodeId, lvl AS level
  FROM #visited
  WHERE node_id <> @nodeId;
END
```

**Gain estimé** : 10-50× sur depth ≥ 5. Chaque niveau ne traite que les
**nouveaux** nœuds (pas de re-exploration des chemins déjà vus).

### 6.3 SQL Server Graph Tables (solution native)

SQL Server 2017+ propose des **tables graphe** avec syntaxe `MATCH` :

```sql
-- Créer les tables en mode graphe
CREATE TABLE GraphNodesNative (
  node_id NVARCHAR(255),
  graph_id NVARCHAR(255),
  label NVARCHAR(255)
) AS NODE;

CREATE TABLE ConnectedTo (
  edge_type NVARCHAR(255)
) AS EDGE;

-- Requête avec MATCH (traversée native)
SELECT n2.node_id
FROM GraphNodesNative n1, ConnectedTo e, GraphNodesNative n2
WHERE MATCH(n1-(e)->n2)
  AND n1.node_id = @nodeId;
```

**Limitation** : SQL Server 2022 ne supporte que des traversées `MATCH` de
profondeur fixe (pas de `*1..N` comme Cypher). Il faut chaîner manuellement :

```sql
-- Depth=3 avec SHORTEST_PATH (SQL Server 2019+)
SELECT LAST_VALUE(n2.node_id) WITHIN GROUP (GRAPH PATH)
FROM GraphNodesNative n1,
     ConnectedTo FOR PATH e,
     GraphNodesNative FOR PATH n2
WHERE MATCH(SHORTEST_PATH(n1(-(e)->n2)+))
  AND n1.node_id = @nodeId;
```

**Gain estimé** : 5-20× vs CTE, mais la syntaxe est limitée et ne couvre pas
tous les cas de notre analyse.

### 6.4 Cache applicatif des résultats

Puisque la topologie du graphe change rarement, on peut mettre en cache le
résultat de `computeImpact` :

```typescript
// Clé de cache : graphId + nodeId + depth + engine
const cacheKey = `impact:${graphId}:${nodeId}:${depth}`;
const cached = impactCache.get(cacheKey);
if (cached) return cached;

const result = await computeImpact(...);
impactCache.set(cacheKey, result, 300); // TTL 5 min
return result;
```

**Gain** : de 18 000 ms à 0 ms sur les requêtes répétées.

### 6.5 Limiter la profondeur côté API

Ajouter un cap dur dans la route pour MSSQL :

```typescript
// Dans graphRoutes.ts
const maxAllowed = engine === 'mssql' ? 5 : 15;
const safeDep = Math.min(depth, maxAllowed);
```

Cela empêche les requêtes d=8+ qui font exploser la CTE.

### 6.6 Résumé des optimisations

| Optimisation | Complexité | Gain estimé | Risque |
|-------------|-----------|------------|--------|
| Index couvrants | Faible | 20-40% | Aucun |
| Procédure BFS itérative | Moyenne | **10-50×** | Tests nécessaires |
| SQL Server Graph Tables | Élevée | 5-20× | Refonte schéma |
| Cache applicatif | Faible | **∞** (cache hit) | Données périmées |
| Cap de profondeur | Trivial | Empêche timeout | Fonctionnel limité |

---

## 7. Conclusion

| Critère | Neo4j | MSSQL |
|---------|-------|-------|
| Modèle de données | Graphe natif (nœuds + pointeurs) | Tables relationnelles + JOINs |
| Traversée | Index-free adjacency, O(k^d) | CTE récursive, O(k^d × n) |
| Depth ≤ 3 | 7-22 ms | 29-65 ms (**3-8×** plus lent) |
| Depth = 5 | 10-87 ms | 154-637 ms (**6-16×** plus lent) |
| Depth = 8 | 7-97 ms | 4 122-18 637 ms (**177-589×** plus lent) |
| Scalabilité | Linéaire avec la taille du résultat | Exponentielle avec la profondeur |

**Le côté client** (graphology BFS) est toujours le plus rapide car les données
sont déjà en mémoire — mais il nécessite de charger préalablement tout le graphe.

**Le côté serveur Neo4j** est le meilleur compromis : rapide, scalable,
auditable, pas de pré-chargement nécessaire.

**Le côté serveur MSSQL** est suffisant pour des analyses à faible profondeur
(≤ 5) mais devient inutilisable au-delà. L'optimisation prioritaire est la
**procédure stockée BFS itérative** qui élimine l'explosion combinatoire de la
CTE en dédupliquant à chaque niveau.
