# Communication avec SQL Server — Graph Visualizer

## Architecture de connexion

### Serveur et bases utilisées

| Élément | Valeur |
|---------|--------|
| **Serveur** | `devenv-dev-ded-033-smo.intra.evlabs.net` |
| **Port** | `1433` |
| **Utilisateur** | `sa` |
| **Driver Node.js** | `mssql@12.2.0` (TDS natif) |
| **Base de stockage des graphes** | `dev-11` |
| **Base source CMDB (EasyVista)** | `devenv_dev_ded_033_EVO_DATA40000` (schéma `40000`) |

### Pool de connexions

Le `MssqlService` gère un **pool par base de données** (`Map<string, ConnectionPool>`) :

```typescript
pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 }
connectionTimeout: 15_000
requestTimeout: 30_000
```

Les pools sont créés à la demande via `getPool(database)` et réutilisés entre les requêtes.

---

## Modèle de données (base `dev-11`)

### 3 tables relationnelles

```sql
-- Métadonnées des graphes
CREATE TABLE graphs (
  id           NVARCHAR(255) PRIMARY KEY,
  title        NVARCHAR(255),
  description  NVARCHAR(MAX),
  graph_type   NVARCHAR(50),
  node_count   INT DEFAULT 0,
  edge_count   INT DEFAULT 0,
  created_at   DATETIME2 DEFAULT GETDATE()
);

-- Nœuds du graphe
CREATE TABLE graph_nodes (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  graph_id    NVARCHAR(255) NOT NULL,       -- FK → graphs(id) ON DELETE CASCADE
  node_id     NVARCHAR(255) NOT NULL,
  label       NVARCHAR(255),
  node_type   NVARCHAR(100),
  properties  NVARCHAR(MAX) DEFAULT '{}',   -- JSON sérialisé
  UNIQUE (graph_id, node_id)
);

-- Arêtes du graphe
CREATE TABLE graph_edges (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  graph_id    NVARCHAR(255) NOT NULL,       -- FK → graphs(id) ON DELETE CASCADE
  source_id   NVARCHAR(255) NOT NULL,
  target_id   NVARCHAR(255) NOT NULL,
  label       NVARCHAR(255),
  edge_type   NVARCHAR(100),
  properties  NVARCHAR(MAX) DEFAULT '{}'
);
```

**Index** : `graph_id`, `(graph_id, source_id)`, `(graph_id, target_id)` pour accélérer les jointures.

**Cascade** : `ON DELETE CASCADE` sur les FK — supprimer un graphe supprime automatiquement ses nœuds et arêtes.

---

## Requêtes SQL utilisées

### 1. Import CMDB — Récupération des CIs (nœuds)

**Endpoint** : `POST /api/cmdb/import`  
**Base source** : `devenv_dev_ded_033_EVO_DATA40000`

```sql
SELECT * FROM (
  SELECT 
    ROW_NUMBER() OVER (ORDER BY DUMMY) RN, 
    SMO.* 
  FROM (SELECT 1 DUMMY) A,
  (
    SELECT TOP (1000000000) 
      AM_ASSET.ASSET_ID                          AS asset_id,
      AM_ASSET.NETWORK_IDENTIFIER                AS nom,
      AM_ASSET.ASSET_TAG                         AS nDeCI,
      AM_UN_CLASSIFICATION.UN_CLASSIFICATION_FR  AS categorie,
      CMDB_CI_STATUS.CI_STATUS_FR                AS statutDuCI,
      AM_ASSET.CI_VERSION                        AS version,
      CASE 
        WHEN ((
          SELECT COUNT(CMDB_UNAVAILABILITY.UNAVAILABILITY_ID)
          FROM CMDB_UNAVAILABILITY
          WHERE CMDB_UNAVAILABILITY.ASSET_ID = AM_ASSET.ASSET_ID
            AND CMDB_UNAVAILABILITY.START_DATE <= GETUTCDATE()
            AND (CMDB_UNAVAILABILITY.END_DATE IS NULL 
                 OR CMDB_UNAVAILABILITY.END_DATE > GETUTCDATE())
        ) > 0) THEN 'Indisponible'
        ELSE 'Disponible'
      END AS disponibilite,
      AM_ASSET.E_COST                            AS cout,
      AM_ASSET.IS_SERVICE                        AS estUnService
    FROM AM_ASSET
    INNER JOIN AM_LOCATION         ON AM_ASSET.LOCATION_ID = AM_LOCATION.LOCATION_ID
    INNER JOIN AM_CATALOG          ON AM_ASSET.CATALOG_ID = AM_CATALOG.CATALOG_ID
    INNER JOIN AM_UN_CLASSIFICATION ON AM_CATALOG.UN_CLASSIFICATION_ID = AM_UN_CLASSIFICATION.UN_CLASSIFICATION_ID
    INNER JOIN AM_REFERENCE        ON AM_UN_CLASSIFICATION.ARTICLE_TYPE_ID = AM_REFERENCE.REFERENCE_ID
    LEFT JOIN  CMDB_CI_STATUS      ON AM_ASSET.CI_STATUS_ID = CMDB_CI_STATUS.CI_STATUS_ID
    WHERE AM_ASSET.IS_CI = 1
      AND (AM_ASSET.REMOVED_DATE > GETUTCDATE() OR AM_ASSET.REMOVED_DATE IS NULL)
      AND AM_LOCATION.LFT BETWEEN 1 AND 9999
    ORDER BY AM_ASSET.NETWORK_IDENTIFIER ASC
  ) SMO
) tmp
WHERE RN >= 1 AND RN < 801;
```

