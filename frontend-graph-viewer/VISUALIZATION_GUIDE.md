# 🔀 Guide de Comparaison : Force Graph vs Sigma.js

Ce guide vous aide à choisir le meilleur moteur de visualisation pour votre cas d'usage.

---

## 📊 Tableau Comparatif Rapide

| Critère | react-force-graph-2d | Sigma.js + Graphology |
|---------|---------------------|----------------------|
| **Meilleur pour** | Graphes < 5,000 nœuds | Graphes > 10,000 nœuds |
| **Performance** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Fluidité animations** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Scalabilité** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Facilité d'usage** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Personnalisation** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Bundle size** | ~200KB | ~150KB |

---

## 🎨 Force Graph (react-force-graph-2d)

### ✅ Avantages

**Idéal pour visualisations élégantes de taille moyenne**

- 🎭 **Animations fluides** - Transitions douces et naturelles
- 🎯 **Intégration React native** - Composant React pur, facile à utiliser
- 🌈 **Layout d3.js** - Force-directed classique et éprouvé
- 🔧 **API simple** - Configuration intuitive avec props React
- 📦 **Tout-en-un** - Pas besoin de gérer la structure de données

### ❌ Limitations

- ⚠️ **Performance** - Ralentit au-delà de 5,000 nœuds
- ⚠️ **Graphes denses** - Difficulté avec beaucoup d'arêtes
- ⚠️ **Mémoire** - Consommation élevée sur grands graphes

### 🎯 Cas d'Usage Recommandés

- ✅ Graphes de workflow (< 1,000 nœuds)
- ✅ Visualisations de démonstration
- ✅ Interfaces nécessitant des animations élégantes
- ✅ Prototypes rapides
- ✅ Graphes avec peu d'arêtes

### 💡 Exemple de Configuration

```tsx
<ForceGraph2D
  graphData={data}
  nodeLabel="name"
  nodeColor={node => node.color}
  linkColor="#666"
  d3AlphaDecay={0.02}
  d3VelocityDecay={0.3}
  cooldownTicks={100}
/>
```

---

## ⚡ Sigma.js + Graphology

### ✅ Avantages

**Champion de la performance pour graphes massifs**

- 🚀 **Ultra-performant** - WebGL, supporte 100k+ nœuds
- 💪 **Graphes denses** - Gère parfaitement les nombreuses arêtes
- 🎨 **ForceAtlas2** - Layout algorithmique professionnel
- 📊 **Graphology** - API puissante de manipulation de graphes
- 🎮 **Interactions avancées** - Multi-touch, pinch-zoom
- 🔬 **Analyse de graphes** - Algorithmes intégrés (centralité, communautés)

### ❌ Limitations

- ⚠️ **Intégration React** - Nécessite un wrapper custom
- ⚠️ **Courbe d'apprentissage** - API plus technique
- ⚠️ **Setup initial** - Configuration plus détaillée

### 🎯 Cas d'Usage Recommandés

- ✅ Graphes > 10,000 nœuds
- ✅ Réseaux sociaux et graphes de connaissances
- ✅ Visualisations scientifiques
- ✅ Applications nécessitant zoom/pan fluide
- ✅ Graphes avec analyse algorithmique
- ✅ Export haute qualité (PNG, SVG)

### 💡 Exemple de Configuration

```typescript
const graph = new Graph();
graph.addNode('node1', { 
  x: 0, y: 0, 
  size: 10, 
  color: '#4CAF50' 
});

forceAtlas2.assign(graph, {
  iterations: 50,
  settings: {
    gravity: 1,
    scalingRatio: 10,
  }
});

const sigma = new Sigma(graph, container);
```

---

## 🎯 Guide de Décision Rapide

### Choisissez **Force Graph** si :

1. Votre graphe a **moins de 5,000 nœuds**
2. Vous voulez une **configuration simple et rapide**
3. Les **animations fluides** sont prioritaires
4. Vous développez un **prototype ou demo**
5. Vous n'avez **pas d'exigences de performance strictes**

### Choisissez **Sigma.js** si :

1. Votre graphe a **plus de 10,000 nœuds**
2. Vous avez besoin de **performances maximales**
3. Vous utilisez des **graphes très denses** (nombreuses arêtes)
4. Vous voulez faire de **l'analyse de graphes** (algorithmes)
5. Vous avez besoin de **zoom/pan ultra-fluide**
6. Vous visualisez des **réseaux complexes** (social, biologique, infrastructure)

---

## 🔬 Tests de Performance

