# Tests du Backend Graph Visualizer Node.js

## 🧪 Tests Manuels

### Test 1: Démarrage du Serveur

```bash
npm run dev
```

**Attendu**: 
- ✅ Serveur démarre sur `http://127.0.0.1:8080`
- ✅ Log: "Initializing database..."
- ✅ Log: "Collections initialized"
- ✅ Log: "Example graph created"
- ✅ Log: "XLarge test graph created"
- ✅ Log: "Server running at http://127.0.0.1:8080"

---

### Test 2: Health Check

```bash
curl http://127.0.0.1:8080/api/health
```

**Attendu**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-11T..."
}
```

---

### Test 3: Lister les Graphes

```bash
curl http://127.0.0.1:8080/api/graphs
```

**Attendu**: Array avec au moins 2 graphes (example, xlarge_test)

---

### Test 4: Obtenir le Graphe Example

```bash
curl http://127.0.0.1:8080/api/graphs/example
```

**Attendu**:
- ✅ 11 nodes
- ✅ 14 edges
- ✅ Nœud A (Start)
- ✅ Nœud H (Success)

---

### Test 5: Statistiques du Graphe

```bash
curl http://127.0.0.1:8080/api/graphs/example/stats
```

**Attendu**:
```json
{
  "node_count": 11,
  "edge_count": 14,
  "node_types": {
    "start": 1,
    "process": 7,
    "decision": 1,
    "end": 1,
    "error": 1
  },
  "average_degree": 1.27
}
```

---

### Test 6: Créer un Nouveau Graphe

```bash
curl -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Workflow",
    "description": "A test workflow",
    "graph_type": "flowchart",
    "mermaid_code": "graph TD\nA((Start)) --> B[Process]\nB --> C{Decision}\nC -->|Yes| D[Success]\nC -->|No| E[Failure]\nD --> F((End))\nE --> F"
  }'
