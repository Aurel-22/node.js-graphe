# 🌐 Neo4j Graph Visualizer - Frontend

Interface web moderne pour visualiser les graphes Neo4j en temps réel avec des interactions fluides.

![React](https://img.shields.io/badge/React-18.2-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Vite](https://img.shields.io/badge/Vite-5.0-purple)
![Force Graph](https://img.shields.io/badge/react--force--graph-1.25-green)

---

## ✨ Fonctionnalités

### 🎨 Deux Moteurs de Visualisation

#### 🌀 **react-force-graph-2d** (d3.js)
- Force-directed layout élégant
- Interactions fluides et intuitives
- Idéal pour graphes moyens (< 5,000 nœuds)
- Animations et transitions douces

#### ⚡ **Sigma.js + Graphology**
- Performance WebGL ultra-rapide
- Optimisé pour grands graphes (20,000+ nœuds)
- Layout ForceAtlas2 professionnel
- Rendu GPU accéléré

### 🎯 Interface Intuitive
- **Liste des graphes** avec métadonnées (nœuds, arêtes, type)
- **Sélection facile** d'un graphe à visualiser
- **Indicateur de connexion** au backend
- **Design moderne** avec gradients et animations

### ⚡ Performance
- **Optimisé pour les grands graphes** (jusqu'à 20,000 nœuds)
- **Rendu GPU** via canvas
- **Lazy loading** et mise en cache

---

## 🚀 Démarrage Rapide

### 1. Prérequis

- **Node.js 18+** installé
- **Backend Neo4j** en cours d'exécution sur `http://127.0.0.1:8080`

### 2. Installation

```bash
cd frontend-graph-viewer
npm install
```

### 3. Lancement

```bash
npm run dev
```

L'application sera accessible sur **http://localhost:5173**

---

## 📁 Structure du Projet

```
frontend-graph-viewer/
├── src/
│   ├── components/
│   │   ├── GraphList.tsx          # Liste des graphes disponibles
│   │   ├── GraphList.css
│   │   ├── GraphViewer.tsx        # Composant de visualisation principal
│   │   └── GraphViewer.css
│   ├── services/
│   │   ├── api.ts                 # Client API backend
│   │   └── graphTransform.ts      # Transformation des données
│   ├── types/
│   │   └── graph.ts               # Types TypeScript
│   ├── App.tsx                    # Composant principal
│   ├── App.css
│   ├── main.tsx                   # Point d'entrée
│   └── index.css
├── public/
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

---

## 🎨 Bibliothèques de Visualisation

### ⚡ Sigma.js + Graphology (Nouveau !)

**Implémentation haute performance pour graphes massifs**

✅ **WebGL/Canvas** - Rendu GPU accéléré  
✅ **Graphology** - Manipulation de graphes optimisée  
✅ **ForceAtlas2** - Layout algorithmique professionnel  
✅ **Scalable** - Supporte 100k+ nœuds sans ralentissement  
✅ **Interactions riches** - Hover, zoom, pan multi-touch  
✅ **Sigma.js v3** - Version moderne avec TypeScript

**Installation :**
```bash
npm install sigma graphology graphology-layout-forceatlas2
```

**Quand l'utiliser :**
- Graphes > 10,000 nœuds
- Visualisations nécessitant des performances optimales
- Graphes denses avec nombreuses arêtes
- Applications nécessitant un zoom/pan fluide

### 🌀 react-force-graph-2d (Par défaut)

**Pourquoi ce choix ?**

✅ **Basé sur d3.js** - Standard de l'industrie  
✅ **Force-directed layout** - Layout automatique élégant  
✅ **Performant** - Rendu GPU, supporte 20k+ nœuds  
✅ **React-friendly** - Hooks et composants React natifs  
✅ **Interactif** - Zoom, pan, hover, click out of the box  
✅ **Personnalisable** - Contrôle total des couleurs, tailles, etc.

### Alternatives Disponibles

#### @antv/g6 (AntV)
```bash
npm install @antv/g6
```
- ✅ Très configurable, nombreux layouts
- ✅ Optimisé pour les entreprises
- ❌ Plus complexe à configurer
- ❌ Documentation principalement en chinois

#### sigma.js
```bash
npm install sigma
```
- ✅ Ultra-performant (WebGL)
- ✅ Excellent pour graphes massifs (100k+ nœuds)
- ❌ API plus bas niveau
- ❌ Intégration React nécessite du travail

#### vis-network
```bash
npm install vis-network
```
- ✅ Simple et rapide
- ✅ Nombreuses options de layout
- ❌ Moins moderne visuellement
- ❌ Moins performant sur grands graphes

---

## 🎯 Utilisation

### Vue d'Ensemble

1. **Démarrez le backend** Neo4j (port 8080)
2. **Lancez le frontend** (port 5173)
3. **Ouvrez** http://localhost:5173 dans votre navigateur
4. **Choisissez** votre moteur de visualisation dans le header

### Choix du Moteur de Visualisation

Dans le header, utilisez le toggle pour basculer entre :
- **🌀 Force Graph (d3.js)** - Layout force-directed classique, fluide
- **⚡ Sigma.js** - Performance WebGL, pour grands graphes

### Interface

#### Panneau Gauche - Liste des Graphes
- Affiche tous les graphes disponibles
- Cliquez sur un graphe pour le visualiser
- Indicateurs de taille (nœuds, arêtes)

#### Panneau Principal - Visualisation
- **Zoom** : Molette de la souris
- **Pan** : Cliquer-glisser
- **Hover** : Surbrillance des connexions
- **Click** : Informations du nœud (console)

#### Contrôles
- **🔍 Fit View** : Ajuster la vue au graphe
- **🎯 Center** : Centrer le graphe

#### Légende (en bas à gauche)
- 🟢 **Start** : Nœuds de démarrage
- 🔴 **End** : Nœuds de fin
- 🟠 **Decision** : Nœuds de décision
- 🔵 **Process** : Nœuds de traitement
- 🔴 **Error** : Nœuds d'erreur

---

## 🎨 Personnalisation

### Couleurs des Nœuds

Éditez `src/services/graphTransform.ts` :

```typescript
const NODE_COLORS: Record<string, string> = {
  start: '#4CAF50',      // Vert
  end: '#F44336',        // Rouge
  error: '#FF5722',      // Orange foncé
  decision: '#FF9800',   // Orange
  process: '#2196F3',    // Bleu
  default: '#9E9E9E',    // Gris
};
```

### Layout Force-Directed

Éditez `src/components/GraphViewer.tsx` :

```typescript
<ForceGraph2D
  // ...
  d3AlphaDecay={0.02}           // Vitesse de stabilisation
  d3VelocityDecay={0.3}         // Friction
  cooldownTicks={100}           // Iterations maximales
  linkDistance={50}             // Distance entre nœuds
  chargeStrength={-30}          // Force de répulsion
/>
```

### Taille des Nœuds

```typescript
nodeVal={(node: any) => {
  if (hoverNode === node) return 15;      // Grand au hover
  if (highlightNodes.has(node.id)) return 12;
  return node.val;  // Taille par défaut (10)
}}
```

---

## 🔌 API Backend

Le frontend communique avec le backend via les endpoints suivants :

### `GET /api/health`
Vérifier la connexion au backend

### `GET /api/graphs`
Lister tous les graphes disponibles

### `GET /api/graphs/:id`
Récupérer les données d'un graphe spécifique

### `GET /api/graphs/:id/stats`
Obtenir les statistiques d'un graphe

---

## 🛠️ Scripts Disponibles

| Script | Commande | Description |
|--------|----------|-------------|
| **dev** | `npm run dev` | Démarrer en mode développement |
| **build** | `npm run build` | Compiler pour la production |
| **preview** | `npm run preview` | Prévisualiser le build de production |
| **lint** | `npm run lint` | Vérifier le code avec ESLint |

---

## 📊 Comparaison des Moteurs

| Fonctionnalité | react-force-graph-2d | Sigma.js + Graphology |
|----------------|----------------------|-----------------------|
| **Performance** | Bonne (< 5k nœuds) | Excellente (100k+ nœuds) |
| **Layout** | Force-directed d3.js | ForceAtlas2 |
| **Rendu** | Canvas 2D | Canvas/WebGL |
| **Interactivité** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Animations** | Fluides | Ultra-rapides |
| **Personnalisation** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Intégration React** | Native | Wrapper custom |
| **Courbe d'apprentissage** | Facile | Moyenne |
| **Bundle size** | ~200KB | ~150KB |

**Recommandation :**
- **< 5,000 nœuds** : react-force-graph-2d (plus intuitif)
- **> 5,000 nœuds** : Sigma.js (nettement plus performant)
- **Graphes denses** : Sigma.js (gère mieux les arêtes multiples)

---

## 🌟 Exemples de Graphes

### Graphe Example (11 nœuds)
Workflow de démonstration avec :
- Nœuds de départ/fin
- Décisions conditionnelles
- Gestion d'erreurs et retry
- Logging

### Graphe XLarge Test (20,000 nœuds)
Graphe dense pour tests de performance :
- 20,000 nœuds
- ~87,000 arêtes
- 3-10 connexions par nœud
- Différents types de relations

---

## 🐛 Dépannage

### Le frontend ne se connecte pas au backend

**Problème** : `Failed to connect to backend`

**Solutions** :
1. Vérifiez que le backend est démarré : `curl http://127.0.0.1:8080/api/health`
2. Vérifiez les CORS dans le backend (déjà configuré normalement)
3. Regardez la console du navigateur pour les erreurs

### Le graphe ne s'affiche pas

**Problème** : Écran noir ou vide

**Solutions** :
1. Ouvrez la console du navigateur (F12)
2. Vérifiez qu'il y a des données : `Réseau > graphes/example`
3. Rafraîchissez la page (F5)
4. Essayez un autre navigateur (Chrome/Edge recommandés)

### Performance lente sur grands graphes

**Solutions** :
1. Utilisez le bouton "Fit View" pour centrer
2. Réduisez `cooldownTicks` dans GraphViewer.tsx
3. Désactivez les labels sur arêtes pour graphes >1000 nœuds
4. Envisagez sigma.js pour graphes >50k nœuds

---

## 🚀 Optimisations Futures

### Fonctionnalités Planifiées
- [ ] Filtrage par type de nœud
- [ ] Recherche de nœuds
- [ ] Export en image (PNG, SVG)
- [ ] Layouts multiples (circular, hierarchical, radial)
- [ ] Édition de graphes (ajouter/supprimer nœuds)
- [ ] Analyse de graphes (chemins, centralité)
- [ ] Mode sombre/clair
- [ ] Statistiques en temps réel

### Bibliothèques Alternatives
- **Cytoscape.js** : Excellent pour graphes biologiques
- **react-flow** : Parfait pour workflows et diagrammes
- **Graphin (AlibabaGraph)** : Solution enterprise complète

---

## 📚 Documentation

### React Force Graph
- [Documentation officielle](https://github.com/vasturiano/react-force-graph)
- [Exemples interactifs](https://vasturiano.github.io/react-force-graph/)

### d3.js (sous le capot)
- [d3-force](https://github.com/d3/d3-force)
- [Force simulation](https://observablehq.com/@d3/force-directed-graph)

### Alternatives
- [@antv/g6](https://g6.antv.vision/en)
- [sigma.js](https://www.sigmajs.org/)
- [vis-network](https://visjs.github.io/vis-network/docs/network/)

---

## 🎯 Technologies Utilisées

| Technologie | Version | Usage |
|-------------|---------|-------|
| React | 18.2 | Framework UI |
| TypeScript | 5.3 | Type safety |
| Vite | 5.0 | Build tool |
| react-force-graph-2d | 1.25 | Visualisation d3.js |
| sigma | 3.x | Visualisation WebGL |
| graphology | 0.25 | Structure de graphe |
| graphology-layout-forceatlas2 | 0.10 | Layout algorithmique |
| axios | 1.6 | HTTP client |
| d3.js | ^7 | Calculs force-directed |

---

## 📝 Licence

MIT

---

## 🤝 Contribution

Pour contribuer au projet :

1. **Fork** le projet
2. **Créez** une branche feature (`git checkout -b feature/amazing`)
3. **Commit** vos changements (`git commit -m 'Add amazing feature'`)
4. **Push** vers la branche (`git push origin feature/amazing`)
5. **Ouvrez** une Pull Request

---

## 📞 Support

Pour toute question ou problème :

1. Consultez la section [Dépannage](#-dépannage)
2. Ouvrez une issue sur GitHub
3. Consultez la documentation du backend

---

**🎉 Profitez de la visualisation de vos graphes Neo4j !**
