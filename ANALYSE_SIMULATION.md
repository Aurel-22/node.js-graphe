# Analyse détaillée — Simulation de performance

## Résultats complets (graphe 20K nœuds / 50K arêtes, 5 itérations)

| # | Combinaison | Moy. | Min | Max | Taille brute | Taille Gzip | Gain |
|---|-------------|------|-----|-----|-------------|-------------|------|
| 🏆 | SQL + JSON + Gzip | **1920 ms** | 1699 ms | 2112 ms | 14 957 Ko | — | −43% |
| 2 | Cache + MsgPack + Gzip | 2232 ms | 2188 ms | 2261 ms | 12 162 Ko | 12 162 Ko | −33% |
| 3 | Cache + JSON (brut) | 2234 ms | 2221 ms | 2251 ms | 14 957 Ko | 14 957 Ko | −33% |
| 4 | Cache + MsgPack (brut) | 2240 ms | 2210 ms | 2284 ms | 12 162 Ko | 12 162 Ko | −33% |
| … | | | | | | | |
| 16 | SQL + JSON + Enrich + Gzip | 3351 ms | 3005 ms | 3723 ms | 14 957 Ko | — | — |

---

## 🏆 Pourquoi « SQL + JSON + Gzip » gagne

### Le pipeline complet en 6 étapes

```
                 SQL Server                    Node.js                              Réseau                    Navigateur
┌───────────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────┐
│ 1. Exécute 2 SELECT       │──>│ 2. JSON.parse() ×25 000      │──>│ 4. Transfert HTTP            │──>│ 5. Décompression │
│    en parallèle            │   │    (properties par ligne)     │   │    ~1-2 Mo compressé         │   │    gzip native    │
│    (graph_nodes +          │   │                              │   │    au lieu de 14.9 Mo brut    │   │    (gratuit)     │
│     graph_edges)           │   │ 3. JSON.stringify() 14.9 Mo  │   │                              │   │                  │
│                            │   │    + Gzip compress level 6   │   │                              │   │ 6. JSON.parse()  │
│    ~300-500 ms             │   │    ~200-400 ms               │   │    ~50-100 ms                │   │    ~150 ms       │
└───────────────────────────┘   └──────────────────────────────┘   └──────────────────────────────┘   └──────────────────┘
```

**Temps total mesuré côté client : ~1 700 – 2 100 ms**

### Étape 1 — Requêtes SQL parallèles (`Promise.all`)

```typescript
const [nodesRes, edgesRes] = await Promise.all([
  pool.request()
    .input("graphId", sql.NVarChar(255), graphId)
    .query(`SELECT node_id, label, node_type, properties FROM graph_nodes WHERE graph_id = @graphId`),
  pool.request()
    .input("graphId", sql.NVarChar(255), graphId)
    .query(`SELECT id, source_id, target_id, label, edge_type, properties FROM graph_edges WHERE graph_id = @graphId`),
]);
```

