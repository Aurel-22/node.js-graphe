# Formules Mathématiques des Algorithmes de Graphe

> **Référence** : Algorithmes implémentés dans `AlgorithmService.ts`  
> **Notation** : $G = (V, E)$ avec $|V| = n$, $|E| = m$, $w(u,v)$ = poids de l'arête $(u,v)$

---

## Table des matières

1. [Algorithmes de parcours](#1-algorithmes-de-parcours)
2. [Algorithmes de centralité](#2-algorithmes-de-centralité)
3. [Algorithmes de détection de communautés](#3-algorithmes-de-détection-de-communautés)
4. [Algorithmes de chemins critiques](#4-algorithmes-de-chemins-critiques)
5. [Algorithmes de résilience](#5-algorithmes-de-résilience)

---

## 1. Algorithmes de parcours

### 1.1 BFS — Breadth-First Search

**Principe** : exploration niveau par niveau depuis un nœud source $s$.

**Initialisation** :

$$d(s) = 0, \quad d(v) = \infty \quad \forall v \neq s$$

**Règle de mise à jour** : pour chaque arête $(u, v) \in E$ avec $v$ non visité :

$$d(v) = d(u) + 1$$

$$\pi(v) = u$$

où $\pi(v)$ est le prédécesseur de $v$ dans l'arbre BFS.

**Propriété fondamentale** : BFS calcule les **plus courts chemins non pondérés** :

$$d(v) = \min_{P \in \text{chemins}(s,v)} |P|$$

**Complexité** : $O(V + E)$

---

### 1.2 DFS — Depth-First Search

**Principe** : exploration en profondeur, backtracking quand un cul-de-sac est atteint.

**Timestamps** : chaque nœud $v$ reçoit deux horodatages :
- $d[v]$ : instant de **découverte** (pré-ordre)
- $f[v]$ : instant de **fin** (post-ordre)

**Classification des arêtes** $(u, v)$ :

$$\text{Type}(u,v) = \begin{cases}
\text{tree edge} & \text{si } v \text{ est découvert via } u \\
\text{back edge} & \text{si } d[v] < d[u] \text{ et } f[v] > f[u] \quad \Rightarrow \text{cycle !} \\
\text{forward edge} & \text{si } d[v] > d[u] \text{ et } f[v] < f[u] \\
\text{cross edge} & \text{sinon}
\end{cases}$$

**Détection de cycle** : un graphe dirigé contient un cycle $\iff$ DFS trouve une **back edge**.

**Complexité** : $O(V + E)$

---

### 1.3 BFS Bidirectionnel

**Principe** : deux BFS simultanés — un depuis la source $s$, un depuis la cible $t$ — qui se rejoignent au milieu.

**Frontières** :

$$F_s^{(k)} = \{v \in V : d_s(v) = k\}, \quad F_t^{(k)} = \{v \in V : d_t(v) = k\}$$

**Condition d'arrêt** : dès qu'un nœud $m$ est trouvé tel que :

$$m \in F_s^{(i)} \cap \overline{F_t^{(j)}} \quad \text{ou} \quad m \in \overline{F_s^{(i)}} \cap F_t^{(j)}$$

c'est-à-dire $m$ est atteint par les deux frontières.

**Reconstruction du chemin** :

$$P(s, t) = P_s(s, m) \circ P_t(m, t)$$

$$d(s, t) = d_s(m) + d_t(m)$$

**Complexité** : $O(b^{d/2})$ vs $O(b^d)$ pour BFS simple, où $b$ = facteur de branchement, $d$ = distance.

**Gain théorique** : réduction exponentielle de l'espace exploré.

---

### 1.4 Dijkstra

**Principe** : plus court chemin pondéré depuis $s$ avec $w(u,v) \geq 0$.

**Initialisation** :

$$d(s) = 0, \quad d(v) = +\infty \quad \forall v \neq s$$

**Relaxation** : pour chaque arête $(u, v) \in E$ :

$$\text{si } d(u) + w(u, v) < d(v) \text{ alors } \begin{cases} d(v) \leftarrow d(u) + w(u, v) \\ \pi(v) \leftarrow u \end{cases}$$

**Extraction du min** (file de priorité) :

$$u = \arg\min_{v \in Q} d(v)$$

**Invariant** : à chaque itération, $d(u)$ est le **plus court chemin définitif** de $s$ à $u$.

**Complexité** :
- Avec tas binaire : $O((V + E) \log V)$
- Avec tas de Fibonacci : $O(V \log V + E)$

---

### 1.5 A* (A-star)

**Extension de Dijkstra** avec une heuristique $h(v)$ estimant la distance restante vers la cible $t$.

**Fonction d'évaluation** :

$$f(v) = g(v) + h(v)$$

où :
- $g(v) = d(s, v)$ : coût réel depuis la source
- $h(v)$ : estimation heuristique de $d(v, t)$

**Extraction** :

$$u = \arg\min_{v \in Q} f(v)$$

**Conditions d'optimalité** — l'heuristique doit être :
- **Admissible** : $h(v) \leq d^*(v, t) \quad \forall v$ (ne surestime jamais)
- **Consistante** (monotone) : $h(u) \leq w(u,v) + h(v) \quad \forall (u,v) \in E$

**Cas CMDB** : heuristique basée sur la distance géographique entre sites :

$$h(v) = \text{haversine}(\text{loc}(v), \text{loc}(t))$$

**Complexité** : $O(E)$ dans le meilleur cas, $O(b^d)$ dans le pire (équivalent Dijkstra si $h = 0$).

---

## 2. Algorithmes de centralité

### 2.1 Degree Centrality

**Formule** : la centralité de degré normalisée d'un nœud $v$ :

$$C_D(v) = \frac{\deg(v)}{n - 1} = \frac{\deg^+(v) + \deg^-(v)}{n - 1}$$

où :
- $\deg^+(v) = |\{(v, u) \in E\}|$ : degré sortant
- $\deg^-(v) = |\{(u, v) \in E\}|$ : degré entrant

**Interprétation CMDB** : $C_D(v) \approx 1 \Rightarrow$ le CI $v$ est connecté à presque tous les autres CIs.

**Complexité** : $O(V + E)$

---

### 2.2 Betweenness Centrality (algorithme de Brandes)

**Formule** : la centralité d'intermédiarité de $v$ :

$$C_B(v) = \sum_{s \neq v \neq t \in V} \frac{\sigma_{st}(v)}{\sigma_{st}}$$

où :
- $\sigma_{st}$ = nombre de plus courts chemins de $s$ à $t$
- $\sigma_{st}(v)$ = nombre de ces chemins passant par $v$

**Algorithme de Brandes** — calcul efficace par accumulation de dépendances :

$$\delta_{s \bullet}(v) = \sum_{w : v \in P_s(w)} \frac{\sigma_{sv}}{\sigma_{sw}} \cdot (1 + \delta_{s \bullet}(w))$$

où $P_s(w)$ = ensemble des prédécesseurs de $w$ dans les plus courts chemins depuis $s$.

**Résultat final** :

$$C_B(v) = \sum_{s \in V} \delta_{s \bullet}(v)$$

**Normalisation** (graphe dirigé) :

$$\hat{C}_B(v) = \frac{C_B(v)}{(n-1)(n-2)}$$

**Complexité** : $O(VE)$ pour les graphes non pondérés, $O(VE + V^2 \log V)$ pour les pondérés.

---

### 2.3 Closeness Centrality

**Formule classique** :

$$C_C(v) = \frac{1}{\sum_{u \neq v} d(v, u)}$$

**Formule normalisée (Wasserman-Faust)** pour les graphes non connexes :

$$C_C(v) = \frac{r(v)}{n - 1} \cdot \frac{r(v)}{\sum_{u \in R(v)} d(v, u)}$$

où :
- $r(v) = |R(v)|$ = nombre de nœuds atteignables depuis $v$
- $R(v) = \{u \in V : d(v, u) < \infty\}$

**Interprétation** : $C_C(v)$ élevé $\Rightarrow$ le CI $v$ atteint rapidement tous les autres CIs.

**Complexité** : $O(V \cdot (V + E))$ — un BFS par nœud.

---

### 2.4 PageRank

**Formule itérative** :

$$PR^{(k+1)}(v) = \frac{1 - d}{n} + d \cdot \left( \sum_{u \in B(v)} \frac{PR^{(k)}(u)}{\deg^+(u)} + \frac{S^{(k)}}{n} \right)$$

où :
- $d = 0.85$ : facteur d'amortissement (*damping factor*)
- $B(v) = \{u : (u, v) \in E\}$ : ensemble des prédécesseurs de $v$
- $\deg^+(u)$ : degré sortant de $u$
- $S^{(k)} = \sum_{u : \deg^+(u)=0} PR^{(k)}(u)$ : masse des nœuds puits (*dangling nodes*)

**Initialisation** :

$$PR^{(0)}(v) = \frac{1}{n} \quad \forall v \in V$$

**Propriété** : à convergence, $\sum_{v \in V} PR(v) = 1$.

**Interprétation matricielle** — PageRank est le **vecteur propre principal** de la matrice de Google :

$$\mathbf{M} = d \cdot \mathbf{H} + d \cdot \frac{\mathbf{a} \cdot \mathbf{1}^T}{n} + (1 - d) \cdot \frac{\mathbf{1} \cdot \mathbf{1}^T}{n}$$

où $\mathbf{H}$ est la matrice de transition colonne-stochastique et $\mathbf{a}$ le vecteur indicateur des nœuds puits.

**Convergence** : $\|PR^{(k+1)} - PR^{(k)}\|_1 \leq d^k$ — convergence géométrique.

**Complexité** : $O(k \cdot E)$ avec $k$ itérations (typiquement $k = 20–50$).

---

### 2.5 Eigenvector Centrality

**Définition** : $x_v$ est la composante de $v$ dans le vecteur propre dominant de la matrice d'adjacence $\mathbf{A}$ :

$$\mathbf{A} \mathbf{x} = \lambda_1 \mathbf{x}$$

**Formule récursive** (méthode de la puissance) :

$$x_v^{(k+1)} = \frac{1}{\lambda_1} \sum_{u : (u,v) \in E} x_u^{(k)}$$

**Relation avec PageRank** : PageRank ajoute le damping factor et la redistribution aux puits. Sans ces corrections, eigenvector centrality ne converge pas sur les graphes dirigés avec des puits.

**Complexité** : $O(k \cdot E)$

---

### 2.6 HITS — Hubs & Authorities

**Deux scores par nœud** :
- $a(v)$ : score d'**autorité** (le nœud est pointé par de bons hubs)
- $h(v)$ : score de **hub** (le nœud pointe vers de bonnes autorités)

**Mise à jour itérative** :

$$a^{(k+1)}(v) = \sum_{u : (u,v) \in E} h^{(k)}(u)$$

$$h^{(k+1)}(v) = \sum_{u : (v,u) \in E} a^{(k+1)}(u)$$

**Normalisation** après chaque itération :

$$a(v) \leftarrow \frac{a(v)}{\|\mathbf{a}\|_2}, \quad h(v) \leftarrow \frac{h(v)}{\|\mathbf{h}\|_2}$$

**Interprétation matricielle** :
- $\mathbf{a}$ converge vers le vecteur propre principal de $\mathbf{A}^T \mathbf{A}$
- $\mathbf{h}$ converge vers le vecteur propre principal de $\mathbf{A} \mathbf{A}^T$

**CMDB** : les **hubs** sont les CIs orchestrateurs (ex: serveurs d'application), les **autorités** sont les CIs feuilles critiques (ex: bases de données).

**Complexité** : $O(k \cdot E)$

---

## 3. Algorithmes de détection de communautés

### 3.1 Louvain — Optimisation de modularité

**Modularité** de Newman-Girvan :

$$Q = \frac{1}{2m} \sum_{i,j} \left[ A_{ij} - \frac{k_i k_j}{2m} \right] \delta(c_i, c_j)$$

où :
- $A_{ij}$ = poids de l'arête $(i,j)$
- $k_i = \sum_j A_{ij}$ = force du nœud $i$
- $m = \frac{1}{2} \sum_{ij} A_{ij}$ = poids total des arêtes
- $c_i$ = communauté du nœud $i$
- $\delta(c_i, c_j) = \begin{cases} 1 & \text{si } c_i = c_j \\ 0 & \text{sinon} \end{cases}$

**Gain de modularité** en déplaçant le nœud $i$ de la communauté $C_\text{old}$ vers $C_\text{new}$ :

$$\Delta Q = \left[ \frac{\Sigma_{\text{in,new}} + k_{i,\text{new}}}{2m} - \left( \frac{\Sigma_{\text{tot,new}} + k_i}{2m} \right)^2 \right] - \left[ \frac{\Sigma_{\text{in,new}}}{2m} - \left( \frac{\Sigma_{\text{tot,new}}}{2m} \right)^2 - \left( \frac{k_i}{2m} \right)^2 \right]$$

Simplifié :

$$\Delta Q = \frac{k_{i,\text{new}} - k_{i,\text{old}}}{m} - \frac{k_i \cdot (\Sigma_{\text{tot,new}} - \Sigma_{\text{tot,old}} + k_i)}{2m^2}$$

où :
- $k_{i,C}$ = somme des poids des arêtes de $i$ vers les nœuds de la communauté $C$
- $\Sigma_{\text{tot},C}$ = somme des degrés des nœuds dans $C$
- $\Sigma_{\text{in},C}$ = somme des poids des arêtes internes à $C$

**Algorithme** :
1. Chaque nœud = sa propre communauté
2. Pour chaque nœud, calculer $\Delta Q$ pour chaque communauté voisine, déplacer vers le meilleur $\Delta Q > 0$
3. Répéter jusqu'à convergence
4. Contracter le graphe (communautés → super-nœuds) et recommencer

**Complexité** : $O(n \log n)$ en pratique pour les graphes creux.

---

### 3.2 Label Propagation

**Initialisation** : $\ell(v) = v \quad \forall v \in V$ (chaque nœud est son propre label).

**Règle de mise à jour** (asynchrone, ordre aléatoire) :

$$\ell^{(k+1)}(v) = \arg\max_{l} \sum_{u \in N(v)} \mathbb{1}[\ell^{(k)}(u) = l]$$

(le nœud adopte le label le plus fréquent chez ses voisins)

En cas d'égalité, choix aléatoire parmi les labels ex aequo.

**Convergence** : l'algorithme converge quand chaque nœud a le label majoritaire de ses voisins.

**Complexité** : $O(E)$ par itération, convergence typique en $O(1)$–$O(\log n)$ itérations.

---

### 3.3 Girvan-Newman

**Principe** : supprimer itérativement l'arête avec la plus grande betweenness.

**Betweenness d'arête** :

$$C_B(e) = \sum_{s \neq t \in V} \frac{\sigma_{st}(e)}{\sigma_{st}}$$

**Algorithme** :
1. Calculer $C_B(e)$ pour toutes les arêtes
2. Supprimer l'arête $e^* = \arg\max_e C_B(e)$
3. Recalculer les composantes connexes
4. Répéter jusqu'au nombre de communautés souhaité

**Dendrogramme** : chaque suppression produit une partition — on choisit celle avec la modularité $Q$ maximale.

**Complexité** : $O(V \cdot E^2)$ — trop lent pour les grands graphes.

---

### 3.4 Strongly Connected Components — Tarjan

**Définition** : un SCC est un sous-ensemble maximal $C \subseteq V$ tel que :

$$\forall u, v \in C : \exists \text{ chemin dirigé } u \rightsquigarrow v \text{ ET } v \rightsquigarrow u$$

**Algorithme de Tarjan** — basé sur DFS avec deux indices par nœud :
- $\text{index}(v)$ : ordre de découverte DFS
- $\text{lowlink}(v)$ : plus petit index atteignable depuis $v$

**Formule de lowlink** :

$$\text{lowlink}(v) = \min \begin{cases} \text{index}(v) \\ \text{lowlink}(w) & \text{pour } (v,w) \in E \text{ tree edge} \\ \text{index}(w) & \text{pour } (v,w) \in E \text{ et } w \text{ sur la pile} \end{cases}$$

**Racine d'un SCC** : $v$ est racine $\iff \text{lowlink}(v) = \text{index}(v)$.

Quand une racine est trouvée, dépiler tous les nœuds jusqu'à $v$ inclus → un SCC.

**Interprétation CMDB** : $|SCC| > 1 \Rightarrow$ cycle de dépendances (ex: A dépend de B, B dépend de A).

**Complexité** : $O(V + E)$

---

### 3.5 Weakly Connected Components (Union-Find)

**Définition** : sous-ensemble maximal $C \subseteq V$ tel que pour tout $u, v \in C$, il existe un chemin **non orienté** :

$$\forall u, v \in C : \exists \text{ chemin } u \text{---} v \text{ (en ignorant l'orientation)}$$

**Algorithme Union-Find** :

- `Find(x)` : trouver la racine de $x$ avec compression de chemin :
$$\text{parent}(x) \leftarrow \text{Find}(\text{parent}(x))$$

- `Union(x, y)` : fusionner les composantes de $x$ et $y$ par rang :
$$\text{si } \text{rang}(r_x) < \text{rang}(r_y) : \text{parent}(r_x) \leftarrow r_y$$

**Complexité amortie** : $O(\alpha(n))$ par opération, où $\alpha$ est la fonction d'Ackermann inverse ($\alpha(n) \leq 4$ pour toute valeur pratique de $n$).

**Total** : $O((V + E) \cdot \alpha(V)) \approx O(V + E)$

---

## 4. Algorithmes de chemins critiques

### 4.1 Critical Path Method (CPM)

**Modèle** : DAG pondéré où $w(u,v)$ = durée de la tâche associée à l'arête.

**Chemin critique** = chemin le plus long dans le DAG :

$$L(v) = \max_{u : (u,v) \in E} \left[ L(u) + w(u, v) \right]$$

avec $L(s) = 0$ pour les sources.

**Marge totale** (*total float*) d'une arête $(u,v)$ :

$$TF(u,v) = LS(v) - ES(u) - w(u,v)$$

où $ES(u)$ = earliest start, $LS(v)$ = latest start.

Une arête est **critique** $\iff TF(u,v) = 0$.

**CMDB** : le chemin critique représente la **séquence de dépendances la plus longue** — délai de remédiation maximal en cas de panne en cascade.

**Complexité** : $O(V + E)$ (tri topologique + parcours linéaire)

---

### 4.2 Floyd-Warshall

**Objectif** : matrice complète des plus courts chemins entre toutes les paires.

**Récurrence** :

$$d_k(i, j) = \min\left(d_{k-1}(i, j), \; d_{k-1}(i, k) + d_{k-1}(k, j)\right)$$

**Initialisation** :

$$d_0(i, j) = \begin{cases} 0 & \text{si } i = j \\ w(i,j) & \text{si } (i,j) \in E \\ +\infty & \text{sinon} \end{cases}$$

**Résultat** : $d_n(i, j) = d^*(i, j)$ pour tout $i, j$.

**Détection de cycle négatif** : $\exists i : d_n(i, i) < 0$.

**Complexité** : $O(V^3)$ en temps, $O(V^2)$ en espace — utilisable uniquement pour de petits sous-graphes ($n < 1000$).

---

### 4.3 Bellman-Ford

**Objectif** : plus courts chemins depuis $s$ avec poids négatifs autorisés.

**Relaxation** (répétée $n - 1$ fois) :

$$\forall (u, v) \in E : \quad d(v) \leftarrow \min\left(d(v), \; d(u) + w(u, v)\right)$$

**Détection de cycle négatif** (passe supplémentaire) :

$$\exists (u, v) \in E : d(u) + w(u, v) < d(v) \quad \Rightarrow \quad \text{cycle négatif}$$

**Complexité** : $O(V \cdot E)$

---

### 4.4 Tri topologique (Kahn)

**Condition** : le graphe doit être un **DAG** (Directed Acyclic Graph).

**Degré entrant** :

$$\text{in}(v) = |\{u : (u, v) \in E\}|$$

**Algorithme** :
1. $Q \leftarrow \{v \in V : \text{in}(v) = 0\}$
2. Tant que $Q \neq \emptyset$ :
   - Extraire $v$ de $Q$, l'ajouter à l'ordre
   - Pour chaque $(v, w) \in E$ : $\text{in}(w) \leftarrow \text{in}(w) - 1$
   - Si $\text{in}(w) = 0$ : $Q \leftarrow Q \cup \{w\}$

**Détection de cycle** :

$$|\text{ordre}| < |V| \iff G \text{ contient un cycle}$$

**CMDB** : l'ordre topologique donne l'**ordre de déploiement** des services — déployer les dépendances avant les dépendants.

**Complexité** : $O(V + E)$

---

## 5. Algorithmes de résilience

### 5.1 Vertex Connectivity $\kappa(G)$

**Définition** :

$$\kappa(G) = \min_{S \subseteq V} |S| \quad \text{t.q.} \quad G \setminus S \text{ est déconnecté ou trivial}$$

**Théorème de Menger** : la vertex connectivity entre $u$ et $v$ est égale au nombre maximum de chemins $u$-$v$ **vertex-disjoint** :

$$\kappa(u, v) = \max |\{P_1, P_2, \ldots, P_k : P_i \cap P_j = \{u, v\}\}|$$

**Calcul via max-flow** : formulation en flot maximum dans un réseau auxiliaire où chaque nœud $v$ est dédoublé en $v_{\text{in}}$, $v_{\text{out}}$ avec une capacité unitaire :

$$\kappa(u, v) = \text{MaxFlow}(u_{\text{out}}, v_{\text{in}})$$

**CMDB** : $\kappa(G) = 1 \Rightarrow$ il existe un CI unique dont la suppression déconnecte le réseau (point d'articulation critique).

---

### 5.2 Edge Connectivity $\lambda(G)$

**Définition** :

$$\lambda(G) = \min_{F \subseteq E} |F| \quad \text{t.q.} \quad G \setminus F \text{ est déconnecté}$$

**Théorème de Menger (version arête)** :

$$\lambda(u, v) = \text{MaxFlow}(u, v) \quad \text{avec capacités unitaires sur les arêtes}$$

**Min-cut / Max-flow** (Ford-Fulkerson) :

$$\lambda(G) = \min_{s,t \in V} \text{MaxFlow}(s, t)$$

**Borne** : $\lambda(G) \leq \delta(G)$ où $\delta(G) = \min_{v \in V} \deg(v)$ est le degré minimum.

---

### 5.3 Cascading Failure Simulation

**Modèle à seuil** : chaque nœud $v$ tombe en panne si la fraction de ses voisins entrants déjà en panne dépasse un seuil $\theta$ :

$$\text{Défaillance}(v, t) = \begin{cases}
1 & \text{si } v = s \text{ (source initiale)} \\
1 & \text{si } \displaystyle\frac{|\{u \in N^-(v) : \text{Défaillance}(u, t-1) = 1\}|}{|N^-(v)|} \geq \theta \\
0 & \text{sinon}
\end{cases}$$

**Propagation par niveaux** :

$$F_0 = \{s\}$$

$$F_{t+1} = F_t \cup \left\{v \in V \setminus F_t : \frac{|N^-(v) \cap F_t|}{|N^-(v)|} \geq \theta \right\}$$

**Métriques de sortie** :
- **Taille de la cascade** : $|F_\infty|$
- **Profondeur** : $\min\{t : F_t = F_{t+1}\}$
- **Fraction impactée** : $|F_\infty| / n$

**Paramètre CMDB** : $\theta = 0.5$ signifie qu'un CI tombe si au moins la moitié de ses fournisseurs sont en panne.

---

### 5.4 Percolation Analysis

**Modèle** : supprimer une fraction $p$ des nœuds aléatoirement et mesurer la taille de la plus grande composante connexe.

**Seuil de percolation** $p_c$ :

$$p_c = \inf\{p : S(p) = 0\}$$

où $S(p) = |C_{\max}(G')| / n$ avec $G' = G$ après suppression de $\lfloor p \cdot n \rfloor$ nœuds.

**Pour les graphes scale-free** (distribution de degré $P(k) \sim k^{-\gamma}$) :

$$p_c = 1 - \frac{1}{\frac{\langle k^2 \rangle}{\langle k \rangle} - 1}$$

où $\langle k \rangle$ et $\langle k^2 \rangle$ sont les premier et second moments de la distribution des degrés.

**Interprétation** : si $\gamma \leq 3$ (typique des CMDB), $p_c \to 0$ en suppression aléatoire (le réseau est robuste). Mais en **attaque ciblée** (suppression des hubs), $p_c$ est beaucoup plus petit — le réseau se fragmente rapidement.

**CMDB** : quantifie le **pourcentage de CIs dont la panne simultanée déconnecte le SI**.

---

## Résumé des complexités

| # | Algorithme | Temps | Espace |
|---|-----------|-------|--------|
| 1 | BFS | $O(V + E)$ | $O(V)$ |
| 2 | DFS | $O(V + E)$ | $O(V)$ |
| 3 | BFS bidirectionnel | $O(b^{d/2})$ | $O(b^{d/2})$ |
| 4 | Dijkstra | $O((V+E) \log V)$ | $O(V)$ |
| 5 | A* | $O(E)$ — $O(b^d)$ | $O(V)$ |
| 6 | Degree Centrality | $O(V + E)$ | $O(V)$ |
| 7 | Betweenness (Brandes) | $O(VE)$ | $O(V + E)$ |
| 8 | Closeness | $O(V(V + E))$ | $O(V)$ |
| 9 | PageRank | $O(kE)$ | $O(V)$ |
| 10 | Eigenvector | $O(kE)$ | $O(V)$ |
| 11 | HITS | $O(kE)$ | $O(V)$ |
| 12 | Louvain | $O(n \log n)$ | $O(V + E)$ |
| 13 | Label Propagation | $O(kE)$ | $O(V)$ |
| 14 | Girvan-Newman | $O(VE^2)$ | $O(V + E)$ |
| 15 | SCC (Tarjan) | $O(V + E)$ | $O(V)$ |
| 16 | WCC (Union-Find) | $O(V + E)$ | $O(V)$ |
| 17 | CPM | $O(V + E)$ | $O(V)$ |
| 18 | Floyd-Warshall | $O(V^3)$ | $O(V^2)$ |
| 19 | Bellman-Ford | $O(VE)$ | $O(V)$ |
| 20 | Tri topologique | $O(V + E)$ | $O(V)$ |
| 21 | Vertex Connectivity | $O(V \cdot \text{MaxFlow})$ | $O(V + E)$ |
| 22 | Edge Connectivity | $O(V \cdot \text{MaxFlow})$ | $O(V + E)$ |
| 23 | Cascading Failure | $O(V + E)$ par niveau | $O(V)$ |
| 24 | Percolation | $O(T \cdot (V + E))$ | $O(V)$ |

---

*Formules extraites de : Cormen et al. (CLRS), Newman "Networks", Brandes (2001), Blondel et al. (2008), Kleinberg (1999).*
