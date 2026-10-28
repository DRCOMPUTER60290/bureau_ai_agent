# Bureau 3D — Agents IA · CLAUDE.md

Mémoire permanente du projet. À lire en début de session pour éviter de re-explorer le code.

---

## Résumé

Interface web 3D (Three.js) représentant un bureau virtuel. Les agents personnalisables se déplacent dans la scène. Un agent "patron" orchestre l'équipe en passant par l'API locale de `launch.py`, qui appelle Claude Code ou Codex selon le provider choisi. Codex utilise le compte ChatGPT local.

**Statut** : Projet complet (8/8 étapes livrées).

---

## Démarrage rapide

```bash
# Depuis E:\travail\bureau3d_claude\
python launch.py
# Le serveur local ouvre le navigateur et fournit les providers Claude Code et Codex
```

Pas de bundler, pas d'install npm. Tout est vanilla JS ES modules + Three.js CDN.

---

## Architecture

```
Utilisateur → input tâche
  → orchestrator.js (le patron choisit l'agent avec le provider sélectionné)
    → behavior.js (animation délégation : rayon lumineux)
      → bridge.js (appel HTTP local → lancement du CLI sélectionné)
        → réponse affichée dans #log-messages + état 3D mis à jour
```

**Providers** : `launch.py` expose `/api/claude` (Claude Code `claude -p`) et `/api/codex` (Codex CLI `codex exec`) en loopback. Codex utilise le compte ChatGPT local; son exécution est éphémère et en lecture seule. Aucune clé API n'est utilisée. La recherche web est permise uniquement si `bureau3d_web_search` vaut `true` dans le navigateur. Pas de simulation silencieuse si le provider est indisponible.

---

## Stack technique

| Technologie | Version / source |
|---|---|
| Three.js | 0.158.0 via `cdn.jsdelivr.net` |
| CSS2DRenderer | `three/addons/renderers/CSS2DRenderer.js` |
| Modules ES | natifs, pas de bundler |
| Persistence | `localStorage` (clé `bureau3d_team`) |
| Provider LLM | Claude Code CLI ou Codex CLI via l'API locale de `launch.py` |

**CDN autorisés** : `cdn.jsdelivr.net` et `cdnjs.cloudflare.com` uniquement — ne pas en ajouter d'autres.

---

## Structure de fichiers

```
E:\travail\bureau3d_claude\
├── CLAUDE.md               ← ce fichier
├── README.md
├── plans/
│   └── bureau3d-claude-agents.md  ← plan de développement original
└── src/
    ├── index.html          ← layout HTML + importmap + CSS vars + script tags
    ├── scene.js            ← WebGLRenderer, CSS2DRenderer, OrbitControls, boucle animation
    ├── office.js           ← décor 3D adapté d'AgenticView : alvéoles, cloisons vitrées, mobilier
    ├── agents.js           ← classe AgentCharacter (corps 3D, états visuels, tooltip raycaster)
    ├── behavior.js         ← machine à états + moveAgentTo + showDelegationBeam + patronDelegatesTo
    ├── ui.js               ← Team Builder (patron + agents CRUD, model selector, localStorage)
    ├── bridge.js           ← appels vers le provider local choisi
    └── orchestrator.js     ← user:task → patron JSON → délégation → bridge
```

---

## Détail des modules

### `scene.js`
- `initScene()` — crée renderer WebGL, CSS2DRenderer sur `#css2d-overlay`, caméra, lumières, OrbitControls
- OrbitControls autorise l'orbite à gauche, le panoramique à droite et le zoom molette. `focusOnRoom(x,z)` anime le recentrage vers un bureau; la scène sélectionne les meshes enregistrés par `registerRoomTarget()` au clic.
- `getScene()` — retourne la THREE.Scene
- Émet `scene:update` avec `{ delta }` à chaque frame (consommé par behavior.js)

