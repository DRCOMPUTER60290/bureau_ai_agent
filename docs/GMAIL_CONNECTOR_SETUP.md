# Installer Gmail Connector en mode complet

Ce guide configure [jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector) sur Windows pour Bureau 3D et Claude Code. Il est destiné à être suivi par Claude Code dans un terminal PowerShell.

Le mode `full` expose au connecteur des outils de rédaction, de classement et d'envoi. **Bureau 3D n'autorise que la création de brouillons, la modification des libellés et l'archivage.** Il bloque l'envoi, la suppression de brouillons, la corbeille et la suppression de libellés.

## Prérequis

- Windows avec Git, Node.js 20 ou ultérieur et npm dans le `PATH`.
- Claude Code installé et connecté (`claude auth status`).
- Un compte Google et un projet Google Cloud configuré pour Gmail API et OAuth Desktop. Le compte doit être un utilisateur test si l'application OAuth est en statut Testing.

Ne demande pas à l'utilisateur de coller ses secrets OAuth, ses jetons ou son mot de passe dans le chat ou dans le dépôt. Le fichier de clés OAuth doit rester dans le dossier utilisateur du connecteur et ne doit pas être commité.

## Cloner et installer

Dans PowerShell, choisis un dossier de travail qui ne contient pas déjà un autre dépôt `gmail_connector` :

```powershell
$connectorRoot = Join-Path $env:USERPROFILE "source\gmail_connector"
git clone https://github.com/jwlutz/gmail_connector.git $connectorRoot
Set-Location $connectorRoot
npm install
npm link
```

Si le dossier existe déjà, inspecte son origine avec `git -C $connectorRoot remote -v` et son état avec `git -C $connectorRoot status --short` avant de le réutiliser. Ne supprime ni ne remplace un dépôt existant ou ses fichiers locaux.

Vérifie que la commande est accessible :

```powershell
Get-Command gmail-connector
```

Si elle est introuvable après `npm link`, vérifie le dossier global npm (`npm prefix -g`) et ajoute ce dossier au `PATH` Windows, puis ouvre un nouveau terminal PowerShell.

## Initialiser OAuth et autoriser le compte en mode `full`

L'initialisation guidée ouvre les pages nécessaires pour créer ou utiliser un client OAuth Desktop. Termine l'activation de Gmail API et place le fichier OAuth au chemin demandé par le programme. N'affiche pas le contenu du fichier de clés dans le terminal ou dans le chat.

```powershell
gmail-connector init
```

Avant d'autoriser chaque alias, définis le mode complet **dans le même terminal PowerShell**. Sans cette variable, le CLI enregistre les comptes en lecture seule, même si Bureau 3D lancera ensuite le serveur en mode complet.

```powershell
$env:GMAIL_MCP_MODE = "full"
gmail-connector auth pro
```

Accepte les scopes demandés dans la fenêtre Google. Pour un autre compte, répète `gmail-connector auth <alias>` avec la variable toujours définie. Vérifie ensuite les comptes :

```powershell
gmail-connector accounts
```

La sortie attendue pour l'alias est de la forme `Saved pro (adresse@gmail.com) — mode=full`. Si elle indique `mode=readonly`, ne poursuis pas : vérifie `$env:GMAIL_MCP_MODE` dans ce terminal, remets-le à `full`, puis relance l'authentification et accepte à nouveau la demande Google.

Quand l'authentification est terminée, retire la variable de l'environnement de ce terminal :

```powershell
Remove-Item Env:GMAIL_MCP_MODE
```

Les autorisations OAuth en lecture seule ne sont pas mises à niveau automatiquement. La réauthentification avec le mode complet est nécessaire pour chaque alias.

## Ajouter le serveur à Bureau 3D

1. Démarre Bureau 3D avec `Lancer Bureau 3D.bat`.
2. Choisis **Claude Code** comme provider.
3. Ouvre le panneau MCP et clique **Ajouter Gmail Connector local**.
4. Vérifie que la ligne indique **brouillons + classement**, puis coche-la pour autoriser l'usage du serveur par les tâches.
5. Vérifie que `gmail-connector` est accessible dans le `PATH` Windows de la session qui lance Bureau 3D. Si tu viens de modifier le `PATH`, ferme et rouvre le terminal ou relance Bureau 3D.

Le launcher Bureau 3D passe `GMAIL_MCP_MODE=full` au processus MCP. Cela active les outils nécessaires côté serveur; les scopes Google accordés au compte doivent eux aussi être `full`, d'où l'étape d'authentification PowerShell ci-dessus.

## Ajouter séparément à Claude Code interactif (facultatif)

Bureau 3D démarre son serveur MCP lui-même; son entrée dans le panneau MCP suffit pour Bureau 3D. Pour utiliser également le connecteur dans une session Claude Code interactive, configure une entrée MCP utilisateur avec la commande exécutable `gmail-connector` et la variable d'environnement `GMAIL_MCP_MODE` définie à `full`, puis redémarre Claude Code. Ne partage pas les jetons entre comptes ni entre utilisateurs Windows.

## Dépannage

- **`Saved <alias> (...) — mode=readonly`** : le terminal d'authentification n'avait pas `$env:GMAIL_MCP_MODE = "full"`. Redéfinis-la et relance `gmail-connector auth <alias>`.
- **`Request had insufficient authentication scopes`** : Google conserve l'ancien jeton. Réautorise l'alias en mode complet et accepte les nouveaux scopes dans la page Google.
- **`gmail-connector` est introuvable** : vérifie `npm link`, le dossier global npm et le `PATH` du terminal qui a lancé Bureau 3D.
- **La demande OAuth est refusée** : vérifie que Gmail API est activée dans le projet Cloud et que l'adresse est ajoutée aux utilisateurs test de l'écran de consentement OAuth.
- **Les outils de brouillon ou de classement ne sont pas proposés** : vérifie dans Bureau 3D que le serveur est en mode **brouillons + classement**, que sa case est cochée, et que l'alias est en `mode=full`.

Référence amont : [README de jwlutz/gmail_connector](https://github.com/jwlutz/gmail_connector).
