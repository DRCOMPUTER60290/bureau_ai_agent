# Bureau 3D — Agents IA

Interface web 3D qui représente des agents IA comme des personnages animés dans le décor d'AgenticView adapté : pièces hexagonales reliées par des portes, cloisons vitrées, lounge central et bureaux meublés. Les robots sphériques d'origine sont remplacés par les personnages cubiques orange du projet.

## Concept

Un **patron** orchestre une équipe d'agents IA. Choisissez Claude Code ou ChatGPT (Codex) dans la barre supérieure. Chaque agent a un rôle (développeur, designer, analyste…) et une personnalité visible dans la scène 3D. Vous pouvez lui parler même si l'équipe est vide : il répond aux demandes simples ou crée les spécialistes nécessaires.

Quand vous donnez une consigne, le patron répond directement, la confie à un agent adapté ou crée une équipe sur mesure. Les réponses s'affichent en français avec des paragraphes, titres et listes lisibles.

## Provider Claude Code (compte Pro, sans clé API)

```
Navigateur → API locale de launch.py → claude -p → session Claude Code du compte Pro
```

Aucune clé API Anthropic n'est enregistrée ni envoyée. L'application utilise la session déjà authentifiée du CLI Claude Code (`claude auth status`). Les requêtes sont en mode texte, sans outils d'édition et sans sauvegarder de session de conversation. La recherche web peut être autorisée dans le panneau Équipe; elle est désactivée par défaut.

Le serveur vérifie que le CLI est connecté à `claude.ai` avec le plan Pro. Si Claude Code est absent ou déconnecté, l'application affiche l'erreur au lieu de fabriquer une réponse de simulation.

## Provider ChatGPT (compte ChatGPT)

Dans la barre supérieure, choisissez **ChatGPT (Codex)**. Le serveur appelle `codex exec` avec l'authentification locale du compte ChatGPT, sans clé API, en mode éphémère et lecture seule. La recherche web est disponible seulement si la case correspondante est activée. Pour connecter le compte sur la machine, installez Codex CLI et lancez une fois `codex login`; le badge affiche alors son état de connexion. Le provider utilise le modèle par défaut de Codex CLI.

## Stack technique

- **Three.js 0.158.0** — scène 3D, personnages, ombres, brouillard
- **CSS2DRenderer** — labels HTML ancrés en espace 3D
- **Modules ES natifs** — aucun bundler, import via CDN (cdn.jsdelivr.net)
- **LocalStorage** — configuration d'équipe persistante
- **Claude Code CLI** — `claude -p` via le serveur local Python
- **Codex CLI** — `codex exec` via le serveur local Python, authentifié par compte ChatGPT

## Lancer l'application

### Prérequis