### `office.js`
- Adaptation du décor AgenticView : pièces hexagonales de rayon 7, cloisons vitrées avec portes, sols et tapis distincts, meubles détaillés
- Plan : lounge central, bureau manager à l'ouest, salle de réunion, quatre pods (six postes chacun), bureau privé, studio et bibliothèque
- Les personnages orange du projet remplacent les robots d'AgenticView
- Exporte `WALK_OBSTACLES`, `WALK_WALLS` et `LOUNGE_BREAK_SPOTS` pour garder les déplacements hors du mobilier et à travers les ouvertures
- Attribution et licence de la scène : `THIRD_PARTY_NOTICES.md`
- Importé uniquement pour ses effets de bord (s'ajoute à la scène via `getScene()`)

### `agents.js`
- Classe `AgentCharacter(id, name, role, color, isPatron)`
  - Personnage jouet orange : corps cubique, yeux noirs carrés, quatre pattes et queue animée
  - Patron : scale 1.3× + `ConeGeometry` couronne jaune
  - Animations : balancement léger, pattes en marche et queue qui remue via `scene:update`
  - `setState(state)` — met à jour le label CSS2D au-dessus du personnage
  - `setMessage(text)` — texte court affiché dans le label
  - `lookAt(x, z)` — orientation vers une cible
- `getAgent(id)` / `getAllAgents()` — registre global
- `DEMO_AGENTS` — équipe par défaut chargée si localStorage vide

### `behavior.js`
- États : `IDLE | WALKING | THINKING | WORKING | DONE | ERROR`
- `setAgentState(id, state)` — délègue à `agent.setState()`
- `setAgentMessage(id, text)`
- `moveAgentTo(id, tx, tz, onDone)` — chemin A* sur grille, obstacles des meubles et murs; si aucun itinéraire n'existe, l'agent reste sur place (pas de trajet en ligne droite à travers le décor)
- Les agents au repos font une courte pause au coin détente puis reviennent à leur poste
- `showDelegationBeam(fromId, toId, duration)` — THREE.Line orange entre deux agents
- `patronDelegatesTo(agentId)` — séquence : patron regarde + rayon + agent THINKING
- Écoute `scene:update` pour la boucle de mouvement
- `_syncCards()` — throttlé à ~5/s, sync les émojis d'état dans les cartes UI

### `ui.js`
- `initTeamBuilder()` — monte les cartes patron + agents depuis localStorage
- `getTeamConfig()` — retourne `{ patron, agents[] }`
- `createAgentFromPlan(spec)` — valide et sauvegarde un agent créé par le patron, puis lui attribue un bureau libre
- Le bouton d'envoi reste actif sans sous-agent : le patron peut répondre directement ou créer une équipe adaptée
- `addLogEntry(who, type, html)` — pousse une entrée dans `#log-messages`
- Formulaire agent : nom, rôle (5 options), description, (pas de model selector visible dans le form HTML — le modèle est dans la config agent)
- Bouton "Reset équipe" disponible
- Sauvegardes dans `localStorage` à chaque mutation
- `_initLogResize()` — redimensionnement vertical du journal avec poignée, bouton Agrandir/Réduire, hauteur locale persistée

### `launch.py`
- Sert `src/` et expose `/api/status` et `/api/claude` sur `127.0.0.1:7788`
- Vérifie la session `claude.ai` Pro avec `claude auth status`; ne divulgue pas l'adresse du compte
- Délègue au CLI `claude -p`, sans outils, sans persistance de conversation et sans variables de clé API

### `bridge.js`
- `askProvider(prompt, model)` — transmet les demandes au provider local choisi, sans mode simulation
- `dispatchTask(agentConfig, task)` — point d'entrée principal
  - `agentConfig : { id, name, role, model, description, skills[] }`
  - Cycle états : THINKING → (appel) → DONE ou ERROR
- Délai maximum 155 s
- Alias de modèle `sonnet` / `haiku`, transmis au CLI Claude Code
- Prompt agent : réponse en français clair, paragraphes courts et listes si utiles
- Les réponses Markdown (titres, listes, tableaux) sont affichées avec une mise en forme lisible et échappée
- Le serveur décode la sortie du CLI en UTF-8 pour préserver les accents français
- Badge `#connection-badge` : état de connexion lu depuis `/api/status`
- Sélecteur `#provider-select` : choisit Claude Code ou ChatGPT (Codex); choix conservé dans le navigateur

### `orchestrator.js`
- Écoute `user:task` (dispatché par ui.js au clic "Envoyer")
- Guard `_busy` — une seule tâche à la fois
- Prompt patron : choisit `answer`, `delegate` ou `create_team` dans un JSON (modèle `sonnet` via Claude Code)
- Une équipe créée reçoit des agents spécialistes persistés dans `localStorage` et des missions ciblées
- `_parseJSON` — extrait l'objet JSON même entouré de texte ou de backticks
- Si Claude Code ne répond pas, affiche l'erreur dans le journal plutôt que de simuler une réponse
- Une délégation vers un nom absent est affichée comme une erreur au lieu de choisir un agent au hasard
- `patron.skills` guide la planification; `agent.skills[]` est ajouté aux consignes de son prompt. Les skills sont du texte libre, pas chargés depuis un catalogue automatiquement.
- Le patron recherche une URL avant de répartir les missions si la recherche web est activée, puis transmet les résultats sourcés et les incertitudes aux agents.
- Les prompts patron et agent imposent les sources URL, distinguent faits et hypothèses, empêchent les fausses affirmations d'action et marquent « À vérifier » les affirmations commerciales, tarifaires ou juridiques non sourcées.

### Recherche web et MCP
- Case `#web-search-toggle` : stocke le choix local sous `bureau3d_web_search`; l'API n'autorise `WebSearch` que si la valeur envoyée est exactement `true`.
- `#mcp-panel` ajoute les serveurs HTTP/SSE et des serveurs stdio prédéfinis; la configuration applicative est conservée dans `%APPDATA%/Bureau3D/mcp_servers.json`.
- Gmail utilise le serveur HTTP officiel `https://gmailmcp.googleapis.com/mcp/v1`. L'interface demande un client OAuth Google; le secret est transmis temporairement via `MCP_CLIENT_SECRET` à Claude Code, qui le stocke dans son coffre de credentials. Le callback OAuth local fixe est `http://localhost:8765/callback`. Le projet Google Cloud et une adresse utilisateur sur domaine Workspace doivent être inscrits au Google Workspace Developer Preview; les adresses personnelles `@gmail.com` ne sont pas acceptées à l'inscription. Les API Gmail + Gmail MCP doivent aussi être activées dans le projet.
- Seuls les serveurs cochés sont transmis dans un fichier MCP temporaire, supprimé après l'appel. Le launcher stdio `gmail-connector` est autorisé uniquement comme commande exacte `cmd /c gmail-connector`. Read-only autorise les outils de lecture précis; `GMAIL_MCP_MODE=full` ajoute brouillon, libellés et archive; envoyer/supprimer/mettre en corbeille sont explicitement refusés via `--disallowedTools`. Le mode complet requiert une nouvelle autorisation OAuth pour chaque compte.
- Sans recherche web ni MCP activé, `--tools ""` reste appliqué. Les outils d'édition et de shell ne doivent pas être ajoutés.
- Chaque utilisateur doit se connecter dans son installation locale avec `claude auth login`. L'application ne partage pas de session Claude entre personnes et ne sert qu'en loopback.
- Le provider ChatGPT requiert Codex CLI installé et connecté localement via `codex login`. Les appels utilisent `codex exec --ephemeral --sandbox read-only --ignore-user-config`; les paramètres utilisateur (dont les serveurs MCP) ne sont pas chargés. Le modèle par défaut du CLI est utilisé.

---

## Invariants à ne jamais violer

1. **Jamais de clé API** dans le code ou transmise au provider — Claude Code utilise l'authentification du compte Pro.
2. **Tous les imports internes** ont le même suffixe de version (ex: `import { foo } from './ui.js?v=18'`). Quand des modules changent, bumper la version partout pour éviter un module split ou un cache périmé.
3. **CDN** : `cdn.jsdelivr.net` et `cdnjs.cloudflare.com` uniquement.
4. **localStorage** `bureau3d_team` — toujours lire la config équipe avant de spawner les personnages 3D.
5. **États agents** synchronisés entre scène 3D et cartes UI panel (via `_syncCards`).

---

## Équipe démo par défaut

Chargée depuis `DEMO_AGENTS` dans `agents.js` si `localStorage` vide :

| Nom | Rôle | Modèle |
|---|---|---|
| Alex | developer | sonnet |
| Sam | writer | haiku |
| Jordan | analyst | sonnet |

Patron par défaut : **Claude Manager** (Orchestrateur d'équipe).

---

## CSS — Variables clés (`index.html`)

```css
--bg: #0f0f13          /* fond général */
--surface: #1a1a22     /* panels */
--surface2: #22222e    /* cartes */
--border: #2e2e40
--text: #e8e6f0
--text-muted: #8884a0
--accent: #e97319      /* orange Anthropic — patron, boutons primaires */
--accent2: #5b7fa6     /* bleu — agents */
--panel-w: 300px
--log-h: 200px
```

---

## Événements DOM personnalisés

| Événement | Émetteur | Consommateur | Payload |
|---|---|---|---|
| `scene:update` | `scene.js` (RAF) | `behavior.js` | `{ delta: number }` |
| `user:task` | `ui.js` (submit) | `orchestrator.js` | `{ text: string }` |

---

## Points d'attention pour les futures modifications

- **Ajouter un fichier JS** → bumper `?v=X` sur tous les imports dans tous les fichiers (`replace_all`).
- **Nouveaux états** → mettre à jour : `STATE` dans behavior.js, `icons` dans `_syncCards`, le label CSS2D dans `AgentCharacter.setState`.
- **Nouveau rôle agent** → ajouter dans `<select id="f-role">` (index.html) et dans la map couleurs d'agents.js.
- **Model aliases** → mettre à jour `_mapModel` dans bridge.js. Les modèles acceptés dépendent du compte Claude Code et sont limités à Haiku et Sonnet pour le plan Pro.
- **CSS2DRenderer** — le div `#css2d-overlay` doit rester `pointer-events: none` pour que le raycaster des tooltips fonctionne.