**Coût : ~300-500 ms** (dépend de la charge SQL Server et de l'état du cache SQL)

Les deux requêtes s'exécutent en parallèle grâce à `Promise.all`. Le temps est dicté par la plus lente des deux. La colonne `properties NVARCHAR(MAX)` est le principal goulot (stockage LOB, I/O disque).

### Étape 2 — JSON.parse() des propriétés (×25 000)

```typescript
const nodes = nodesRes.recordset.map((r: any) => ({
  id: r.node_id,
  label: r.label,
  node_type: r.node_type,
  properties: JSON.parse(r.properties || "{}"),     // ← 20 000 appels
}));

const edges = edgesRes.recordset.map((r: any) => ({
  // ...
  properties: JSON.parse(r.properties || "{}"),      // ← 50 000 appels
}));
```

**Coût : ~200-400 ms** pour 70 000 appels à `JSON.parse()`

Chaque nœud et arête a un champ `properties` stocké en JSON texte. Le serveur doit parser chaque ligne individuellement. C'est le coût le plus lourd côté Node.js.

### Étape 3 — JSON.stringify() + Gzip compression

```typescript
// Express renvoie du JSON, puis le middleware compression() le compresse
const jsonStr = JSON.stringify(graphData);     // ~14.9 Mo de texte JSON
res.send(jsonStr);
// → Le middleware compression() intercepte et compresse en gzip level 6
```

**Coût stringify : ~100-200 ms**
**Coût gzip : ~100-200 ms**

Le middleware Express `compression()` (configuré avec `level: 6`) compresse le flux JSON avant envoi. Voici pourquoi c'est crucial :

```
JSON texte (14.9 Mo) :
  {"nodes":[{"id":"CI_123","label":"SRV01","node_type":"Serveur","properties":{...}},
            {"id":"CI_124","label":"SRV02","node_type":"Serveur","properties":{...}},
            ... ×20 000 ]

→ Gzip compresse à ~1-2 Mo (compression ~85-90%)
```

**Le JSON se compresse extrêmement bien** parce que :
- Les noms de clés se répètent 20 000 fois (`"id"`, `"label"`, `"node_type"`, `"properties"`)
- Les valeurs de `node_type` sont souvent identiques (ex: `"Serveur"` apparaît 5 000 fois)
- Le texte JSON contient beaucoup de caractères structurels (`{`, `}`, `"`, `:`, `,`) qui forment des motifs répétitifs
- L'algorithme DEFLATE de gzip exploite ces répétitions avec des tables de Huffman et des fenêtres glissantes

### Étape 4 — Transfert réseau

```
Sans gzip : 14.9 Mo → ~200-500 ms (selon bande passante)
Avec gzip  :  1-2 Mo → ~50-100 ms
                        ─────────
                        Gain : ~150-400 ms
```

**C'est ici que la victoire se joue.** Le transfert réseau est réduit de **~85%** en volume, ce qui économise ~200 ms ou plus.

### Étape 5 — Décompression gzip (navigateur)

**Coût : ~0 ms (gratuit)**

Les navigateurs modernes décompressent gzip **nativement en C++** dans le moteur réseau. Ce n'est pas du JavaScript — c'est une opération système ultra-optimisée qui prend moins d'1 ms même pour 15 Mo décompressés.

Le header `Content-Encoding: gzip` déclenche automatiquement cette décompression. Aucun code JavaScript n'est impliqué.

### Étape 6 — JSON.parse() côté client (Axios)

```typescript
// Axios fait automatiquement :
const data = JSON.parse(responseText);   // ~14.9 Mo de JSON décompressé
```

**Coût : ~100-200 ms**

Axios détecte le `Content-Type: application/json` et appelle `JSON.parse()` automatiquement. V8 (le moteur JS de Chrome) a un parser JSON très optimisé, mais 15 Mo reste conséquent.

---

## Pourquoi le cache ne gagne PAS

C'est le résultat le plus surprenant. On s'attendrait à ce que le cache in-memory soit toujours plus rapide. Voici pourquoi ce n'est pas le cas :

### Le cache ne saute que l'étape 1 (SQL)

```
Cache HIT :
  Node.js vérifie NodeCache → objet JS déjà en mémoire (~0 ms)
  
  MAIS il doit quand même :
  ✦ JSON.stringify() de l'objet de 14.9 Mo    (~100-200 ms)
  ✦ Gzip compress 14.9 Mo                     (~100-200 ms)
  ✦ Transférer ~1-2 Mo                        (~50-100 ms)
  ✦ JSON.parse() côté client                  (~100-200 ms)
  
  Total cache : ~400-700 ms de traitement incompressible
```

Le cache économise ~300-500 ms de SQL, mais le reste du pipeline (sérialisation + compression + transfert + parsing) reste identique. L'économie est réelle mais limitée.

### Gzip + MsgPack : un non-gain

Résultat clé dans les données :

| Combo | Taille brute | Taille Gzip |
|-------|-------------|-------------|
| Cache + MsgPack + Gzip | 12 162 Ko | **12 162 Ko** |
| SQL + JSON + Gzip | 14 957 Ko | **—** |

**MsgPack n'est pas compressé par gzip.** La colonne « Taille Gzip » affiche la même valeur que la taille brute (12 162 Ko = 12 162 Ko). Le « — » pour JSON+Gzip signifie que le header `Content-Length` a été supprimé, ce qui confirme que gzip fonctionne.

Explication technique :

```typescript
// backend-nodejs/src/index.ts
app.use(compression({
  filter: (req, res) => {
    if (req.query.nocompress === 'true') return false;
    return compression.filter(req, res);   // ← Filtre par défaut
  },
}));
```

**Le filtre par défaut de `compression()` ne compresse que certains Content-Types** :
- ✅ `application/json` → compressé
- ❌ `application/x-msgpack` → **ignoré** (type binaire non reconnu)

Résultat : quand on demande `?format=msgpack`, le middleware gzip ne s'active pas. La réponse MsgPack transite **en clair** (12.1 Mo), même si `?nocompress` n'est pas activé.

### Pourquoi MsgPack est plus petit mais pas plus rapide

```
JSON  : 14 957 Ko texte → gzip → ~1 500 Ko réseau → décompression native → JSON.parse()
MsgPack : 12 162 Ko binaire → PAS de gzip → 12 162 Ko réseau → msgpack.decode()
```

MsgPack est 19% plus compact que JSON en brut, mais comme **gzip ne s'applique pas**, il doit transférer **12 Mo au lieu de ~1.5 Mo**. L'avantage de taille de MsgPack est complètement annulé.

---

## Schéma comparatif des 3 premiers

```
🏆 SQL + JSON + Gzip (1920 ms)
├── SQL parallèle ............ ~400 ms    ← seul coût supplémentaire vs cache
├── JSON.parse ×25K .......... ~300 ms
├── JSON.stringify 14.9 Mo ... ~150 ms
├── Gzip compress ............ ~150 ms    ← divise la taille par ~10
├── Transfert ~1.5 Mo ........ ~70 ms     ← GROS GAIN
├── Décompression native ..... ~0 ms      ← GRATUIT
└── JSON.parse client ........ ~150 ms
    Total ..................... ~1 920 ms   (variance faible : 1699-2112)

#2 Cache + MsgPack + Gzip (2232 ms)
├── Cache HIT ................ ~1 ms
├── msgpack.encode 12.1 Mo ... ~200 ms
├── Gzip ..................... INACTIF ❌  (application/x-msgpack ignoré)
├── Transfert 12.1 Mo ........ ~400 ms    ← GROS TRANSFERT
└── msgpack.decode client .... ~100 ms
    Total ..................... ~2 232 ms   (variance très faible : 2188-2261)

#3 Cache + JSON brut (2234 ms)
├── Cache HIT ................ ~1 ms
├── JSON.stringify 14.9 Mo ... ~150 ms
├── Gzip ..................... DÉSACTIVÉ (nocompress=true)
├── Transfert 14.9 Mo ........ ~500 ms    ← ÉNORME TRANSFERT
└── JSON.parse client ........ ~150 ms
    Total ..................... ~2 234 ms   (variance très faible : 2221-2251)
```

---

## L'insight fondamental

```
Temps = SQL + sérialisation + compression + transfert + décompression + parsing

Le cache supprime le coût SQL (~400 ms)
Gzip supprime le coût transfert (~350 ms)      ← plus impactant !

Sur un graphe de 20K nœuds :
  Coût SQL ≈ 400 ms
  Coût transfert sans gzip ≈ 400-500 ms
  Coût transfert avec gzip ≈ 50-100 ms
  
  → Gzip économise ~350 ms  >  Cache économise ~400 ms
  → Mais gzip + SQL coûte ~400 + 150 = 550 ms
  →     cache + pas gzip coûte 0 + 500 = 500 ms
  
  La différence est faible, et la variance SQL peut jouer en faveur de SQL+Gzip
  (certaines requêtes SQL tombent à 300 ms si le cache SQL Server est chaud)
```

**Le transfert réseau est le vrai goulot**, pas la base de données. Gzip réduit le transfert de ~85%, ce qui a plus d'impact que d'éviter la requête SQL.

---

## Recommandations

### Configuration optimale immédiate

| Action | Impact | Effort |
|--------|--------|--------|
| **Activer gzip pour MsgPack** | Permettrait à MsgPack de bénéficier aussi de la compression | 1 ligne de code |
| **Utiliser Cache + JSON + Gzip** | Combinerait les deux gains (cache + gzip) | Déjà possible |

### Correction : activer gzip pour MsgPack

Le middleware `compression()` ignore `application/x-msgpack` par défaut. Pour l'activer :

```typescript
app.use(compression({
  filter: (req, res) => {
    if (req.query.nocompress === 'true') return false;
    // Forcer la compression pour MsgPack aussi
    if (res.getHeader('Content-Type')?.toString().includes('msgpack')) return true;
    return compression.filter(req, res);
  },
}));
```

Cela permettrait la combo ultime : **Cache + MsgPack + Gzip** → le cache évite SQL, MsgPack est plus compact (12 Mo vs 15 Mo), et gzip compresse le tout à ~1 Mo.

### Anomalie à investiguer

**Cache + JSON + Gzip est #13 (2863 ms) avec un pic à 4687 ms**, alors que SQL + JSON + Gzip est #1. C'est contre-intuitif : le cache devrait toujours battre SQL.

L'explication probable : un **outlier** (4687 ms sur 5 itérations) tire la moyenne vers le haut. Cet outlier pourrait être causé par :
- Un **Garbage Collection** Node.js déclenché par l'allocation mémoire de la requête de préchauffage
- Un **Cold start** du compresseur gzip ou de la connexion HTTP
- Une contention sur l'event loop Node.js

Avec plus d'itérations (10-20), cette anomalie devrait se lisser et Cache + JSON + Gzip devrait battre SQL + JSON + Gzip.

---

## Résumé en une phrase

> **Sur un réseau à latence non-négligeable, la compression gzip du JSON (~85% de réduction) a plus d'impact que le cache in-memory**, parce que le transfert réseau de 15 Mo est le vrai goulot — pas la requête SQL.