- **Claude Code** installé et connecté sur la machine (`claude auth login`). L'intégration Gmail de Bureau 3D passe par le provider Claude Code; elle n'est pas disponible avec le provider ChatGPT (Codex).
- **Gmail MCP Connector** cloné, installé et configuré en mode `full` selon le [guide de configuration](docs/GMAIL_CONNECTOR_SETUP.md) et les instructions de [jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector). Le dépôt [thevickypedia/gmail-connector](https://github.com/thevickypedia/gmail-connector) est une bibliothèque Python distincte; Bureau 3D attend le serveur MCP `gmail-connector`.

Une fois ces prérequis en place, démarrez Bureau 3D, choisissez **Claude Code**, puis cochez **Gmail Connector** dans le panneau MCP. Le connecteur démarre en mode `full` par défaut. Pour que Google accorde les droits requis, configurez aussi chaque compte en mode complet depuis PowerShell :

```powershell
$env:GMAIL_MCP_MODE = "full"
gmail-connector auth pro
Remove-Item Env:GMAIL_MCP_MODE
```

Remplacez `pro` par l'alias du compte concerné. Dans la fenêtre Google, acceptez les nouveaux droits; relancez ensuite Bureau 3D si nécessaire. Sans la variable d'environnement pendant l'authentification, le connecteur enregistre le compte en lecture seule. Bureau 3D bloque l'envoi et les suppressions même en mode `full`.

Sur Windows, double-cliquez sur **Lancer Bureau 3D.bat** à la racine du projet. Le serveur local démarre et ouvre automatiquement le navigateur. Laissez la fenêtre de terminal ouverte pendant l'utilisation ; `Ctrl+C` arrête le serveur.

N'ouvrez pas `src/index.html` directement depuis l'explorateur (`file://`) : les navigateurs bloquent alors les modules JavaScript et le rendu 3D ne démarre pas.

Pour lancer manuellement :

```bash
python launch.py
```

L'application est servie sur `http://127.0.0.1:7788/`.

Le plan Pro partage ses limites d'utilisation entre Claude et Claude Code. Une réponse directe nécessite un appel du patron; une délégation ajoute la réponse de l'agent, et une nouvelle équipe peut mobiliser plusieurs agents.

## Structure des fichiers

```
src/
├── index.html       — Layout, CSS, importmap Three.js
├── scene.js         — Rendu Three.js, boucle animation, lumières
├── office.js        — Décor AgenticView adapté : pièces, cloisons, mobilier et postes
├── agents.js        — Personnages 3D, états visuels, tooltip survol
├── behavior.js      — Machine à états, mouvements, rayon délégation
├── ui.js            — Panneau équipe, formulaires, journal d'activité
├── bridge.js        — Connexion navigateur vers le provider local
└── orchestrator.js  — Patron reçoit la tâche, choisit l'agent, délègue
plans/
└── bureau3d-claude-agents.md  — Blueprint 8 étapes
docs/
└── GMAIL_CONNECTOR_SETUP.md   — Clonage, installation et OAuth Gmail en mode full
```

Le décor repris et adapté depuis [AgenticView](https://github.com/VoidCU/agenticView) est crédité sous licence MIT dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Utilisation

### Configurer l'équipe

Le premier lancement propose une équipe démo (Alex/Sam/Jordan). Cliquez **✏️** sur la carte Patron pour personnaliser le chef d'équipe.

Cliquez **+ Ajouter un agent** pour créer un agent avec :
- Nom et rôle (développeur, designer, analyste, rédacteur, chercheur)
- Description de sa spécialité
- Modèle Claude (Haiku, Sonnet, Opus)

Cliquez **↺ Réinitialiser l'équipe** pour revenir à l'équipe démo.

### Donner une tâche

Tapez une consigne dans le champ en bas et cliquez **Envoyer**. Le patron répond aux demandes simples, réutilise un agent existant ou crée les spécialistes manquants et leur distribue des missions. Les nouveaux agents sont sauvegardés avec l'équipe.

Pendant leurs pauses, les personnages suivent des itinéraires qui contournent les meubles. S'il n'existe pas de chemin libre, ils restent sur place au lieu de traverser le décor.

Dans la scène, glissez avec le bouton gauche pour tourner autour du bureau, le bouton droit pour déplacer la vue et la molette pour zoomer. Cliquez sur le sol d'une pièce pour recentrer la vue sur ce bureau. Faites glisser la poignée au-dessus du journal pour le redimensionner, ou utilisez **Agrandir / Réduire**; sa hauteur est mémorisée dans le navigateur.

### États des agents

| Émoji | État | Description |
|-------|------|-------------|
| 💤 | IDLE | Disponible |
| 🚶 | WALKING | En déplacement |
| 💭 | THINKING | En réflexion |
| ⚡ | WORKING | Traitement en cours |
| ✅ | DONE | Tâche terminée |
| ❌ | ERROR | Erreur |

## Invariants du système

- **Jamais de clé API** dans le code source ou la requête
- **Pas de bundler** — ES modules natifs uniquement
- **CDN autorisés** : cdn.jsdelivr.net et cdnjs.cloudflare.com uniquement
- **Config d'équipe** sauvegardée avant tout spawn 3D

### Recherche web, skills et partage

- La case **Autoriser la recherche web** donne au provider la permission `WebSearch` pour les requêtes du navigateur. Elle est désactivée par défaut et son réglage est conservé dans le navigateur.
- **Connecteurs MCP** : disponibles avec le provider Claude Code. Seuls les serveurs cochés sont autorisés pour les tâches. Le panneau propose Gmail Connector local (`cmd /c gmail-connector`) si son exécutable est disponible dans le `PATH` Windows, GitHub MCP via `npx`, et les serveurs HTTP/SSE distants. Gmail Connector est ajouté par défaut avec l'autorisation de lire les mails, créer des brouillons, modifier les libellés et archiver. Son mode complet demande à Google les scopes de modification et d'envoi; Bureau 3D bloque toutefois l'envoi, la suppression de brouillons, la corbeille et la suppression de libellés. Pour les étapes de clonage et d'installation, voir [le guide Gmail Connector](docs/GMAIL_CONNECTOR_SETUP.md). Pour obtenir les scopes d'écriture, ouvre PowerShell, définis `$env:GMAIL_MCP_MODE = "full"`, puis exécute `gmail-connector auth <alias>` et accepte les droits Google. Sans cette variable dans le terminal d'authentification, le compte reste en lecture seule. Le Gmail MCP officiel se configure aussi avec un client OAuth Google, mais il est en aperçu développeur et exige l'inscription du projet Cloud avec une adresse Workspace; Google n'accepte pas les adresses personnelles `@gmail.com` à l'inscription. Les serveurs HTTP locaux sont acceptés uniquement sur localhost; les identifiants en URL sont refusés.
- **Outils populaires** : les raccourcis Gmail, Google Drive, GitHub, Outlook, Slack et Notion ouvrent leur page dans un nouvel onglet du navigateur. Se connecter sur leur site ne donne pas automatiquement accès aux agents; configure un serveur MCP dans Bureau 3D et autorise-le dans Claude Code pour intégrer ses outils.
- Les skills du patron et de chaque agent sont des consignes textuelles (une par ligne) incluses dans leurs prompts. Le champ `finds-skills` peut guider le patron pour choisir des skills que vous avez décrits; cette version ne parcourt pas automatiquement le catalogue de skills Codex/Claude.
- Chaque personne qui exécute le projet connecte localement son compte Claude avec `claude auth login` ou son compte ChatGPT avec `codex login`, puis ouvre le projet avec `Lancer Bureau 3D.bat`. Les identifiants ne sont pas partagés et le compte est vérifié sur la machine locale. Le serveur écoute uniquement sur `127.0.0.1`; il ne permet pas à d'autres personnes d'utiliser ton instance à distance.
