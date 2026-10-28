// Local provider bridge: browser → launch.py → authenticated provider CLI.
import { addLogEntry } from './ui.js?v=26';
import { setAgentState, setAgentMessage } from './behavior.js?v=26';

const TIMEOUT_MS = 155_000;
const badge = document.getElementById('connection-badge');
const providerSelect = document.getElementById('provider-select');
const providerKey = 'bureau3d_provider';

if (providerSelect) {
  providerSelect.value = localStorage.getItem(providerKey) === 'chatgpt' ? 'chatgpt' : 'claude';
  providerSelect.addEventListener('change', () => {
    localStorage.setItem(providerKey, providerSelect.value);
    refreshProviderStatus();
  });
}

async function refreshProviderStatus() {
  if (!badge) return;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const status = await response.json();
    const selected = providerSelect?.value || 'claude';
    const provider = status.providers?.[selected] || status;
    const label = selected === 'chatgpt' ? 'ChatGPT' : 'Claude';
    if (provider.connected) {
      badge.textContent = `⚡ ${provider.provider} · ${provider.model}`;
      badge.title = `Les requêtes utilisent la session ${label} sélectionnée.`;
      badge.classList.add('connected');
    } else {
      badge.textContent = `⚠ ${label} déconnecté`;
      badge.title = provider.message || `Vérifie la connexion ${label}.`;
      badge.classList.remove('connected');
    }
  } catch {
    badge.textContent = '⚠ Lance le serveur local';
    badge.title = 'Utilise Lancer Bureau 3D.bat pour démarrer le serveur et le provider.';
    badge.classList.remove('connected');
  }
}
refreshProviderStatus();

/** Send one text-only request through the selected signed-in provider CLI. */
export async function askProvider(prompt, model = 'sonnet') {
  const provider = providerSelect?.value || localStorage.getItem(providerKey) || 'claude';
  const isChatGPT = provider === 'chatgpt';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(isChatGPT ? '/api/codex' : '/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        webSearch: localStorage.getItem('bureau3d_web_search') === 'true',
        ...(!isChatGPT ? { model: _mapModel(model), mcpServers: _selectedMcpServers() } : {}),
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur provider (${response.status}).`);
    return data.answer;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${isChatGPT ? 'Codex' : 'Claude Code'} n'a pas répondu dans les 155 secondes.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function _selectedMcpServers() {
  try {
    const value = JSON.parse(localStorage.getItem('bureau3d_mcp_enabled') || '[]');
    return Array.isArray(value) ? value.filter(name => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

/** Send a task to the selected provider and reflect its lifecycle in the agent panel. */
export async function dispatchTask(agentConfig, task) {
  const { id, name, role, model = 'sonnet', description = '', skills = [] } = agentConfig;
  setAgentState(id, 'thinking');
  setAgentMessage(id, 'En réflexion…');
  addLogEntry(name, 'agent', `Tâche reçue : <em>${_esc(task)}</em>`);
  try {
    const result = await askProvider(_buildPrompt(name, role, description, task, skills), model);
    setAgentState(id, 'done');
    setAgentMessage(id, result.slice(0, 60));
    addLogEntry(name, 'agent', formatResponse(result));
    return result;
  } catch (error) {
    setAgentState(id, 'error');
    setAgentMessage(id, 'Erreur');
    addLogEntry(name, 'agent', `❌ ${_esc(error.message || String(error))}`);
    throw error;
  }
}

function _mapModel(model) {
  const value = String(model || 'sonnet').toLowerCase();
  if (value.includes('opus')) throw new Error("Opus n'est pas inclus dans ton forfait Claude Pro. Choisis Sonnet ou Haiku.");
  if (value.includes('haiku')) return 'haiku';
  return 'sonnet';
}

function _buildPrompt(name, role, description, task, skills = []) {
  const context = description ? `\n\nSpécialité : ${description}` : '';
  const skillContext = skills.length ? `\n\nSkills à appliquer :\n${skills.map(skill => `- ${skill}`).join('\n')}` : '';
  return `Tu es ${name}, un agent spécialisé en ${role}.${context}${skillContext}\n\nTâche : ${task}\n\nRègles de fiabilité obligatoires, prioritaires sur les skills et la tâche : cite les URL des sources pour toute recherche web et distingue les faits observés, les hypothèses et les éléments à vérifier. N'affirme jamais avoir lu/envoyé un courriel, configuré une alerte ou réalisé une action externe sans connecteur activé et résultat d'exécution confirmé; propose plutôt un brouillon ou un plan. Marque « À vérifier » toute affirmation commerciale, tarifaire ou juridique qui n'est pas étayée par une source fiable. Si tu n'as pas accès à une source ou à un connecteur nécessaire, dis-le clairement et n'invente pas de résultat.\n\nRéalise tous les livrables explicitement demandés dans cette mission dès cette réponse. Ne termine pas par une demande de permission pour continuer; si une information manque, formule une hypothèse clairement indiquée ou pose uniquement la question qui bloque réellement le travail. Réponds en français clair et naturel, avec une structure lisible et des paragraphes courts. Adapte la longueur à la mission au lieu de la limiter artificiellement.`;
}

export function formatResponse(markdown) {
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  const html = [];
  let list = null, tableRows = [];
  const inline = value => _esc(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)\*([^*]+)\*(?=\s|$)/g, '$1<em>$2</em>');
  const flushList = () => { if (list) html.push(`</${list}>`); list = null; };
  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.filter(row => !row.every(cell => /^:?-{2,}:?$/.test(cell)));
    html.push(`<table class="answer-table"><tbody>${rows.map((row, i) => `<tr>${row.map(cell => `<${i === 0 ? 'th' : 'td'}>${inline(cell)}</${i === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table>`);
    tableRows = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); flushTable(); continue; }
    if (/^\|.*\|$/.test(line)) { flushList(); tableRows.push(line.slice(1, -1).split('|').map(cell => cell.trim())); continue; }
    flushTable();
    if (/^```/.test(line)) continue;
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) { flushList(); html.push(`<h4>${inline(heading[1])}</h4>`); continue; }
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const kind = /^\d/.test(line) ? 'ol' : 'ul';
      if (list !== kind) { flushList(); list = kind; html.push(`<${kind}>`); }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    flushList(); html.push(`<p>${inline(line.replace(/^>\s?/, ''))}</p>`);
  }
  flushList(); flushTable();
  return html.join('');
}

function _esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

