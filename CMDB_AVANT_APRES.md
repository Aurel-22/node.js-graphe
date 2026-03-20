# CMDB Impact Analysis — Avant / Après

## Résumé

Implémentation des fonctionnalités manquantes du module **CMDB EasyVista** dans le composant `ImpactAnalysis` du graph viewer.

---

## Tableau comparatif

| Fonctionnalité | Avant | Après |
|---|---|---|
| **Arêtes bloquantes / non bloquantes** | Toutes les arêtes identiques (même style) | Arêtes bloquantes = trait plein, non bloquantes = trait en pointillés (dashed) + épaisseur réduite |
| **Labels sur les arêtes** | Pas de label affiché | Labels affichés (`edge.label` ou `edge_type`) si < 1000 nœuds |
| **CI courant (cercle bleu)** | Pas de notion de CI courant | Nœud sélectionné entouré d'un cercle bleu (`#2196F3`) + taille ×1.5 |
| **CI initial + retour** | Pas de bouton retour | Bouton 🏠 pour revenir au CI initial (premier nœud du graphe) |
| **Sélecteur de profondeur** | Pas de contrôle de profondeur | Contrôle ± avec affichage du niveau (1–10) |
| **Export PNG** | Non disponible | Bouton 🖼️ — compose tous les canvas Sigma et télécharge un `.png` |
| **Impression** | Non disponible | Bouton 🖨️ — ouvre une fenêtre avec l'image du graphe et lance `window.print()` |
| **Panneau contextuel CI** | Clic simple = toggle blocking, aucune info | Clic = affiche panneau latéral gauche avec : label, type, statut, degré entrant/sortant, liste des CI impactants et impactés avec indicateur bloquant/non-bloquant |
| **Double-clic CI** | Non géré | Double-clic = définir comme CI courant (cercle bleu) + zoom, sans changer le statut |
| **Clic sur le fond** | Non géré | Cache le panneau contextuel |
| **Légende bloquant/non-bloquant** | Uniquement couleurs de statut (vert/rouge/orange) | Ajout indicateurs visuels : trait plein = relation bloquante, pointillés = non-bloquante + dot bleu = CI courant |
| **Couleurs des nœuds par type** | Couleur unique (gris) | Couleur sémantique par `node_type` via `getNodeColor()` (même palette que SigmaGraphViewer) |
| **Icônes par type de nœud** | Icônes de statut uniquement | Icônes pictogrammes par `node_type` via `getNodeTypeIcon()` (même catalogue que SigmaGraphViewer) |
| **Bordures colorées par statut** | Pas de bordure | `@sigma/node-border` — vert (disponible), rouge (bloquant), orange (impacté), bleu (CI courant) |
| **Survol préserve CI courant** | Le survol écrasait toutes les bordures | Le survol respecte la bordure bleue du CI courant |
| **Liste des CI affectés** | "Afficher la liste" / "Masquer" (texte FR) | "{n} affected CIs" avec icône de statut + label + id, clic pour centrer |
| **Barre de stats** | "{n} nodes — {n} edges" | "{n} CIs — {n} relations" + nom du CI courant en bleu |

---

## Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `ImpactAnalysis.tsx` | Refonte complète : imports, état, handlers (click/double-click/stage), rendu JSX (toolbar, panneau contextuel, légende, export/print), fonctions utilitaires (`isEdgeBlocking`, `buildContextInfo`, `exportAsPNG`, `printGraph`, `returnToInitialCI`, `changeDepthLevel`) |
| `ImpactAnalysis.css` | Ajout : `.impact-toolbar-row`, `.depth-level-control`, `.depth-buttons`, `.depth-value`, `.legend-dot`, `.legend-divider`, `.legend-line`, `.legend-line-solid`, `.legend-line-dashed`, `.ci-context-panel` (avec animation), `.ci-context-header`, `.ci-status-dot`, `.ci-context-name`, `.ci-context-type`, `.ci-context-stats`, `.ci-relations-section`, `.ci-relation-item`, `.ci-relation-line`, `.ci-context-form-btn` |

---

## Architecture des nouveaux composants UI

```
┌─────────────────────────────────────────────────────────────┐
│ ImpactAnalysis                                              │
│                                                             │
│  ┌──────────────────┐              ┌──────────────────────┐ │
│  │ CI Context Panel │              │ Controls (right)     │ │
│  │  - Status dot    │              │  Row 1: Fit/Zoom/Rst │ │
│  │  - Label         │              │  Row 2: Home/PNG/Prn │ │
│  │  - Type badge    │              │  Depth: − [2] +      │ │
│  │  - In/Out degree │              │  Threshold slider    │ │
│  │  - Impacting CIs │              │  Viewport slider     │ │
│  │  - Impacted CIs  │              │  Legend:             │ │
│  │  - Focus button  │              │   ● Current CI       │ │
│  └──────────────────┘              │   ● Available        │ │
│                                    │   ● Blocking         │ │
│       ┌────────────────────┐       │   ● Impacted         │ │
│       │   Sigma Canvas     │       │   ── Blocking rel    │ │
│       │                    │       │   - - Non-blocking   │ │
│       └────────────────────┘       └──────────────────────┘ │
│                                                             │
│  ┌──────────────┐           ┌───────────────────────────┐   │
│  │ Affected CIs │           │ Stats: N CIs — N rels — ● │  │
│  │  list (left)  │          │ current CI name            │  │
│  └──────────────┘           └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Détail technique des nouvelles fonctionnalités

### 1. Arêtes bloquantes vs non-bloquantes

```typescript
function isEdgeBlocking(edge): boolean {
  // true si properties.blocking === true
  // true si edge_type contient "block" (et pas "non-block")
  // défaut: bloquant
}
```

- **Bloquante** : épaisseur normale, trait plein
- **Non-bloquante** : épaisseur ×0.5, rendu dashed via edge reducer

### 2. CI courant (Current CI)

- État `currentCI` — l'ID du nœud actuellement sélectionné
- État `initialCI` — le premier nœud du graphe (pour le bouton retour)
- Bordure bleue `#2196F3` + taille ×1.5
- Préservée lors du survol d'autres nœuds

### 3. Panneau contextuel

Interface `CIContextInfo` :

```typescript
{
  id, label, nodeType, status,
  inDegree, outDegree,
  impactingCIs: [{ id, label, blocking }],
  impactedCIs: [{ id, label, blocking }]
}
```

Construit via `buildContextInfo()` à chaque clic sur un nœud. Chaque CI dans la liste est cliquable (focus + zoom).

### 4. Export PNG

Combine tous les canvas layers de Sigma (`sigma.getCanvases()`) sur un canvas composite avec fond blanc, puis déclenche un téléchargement via `canvas.toBlob()`.

### 5. Impression

Même composition que l'export, mais ouvre une nouvelle fenêtre avec `<img onload="window.print()"/>`.