**Tables jointes** :
| Table | Rôle |
|-------|------|
| `AM_ASSET` | Table principale des actifs/CIs |
| `AM_LOCATION` | Localisation (filtre par arbre LFT) |
| `AM_CATALOG` | Catalogue produits |
| `AM_UN_CLASSIFICATION` | Classification UNSPSC → type de CI |
| `AM_REFERENCE` | Types de référence |
| `CMDB_CI_STATUS` | Statut du CI (En production, En stock…) |
| `CMDB_UNAVAILABILITY` | Indisponibilités actives (sous-requête) |

**Résultat** : ~566 CIs avec nom, catégorie, statut, version, disponibilité, coût.

---

### 2. Import CMDB — Récupération des relations (arêtes)

```sql
SELECT 
  l.PARENT_CI_ID,
  l.CHILD_CI_ID,
  l.RELATION_TYPE_ID,
  l.BLOCKING,
  r.REFERENCE_FR AS relation_label
FROM CONFIGURATION_ITEM_LINK l
LEFT JOIN AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID;
```

**Types de relations trouvés** (14 types) :

| RELATION_TYPE_ID | Libellé |
|------------------|---------|
| 86 | Réseau |
| 87 | Accessible par |
| 88 | Protégé par |
| 89 | Installé sur |
| 90 | Analysé par |
| 91 | Fourni par |
| 129 | Base de données |
| 130 | Serveur applicatif |
| 180 | Exécute |
| 181 | Utilise |
| 182 | Est couvert par |
| 183 | Est installé sur |
| 202 | Fonction de |
| 203 | Stockage - SGBD |

**Résultat** : ~806 relations, dont ~632 entre les CIs importés.

---

### 3. Insertion des graphes (batch)

**Base cible** : `dev-11`

```sql
-- Métadonnées
INSERT INTO graphs (id, title, description, graph_type, node_count, edge_count, created_at)
VALUES (@id, @title, @description, @graphType, @nodeCount, @edgeCount, @createdAt);

-- Nœuds par batch de 500 (limite SQL Server : 2100 paramètres)
INSERT INTO graph_nodes (graph_id, node_id, label, node_type, properties)
VALUES (@graphId, @nid0, @nlbl0, @ntyp0, @nprop0),
       (@graphId, @nid1, @nlbl1, @ntyp1, @nprop1),
       ...;

-- Arêtes par batch de 400 (5 colonnes × 400 = 2000 < 2100)
INSERT INTO graph_edges (graph_id, source_id, target_id, label, edge_type, properties)
VALUES (@graphId, @esrc0, @etgt0, @elbl0, @etyp0, @eprop0),
       ...;
```

> **Contrainte SQL Server** : maximum 2100 paramètres par requête préparée.  
> Nœuds : 4 paramètres × 500 = 2000 ✓  
> Arêtes : 5 paramètres × 400 = 2000 ✓

---

### 4. Lecture d'un graphe (requêtes parallèles)

```sql
-- Exécutées en Promise.all() pour paralléliser
SELECT node_id, label, node_type, properties
FROM graph_nodes WHERE graph_id = @graphId;

SELECT id, source_id, target_id, label, edge_type, properties
FROM graph_edges WHERE graph_id = @graphId;
```

---

### 5. Traversée de voisins (CTE récursive)

```sql
-- Traversée sortante (downstream)
WITH Traverse AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @graphId AND node_id = @nodeId
  UNION ALL
  SELECT n.node_id, t.lvl + 1
  FROM Traverse t
  JOIN graph_edges e ON e.graph_id = @graphId AND e.source_id = t.node_id
  JOIN graph_nodes n ON n.graph_id = @graphId AND n.node_id = e.target_id
  WHERE t.lvl < @maxDepth
),
-- Traversée entrante (upstream)
TraverseIn AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @graphId AND node_id = @nodeId
  UNION ALL
  SELECT n.node_id, t.lvl + 1
  FROM TraverseIn t
  JOIN graph_edges e ON e.graph_id = @graphId AND e.target_id = t.node_id
  JOIN graph_nodes n ON n.graph_id = @graphId AND n.node_id = e.source_id
  WHERE t.lvl < @maxDepth
),
AllNodeIds AS (
  SELECT DISTINCT node_id FROM Traverse
  UNION
  SELECT DISTINCT node_id FROM TraverseIn
)
-- Retourne nœuds + arêtes entre nœuds trouvés
OPTION (MAXRECURSION 200);
```