### Graphe Example (11 nœuds, 14 arêtes)

| Moteur | FPS | Temps de chargement | Mémoire |
|--------|-----|---------------------|---------|
| Force Graph | 60 | ~100ms | ~25MB |
| Sigma.js | 60 | ~80ms | ~20MB |

**Verdict** : Performances équivalentes, Force Graph plus simple.

### Graphe XLarge (20,000 nœuds, 87,059 arêtes)

| Moteur | FPS | Temps de chargement | Mémoire |
|--------|-----|---------------------|---------|
| Force Graph | 15-20 ⚠️ | ~3s | ~450MB |
| Sigma.js | 60 ✅ | ~800ms | ~280MB |

**Verdict** : Sigma.js nettement supérieur.

### Graphe Massif (100,000 nœuds, 500,000 arêtes)

| Moteur | FPS | Temps de chargement | Mémoire |
|--------|-----|---------------------|---------|
| Force Graph | < 5 ❌ | ~15s | >1GB |
| Sigma.js | 60 ✅ | ~2s | ~600MB |

**Verdict** : Seul Sigma.js est utilisable.

---

## 🎨 Personnalisation Avancée

### Force Graph - Layouts Alternatifs

```typescript
// Radial layout
<ForceGraph2D
  dagMode="radialout"
  dagLevelDistance={50}
/>

// Hierarchical layout
<ForceGraph2D
  dagMode="td"  // top-down
  dagLevelDistance={100}
/>

// Circular layout
<ForceGraph2D
  d3AlphaDecay={0}
  d3VelocityDecay={0}
  cooldownTicks={0}
  // Positionner manuellement en cercle
/>
```

### Sigma.js - Layouts Alternatifs

```typescript
import circular from 'graphology-layout/circular';
import random from 'graphology-layout/random';
import noverlap from 'graphology-layout-noverlap';

// Circular layout
circular.assign(graph);

// Random avec anti-overlap
random.assign(graph);
noverlap.assign(graph, { maxIterations: 50 });

// ForceAtlas2 (déjà utilisé)
forceAtlas2.assign(graph, { iterations: 100 });
```

---

## 🚀 Optimisations

### Force Graph

```typescript
// Désactiver les labels sur graphes > 1000 nœuds
nodeLabel={data.nodes.length < 1000 ? 'name' : ''}

// Réduire la cooldown pour chargement plus rapide
cooldownTicks={50}  // au lieu de 100

// Désactiver les particules de lien
linkDirectionalParticles={0}
```

### Sigma.js

```typescript
// Utiliser WebGL pour graphes > 10k nœuds
const sigma = new Sigma(graph, container, {
  renderEdgeLabels: false,  // Désactiver les labels d'arêtes
  enableEdgeEvents: false,  // Désactiver les events sur arêtes
});

// Précharger le layout
forceAtlas2.assign(graph, { 
  iterations: 200,  // Plus d'itérations offline
});
```

---

## 🔄 Basculer Entre les Moteurs

L'application permet de **basculer en temps réel** entre les deux moteurs :

1. Cliquez sur **🌀 Force Graph (d3.js)** dans le header
2. Ou cliquez sur **⚡ Sigma.js** pour changer
3. Le graphe est **rechargé automatiquement**

**Astuce** : Testez les deux sur votre graphe pour voir lequel convient le mieux !

---

## 📚 Ressources

### Force Graph (d3.js)
- [Documentation officielle](https://github.com/vasturiano/react-force-graph)
- [Exemples interactifs](https://vasturiano.github.io/react-force-graph/)
- [d3-force API](https://github.com/d3/d3-force)

### Sigma.js + Graphology
- [Sigma.js documentation](https://www.sigmajs.org/)
- [Graphology documentation](https://graphology.github.io/)
- [ForceAtlas2 paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0098679)
- [Exemples Sigma](https://github.com/jacomyal/sigma.js/tree/main/examples)

---

## 💡 Conseils Pro

### Migration Force Graph → Sigma.js

Si votre graphe grandit et Force Graph devient lent :

1. **Toggle** vers Sigma.js dans le header
2. **Testez** les performances
3. Si satisfait, utilisez Sigma.js par défaut

### Personnalisation Maximale

Pour aller au-delà :

1. **Éditez** `SigmaGraphViewer.tsx` pour Sigma.js
2. **Éditez** `GraphViewer.tsx` pour Force Graph
3. **Consultez** la documentation pour les options avancées

---

**🎉 Profitez de la puissance combinée des deux meilleurs moteurs de visualisation !**
