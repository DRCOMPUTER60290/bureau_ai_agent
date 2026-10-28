"""Serve Bureau 3D and connect it to authenticated Claude Code and Codex CLIs."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
import json
import os
import re
import shutil
import subprocess
import tempfile
import webbrowser


ROOT = Path(__file__).resolve().parent / "src"
HOST = "127.0.0.1"
PORT = 7788
URL = f"http://{HOST}:{PORT}/"
ALLOWED_ORIGINS = {URL.rstrip("/"), f"http://localhost:{PORT}"}
MODELS = {"sonnet", "haiku"}
MAX_BODY = 20_000
MAX_PROMPT = 16_000
REQUEST_TIMEOUT = 150
MCP_NAME = re.compile(r"^[A-Za-z0-9_-]{1,48}$")
GMAIL_MCP_URL = "https://gmailmcp.googleapis.com/mcp/v1"
GMAIL_OAUTH_CALLBACK_PORT = 8765
GOOGLE_CLIENT_ID = re.compile(r"^[A-Za-z0-9._-]{10,512}$")
_SAFE_ENV_KEY = re.compile(r'^[A-Z][A-Z0-9_]{1,63}$')
_NPM_PKG = re.compile(r'^(@[a-z0-9][a-z0-9._-]{0,63}/)?[a-z0-9][a-z0-9._-]{0,213}$')


def _claude_executable():
    return shutil.which("claude") or shutil.which("claude.exe")


def _codex_executable():
    return shutil.which("codex") or shutil.which("codex.exe")


def _codex_env():
    """Use the local ChatGPT login, not an API key or custom provider."""
    env = os.environ.copy()
    env.pop("OPENAI_API_KEY", None)
    env.pop("OPENAI_BASE_URL", None)
    env.setdefault("CODEX_HOME", str(Path.home() / ".codex"))
    return env


def _cli_env():
    """Force the child CLI to use its first-party login, never an API/custom provider key."""
    env = os.environ.copy()
    for key in (
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ):
        env.pop(key, None)
    return env


def _auth_status():
    executable = _claude_executable()
    if not executable:
        return {"connected": False, "message": "Claude Code est introuvable dans le PATH."}
    try:
        result = subprocess.run(
            [executable, "auth", "status"],
            cwd=ROOT,
            env=_cli_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
            shell=False,
        )
        data = json.loads(result.stdout) if result.returncode == 0 else {}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return {"connected": False, "message": "Impossible de vérifier la session Claude Code."}

    connected = (
        data.get("loggedIn") is True
        and data.get("authMethod") == "claude.ai"
        and data.get("apiProvider") == "firstParty"
        and str(data.get("subscriptionType", "")).lower() == "pro"
    )
    if connected:
        return {"connected": True, "provider": "Claude Code · compte Pro", "model": "Sonnet"}
    if data.get("loggedIn"):
        return {
            "connected": False,
            "message": "La session Claude Code active n'est pas connectée au compte Claude Pro.",
        }
    return {"connected": False, "message": "Connecte-toi à Claude Code avec ton compte Claude Pro."}


def _codex_auth_status():
    executable = _codex_executable()
    if not executable:
        return {"connected": False, "message": "Codex CLI est introuvable dans le PATH."}
    try:
        result = subprocess.run(
            [executable, "login", "status"], cwd=ROOT, env=_codex_env(),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=10, check=False, shell=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {"connected": False, "message": "Impossible de vérifier la session Codex."}
    output = f"{result.stdout}\n{result.stderr}".casefold()
    if result.returncode == 0 and "logged in using chatgpt" in output:
        return {"connected": True, "provider": "Codex · compte ChatGPT", "model": "Codex"}
    if result.returncode == 0 and "logged in" in output:
        return {"connected": False, "message": "Codex CLI n'utilise pas une session de compte ChatGPT."}
    return {"connected": False, "message": "Connecte-toi à Codex CLI avec `codex login`."}


def _mcp_registry_path():
    base = Path(os.environ.get("APPDATA", Path.home()))
    return base / "Bureau3D" / "mcp_servers.json"


def _read_mcp_registry():
    try:
        data = json.loads(_mcp_registry_path().read_text(encoding="utf-8"))
        servers = data.get("mcpServers", {}) if isinstance(data, dict) else {}
        if not isinstance(servers, dict):
            return {}
        result = {}
        for name, item in servers.items():
            if not isinstance(name, str) or not MCP_NAME.fullmatch(name) or not isinstance(item, dict):
                continue
            stype = item.get("type", "http")
            if stype == "user_config":
                result[name] = item
            elif stype in {"http", "sse"} and isinstance(item.get("url"), str) and _is_safe_mcp_url(item["url"]):
                result[name] = item
            elif stype == "stdio" and _is_valid_stdio(item):
                result[name] = item
        return result
    except (OSError, json.JSONDecodeError):
        return {}


def _write_mcp_registry(data):
    path = _mcp_registry_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"mcpServers": data}, ensure_ascii=False, indent=2), encoding="utf-8")


def _is_valid_stdio(item):
    command = item.get("command")
    args = item.get("args", [])
    env = item.get("env", {})
    if not isinstance(args, list) or not args or not all(isinstance(arg, str) and len(arg) <= 512 for arg in args):
        return False
    if not isinstance(env, dict):
        return False
    if not all(isinstance(k, str) and _SAFE_ENV_KEY.fullmatch(k) for k in env):
        return False
    if not all(isinstance(v, str) and len(v) <= 256 for v in env.values()):
        return False
    if command == "npx":
        pkg = next((a for a in args if not a.startswith("-")), None)
        return bool(pkg and _NPM_PKG.fullmatch(pkg))
    # Permit only the user's exact Windows launcher for the preinstalled Gmail MCP.
    # Do not allow arbitrary cmd.exe scripts or arguments through this endpoint.
    return (
        isinstance(command, str)
        and command.casefold() in {"cmd", "cmd.exe"}
        and [str(arg).casefold() for arg in args] == ["/c", "gmail-connector"]
        and env in ({}, {"GMAIL_MCP_MODE": "readonly"}, {"GMAIL_MCP_MODE": "full"})
    )


def _registry_row(name, item):
    stype = item.get("type", "http")
    if stype == "user_config":
        return {"name": name, "type": "user_config", "managed": item.get("managed") is True, "url": "(config Claude Code)", "transport": "user_config"}
    if stype == "stdio":
        if item.get("command") in {"cmd", "cmd.exe"}:
            row = {"name": name, "type": "stdio", "url": "cmd /c gmail-connector", "transport": "stdio"}
            if name == "gmail-connector":
                row["gmailMode"] = item.get("env", {}).get("GMAIL_MCP_MODE", "full")
            return row
        pkg = next((a for a in item.get("args", []) if not a.startswith("-")), "?")
        return {"name": name, "type": "stdio", "url": f"npx {pkg}", "transport": "stdio"}
    return {"name": name, "type": stype, "url": item.get("url", ""), "transport": stype}


def _is_safe_mcp_url(value):
    from urllib.parse import urlparse
    try:
        parsed = urlparse(value)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            return False
    except ValueError:
        return False
    if parsed.scheme == "https" and parsed.hostname:
        return True
    return parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}


def _run_cli(args, timeout=30):
    executable = _claude_executable()
    if not executable:
        return None
    return subprocess.run(
        [executable, *args], cwd=ROOT, env=_cli_env(), capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=timeout,
        check=False, shell=False,
    )


def _start_gmail_auth(executable):
    if os.name != "nt":
        return "Gmail est configuré dans Claude Code. Ouvre Claude Code, lance /mcp, puis authentifie Gmail dans le navigateur."
    try:
        help_result = subprocess.run(
            [executable, "mcp", "--help"], cwd=ROOT, env=_cli_env(),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=10, check=False, shell=False,
        )
        supports_login = bool(re.search(r"\blogin\b", help_result.stdout or ""))
        command = [executable, "mcp", "login", "gmail"] if supports_login else [executable]
        subprocess.Popen(
            command, cwd=ROOT, env=_cli_env(),
            creationflags=subprocess.CREATE_NEW_CONSOLE, close_fds=True,
        )
        if supports_login:
            return "Gmail est configuré. La fenêtre Claude Code lance l'autorisation Google. Termine la connexion, puis coche Gmail dans la liste pour donner accès aux agents."
        return "Gmail est configuré. Dans la fenêtre Claude Code ouverte, tape /mcp, sélectionne Gmail puis Authentifier. Termine la connexion Google, puis coche Gmail dans la liste pour donner accès aux agents."
    except (OSError, subprocess.TimeoutExpired):
        return "Gmail est configuré dans Claude Code. Ouvre Claude Code, lance /mcp, puis authentifie Gmail dans le navigateur avant de cocher le connecteur ici."


def _gmail_cli_config(executable):
    try:
        result = subprocess.run(
            [executable, "mcp", "get", "gmail"], cwd=ROOT, env=_cli_env(),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=20, check=False, shell=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return f"{result.stdout}\n{result.stderr}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        # Do not log task prompts or Claude responses in the server terminal.
        if self.path.startswith("/api/"):
            return
        super().log_message(format, *args)

    def _send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _is_local_request(self):
        return (
            self.headers.get("Host") in {f"{HOST}:{PORT}", f"localhost:{PORT}"}
            and self.headers.get("Origin") in ALLOWED_ORIGINS
        )

    def do_GET(self):
        if self.path == "/api/status":
            claude = _auth_status()
            chatgpt = _codex_auth_status()
            return self._send_json(200, {
                "connected": claude["connected"],
                "provider": claude.get("provider"),
                "model": claude.get("model"),
                "message": claude.get("message"),
                "providers": {"claude": claude, "chatgpt": chatgpt},
            })
        if self.path == "/api/mcp":
            registry = _read_mcp_registry()
            return self._send_json(200, {"servers": [_registry_row(n, i) for n, i in registry.items()]})
        if self.path.startswith("/api/"):
            return self._send_json(404, {"error": "Route inconnue."})
        return super().do_GET()

    def do_POST(self):
        if self.path not in {"/api/claude", "/api/codex", "/api/mcp/add", "/api/mcp/remove", "/api/mcp/link", "/api/mcp/add-stdio", "/api/mcp/gmail/connect", "/api/mcp/gmail-connector/mode"}:
            return self._send_json(404, {"error": "Route inconnue."})
        if not self._is_local_request():
            return self._send_json(403, {"error": "Requête locale refusée."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                return self._send_json(413, {"error": "La requête est vide ou trop volumineuse."})
            request = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self._send_json(400, {"error": "Requête JSON invalide."})

        if self.path == "/api/mcp/gmail/connect":
            client_id = request.get("clientId") if isinstance(request, dict) else None
            client_secret = request.get("clientSecret") if isinstance(request, dict) else None
            registry = _read_mcp_registry()
            if not isinstance(client_id, str) or not GOOGLE_CLIENT_ID.fullmatch(client_id):
                return self._send_json(400, {"error": "Le Client ID Google est invalide."})
            if not isinstance(client_secret, str) or not client_secret or len(client_secret) > 1024 or any(ord(char) < 32 for char in client_secret):
                return self._send_json(400, {"error": "Le Client Secret Google est invalide."})
            executable = _claude_executable()
            if not executable:
                return self._send_json(503, {"error": "Claude Code est introuvable dans le PATH."})
            try:
                version_result = subprocess.run(
                    [executable, "--version"], cwd=ROOT, env=_cli_env(),
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=10, check=False, shell=False,
                )
            except (OSError, subprocess.TimeoutExpired):
                return self._send_json(503, {"error": "Impossible de vérifier la version de Claude Code."})
            version_match = re.search(r"\b(\d+)\.(\d+)\.(\d+)\b", version_result.stdout or "")
            if not version_match or tuple(map(int, version_match.groups())) < (2, 1, 231):
                return self._send_json(426, {"error": "Mets Claude Code à jour en version 2.1.231 ou ultérieure avant de connecter Gmail."})
            existing_config = _gmail_cli_config(executable)
            if GMAIL_MCP_URL in existing_config:
                try:
                    subprocess.run(
                        [executable, "mcp", "remove", "--scope", "user", "gmail"],
                        cwd=ROOT, env=_cli_env(), capture_output=True,
                        text=True, encoding="utf-8", errors="replace", timeout=15,
                        check=False, shell=False,
                    )
                except (OSError, subprocess.TimeoutExpired):
                    return self._send_json(503, {"error": "Impossible de remplacer l'ancienne configuration Gmail dans Claude Code."})
                if GMAIL_MCP_URL in _gmail_cli_config(executable):
                    return self._send_json(409, {"error": "L'ancienne configuration Gmail est encore présente dans Claude Code. Retire-la avec `claude mcp remove gmail --scope user`, puis réessaie."})
            server_config = {
                "type": "http",
                "url": GMAIL_MCP_URL,
                "oauth": {
                    "clientId": client_id,
                    "callbackPort": GMAIL_OAUTH_CALLBACK_PORT,
                    "scopes": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
                },
            }
            env = _cli_env()
            env["MCP_CLIENT_SECRET"] = client_secret
            try:
                result = subprocess.run(
                    [executable, "mcp", "add-json", "--scope", "user", "gmail",
                     json.dumps(server_config, separators=(",", ":")), "--client-secret"],
                    cwd=ROOT, env=env, capture_output=True, text=True,
                    encoding="utf-8", errors="replace", timeout=30,
                    check=False, shell=False,
                )
            except (OSError, subprocess.TimeoutExpired):
                return self._send_json(503, {"error": "Impossible de lancer la configuration Gmail dans Claude Code."})
            if result.returncode != 0:
                configured_after = _gmail_cli_config(executable)
                if GMAIL_MCP_URL not in configured_after or "client_id configured" not in configured_after:
                    return self._send_json(502, {"error": "Claude Code n'a pas terminé l'enregistrement du client OAuth Gmail. Vérifie le Client ID et le Client Secret Google, puis réessaie."})
            registry["gmail"] = {"type": "user_config", "managed": True}
            try:
                _write_mcp_registry(registry)
            except OSError:
                try:
                    subprocess.run([executable, "mcp", "remove", "--scope", "user", "gmail"], cwd=ROOT, env=_cli_env(), capture_output=True, timeout=10, check=False, shell=False)
                except (OSError, subprocess.TimeoutExpired):
                    pass
                return self._send_json(500, {"error": "Claude Code a configuré Gmail, mais Bureau 3D n'a pas pu enregistrer le connecteur."})
            message = _start_gmail_auth(executable)
            return self._send_json(200, {"message": message, "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if self.path == "/api/mcp/gmail-connector/mode":
            mode = request.get("mode") if isinstance(request, dict) else None
            if mode not in {"readonly", "full"}:
                return self._send_json(400, {"error": "Mode Gmail invalide."})
            registry = _read_mcp_registry()
            server = registry.get("gmail-connector")
            if not server or server.get("type") != "stdio" or server.get("command") not in {"cmd", "cmd.exe"}:
                return self._send_json(404, {"error": "Ajoute d'abord Gmail Connector local."})
            server["env"] = {"GMAIL_MCP_MODE": mode}
            if not _is_valid_stdio(server):
                return self._send_json(400, {"error": "La configuration Gmail Connector locale est invalide."})
            try:
                registry["gmail-connector"] = server
                _write_mcp_registry(registry)
            except OSError:
                return self._send_json(500, {"error": "Impossible d'enregistrer le mode Gmail Connector."})
            message = (
                "Mode complet activé. Bureau 3D autorisera les brouillons, libellés et archivage, mais bloquera l'envoi, la suppression et la corbeille. Réautorise chaque compte avec `gmail-connector auth <alias>` pour accorder les nouveaux scopes Gmail."
                if mode == "full"
                else "Mode lecture seule activé pour Gmail Connector."
            )
            return self._send_json(200, {"message": message, "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if self.path == "/api/mcp/add":
            name = request.get("name") if isinstance(request, dict) else None
            url = request.get("url") if isinstance(request, dict) else None
            transport = request.get("transport", "http") if isinstance(request, dict) else "http"
            if not isinstance(name, str) or not MCP_NAME.fullmatch(name) or not isinstance(url, str) or not _is_safe_mcp_url(url) or transport not in {"http", "sse"}:
                return self._send_json(400, {"error": "Entre un nom simple, une URL HTTPS (HTTP est limité à localhost) et un transport valide."})
            registry = _read_mcp_registry()
            if name in registry:
                return self._send_json(409, {"error": "Ce nom de connecteur est déjà ajouté dans Bureau 3D."})
            try:
                result = _run_cli(["mcp", "add", "--scope", "user", "--transport", transport, name, url])
            except (OSError, subprocess.TimeoutExpired):
                return self._send_json(503, {"error": "Impossible de lancer l'ajout MCP dans Claude Code."})
            if result is None:
                return self._send_json(503, {"error": "Claude Code est introuvable dans le PATH."})
            if result.returncode != 0:
                return self._send_json(502, {"error": "Claude Code n'a pas pu ajouter ce serveur MCP. Vérifie le nom et l'URL."})
            registry[name] = {"type": transport, "url": url}
            try:
                _write_mcp_registry(registry)
            except OSError:
                try:
                    _run_cli(["mcp", "remove", name, "--scope", "user"])
                except (OSError, subprocess.TimeoutExpired):
                    pass
                return self._send_json(500, {"error": "Impossible d'enregistrer le connecteur dans le profil local Bureau 3D."})
            return self._send_json(200, {"message": f"Connecteur {name} ajouté à la configuration utilisateur Claude Code.", "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if self.path == "/api/mcp/remove":
            name = request.get("name") if isinstance(request, dict) else None
            registry = _read_mcp_registry()
            if not isinstance(name, str) or name not in registry:
                return self._send_json(404, {"error": "Connecteur Bureau 3D introuvable."})
            stype = registry[name].get("type", "http")
            if stype in {"http", "sse"} or registry[name].get("managed") is True:
                try:
                    result = _run_cli(["mcp", "remove", name, "--scope", "user"])
                except (OSError, subprocess.TimeoutExpired):
                    return self._send_json(503, {"error": "Impossible de retirer ce connecteur de Claude Code."})
                if result is None or result.returncode != 0:
                    return self._send_json(502, {"error": "Claude Code n'a pas pu retirer ce serveur MCP."})
            del registry[name]
            try:
                _write_mcp_registry(registry)
            except OSError:
                return self._send_json(500, {"error": "Le serveur a été retiré de Claude Code, mais Bureau 3D n'a pas pu actualiser son registre local."})
            return self._send_json(200, {"message": f"Connecteur {name} retiré.", "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if self.path == "/api/mcp/link":
            name = request.get("name") if isinstance(request, dict) else None
            if not isinstance(name, str) or not MCP_NAME.fullmatch(name):
                return self._send_json(400, {"error": "Nom invalide (lettres, chiffres, tirets, max 48 car.)."})
            registry = _read_mcp_registry()
            if name in registry:
                return self._send_json(409, {"error": f"« {name} » est déjà dans Bureau 3D."})
            try:
                result = _run_cli(["mcp", "list"])
            except (OSError, subprocess.TimeoutExpired):
                return self._send_json(503, {"error": "Impossible de consulter la configuration Claude Code."})
            if result is None or name not in (result.stdout or ""):
                return self._send_json(404, {"error": f"Le serveur « {name} » est introuvable dans ta config Claude Code. Dans un terminal : claude mcp add --scope user --transport sse {name} <URL>"})
            registry[name] = {"type": "user_config"}
            try:
                _write_mcp_registry(registry)
            except OSError:
                return self._send_json(500, {"error": "Impossible d'enregistrer dans Bureau 3D."})
            return self._send_json(200, {"message": f"Serveur « {name} » lié depuis ta config Claude Code.", "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if self.path == "/api/mcp/add-stdio":
            name = request.get("name") if isinstance(request, dict) else None
            command = request.get("command") if isinstance(request, dict) else None
            args = request.get("args") if isinstance(request, dict) else None
            env = request.get("env") if isinstance(request, dict) else {}
            if not isinstance(name, str) or not MCP_NAME.fullmatch(name):
                return self._send_json(400, {"error": "Nom invalide."})
            server_def = {"type": "stdio", "command": command, "args": args or [], "env": env or {}}
            if name == "gmail-connector" and command in {"cmd", "cmd.exe"}:
                server_def["env"] = {**server_def["env"], "GMAIL_MCP_MODE": "full"}
            if not _is_valid_stdio(server_def):
                return self._send_json(400, {"error": "Configuration stdio invalide. Seuls npx avec un paquet valide ou la commande prédéfinie cmd /c gmail-connector sont autorisés."})
            registry = _read_mcp_registry()
            if name in registry:
                return self._send_json(409, {"error": f"« {name} » est déjà dans Bureau 3D."})
            registry[name] = server_def
            try:
                _write_mcp_registry(registry)
            except OSError:
                return self._send_json(500, {"error": "Impossible d'enregistrer dans Bureau 3D."})
            return self._send_json(200, {"message": f"Serveur local « {name} » ajouté. Coche-le pour activer ses outils.", "servers": [_registry_row(n, i) for n, i in registry.items()]})

        if not isinstance(request, dict):
            return self._send_json(400, {"error": "Requête JSON invalide."})

        if self.path == "/api/codex":
            return self._handle_codex(request)

        prompt = request.get("prompt") if isinstance(request, dict) else None
        model = request.get("model", "sonnet") if isinstance(request, dict) else "sonnet"
        web_search = request.get("webSearch") is True if isinstance(request, dict) else False
        requested_mcp = request.get("mcpServers", [])
        if not isinstance(requested_mcp, list) or any(not isinstance(name, str) for name in requested_mcp):
            return self._send_json(400, {"error": "La liste des connecteurs MCP est invalide."})
        registry = _read_mcp_registry()
        gmail_server = registry.get("gmail-connector")
        if gmail_server and gmail_server.get("type") == "stdio":
            gmail_env = gmail_server.get("env")
            if not isinstance(gmail_env, dict):
                gmail_env = {}
                gmail_server["env"] = gmail_env
            gmail_env.setdefault("GMAIL_MCP_MODE", "full")
        mcp_servers = sorted(set(requested_mcp))
        if any(name not in registry or not MCP_NAME.fullmatch(name) for name in mcp_servers):
            return self._send_json(400, {"error": "Un connecteur demandé n'est pas ajouté dans Bureau 3D."})
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT:
            return self._send_json(400, {"error": "La consigne est vide ou trop longue."})
        if not isinstance(model, str) or model not in MODELS:
            return self._send_json(400, {"error": "Ce modèle n'est pas disponible pour cette configuration Pro."})

        status = _auth_status()
        if not status["connected"]:
            return self._send_json(503, {"error": status["message"]})

        executable = _claude_executable()
        command = [
            executable,
            "-p",
            prompt,
            "--output-format", "json",
            "--model", model,
            "--max-turns", "4" if web_search or mcp_servers else "1",
            "--no-session-persistence",
            "--setting-sources", "user",
        ]
        # Claude Code's safe mode disables every MCP server, including explicitly
        # selected connectors. Keep it for isolated requests without connectors;
        # selected MCP tools are separately allow-listed below.
        if not mcp_servers:
            command.append("--safe-mode")
        allowed_tools = []
        disallowed_tools = []
        if web_search:
            allowed_tools.append("WebSearch")
        for name in mcp_servers:
            if name != "gmail-connector":
                allowed_tools.append(f"mcp__{name}")
                continue
            readonly_tools = ("list_accounts", "search_emails", "get_email", "get_thread", "list_labels", "get_attachment")
            allowed_tools.extend(f"mcp__gmail-connector__{tool}" for tool in readonly_tools)
            if registry[name].get("env", {}).get("GMAIL_MCP_MODE", "full") == "full":
                write_tools = ("create_draft", "modify_labels", "archive_email", "create_label")
                allowed_tools.extend(f"mcp__gmail-connector__{tool}" for tool in write_tools)
                disallowed_tools.extend(f"mcp__gmail-connector__{tool}" for tool in ("send_email", "delete_draft", "trash_email", "delete_label"))
        # user_config servers are already in Claude Code user settings (via --setting-sources user);
        # only http/sse and stdio servers need to be passed via --mcp-config.
        conf_servers = [n for n in mcp_servers if registry[n].get("type") != "user_config"]
        mcp_config_path = None
        if conf_servers:
            registry_dir = _mcp_registry_path().parent
            registry_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", dir=registry_dir, delete=False) as config_file:
                json.dump({"mcpServers": {name: registry[name] for name in conf_servers}}, config_file)
                mcp_config_path = config_file.name
            command.extend(["--mcp-config", mcp_config_path])
        if allowed_tools:
            command.extend(["--allowedTools", ",".join(allowed_tools)])
        else:
            command.extend(["--tools", ""])
        if disallowed_tools:
            command.extend(["--disallowedTools", ",".join(disallowed_tools)])
        cli_env = _cli_env()
        if any(registry[name].get("command") in {"cmd", "cmd.exe"} for name in mcp_servers):
            npm_bin = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "npm"
            cli_env["PATH"] = os.pathsep.join(filter(None, (str(npm_bin), cli_env.get("PATH", ""))))
        try:
            result = subprocess.run(
                command,
                cwd=ROOT,
                env=cli_env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=REQUEST_TIMEOUT,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            return self._send_json(504, {"error": "Claude Code n'a pas répondu dans les 150 secondes."})
        except OSError:
            return self._send_json(503, {"error": "Impossible de démarrer Claude Code."})
        finally:
            if mcp_config_path:
                try:
                    os.unlink(mcp_config_path)
                except OSError:
                    pass

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "Erreur inconnue de Claude Code.").strip()
            return self._send_json(502, {"error": _friendly_cli_error(detail, web_search)})
        try:
            output = json.loads(result.stdout)
            answer = output.get("result", "") if isinstance(output, dict) else ""
        except json.JSONDecodeError:
            answer = result.stdout.strip()
        if not isinstance(answer, str) or not answer.strip():
            return self._send_json(502, {"error": "Claude Code a renvoyé une réponse vide."})
        return self._send_json(200, {"answer": answer.strip(), "model": model})

    def _handle_codex(self, request):
        prompt = request.get("prompt")
        web_search = request.get("webSearch") is True
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT:
            return self._send_json(400, {"error": "La consigne est vide ou trop longue."})
        status = _codex_auth_status()
        if not status["connected"]:
            return self._send_json(503, {"error": status["message"]})
        executable = _codex_executable()
        command = [
            executable, "exec", "--ephemeral", "--json", "--sandbox", "read-only",
            "--skip-git-repo-check", "--ignore-user-config",
        ]
        if web_search:
            command.append("--search")
        command.append("-")
        try:
            result = subprocess.run(
                command, input=prompt, cwd=ROOT, env=_codex_env(),
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=REQUEST_TIMEOUT, check=False, shell=False,
            )
        except subprocess.TimeoutExpired:
            return self._send_json(504, {"error": "Codex n'a pas répondu dans les 150 secondes."})
        except OSError:
            return self._send_json(503, {"error": "Impossible de démarrer Codex CLI."})
        if result.returncode != 0:
            return self._send_json(502, {"error": "Codex n'a pas pu terminer la tâche. Vérifie la session du compte ChatGPT, puis réessaie."})
        answer = ""
        for line in result.stdout.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = event.get("item", {}) if isinstance(event, dict) else {}
            if event.get("type") == "item.completed" and item.get("type") == "agent_message":
                answer = item.get("text", "")
        if not isinstance(answer, str) or not answer.strip():
            return self._send_json(502, {"error": "Codex n'a pas renvoyé de réponse exploitable."})
        return self._send_json(200, {"answer": answer.strip(), "model": "Codex"})


def _friendly_cli_error(detail, web_search):
    """Avoid exposing Claude Code's raw diagnostic/usage JSON in the activity log."""
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        payload = {}
    denials = payload.get("permission_denials", []) if isinstance(payload, dict) else []
    if web_search and any(item.get("tool_name") == "WebSearch" for item in denials if isinstance(item, dict)):
        return "La recherche web a été refusée par Claude Code. Vérifie sa configuration de permissions puis réessaie."
    if "Reached maximum number of turns" in detail:
        return "Claude Code a atteint la limite de tours avant de terminer. Réessaie avec une demande plus courte."
    return "Claude Code n'a pas pu terminer la tâche. Vérifie la session et la configuration du CLI, puis réessaie."


class LocalHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False


def main():
    global PORT, URL, ALLOWED_ORIGINS
    server = None
    for candidate in range(7788, 7800):
        try:
            server = LocalHTTPServer((HOST, candidate), Handler)
            PORT = candidate
            URL = f"http://{HOST}:{PORT}/"
            ALLOWED_ORIGINS = {URL.rstrip("/"), f"http://localhost:{PORT}"}
            break
        except OSError:
            continue
    if server is None:
        raise OSError("Aucun port local disponible entre 7788 et 7799.")
    server.daemon_threads = True
    print(f"Bureau 3D disponible sur {URL}")
    status = _auth_status()
    print(status.get("provider", status.get("message", "Claude Code indisponible")))
    chatgpt_status = _codex_auth_status()
    print(chatgpt_status.get("provider", chatgpt_status.get("message", "Compte ChatGPT indisponible")))
    print("Laissez cette fenêtre ouverte. Ctrl+C arrête le serveur.")
    Timer(0.5, lambda: webbrowser.open_new_tab(URL)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur Bureau 3D.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