```

**Attendu**:
- ✅ Status 201
- ✅ Retour avec ID généré
- ✅ node_count: 6
- ✅ edge_count: 5

---

### Test 7: Vérifier le Nouveau Graphe

```bash
# Utiliser l'ID retourné par Test 6
curl http://127.0.0.1:8080/api/graphs/graph_XXXXX
```

**Attendu**:
- ✅ 6 nœuds
- ✅ 5 arêtes
- ✅ Nœuds corrects: A, B, C, D, E, F

---

### Test 8: Supprimer le Graphe

```bash
curl -X DELETE http://127.0.0.1:8080/api/graphs/graph_XXXXX
```

**Attendu**:
- ✅ Status 204 No Content

---

### Test 9: Vérifier la Suppression

```bash
curl http://127.0.0.1:8080/api/graphs/graph_XXXXX
```

**Attendu**:
- ✅ Erreur 500 ou données vides

---

## 🧪 Tests de Parsing Mermaid

### Test P1: Nœuds Simples

```json
{
  "mermaid_code": "graph TD\nA\nB\nA --> B"
}
```

**Attendu**: 2 nœuds (A, B), 1 arête

---

### Test P2: Nœuds avec Labels

```json
{
  "mermaid_code": "graph TD\nA[Start Node]\nB[End Node]\nA --> B"
}
```

**Attendu**: Labels "Start Node" et "End Node"

---

### Test P3: Différents Types de Nœuds

```json
{
  "mermaid_code": "graph TD\nA((Circle))\nB[Rectangle]\nC{Diamond}\nD(Rounded)\nA --> B --> C --> D"
}
```

**Attendu**: 
- A: node_type = "start"
- B: node_type = "process"
- C: node_type = "decision"
- D: node_type = "process"

---

### Test P4: Arêtes avec Labels

```json
{
  "mermaid_code": "graph TD\nA --> B\nB -->|Success| C\nC ---|Related| D"
}
```

**Attendu**: 
- Arête 2: label = "Success"
- Arête 3: label = "Related"

---

### Test P5: Différents Types de Connexions

```json
{
  "mermaid_code": "graph TD\nA --> B\nB ==> C\nC -.-> D\nD --- E"
}
```

**Attendu**: 4 edge_type différents (next, strong, optional, relation)

---

## 🔍 Tests de Charge

### Test L1: Graphe XLarge (20k nœuds)

```bash
time curl http://127.0.0.1:8080/api/graphs/xlarge_test
```

**Attendu**:
- ✅ Réponse < 5 secondes
- ✅ 20,000 nœuds
- ✅ ~140,000 arêtes

---

### Test L2: Statistiques XLarge

```bash
time curl http://127.0.0.1:8080/api/graphs/xlarge_test/stats
```

**Attendu**:
- ✅ Réponse < 2 secondes
- ✅ node_count: 20000
- ✅ average_degree: ~7

---

### Test L3: Création de Graphe Moyen (1000 nœuds)

Créer un script pour générer un graphe avec 1000 nœuds en Mermaid:

```bash
# Générer le code Mermaid
node -e "
let code = 'graph TD\\n';
for (let i = 0; i < 1000; i++) {
  code += \`N\${i}[Node \${i}]\\n\`;
  if (i > 0) code += \`N\${i-1} --> N\${i}\\n\`;
}
console.log(JSON.stringify({
  title: 'Large Test',
  description: '1000 nodes',
  graph_type: 'flowchart',
  mermaid_code: code
}));
" > large_graph.json

# Envoyer à l'API
curl -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d @large_graph.json
```

**Attendu**:
- ✅ Création < 10 secondes
- ✅ 1000 nœuds créés

---

## 🐛 Tests d'Erreur

### Test E1: Mermaid Code Invalide

```bash
curl -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Invalid",
    "description": "Test",
    "graph_type": "flowchart",
    "mermaid_code": "invalid code"
  }'
```

**Attendu**:
- ✅ Status 400
- ✅ Message d'erreur

---

### Test E2: Champs Manquants

```bash
curl -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test"
  }'
```

**Attendu**:
- ✅ Status 400
- ✅ Message "Missing required fields"

---

### Test E3: Graphe Inexistant

```bash
curl http://127.0.0.1:8080/api/graphs/nonexistent
```

**Attendu**:
- ✅ Données vides ou erreur

---

## 🔄 Tests d'Intégration

### Test I1: Cycle Complet CRUD

```bash
# 1. Créer
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/api/graphs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "CRUD Test",
    "description": "Test",
    "graph_type": "flowchart",
    "mermaid_code": "graph TD\nA --> B --> C"
  }')

# Extraire l'ID
ID=$(echo $RESPONSE | jq -r '.id')
echo "Created graph: $ID"

# 2. Lire
curl http://127.0.0.1:8080/api/graphs/$ID

# 3. Vérifier dans la liste
curl http://127.0.0.1:8080/api/graphs | jq ".[] | select(.id == \"$ID\")"

# 4. Supprimer
curl -X DELETE http://127.0.0.1:8080/api/graphs/$ID

# 5. Vérifier la suppression
curl http://127.0.0.1:8080/api/graphs | jq ".[] | select(.id == \"$ID\")"
```

**Attendu**: Cycle complet réussi

---

## 📊 Rapport de Tests

### Checklist

- [ ] Serveur démarre correctement
- [ ] Health check fonctionne
- [ ] Liste des graphes retourne des données
- [ ] Obtenir un graphe spécifique
- [ ] Obtenir les statistiques
- [ ] Créer un graphe simple
- [ ] Créer un graphe complexe avec décisions
- [ ] Parsing des différents types de nœuds
- [ ] Parsing des différents types d'arêtes
- [ ] Parsing des labels
- [ ] Supprimer un graphe
- [ ] Graphe XLarge (20k nœuds) fonctionne
- [ ] Gestion des erreurs (code invalide)
- [ ] Gestion des erreurs (champs manquants)
- [ ] Cycle CRUD complet

---

## 🚀 Commandes Utiles

### PowerShell

```powershell
# Test rapide de tous les endpoints
function Test-AllEndpoints {
    Write-Host "1. Health Check"
    Invoke-RestMethod "http://127.0.0.1:8080/api/health"
    
    Write-Host "`n2. List Graphs"
    $graphs = Invoke-RestMethod "http://127.0.0.1:8080/api/graphs"
    $graphs | Format-Table
    
    Write-Host "`n3. Get Example Graph"
    $example = Invoke-RestMethod "http://127.0.0.1:8080/api/graphs/example"
    Write-Host "Nodes: $($example.nodes.Count)"
    Write-Host "Edges: $($example.edges.Count)"
    
    Write-Host "`n4. Get Stats"
    Invoke-RestMethod "http://127.0.0.1:8080/api/graphs/example/stats"
}

Test-AllEndpoints
```

---

## 📝 Notes

- Tous les tests doivent être exécutés avec ArangoDB en cours d'exécution
- Le serveur doit être démarré avec `npm run dev`
- Les graphes de test (example, xlarge_test) sont créés automatiquement au démarrage
- Pour des tests plus avancés, envisager d'utiliser Jest ou Mocha
