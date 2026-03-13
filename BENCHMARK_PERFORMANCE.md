# Benchmark de Performance — Graph Visualizer

> **Date** : 13 mars 2026  
> **Graphe** : VALEO G9 — 20 000 nœuds / 50 000 arêtes  
> **Base** : DATA_VALEO (MSSQL)  
> **Itérations** : 10  
> **Covering Indexes** : ❌ inactifs

---

## Résultats bruts (10 itérations)

| Stratégie | Moy. (ms) | Min (ms) | Max (ms) | Écart |
|-----------|-----------|----------|----------|-------|
| 🔴 Requête SQL directe | **3 413.8** | 2 432.0 | 4 282.0 | 1 850 |
| 🟡 Cache NodeCache | **2 095.6** | 2 052.9 | 2 133.5 | 81 |
| 🟢 JSON parse | **36.8** | 33.7 | 46.6 | 13 |
| 🔵 MessagePack encode | **52.8** | 45.6 | 61.6 | 16 |
| 🟠 Enrichissement EasyVista | **720.8** | 287.7 | 1 207.8 | 920 |

---

## Diagramme des temps moyens

```mermaid
xychart-beta
    title "Temps moyen par stratégie (ms) — 10 itérations"
    x-axis ["SQL directe", "Cache", "JSON parse", "MsgPack", "Enrichissement"]
    y-axis "Temps (ms)" 0 --> 3500
    bar [3413.8, 2095.6, 36.8, 52.8, 720.8]
```

## Diagramme sérialisation (zoom)

```mermaid
xychart-beta
    title "Sérialisation : JSON vs MessagePack (ms)"
    x-axis ["JSON parse", "MessagePack encode"]
    y-axis "Temps (ms)" 0 --> 60
    bar [36.8, 52.8]
```

---

## Taille des données (transfert réseau)

| Format | Taille | Réduction |
|--------|--------|-----------|
| JSON | **14 908.7 Ko** (14.6 Mo) | — |
| MessagePack | **12 113.3 Ko** (11.8 Mo) | **−18.8%** |

```mermaid
pie title Répartition des tailles de transfert
    "MessagePack (81.2%)" : 12113.3
    "Gain MsgPack (18.8%)" : 2795.4
```

---

## Gains de performance (speedup)

| Comparaison | Facteur | Interprétation |
|-------------|---------|----------------|
| Cache vs SQL | **1.6×** | Le cache réduit le temps de 38% |
| JSON vs SQL | **92.7×** | La sérialisation est 93× plus rapide que la requête SQL |
| MsgPack vs JSON | **0.7×** | MessagePack est plus lent à encoder côté serveur |

### Analyse

```mermaid
flowchart LR
    A[Client demande un graphe] --> B{Cache HIT ?}
    B -- Oui --> C[NodeCache: ~2096 ms]
    B -- Non --> D[SQL directe: ~3414 ms]
    C --> E{Format ?}
    D --> E
    E -- JSON --> F[Sérialisation: 37 ms\nTaille: 14.9 Mo]
    E -- MsgPack --> G[Sérialisation: 53 ms\nTaille: 12.1 Mo ✨]
    F --> H{Enrichissement ?}
    G --> H
    H -- Oui --> I[+721 ms\nDonnées EasyVista live]
    H -- Non --> J[Réponse envoyée]
    I --> J
```

---

## Distribution des temps (variabilité)

```mermaid
xychart-beta
    title "Variabilité : Min / Moy / Max (ms)"
    x-axis ["SQL min", "SQL moy", "SQL max", "Cache min", "Cache moy", "Cache max", "Enrich min", "Enrich moy", "Enrich max"]
    y-axis "Temps (ms)" 0 --> 4500
    bar [2432, 3414, 4282, 2053, 2096, 2133, 288, 721, 1208]
```

**Observations :**
- **SQL** : forte variabilité (±54%) — dépend de la charge SQL Server
- **Cache** : très stable (±2%) — performances prévisibles
- **Enrichissement** : haute variabilité (±64%) — dépend du réseau et de la charge EasyVista

---

## Recommandations

### ✅ Optimisations à activer en production

1. **Cache NodeCache** — toujours actif (gain constant de 1.6×)
2. **Covering Indexes** — à créer (accélère les requêtes SQL, actuellement inactifs)
3. **MessagePack** — recommandé pour les clients distants (−18.8% de bande passante)

### ⚠️ Optimisations conditionnelles

4. **Enrichissement EasyVista** — utile pour les graphes CMDB avec nœuds CI_, mais ajoute ~721 ms
5. **Gzip** — compression serveur activée par défaut (réduit davantage le JSON/MsgPack compressé)

### 📊 Configuration optimale (onglet "Sigma ⚡")

L'onglet **Sigma ⚡** dans l'interface active automatiquement :
- ✅ MessagePack (format binaire)
- ✅ Enrichissement EasyVista
- ✅ Covering Indexes (si créés)

---

## Reproduction

```bash
# Benchmark via API (10 itérations)
curl "http://localhost:8080/api/graphs/graph_1773223493228_uz53irs5r-dev11/benchmark?database=DATA_VALEO&iterations=10"

# Ou via l'interface : Panneau ⚡ > Benchmark serveur > Itérations: 10
```
