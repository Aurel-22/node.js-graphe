# 🚀 Quick Start - Graph Visualizer Backend Node.js

Guide de démarrage rapide en 5 minutes.

---

## ⚡ Installation Rapide

### 1. Prérequis

Vérifiez que vous avez:

```bash
# Node.js 18+ (LTS recommandé)
node --version  # Doit afficher v18.x.x ou supérieur

# Neo4j en cours d'exécution
# Par défaut sur neo4j://127.0.0.1:7687
```

---

### 2. Installation des Dépendances

```bash
cd backend-nodejs
npm install
```

**Temps estimé**: ~30 secondes

---

### 3. Configuration (Optionnel)

Le fichier `.env` est déjà configuré avec les valeurs par défaut:

```env
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=Aurelien22
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
```

➡️ **Modifiez uniquement si vos paramètres Neo4j sont différents**

---

### 4. Démarrer le Serveur

```bash
npm run dev
```

**Attendu**:
```
Initializing Neo4j database...
Neo4j constraints and indexes created
Creating example graph...
Example graph created
Creating extra large DENSE test graph with 20,000 nodes...
XLarge test graph created
Server running at http://127.0.0.1:8080
```

✅ **Votre backend est opérationnel!**

---

## 🧪 Test Rapide

Ouvrez un nouveau terminal et testez:

```bash
# Health check
curl http://127.0.0.1:8080/api/health

# Lister les graphes
curl http://127.0.0.1:8080/api/graphs

# Obtenir le graphe d'exemple
curl http://127.0.0.1:8080/api/graphs/example
```

---

## 📋 Commandes Disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarrer en mode développement (hot-reload) |
| `npm run build` | Compiler TypeScript → JavaScript |
| `npm start` | Démarrer en mode production |
| `npm run typecheck` | Vérifier les types TypeScript |
| `npm run clean` | Nettoyer le dossier `dist/` |

---

## 🌐 Endpoints API

Une fois le serveur démarré, l'API est disponible sur `http://127.0.0.1:8080/api`:

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/health` | GET | Vérification de santé |
| `/api/graphs` | GET | Lister tous les graphes |
| `/api/graphs/:id` | GET | Obtenir un graphe spécifique |
| `/api/graphs/:id/stats` | GET | Statistiques d'un graphe |
| `/api/graphs` | POST | Créer un nouveau graphe |
| `/api/graphs/:id` | DELETE | Supprimer un graphe |

---

## 📝 Créer Votre Premier Graphe

### Via curl

```bash
curl -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Mon Premier Graphe",
    "description": "Un workflow simple",
    "graph_type": "flowchart",
    "mermaid_code": "graph TD\n  A[Début] --> B[Traitement]\n  B --> C{Décision}\n  C -->|Oui| D[Succès]\n  C -->|Non| E[Erreur]\n  D --> F[Fin]\n  E --> F"
  }'
```

### Via PowerShell

```powershell
$body = @{
    title = "Mon Premier Graphe"
    description = "Un workflow simple"
    graph_type = "flowchart"
    mermaid_code = @"
graph TD
  A[Début] --> B[Traitement]
  B --> C{Décision}
  C -->|Oui| D[Succès]
  C -->|Non| E[Erreur]
  D --> F[Fin]
  E --> F
"@
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/graphs" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

---

## 🎯 Graphes de Test Inclus

Le backend crée automatiquement 2 graphes de test:

### 1. **example** - Workflow de Démonstration
- 11 nœuds
- 14 arêtes
- Workflow avec décisions et gestion d'erreurs

```bash
curl http://127.0.0.1:8080/api/graphs/example
```

### 2. **xlarge_test** - Graphe de Performance
- 20,000 nœuds
- ~140,000 arêtes
- Graphe dense pour tests de charge

```bash
curl http://127.0.0.1:8080/api/graphs/xlarge_test
```

---

## 🔧 Dépannage

### Problème: "Error connecting to Neo4j"

**Solution**:
1. Vérifiez que Neo4j est en cours d'exécution:
   ```bash
   # Vérifier le service (Windows)
   sc query neo4j
   
   # Ou tester l'accès web
   # Ouvrir http://localhost:7474 dans un navigateur
   ```

2. Vérifiez les identifiants dans `.env`:
   ```env
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=Aurelien22  # Modifiez si différent
   ```

---

### Problème: Port 8080 déjà utilisé

**Solution**: Changez le port dans `.env`:
```env
SERVER_PORT=3000  # ou un autre port disponible
```

---

### Problème: "Module not found"

**Solution**: Réinstallez les dépendances:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## 📚 Documentation Complète

- [README.md](README.md) - Documentation complète
- [API_EXAMPLES.md](API_EXAMPLES.md) - Exemples d'utilisation détaillés
- [TESTING.md](TESTING.md) - Guide de tests
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Migration depuis Rust

---

## 🎉 Prochaines Étapes

1. ✅ **Backend fonctionnel** - Vous y êtes!
2. 🎨 **Connecter le frontend** - Voir la documentation du frontend React
3. 🚀 **Créer vos graphes** - Utilisez l'API ou le frontend
4. 📊 **Visualiser** - Profitez du rendu interactif

---

## 💡 Conseils

- **Mode développement**: Utilisez `npm run dev` pour le rechargement automatique
- **Logs détaillés**: Modifiez `LOG_LEVEL=debug` dans `.env`
- **Tests**: Consultez [TESTING.md](TESTING.md) pour valider l'installation
- **Performance**: Le graphe xlarge_test est parfait pour tester les performances

---

## 🆘 Support

Si vous rencontrez des problèmes:

1. Vérifiez la [section Dépannage](#-dépannage)
2. Consultez [TESTING.md](TESTING.md) pour valider l'installation
3. Vérifiez les logs du serveur pour des messages d'erreur

---

**Temps total d'installation**: ~5 minutes ⚡

**Vous êtes prêt à créer des graphes!** 🎉
