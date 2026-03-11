# Comparaison des méthodes de chargement de graphes

## Sommaire

1. [Chargement dev-11 (JSON stocké)](#1-chargement-dev-11--json-stocké)
2. [Chargement DATA_VALEO (SQL natif)](#2-chargement-data_valeo--sql-natif)
3. [Comparaison des performances](#3-comparaison-des-performances)
4. [Alternatives plus rapides](#4-alternatives-plus-rapides)
   - [MessagePack](#41-messagepack)
   - [Protocol Buffers](#42-protocol-buffers-protobuf)
   - [FlatBuffers](#43-flatbuffers)
5. [Stockage natif](#5-stockage-natif)
6. [Optimisations SQL](#6-optimisations-sql)

---

## 1. Chargement dev-11 — JSON stocké

### Principe

La base `dev-11` stocke les graphes dans 3 tables relationnelles avec une colonne `properties` contenant un blob JSON par ligne :

```
graphs          → métadonnées (id, title, node_count, edge_count)
graph_nodes     → nœuds (node_id, label, node_type, properties NVARCHAR(MAX))
graph_edges     → arêtes (source_id, target_id, label, edge_type, properties NVARCHAR(MAX))
```

### Requêtes SQL

```sql
-- Nœuds et arêtes en parallèle (Promise.all)
SELECT node_id, label, node_type, properties
FROM graph_nodes WHERE graph_id = @graphId;

SELECT id, source_id, target_id, label, edge_type, properties
FROM graph_edges WHERE graph_id = @graphId;
```

### Pipeline de traitement

```
SQL Server                 Réseau              Node.js                    Réseau          Navigateur
┌──────────────┐     ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐    ┌──────────┐
│ SELECT avec  │────>│ Transfert    │───>│ JSON.parse() ×N   │───>│ JSON.stringify│───>│ Parsing  │
│ properties   │     │ blobs JSON   │    │ par ligne          │    │ 5.6 MB       │    │ + rendu  │
│ (NVARCHAR)   │     │ volumineux   │    │ (25 000 appels)   │    │ via HTTP     │    │          │
└──────────────┘     └──────────────┘    └───────────────────┘    └──────────────┘    └──────────┘
     ~300 ms              ~100 ms              ~400 ms                ~200 ms            ~800 ms
```

### Goulots d'étranglement

| Étape | Coût | Pourquoi |
|-------|------|----------|
| Lecture `properties` | ~300 ms | Colonne `NVARCHAR(MAX)` — stockage LOB, I/O lourde |
| `JSON.parse()` × 25 000 | ~400 ms | Parsing texte → objet JS pour chaque ligne |
| `JSON.stringify()` de la réponse | ~200 ms | Sérialisation de l'objet complet (5.6 MB) |
| Transfert HTTP | ~800 ms | 5.6 MB de JSON texte sur le réseau |

**Temps total typique : ~1 400 ms** (G7 : 8 433 nœuds, 16 866 arêtes)

---

## 2. Chargement DATA_VALEO — SQL natif

### Principe

La base `DATA_VALEO` est une base EasyVista native (CMDB). Les données proviennent de tables SQL typées avec des colonnes indexées — pas de blob JSON.

### Requêtes SQL

```sql
-- 1. Récupérer les asset_ids depuis dev-11 (cross-database)
SELECT node_id FROM [dev-11].dbo.graph_nodes WHERE graph_id = @graphId;

-- 2. Nœuds : colonnes SQL typées et indexées
SELECT
    a.ASSET_ID, a.NETWORK_IDENTIFIER, a.ASSET_TAG,
    a.IS_SERVICE, a.CI_VERSION,
    uc.UN_CLASSIFICATION_FR, uc.[LEVEL],
    parent_uc.UN_CLASSIFICATION_FR
FROM #asset_ids ai
INNER JOIN AM_ASSET a ON a.ASSET_ID = ai.asset_id
LEFT JOIN AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
LEFT JOIN AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID
LEFT JOIN AM_UN_CLASSIFICATION parent_uc ON uc.PARENT_UN_CLASSIFICATION_ID = parent_uc.UN_CLASSIFICATION_ID;

-- 3. Arêtes : enrichissement depuis CONFIGURATION_ITEM_LINK
SELECT e.id, e.source_id, e.target_id,
    COALESCE(r.REFERENCE_FR, e.label) AS label
FROM [dev-11].dbo.graph_edges e
LEFT JOIN CONFIGURATION_ITEM_LINK l ON ...
LEFT JOIN AM_REFERENCE r ON r.REFERENCE_ID = l.RELATION_TYPE_ID
WHERE e.graph_id = @graphId;
```

### Pipeline de traitement

```
SQL Server                 Réseau              Node.js                    Réseau          Navigateur
┌──────────────┐     ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐    ┌──────────┐
│ JOINs sur    │────>│ Transfert    │───>│ Mapping direct    │───>│ JSON.stringify│───>│ Parsing  │
│ colonnes     │     │ colonnes     │    │ (pas de parse)    │    │ 5.6 MB       │    │ + rendu  │
│ indexées     │     │ compactes    │    │                   │    │ via HTTP     │    │          │
└──────────────┘     └──────────────┘    └───────────────────┘    └──────────────┘    └──────────┘
     ~200 ms              ~50 ms               ~50 ms                ~200 ms            ~800 ms
```

### Avantages

| Étape | Coût | Pourquoi c'est plus rapide |
|-------|------|--------------------------|
| Lecture SQL | ~200 ms | Colonnes typées (`INT`, `NVARCHAR(128)`), pas de LOB |
| Mapping Node.js | ~50 ms | Pas de `JSON.parse()` — accès direct aux propriétés SQL |
| Transfert réseau | Identique | Même volume JSON en sortie (~5.6 MB) |

**Temps total typique : ~800 ms** (G7 : 8 433 nœuds, 16 866 arêtes)

---

## 3. Comparaison des performances

### Benchmark G7 (8 433 nœuds, 16 866 arêtes)

| Métrique | dev-11 (JSON) | DATA_VALEO (SQL natif) | Ratio |
|----------|---------------|----------------------|-------|
| Temps SQL serveur | ~1 100 ms | ~500 ms | **2.2×** |
| Temps total (client) | ~1 400 ms | ~800 ms | **1.75×** |
| `JSON.parse()` côté serveur | ~25 000 appels | 0 | ∞ |
| Volume données brutes SQL | ~8 MB (avec JSON blobs) | ~3 MB (colonnes typées) | **2.7×** |
| Volume réponse HTTP | ~5.6 MB | ~5.6 MB | 1× |

### Pourquoi dev-11 est plus lent malgré une table "plus petite"

```
dev-11 : graph_nodes + graph_edges = 2 tables simples
         MAIS chaque ligne contient un properties NVARCHAR(MAX)
         → I/O LOB + JSON.parse() × 25 000 = coût caché majeur

DATA_VALEO : AM_ASSET + AM_CATALOG + AM_UN_CLASSIFICATION + CONFIGURATION_ITEM_LINK
             = 4 JOINs sur tables EasyVista
             MAIS colonnes INT/NVARCHAR(128) indexées, pas de JSON
             → Le moteur SQL optimise les JOINs avec des index
```

### Schéma de la différence fondamentale

```
dev-11 (schéma générique) :
┌─────────────────────────────────────────────────────┐
│ node_id │ label │ node_type │        properties      │
│─────────│───────│───────────│───────────────────────│
│ CI_123  │ SRV01 │ Serveur   │ {"asset_id":123,      │
│         │       │           │  "nom":"SRV01",       │  ← NVARCHAR(MAX)
│         │       │           │  "type_id":42,        │     stockage LOB
│         │       │           │  "family_label":"HW"} │     + JSON.parse()
└─────────────────────────────────────────────────────┘

DATA_VALEO (schéma natif) :
┌──────────┬───────────────────┬───────────┬────────────┬─────────┐
│ ASSET_ID │ NETWORK_IDENTIFIER│ ASSET_TAG │ IS_SERVICE │ VERSION │  ← colonnes typées
│──────────│───────────────────│───────────│────────────│─────────│     INT, NVARCHAR(128)
│ 123      │ SRV01             │ CI-00123  │ 0          │ 2       │     indexées
└──────────┴───────────────────┴───────────┴────────────┴─────────┘
```

---

## 4. Alternatives plus rapides

### 4.1 MessagePack

#### Principe

MessagePack est un format de sérialisation binaire compatible avec JSON. Il encode les mêmes structures (objets, tableaux, nombres, chaînes) mais en binaire compact.

#### Fonctionnement

```
JSON :     {"id":"CI_123","label":"SRV01","node_type":"Serveur"}
           = 55 octets (texte ASCII/UTF-8)

MessagePack : 83 A2 69 64 A6 43 49 5F 31 32 33 A5 6C 61 62 65 6C ...
              = 38 octets (binaire)
```

Encodage des types :
```
Entiers    : 1 octet (0-127) ou 2-9 octets (grands nombres)
Chaînes    : 1 octet longueur + contenu UTF-8 (pas de guillemets, pas d'échappement)
Tableaux   : 1 octet longueur + éléments concaténés
Objets/Maps: 1 octet nb clés + (clé + valeur) concaténés
Null       : 1 octet (0xC0)
Booléens   : 1 octet (0xC2/0xC3)
```

#### Gains

| Métrique | JSON | MessagePack | Gain |
|----------|------|-------------|------|
| Taille réponse | 5.6 MB | ~3.2 MB | **43%** |
| Sérialisation serveur | ~200 ms | ~80 ms | **60%** |
| Parsing client | ~150 ms | ~30 ms | **80%** |
| Transfert réseau | ~800 ms | ~450 ms | **44%** |

#### Implémentation

```typescript
// Serveur (Node.js)
import { encode } from '@msgpack/msgpack';
res.type('application/x-msgpack').send(Buffer.from(encode(graphData)));

// Client (navigateur)
import { decode } from '@msgpack/msgpack';
const buffer = await fetch(url).then(r => r.arrayBuffer());
const graphData = decode(new Uint8Array(buffer));
```

#### Limites

- Pas lisible par un humain (binaire)
- Nécessite une librairie côté client et serveur
- Pas de support natif dans les navigateurs (contrairement à `JSON.parse`)

---

### 4.2 Protocol Buffers (Protobuf)

#### Principe

Protocol Buffers (Google, 2008) est un format de sérialisation binaire **avec schéma**. Contrairement à MessagePack (sans schéma), Protobuf impose de définir la structure des données dans un fichier `.proto`.

#### Fonctionnement

**1. Définition du schéma (`.proto`) :**
```protobuf
syntax = "proto3";

message GraphNode {
  string id = 1;
  string label = 2;
  string node_type = 3;
  map<string, string> properties = 4;
}

message GraphEdge {
  string id = 1;
  string source = 2;
  string target = 3;
  string label = 4;
  string edge_type = 5;
}

message GraphData {
  repeated GraphNode nodes = 1;
  repeated GraphEdge edges = 2;
}
```

**2. Encodage binaire :**
```
Chaque champ = (numéro de champ << 3 | type de fil) + données

Exemple : id = "CI_123"
  Octet 1 : 0x0A       → champ 1, type fil 2 (longueur-préfixée)
  Octet 2 : 0x06       → 6 octets de contenu
  Octets 3-8 : CI_123  → contenu UTF-8

Entiers : encodage Varint (1-10 octets, les petits nombres = 1 octet)
```

**3. Le compilateur `protoc` génère du code typé** pour chaque langage cible (TypeScript, Go, Python, Java...).

#### Gains

| Métrique | JSON | Protobuf | Gain |
|----------|------|----------|------|
| Taille réponse | 5.6 MB | ~1.8 MB | **68%** |
| Sérialisation serveur | ~200 ms | ~15 ms | **93%** |
| Parsing client | ~150 ms | ~10 ms | **93%** |
| Transfert réseau | ~800 ms | ~250 ms | **69%** |

#### Pourquoi c'est plus rapide que MessagePack

- **Pas de clés texte** : chaque champ est identifié par son numéro (1, 2, 3...) au lieu de son nom. Pour 20 000 nœuds avec 8 propriétés, ça économise 160 000 noms de clés.
- **Encodage entiers optimisé** : Varint utilise 1 octet pour les nombres 0-127, vs 4+ octets en JSON/MessagePack.
- **Code généré** : le parser est compilé, pas interprété à l'exécution.

#### Implémentation

```typescript
// Serveur
import { GraphData } from './generated/graph_pb.js';
const msg = GraphData.create({ nodes, edges });
res.type('application/x-protobuf').send(Buffer.from(GraphData.encode(msg).finish()));

// Client
const buffer = await fetch(url).then(r => r.arrayBuffer());
const graphData = GraphData.decode(new Uint8Array(buffer));
```

#### Limites

- Étape de compilation `.proto` → code TypeScript (build step)
- Schéma rigide — l'ajout d'un champ nécessite de modifier le `.proto`
- `map<string, string>` pour `properties` perd la flexibilité du JSON

---

### 4.3 FlatBuffers

#### Principe

FlatBuffers (Google, 2014) est un format de sérialisation **zero-copy**. Contrairement à Protobuf et MessagePack qui doivent **désérialiser** l'intégralité du buffer en objets mémoire, FlatBuffers permet de **lire les champs directement depuis le buffer binaire** sans aucune copie ni allocation.

#### Fonctionnement

**Structure du buffer :**
```
┌─────────────┬──────────────┬────────────────────┬──────────────┐
│ Root Table  │  VTable      │  Données           │  Strings     │
│ (offset)    │ (offsets     │  (champs inline     │ (pool de     │
│             │  par champ)  │   ou offsets)       │  chaînes)    │
└─────────────┴──────────────┴────────────────────┴──────────────┘
```

**Accéder à un champ = 2 lectures mémoire :**
```
1. Lire l'offset du champ dans la VTable (table virtuelle)
2. Lire la valeur à cet offset dans les données

→ Pas de boucle, pas de parsing, pas d'allocation : O(1) par accès
```

**Schéma (`.fbs`) :**
```fbs
table GraphNode {
  id: string;
  label: string;
  node_type: string;
  asset_id: int;
}

table GraphData {
  nodes: [GraphNode];
  edges: [GraphEdge];
}

root_type GraphData;
```

#### Comparaison avec Protobuf

```
Protobuf :  Buffer binaire ──parse()──> Objets JS en mémoire ──accès──> valeur
            │                           │
            │ Temps : O(n)              │ Mémoire : copie complète
            │ (parcourt tout le buffer) │ (alloue chaque objet)

FlatBuffers: Buffer binaire ─────────────────────accès direct──> valeur
             │
             │ Temps : O(1) par accès
             │ Mémoire : 0 octets alloués (lecture in-place)
```

#### Gains

| Métrique | JSON | Protobuf | FlatBuffers | Gain vs JSON |
|----------|------|----------|-------------|--------------|
| Taille réponse | 5.6 MB | 1.8 MB | ~2.0 MB | **64%** |
| Sérialisation serveur | 200 ms | 15 ms | 20 ms | **90%** |
| **Parsing client** | **150 ms** | **10 ms** | **0 ms** | **100%** |
| Accès premier nœud | 150 ms | 10 ms | **0.001 ms** | **150 000×** |
| Mémoire allouée client | ~20 MB | ~15 MB | **0 MB** | **∞** |

#### Cas d'usage idéal

FlatBuffers est optimal quand :
- On n'a pas besoin de lire **tous** les nœuds immédiatement (chargement progressif)
- La mémoire est limitée (mobile, très gros graphes)
- Le temps de premier affichage est critique

#### Limites

- API d'accès moins ergonomique (pas d'objets JS natifs, accesseurs générés)
- Taille légèrement plus grande que Protobuf (VTables + padding d'alignement)
- Mutation du buffer complexe (conçu pour la lecture, pas l'écriture)

---

## 5. Stockage natif

### 5.1 Redis (in-memory)

```
Architecture actuelle :
  Client ──HTTP──> Node.js ──TCP──> SQL Server ──disque──> données
                                    ~300 ms

Avec Redis :
  Client ──HTTP──> Node.js ──TCP──> Redis (RAM)
                                    ~0.5 ms
```

| Propriété | Valeur |
|-----------|--------|
| Latence | ~0.5 ms (vs ~300 ms SQL) |
| Débit | ~100 000 ops/sec |
| Persistance | Snapshots RDB / AOF (optionnel) |
| Structure | Clé-valeur, on stocke le graphe sérialisé (MessagePack ou JSON) |
| Taille max | Limitée par la RAM |

**Usage** : Cache chaud pour les graphes fréquemment consultés. Remplace `NodeCache` (in-process) par un cache partagé multi-process.

### 5.2 SQLite (local)

```
Architecture actuelle :
  Node.js ──réseau TCP──> SQL Server distant ──disque réseau──> données
            ~100 ms RTT

Avec SQLite :
  Node.js ──appel direct──> SQLite ──disque local SSD──> données
             ~0 ms réseau    ~1 ms lecture
```

| Propriété | Valeur |
|-----------|--------|
| Latence | ~1-5 ms (pas de réseau) |
| Concurrence | Lecteurs illimités, 1 écrivain |
| Déploiement | Fichier unique `.db`, embarqué dans Node.js |
| Taille max | ~281 TB (pratiquement illimité) |

**Usage** : Pré-exporter les graphes depuis SQL Server vers un fichier SQLite local. Lecture instantanée pour les benchmarks.

### 5.3 Base graphe native (Neo4j, Memgraph)

```
SQL Server (modèle relationnel) :
  Trouver les voisins de CI_123 :
    SELECT * FROM graph_edges WHERE source_id = 'CI_123'  ← scan d'index B-tree

Base graphe native :
  Trouver les voisins de CI_123 :
    nœud CI_123 → pointeur direct → liste de voisins      ← O(1) par relation
```

| Propriété | SQL Server | Base graphe native |
|-----------|------------|-------------------|
| Traversée 1 niveau | ~10 ms | ~0.1 ms |
| Traversée 5 niveaux | ~500 ms (5 JOINs) | ~1 ms (5 sauts pointeur) |
| Impact analysis | CTE récursive (lent) | Traversée BFS native (rapide) |
| Chargement complet | Rapide (SELECT *) | Plus lent (sérialisation nœud par nœud) |

**Usage** : Supérieur pour les traversées (voisins, impact analysis, plus court chemin). Pas forcément plus rapide pour le chargement bulk d'un graphe entier.

### 5.4 Fichiers binaires pré-calculés

```
Node.js écrit une fois :
  fs.writeFileSync('graph_G7.bin', msgpack.encode(graphData))  // 3.2 MB

Node.js lit ensuite :
  const data = msgpack.decode(fs.readFileSync('graph_G7.bin'))  // ~5 ms
```

| Propriété | Valeur |
|-----------|--------|
| Latence lecture | ~5 ms SSD local |
| Pas de réseau | Oui |
| Pas de SQL | Oui |
| Inconvénient | Données statiques (snapshot), pas de mise à jour live |

---

## 6. Optimisations SQL

### 6.1 Supprimer les blobs JSON (`properties`)

Le principal goulot dans dev-11 est la colonne `properties NVARCHAR(MAX)` :

```sql
-- AVANT: chaque ligne contient un blob JSON
SELECT node_id, label, node_type, properties FROM graph_nodes

-- APRÈS: colonnes SQL typées (comme DATA_VALEO le fait naturellement)
SELECT node_id, label, node_type, asset_id, nom, type_id, family_label
FROM graph_nodes
```

**Gain estimé** : ~60% sur le temps SQL (suppression du stockage LOB + des 25 000 `JSON.parse()`)

### 6.2 Compression gzip côté Express

```typescript
import compression from 'compression';
app.use(compression({ threshold: 1024 })); // compresser si > 1 KB
```

```
Sans compression : 5.6 MB JSON → 800 ms transfert
Avec gzip        : ~500 KB    → 80 ms transfert (10× plus rapide)
```

**Gain estimé** : ~70% sur le temps de transfert réseau

### 6.3 Vues indexées SQL Server

```sql
-- Vue matérialisée pré-jointure nœuds + classification
CREATE VIEW vw_graph_nodes_enriched WITH SCHEMABINDING AS
SELECT
    gn.graph_id, gn.node_id, gn.label, gn.node_type,
    a.NETWORK_IDENTIFIER, a.ASSET_TAG,
    uc.UN_CLASSIFICATION_FR AS type_label
FROM dbo.graph_nodes gn
INNER JOIN dbo.AM_ASSET a ON a.ASSET_ID = CAST(REPLACE(gn.node_id, 'CI_', '') AS INT)
LEFT JOIN dbo.AM_CATALOG cat ON a.CATALOG_ID = cat.CATALOG_ID
LEFT JOIN dbo.AM_UN_CLASSIFICATION uc ON cat.UN_CLASSIFICATION_ID = uc.UN_CLASSIFICATION_ID;

CREATE UNIQUE CLUSTERED INDEX IX_vw_graph_nodes
ON vw_graph_nodes_enriched (graph_id, node_id);
```

**Gain estimé** : ~40% sur les JOINs (les résultats sont pré-calculés par SQL Server)

### 6.4 Index couvrant (covering index)

```sql
-- Index qui couvre tous les champs SELECT → pas besoin de lire la table
CREATE INDEX IX_graph_nodes_covering
ON graph_nodes (graph_id)
INCLUDE (node_id, label, node_type);
-- SQL Server lit uniquement l'index, pas la table
```

### 6.5 Pagination / chargement progressif

Au lieu de charger 20 000 nœuds d'un coup :
```sql
-- Charger par lots de 1 000
SELECT TOP 1000 node_id, label, node_type
FROM graph_nodes
WHERE graph_id = @graphId AND node_id > @lastNodeId
ORDER BY node_id;
```

Le frontend affiche les premiers nœuds immédiatement pendant que les suivants se chargent en arrière-plan.

---

## Résumé comparatif

| Méthode | Temps serveur | Temps total | Complexité | Données live |
|---------|---------------|-------------|------------|-------------|
| **dev-11 (JSON blobs)** | ~1 400 ms | ~2 200 ms | Faible | Non (snapshot) |
| **DATA_VALEO (SQL natif)** | ~800 ms | ~1 600 ms | Moyenne | Oui |
| **+ gzip** | Identique | ~900 ms | Faible | Oui |
| **+ MessagePack** | ~700 ms | ~800 ms | Moyenne | Oui |
| **+ Protobuf** | ~500 ms | ~550 ms | Élevée | Oui |
| **+ FlatBuffers** | ~500 ms | ~500 ms | Très élevée | Oui |
| **Redis cache** | ~5 ms | ~300 ms | Moyenne | Non (cache) |
| **SQLite local** | ~5 ms | ~200 ms | Moyenne | Non (export) |
| **Fichier binaire** | ~5 ms | ~100 ms | Faible | Non (snapshot) |
