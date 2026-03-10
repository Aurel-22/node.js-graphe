# Requêtes SQL pour l'affichage d'un graphe

## Vue d'ensemble

Lorsqu'un graphe est sélectionné dans l'interface, le backend exécute
**2 requêtes SQL en parallèle** pour récupérer ses données, puis renvoie
le tout sérialisé en JSON vers le frontend.

---

## Les 2 requêtes SQL exécutées

### Requête 1 — Chargement des nœuds

```sql
SELECT node_id, label, node_type, properties
FROM graph_nodes
WHERE graph_id = @graphId
```

| Colonne | Type | Description |
|---|---|---|
| `node_id` | `NVARCHAR(255)` | Identifiant unique du nœud |
| `label` | `NVARCHAR(500)` | Libellé affiché dans la visualisation |
| `node_type` | `NVARCHAR(100)` | Catégorie du nœud (ex. `SERVER`, `APPLICATION`) |
| `properties` | `NVARCHAR(MAX)` | Attributs JSON sérialisés (ex. `{"ip":"10.0.0.1"}`) |

### Requête 2 — Chargement des arêtes

```sql
SELECT id, source_id, target_id, label, edge_type, properties
FROM graph_edges
WHERE graph_id = @graphId
```

| Colonne | Type | Description |
|---|---|---|
| `id` | `INT` | Identifiant auto-incrémenté de l'arête |
| `source_id` | `NVARCHAR(255)` | `node_id` du nœud source |
| `target_id` | `NVARCHAR(255)` | `node_id` du nœud cible |
| `label` | `NVARCHAR(500)` | Libellé de la relation |
| `edge_type` | `NVARCHAR(100)` | Type de relation (ex. `DEPENDS_ON`) |
| `properties` | `NVARCHAR(MAX)` | Attributs JSON sérialisés |

---

## Schéma des tables

```
┌─────────────────────────────────────┐
│              graphs                 │
│─────────────────────────────────────│
│ id          NVARCHAR(255)  PK       │
│ title       NVARCHAR(500)           │
│ description NVARCHAR(MAX)           │
│ graph_type  NVARCHAR(100)           │
│ node_count  INT                     │
│ edge_count  INT                     │
│ created_at  DATETIME                │
└─────────────────┬───────────────────┘
                  │ 1
         ─────────┴─────────
         │                 │
         │ N               │ N
┌────────┴──────────┐  ┌───┴────────────────┐
│   graph_nodes     │  │    graph_edges      │
│───────────────────│  │────────────────────-│
│ id          INT PK│  │ id          INT  PK │
│ graph_id    FK ───┤  │ graph_id    FK ─────┤
│ node_id     NVAR  │  │ source_id   NVAR    │
│ label       NVAR  │  │ target_id   NVAR    │
│ node_type   NVAR  │  │ label       NVAR    │
│ properties  JSON  │  │ edge_type   NVAR    │
└───────────────────┘  │ properties  JSON    │
                       └─────────────────────┘
```

> Les 2 tables enfants ont des **foreign keys** avec `ON DELETE CASCADE` :
> supprimer un graphe supprime automatiquement tous ses nœuds et arêtes.

---

## Exécution en parallèle

Les 2 requêtes sont lancées **simultanément** via `Promise.all()` :

```typescript
const [nodesRes, edgesRes] = await Promise.all([
  pool.request()
    .input("graphId", sql.NVarChar(255), graphId)
    .query(`SELECT node_id, label, node_type, properties
            FROM graph_nodes WHERE graph_id = @graphId`),

  pool.request()
    .input("graphId", sql.NVarChar(255), graphId)
    .query(`SELECT id, source_id, target_id, label, edge_type, properties
            FROM graph_edges WHERE graph_id = @graphId`),
]);
```

Sans parallélisme, les 2 requêtes seraient séquentielles et le temps
total serait la somme des deux. Avec `Promise.all`, le temps total
est celui de la **plus lente des deux** (généralement `graph_edges` sur les
grands graphes car les arêtes sont plus nombreuses que les nœuds).

---

## Traitement post-requête

Après réception, chaque ligne est transformée côté serveur :

```typescript
// Désérialisation des propriétés JSON stockées en NVARCHAR(MAX)
const nodes = nodesRes.recordset.map(r => ({
  id:         r.node_id,
  label:      r.label,
  node_type:  r.node_type,
  properties: JSON.parse(r.properties || "{}"),   // ← JSON.parse par ligne
}));

const edges = edgesRes.recordset.map(r => ({
  id:         String(r.id),
  source:     r.source_id,
  target:     r.target_id,
  label:      r.label,
  edge_type:  r.edge_type,
  properties: JSON.parse(r.properties || "{}"),   // ← JSON.parse par ligne
}));
```

> **Point de vigilance** : sur 10 000 nœuds, cela représente 10 000 appels
> `JSON.parse()`. C'est l'une des opérations les plus coûteuses en mode SQL
> direct, et elle est entièrement éliminée lorsque les données sont déjà
> en cache.

---

## Cache serveur (NodeCache)

Avant d'exécuter les requêtes SQL, le backend vérifie d'abord son cache
en mémoire :

```
Appel GET /api/graphs/:id
        │
        ▼
  Cache présent ? ──── OUI ──→ Retour immédiat (~1 ms)
        │
       NON
        │
        ▼
  Exécution des 2 requêtes SQL en parallèle
  + JSON.parse des propriétés
        │
        ▼
  Mise en cache (TTL 5 min)
        │
        ▼
  Réponse HTTP JSON
```

- **Clé de cache** : `graph:<database>:<graphId>`
- **TTL** : 5 minutes
- **Invalidation** : DELETE d'un graphe vide automatiquement son entrée

---

## Comparaison des 3 modes de chargement

| Mode | Requêtes SQL | Réseau HTTP | Temps typique |
|---|---|---|---|
| **SQL direct** (`?nocache=true`) | ✅ oui (×2) | ✅ oui | 50–500+ ms |
| **Cache serveur** | ❌ non | ✅ oui | 2–15 ms |
| **JSON mémoire** (React state) | ❌ non | ❌ non | < 1 ms |

### Détail des coûts par mode

**SQL direct** cumule tous les coûts :
1. Compilation et exécution de la requête par SQL Server
2. Transfert des lignes via le protocole TDS (TCP)
3. `JSON.parse()` sur chaque ligne côté Node.js
4. `JSON.stringify()` de la réponse complète
5. Transfert HTTP (+ gzip si le client accepte)

**Cache serveur** élimine les étapes 1–3 :
- Les données sont directement récupérées depuis la mémoire Node.js
- Reste : sérialisation JSON + transfert HTTP

**JSON mémoire** élimine tout :
- Les données sont déjà dans le state React (chargées lors de la session)
- Aucun appel réseau, aucune base de données — juste un re-render

---

## En-têtes HTTP de diagnostic

Chaque réponse `GET /api/graphs/:id` inclut des en-têtes de performance :

| En-tête | Valeur possible | Signification |
|---|---|---|
| `X-Cache` | `HIT` / `MISS` / `BYPASS` | Origine des données |
| `X-Response-Time` | `42ms` | Temps de traitement serveur |
| `X-Engine` | `mssql` | Moteur de base de données utilisé |
| `X-Parallel-Queries` | `true` | Requêtes exécutées en parallèle |
| `X-Content-Length-Raw` | `184320` | Taille JSON brute avant gzip (en octets) |

Ces en-têtes sont visibles dans le **panneau Optimisations** de l'interface.