---

### 6. Analyse d'impact (BFS sortant)

```sql
WITH Impact AS (
  SELECT node_id, 0 AS lvl
  FROM graph_nodes
  WHERE graph_id = @graphId AND node_id = @nodeId
  UNION ALL
  SELECT n.node_id, i.lvl + 1
  FROM Impact i
  JOIN graph_edges e ON e.graph_id = @graphId AND e.source_id = i.node_id
  JOIN graph_nodes n ON n.graph_id = @graphId AND n.node_id = e.target_id
  WHERE i.lvl < @maxDepth
)
SELECT node_id AS nodeId, MIN(lvl) AS level
FROM Impact
WHERE node_id <> @nodeId
GROUP BY node_id
OPTION (MAXRECURSION 200);
```

> **Attention** : la CTE récursive SQL Server ne déduplique pas les chemins → explosion exponentielle au-delà de depth=4. Préférer le BFS itératif avec tables temporaires pour les grandes profondeurs.

---

### 7. Liste des graphes

```sql
SELECT id, title, description, graph_type, node_count, edge_count
FROM graphs ORDER BY created_at DESC;
```

### 8. Suppression d'un graphe

```sql
DELETE FROM graphs WHERE id = @graphId;
-- Les graph_nodes et graph_edges sont supprimés automatiquement (ON DELETE CASCADE)
```

### 9. Statistiques d'un graphe

```sql
SELECT
  (SELECT COUNT(*) FROM graph_nodes WHERE graph_id = @graphId) AS node_count,
  (SELECT COUNT(*) FROM graph_edges WHERE graph_id = @graphId) AS edge_count;

SELECT node_type, COUNT(*) AS cnt
FROM graph_nodes WHERE graph_id = @graphId
GROUP BY node_type;
```

### 10. Exécution de requêtes brutes

**Endpoint** : `POST /api/query`

Permet d'exécuter du SQL libre depuis le panneau **SQL / Cypher** du frontend :
```typescript
const result = await pool.request().query(query);
// Retourne : { rows, elapsed_ms, rowCount, engine: "mssql" }
```

---

## Flux de données : Import CMDB → Visualisation

```
┌─────────────────────────────────────────────────────────┐
│  Base EasyVista (devenv_dev_ded_033_EVO_DATA40000)       │
│                                                         │
│  AM_ASSET ──┬── AM_CATALOG ── AM_UN_CLASSIFICATION      │
│             ├── AM_LOCATION                             │
│             ├── CMDB_CI_STATUS                          │
│             └── CMDB_UNAVAILABILITY                     │
│  CONFIGURATION_ITEM_LINK ── AM_REFERENCE                │
└─────────────────┬───────────────────────────────────────┘
                  │  POST /api/cmdb/import
                  │  (requêtes SQL cross-database)
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Backend Node.js (Express + mssql driver)                │
│                                                         │
│  1. Connexion pool → EVO_DATA40000                       │
│  2. SELECT CIs (ROW_NUMBER pagination)  → 566 nœuds     │
│  3. SELECT CONFIGURATION_ITEM_LINK      → 632 arêtes     │
│  4. Transformation → { nodes[], edges[] }                │
│  5. INSERT batch dans dev-11 (graphs, graph_nodes,       │
│     graph_edges)                                        │
│  6. WebSocket broadcast → frontend                       │
└─────────────────┬───────────────────────────────────────┘
                  │  GET /api/graphs/:id
                  │  (Promise.all nodes + edges)
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Frontend React (Sigma.js / Force Graph / etc.)          │
│                                                         │
│  GraphData { nodes[], edges[] }                          │
│  → Sigma.js : ForceAtlas2 layout, exploration            │
│     progressive, icônes par node_type (catégorie CI)     │
└─────────────────────────────────────────────────────────┘
```

---

## Optimisations

| Optimisation | Détail |
|-------------|--------|
| **Cache mémoire** | `NodeCache` TTL 5 min, clé `graph:<database>:<graphId>` |
| **Requêtes parallèles** | `Promise.all()` pour nœuds + arêtes |
| **Gzip** | Compression des réponses HTTP (middleware `compression`) |
| **Batch INSERT** | 500 nœuds / 400 arêtes par requête (limite 2100 params) |
| **Index** | `graph_id`, `(graph_id, source_id)`, `(graph_id, target_id)` |
| **MAXRECURSION 200** | Garde-fou CTE pour éviter les boucles infinies |

---

## Configuration (.env)

```env
MSSQL_HOST=devenv-dev-ded-033-smo.intra.evlabs.net
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=Easyvista964158Certif
MSSQL_DATABASE=dev-11
DEFAULT_ENGINE=mssql
```
