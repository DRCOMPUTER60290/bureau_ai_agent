# Bureau 3D — Agents Claude

**Objectif** : Interface web 3D (Three.js) représentant un bureau virtuel où des agents Claude se déplacent. Un agent "patron" orchestre une équipe. L'utilisateur crée son équipe. Les vrais appels LLM passent via `window.claude.ask()` → Claude Code → Agent tool (Option B, pas de clé API).

**Répertoire** : `E:\travail\bureau3d_claude\`

**Mode** : Direct (pas de git/GitHub)

---

## Architecture

```
[Artifact 3D / Browser]
  │  window.claude.ask("task")
  ▼
[Claude Code Session]  ← déjà authentifié avec compte Claude
  │  Agent tool
  ▼
[Subagent Claude]  ← exécute la tâche
  │  retourne résultat
  ▼
[Artifact] → met à jour l'état 3D de l'agent
```

**Capabilities artifact** : `claude` (window.claude.ask), `db` (config équipe persistée)

---

## Structure de fichiers

```
src/
├── index.html        ← entrée, canvas 3D + panels HTML
├── scene.js          ← Three.js scene, caméra, lumières, bureau
├── agents.js         ← modèles personnages + animations
├── behavior.js       ← machine à états + déplacement
├── ui.js             ← panneau Team Builder
├── bridge.js         ← window.claude.ask() integration
└── orchestrator.js   ← logique patron → délégation équipe
```

---

## Étapes

### Étape 1 — Scaffold projet
**Durée estimée** : 1h  
**Dépendances** : aucune

**Contexte** : Projet vide dans `E:\travail\bureau3d_claude\`. On crée le squelette HTML avec Three.js depuis CDN (cdnjs.cloudflare.com). Pas de bundler — vanilla JS avec modules ES.

**Tâches** :
- [ ] Créer `src/index.html` avec `<canvas id="c">`, panel latéral droit, panel log bas
- [ ] Importer Three.js + OrbitControls depuis cdnjs
- [ ] CSS layout : canvas occupe 70% gauche, UI 30% droite, log 20% bas
- [ ] Vérifier rendu vide (fond noir, console propre)

**Vérification** : Ouvrir `index.html` dans navigateur → canvas noir sans erreur JS

**Critère de sortie** : Canvas Three.js initialisé, structure HTML complète

---

### Étape 2 — Scène de bureau 3D
**Durée estimée** : 2h  
**Dépendances** : Étape 1  
**Parallèle possible avec** : Étape 3

**Contexte** : Construire l'environnement 3D du bureau. Style low-poly, tonalité douce. Vue isométrique par défaut. Pas de textures externes — matériaux MeshLambertMaterial avec couleurs hex.

**Tâches** :
- [ ] Sol : `PlaneGeometry(20, 20)`, couleur beige clair, grille optionnelle
- [ ] Murs : 3 murs (fond + 2 côtés), hauteur 4, couleur blanc cassé
- [ ] Plafond (optionnel, semi-transparent)
- [ ] Bureaux (BoxGeometry) : 6 postes arrangés en U
- [ ] Chaises : cylindre + dossier simplifié
- [ ] Plantes décoratives (cylindre pot + sphère verte)
- [ ] Lumière ambiante AmbientLight(0xffffff, 0.6) + DirectionalLight
- [ ] OrbitControls limité (pas de flip)

**Vérification** : Bureau visible, navigable à la souris

**Critère de sortie** : `scene.js` exportant `initScene()` et `getScene()`

---

### Étape 3 — Personnages agents
**Durée estimée** : 2h  
**Dépendances** : Étape 1  
**Parallèle possible avec** : Étape 2

**Contexte** : Personnages low-poly inspirés de Claude (silhouette arrondie, couleur orange/beige Anthropic). Patron = plus grand, couronne dorée. Agents = taille standard, couleur selon rôle.

**Tâches** :
- [ ] Classe `AgentCharacter(name, role, isPatron)` dans `agents.js`
- [ ] Corps : sphère tête (0.3r) + cylindre corps (0.2r, h0.6) + 2 bras cylindre
- [ ] Patron : scale 1.3x + `ConeGeometry` couronne jaune au-dessus tête
- [ ] Animation idle : tween vertical ±0.05 (bob) toutes 1.5s avec `requestAnimationFrame`
- [ ] Couleurs : patron=#E97319, agent défaut=#5B7FA6, variants par rôle
- [ ] `setPosition(x, z)` + `lookAt(target)`

**Vérification** : Au moins 3 personnages visibles dans la scène

**Critère de sortie** : `agents.js` exportant classe `AgentCharacter` avec animations

---

### Étape 4 — Machine à états & déplacement
**Durée estimée** : 2h  
**Dépendances** : Étapes 2 + 3

**Contexte** : Chaque agent a des états visuels : idle (à son bureau), walking (se déplace), thinking (bulle "..."), working (animation rapide), done (check vert). Déplacement linéaire simple vers cible.

**Tâches** :
- [ ] Enum states : `IDLE | WALKING | THINKING | WORKING | DONE | ERROR`
- [ ] Indicateur état : sprite HTML2D (CSS2DRenderer) au-dessus personnage
  - THINKING : "💭 ..." clignotant
  - WORKING : "⚡" animation
  - DONE : "✅"
  - ERROR : "❌"
- [ ] Déplacement : `moveTo(x, z)` → interpolation linéaire sur N frames
- [ ] Transition de bureau à bureau (patron appelle agent → agent se lève, marche, s'assoit)
- [ ] `behavior.js` gérant la boucle d'update

**Vérification** : Agent se déplace fluidement d'un bureau à l'autre avec indicateur visible

**Critère de sortie** : `behavior.js` avec `updateAgents(deltaTime)` appelé dans boucle render

---

### Étape 5 — Panneau Team Builder
**Durée estimée** : 1.5h  
**Dépendances** : Étape 1  
**Parallèle possible avec** : Étape 4

**Contexte** : Panel HTML pur (pas Three.js) sur la droite. L'utilisateur crée/modifie/supprime des agents. Config persistée dans localStorage + artifact DB (capability `db`).

**Tâches** :
- [ ] Liste équipe : cartes agents avec nom, rôle, couleur indicator
- [ ] Bouton "Ajouter agent" → formulaire : nom, rôle (dropdown), description, modèle Claude
- [ ] Patron : section séparée en haut, configurable (nom, personnalité, instructions)
- [ ] Supprimer agent (avec confirmation)
- [ ] Sauvegarder équipe → localStorage + artifact DB
- [ ] Charger au démarrage → instancier `AgentCharacter` pour chaque agent sauvé
- [ ] `ui.js` exportant `initTeamBuilder()` et `getTeamConfig()`

**Vérification** : Créer 3 agents → recharger page → équipe restaurée

**Critère de sortie** : `ui.js` complet, sync localStorage fonctionnel

---

### Étape 6 — Bridge Claude Code
**Durée estimée** : 2h  
**Dépendances** : Étape 5

**Contexte** : Le cœur de l'Option B. `window.claude.ask()` envoie un message à Claude Code. Claude Code spawn un subagent via Agent tool. Résultat retourné à l'artifact.

**Format message** :
```
[AGENT_TASK] Tu es {agent.name}, {agent.role}. {agent.description}. Tâche : {task}
```

**Tâches** :
- [ ] `bridge.js` → fonction `askAgent(agentConfig, task)` → appelle `window.claude.ask(prompt)`
- [ ] Pendant l'appel : setState(THINKING), puis setState(WORKING)
- [ ] À la réception : setState(DONE), afficher réponse dans log panel
- [ ] Gestion erreur : setState(ERROR) + message dans log
- [ ] Timeout 30s avec fallback message
- [ ] `bridge.js` exportant `initBridge()` et `dispatchTask(agentId, task)`

**Vérification** : Envoyer une tâche simple → réponse visible dans log

**Critère de sortie** : `bridge.js` fonctionnel, communication Claude Code confirmée

---

### Étape 7 — Logique d'orchestration (Patron)
**Durée estimée** : 2h  
**Dépendances** : Étapes 5 + 6

**Contexte** : L'utilisateur envoie une tâche globale au patron. Le patron analyse, découpe, et délègue à l'agent approprié.

**Prompt patron** :
```
Tu es {patron.name}, chef d'équipe. Équipe : {liste agents}.
Demande utilisateur : "{task}"
Réponds UNIQUEMENT en JSON : {"agent": "nom", "task": "tâche reformulée"}
```

**Tâches** :
- [ ] Input utilisateur en bas ("Donnez une tâche à votre équipe...")
- [ ] Patron reçoit tâche → THINKING → bridge.js → retour JSON
- [ ] Parser JSON → identifier agent cible
- [ ] Animation : ligne lumineuse patron → agent délégué
- [ ] Agent cible reçoit sa tâche → bridge.js
- [ ] Log panel : chaîne complète patron → agent
- [ ] `orchestrator.js` exportant `initOrchestrator()` et `submitTask(text)`

**Vérification** : "Écris un poème sur Claude" → patron choisit writer → agent répond

**Critère de sortie** : Chaîne complète utilisateur → patron → agent → réponse

---

### Étape 8 — Polish & démo
**Durée estimée** : 1.5h  
**Dépendances** : Toutes

**Tâches** :
- [ ] Équipe démo par défaut (patron + Developer/Designer/Writer)
- [ ] Transitions CSS pour panels
- [ ] Tooltip hover sur personnage (nom + rôle + dernier message)
- [ ] Bouton "Reset équipe"
- [ ] Mobile : layout empilé
- [ ] README.md

**Critère de sortie** : App utilisable end-to-end

---

## Ordre d'exécution

```
Étape 1
 ├── Étape 2 ─┐
 ├── Étape 3 ─┴─→ Étape 4 ─┐
 └── Étape 5 ───────────────┴─→ Étape 6 → Étape 7 → Étape 8
```

**Parallèles** : 2 ∥ 3, puis 4 ∥ 5

---

## Invariants

- Aucune clé API dans le code (Option B — window.claude.ask uniquement)
- Pas de bundler — vanilla JS ES modules depuis CDN uniquement
- CDN autorisés : cdnjs.cloudflare.com, cdn.jsdelivr.net uniquement
- Team config toujours sauvegardée avant spawn des personnages 3D
- States agents toujours synchronisés entre UI panel et scène 3D
