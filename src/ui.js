// Team Builder panel — étapes 1 + 3 + 5

import { spawnAgent, removeAgent, getAgent } from './agents.js?v=26';
import { DESK_SLOTS } from './office.js?v=26';
// v=19 — Gmail OAuth link + GitHub stdio MCP support

export const ROLE_LABELS = {
  developer: 'Développeur', designer: 'Designer',
  analyst: 'Analyste', writer: 'Rédacteur', researcher: 'Chercheur',
};

const ROLE_COLORS_CSS = {
  developer: '#5b7fa6', designer: '#a65b8f',
  analyst: '#5ba67a', writer: '#a6955b', researcher: '#7a5ba6',
};

const DEFAULT_CONFIG = {
  patron: { name: 'Claude Manager', description: 'Orchestrateur d\'équipe', instructions: '' },
  agents: [],
};

// Équipe démo pré-configurée pour les nouveaux utilisateurs
const DEMO_AGENTS = [
  { id: 'demo-dev',      name: 'Alex',   role: 'developer',  description: 'Backend & APIs',      model: 'sonnet', lastMessage: '' },
  { id: 'demo-writer',   name: 'Sam',    role: 'writer',     description: 'Rédaction & contenu', model: 'haiku',  lastMessage: '' },
  { id: 'demo-analyst',  name: 'Jordan', role: 'analyst',    description: 'Analyse de données',  model: 'sonnet', lastMessage: '' },
];

let teamConfig = structuredClone(DEFAULT_CONFIG);
let taskBusy = false;

// ── Init ──────────────────────────────────────────────────────

export function initTeamBuilder() {
  _loadFromStorage();
  _renderPatronCard();
  _renderAgentList();
  _bindPatronEdit();
  _bindForm();
  _bindTaskInput();
  _bindReset();
  _initLogResize();
  const webToggle = document.getElementById('web-search-toggle');
  if (webToggle) {
    webToggle.checked = localStorage.getItem('bureau3d_web_search') === 'true';
    webToggle.addEventListener('change', () => localStorage.setItem('bureau3d_web_search', String(webToggle.checked)));
  }
  _initMcpConnectors();
}

export function getTeamConfig() { return teamConfig; }
export function getAvailableAgentSlots() { return Math.max(0, DESK_SLOTS.length - teamConfig.agents.length); }
export function setTaskBusy(busy) {
  taskBusy = Boolean(busy);
  const button = document.getElementById('task-submit');
  if (button) button.disabled = taskBusy;
}

/** Add a new agent from the patron's validated team plan and persist it. */
export function createAgentFromPlan(spec) {
  if (teamConfig.agents.length >= DESK_SLOTS.length) throw new Error('Tous les bureaux sont déjà occupés.');
  const name = String(spec?.name || '').trim().slice(0, 30);
  const role = String(spec?.role || '').toLowerCase();
  if (!name) throw new Error('Le patron a proposé un agent sans nom.');
  if (!Object.hasOwn(ROLE_LABELS, role)) throw new Error(`Rôle inconnu pour ${name}.`);
  if (teamConfig.agents.some(agent => agent.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`Le nom « ${name} » est déjà utilisé.`);
  const model = String(spec?.model || 'sonnet').toLowerCase() === 'haiku' ? 'haiku' : 'sonnet';
  const agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    role,
    description: String(spec?.description || '').trim().slice(0, 60),
    skills: _parseSkills(spec?.skills),
    model,
    lastMessage: '',
  };
  const slotIndex = teamConfig.agents.length;
  teamConfig.agents.push(agent);
  _save();
  _renderAgentList();
  spawnAgent({ id: agent.id, name: agent.name, role: agent.role, isPatron: false, slotIndex });
  window.dispatchEvent(new CustomEvent('team:updated', { detail: teamConfig }));
  return agent;
}

// ── Log ───────────────────────────────────────────────────────

export function addLogEntry(who, whoClass, text) {
  const box = document.getElementById('log-messages');
  if (!box) return;
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-who ${whoClass}">${_esc(who)}</span><span class="log-text">${text}</span>`;
  box.appendChild(entry);
  box.scrollTop = box.scrollHeight;
}

// ── Storage ───────────────────────────────────────────────────

function _loadFromStorage() {
  try {
    const saved = localStorage.getItem('bureau3d_team');
    if (saved) {
      teamConfig = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } else {
      // Premier lancement : charger l'équipe démo
      teamConfig = { ...DEFAULT_CONFIG, agents: structuredClone(DEMO_AGENTS) };
      _save();
    }
  } catch { /* ignore */ }

  setTimeout(() => {
    teamConfig.agents.forEach((a, i) =>
      spawnAgent({ id: a.id, name: a.name, role: a.role, isPatron: false, slotIndex: i })
    );
  }, 120);
}

export function resetTeam() {
  teamConfig.agents.forEach(a => removeAgent(a.id));
  teamConfig = { ...DEFAULT_CONFIG, agents: structuredClone(DEMO_AGENTS) };
  _save();
  _renderAgentList();
  teamConfig.agents.forEach((a, i) =>
    spawnAgent({ id: a.id, name: a.name, role: a.role, isPatron: false, slotIndex: i })
  );
  addLogEntry('Système', 'system', 'Équipe réinitialisée avec l\'équipe de démo.');
  window.dispatchEvent(new CustomEvent('team:updated', { detail: teamConfig }));
}

function _save() {
  try { localStorage.setItem('bureau3d_team', JSON.stringify(teamConfig)); } catch { /* ignore */ }
}

// ── Rendu patron ──────────────────────────────────────────────

function _renderPatronCard() {
  const card = document.getElementById('patron-card');
  if (!card) return;
  const p = teamConfig.patron;
  card.innerHTML = `
    <div class="card-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>Patron</span>
      <button class="btn-edit-patron" title="Modifier" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:0 2px">✏️</button>
    </div>
    <div class="patron-name" id="patron-name">${_esc(p.name)}</div>
    <div class="patron-role" id="patron-role">${_esc(p.description || 'Orchestrateur d\'équipe')}</div>
  `;

  // Formulaire d'édition patron (injecté sous la carte)
  let editForm = document.getElementById('patron-edit-form');
  if (!editForm) {
    editForm = document.createElement('div');
    editForm.id = 'patron-edit-form';
    editForm.className = 'agent-form';
    editForm.style.marginBottom = '14px';
    editForm.innerHTML = `
      <div class="form-group">
        <label>Nom du patron</label>
        <input type="text" id="pe-name" maxlength="30">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="pe-desc" maxlength="60">
      </div>
      <div class="form-group">
        <label>Instructions systèmes (optionnel)</label>
        <textarea id="pe-instr" placeholder="Tu es un chef d'équipe exigeant..." rows="2"></textarea>
      </div>
      <div class="form-group">
        <label>Skills du patron (un par ligne)</label>
        <textarea id="pe-skills" placeholder="Ex. finds-skills : identifier les skills adaptés à la mission" rows="3"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn-primary" id="pe-save">Sauvegarder</button>
        <button class="btn-secondary" id="pe-cancel">Annuler</button>
      </div>
    `;
    card.insertAdjacentElement('afterend', editForm);
  }
}

function _bindPatronEdit() {
  document.getElementById('patron-card')?.addEventListener('click', e => {
    if (!e.target.closest('.btn-edit-patron')) return;
    const form = document.getElementById('patron-edit-form');
    if (!form) return;
    document.getElementById('pe-name').value  = teamConfig.patron.name;
    document.getElementById('pe-desc').value  = teamConfig.patron.description || '';
    document.getElementById('pe-instr').value = teamConfig.patron.instructions || '';
    document.getElementById('pe-skills').value = (teamConfig.patron.skills || []).join('\n');
    form.classList.add('open');
  });

  document.addEventListener('click', e => {
    if (e.target.id === 'pe-save') {
      const name = document.getElementById('pe-name').value.trim();
      if (!name) return;
      teamConfig.patron.name         = name;
      teamConfig.patron.description  = document.getElementById('pe-desc').value.trim();
      teamConfig.patron.instructions = document.getElementById('pe-instr').value.trim();
      teamConfig.patron.skills = _parseSkills(document.getElementById('pe-skills').value);
      _save();
      _renderPatronCard();
      _bindPatronEdit();
      document.getElementById('patron-edit-form')?.classList.remove('open');
      const patronAgent = getAgent('patron');
      if (patronAgent) patronAgent.setState(patronAgent.state);
      addLogEntry('Système', 'system', `Patron renommé : <strong>${_esc(name)}</strong>`);
    }
    if (e.target.id === 'pe-cancel') {
      document.getElementById('patron-edit-form')?.classList.remove('open');
    }
  });
}

// ── Rendu liste agents ────────────────────────────────────────

function _renderAgentList() {
  const list = document.getElementById('agents-list');
  if (!list) return;
  list.innerHTML = '';

  teamConfig.agents.forEach(agent => {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.dataset.id = agent.id;
    card.innerHTML = `
      <div class="agent-dot" style="background:${ROLE_COLORS_CSS[agent.role] || '#5b7fa6'}"></div>
      <div class="agent-info">
        <div class="agent-name">${_esc(agent.name)}</div>
        <div class="agent-role">${ROLE_LABELS[agent.role] || agent.role}${agent.model ? ` · ${agent.model}` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="agent-state" title="Inactif">💤</div>
        <button class="btn-skills-agent" data-id="${agent.id}" title="Modifier les skills" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:12px;padding:2px 4px">🧠</button>
        <button class="btn-del-agent" data-id="${agent.id}" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:13px;padding:2px 4px;opacity:.6">✕</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.btn-del-agent').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const agent = teamConfig.agents.find(a => a.id === id);
      if (!agent) return;
      if (!confirm(`Supprimer l'agent "${agent.name}" ?`)) return;
      teamConfig.agents = teamConfig.agents.filter(a => a.id !== id);
      _save();
      removeAgent(id);
      _renderAgentList();
      addLogEntry('Système', 'system', `Agent <strong>${_esc(agent.name)}</strong> supprimé.`);
      window.dispatchEvent(new CustomEvent('team:updated', { detail: teamConfig }));
    });
  });

  list.querySelectorAll('.btn-skills-agent').forEach(btn => btn.addEventListener('click', () => {
    const agent = teamConfig.agents.find(a => a.id === btn.dataset.id);
    if (!agent) return;
    const value = prompt(`Skills de ${agent.name}, un par ligne :`, (agent.skills || []).join('\n'));
    if (value === null) return;
    agent.skills = _parseSkills(value);
    _save();
    addLogEntry('Système', 'system', `Skills de <strong>${_esc(agent.name)}</strong> mis à jour.`);
  }));

  const submitBtn = document.getElementById('task-submit');
  if (submitBtn) submitBtn.disabled = taskBusy;
}

// ── Formulaire ajout agent ────────────────────────────────────

function _bindForm() {
  // Ajouter le sélecteur de modèle au formulaire (avant les boutons)
  const formActions = document.querySelector('#agent-form .form-actions');
  if (formActions && !document.getElementById('f-model')) {
    const modelGroup = document.createElement('div');
    modelGroup.className = 'form-group';
    modelGroup.innerHTML = `
      <label>Modèle Claude</label>
      <select id="f-model">
        <option value="haiku">Haiku (rapide)</option>
        <option value="sonnet" selected>Sonnet (équilibré)</option>
        <option value="opus" disabled>Opus (non inclus dans Pro)</option>
      </select>
    `;
    formActions.insertAdjacentElement('beforebegin', modelGroup);
  }

  const btnAdd    = document.getElementById('btn-add-agent');
  const form      = document.getElementById('agent-form');
  const btnCancel = document.getElementById('f-cancel');
  const btnSubmit = document.getElementById('f-submit');
  if (!btnAdd || !form) return;

  btnAdd.addEventListener('click', () => { form.classList.add('open'); btnAdd.style.display = 'none'; });
  btnCancel.addEventListener('click', () => { form.classList.remove('open'); btnAdd.style.display = ''; _clearForm(); });

  btnSubmit.addEventListener('click', () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { document.getElementById('f-name').focus(); return; }
    const agent = {
      id:          Date.now().toString(),
      name,
      role:        document.getElementById('f-role').value,
      description: document.getElementById('f-desc').value.trim(),
      skills: _parseSkills(document.getElementById('f-skills')?.value),
      model:       document.getElementById('f-model')?.value || 'sonnet',
      lastMessage: '',
    };
    teamConfig.agents.push(agent);
    _save();
    _renderAgentList();
    form.classList.remove('open');
    btnAdd.style.display = '';
    _clearForm();
    const slotIndex = teamConfig.agents.length - 1;
    spawnAgent({ id: agent.id, name: agent.name, role: agent.role, isPatron: false, slotIndex });
    addLogEntry('Système', 'system', `Agent <strong>${_esc(name)}</strong> (${ROLE_LABELS[agent.role]}) ajouté.`);
    window.dispatchEvent(new CustomEvent('team:updated', { detail: teamConfig }));
  });
}

// ── Input tâche ────────────────────────────────────────────────

function _bindTaskInput() {
  const input = document.getElementById('task-input');
  const btn   = document.getElementById('task-submit');
  if (!input || !btn) return;
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
  btn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    setTaskBusy(true);
    addLogEntry('Vous', 'system', _esc(text));
    window.dispatchEvent(new CustomEvent('user:task', { detail: { text } }));
  });
}

// ── Reset ─────────────────────────────────────────────────────

function _bindReset() {
  // Injecter le bouton reset sous la liste d'agents s'il n'existe pas
  if (document.getElementById('btn-reset-team')) return;
  const scroll = document.querySelector('.panel-scroll');
  if (!scroll) return;
  const resetBtn = document.createElement('button');
  resetBtn.id = 'btn-reset-team';
  resetBtn.style.cssText = 'width:100%;margin-top:12px;padding:6px;background:none;border:1px dashed #4a3a3a;border-radius:6px;color:#806060;font-size:11px;cursor:pointer;transition:border-color .15s,color .15s;';
  resetBtn.textContent = '↺ Réinitialiser l\'équipe';
  resetBtn.addEventListener('mouseover', () => { resetBtn.style.borderColor = '#a05050'; resetBtn.style.color = '#c07070'; });
  resetBtn.addEventListener('mouseout', () => { resetBtn.style.borderColor = '#4a3a3a'; resetBtn.style.color = '#806060'; });
  scroll.appendChild(resetBtn);
  resetBtn.addEventListener('click', () => {
    if (!confirm('Réinitialiser l\'équipe avec les agents démo ?')) return;
    resetTeam();
  });
}

// ── Helpers ───────────────────────────────────────────────────

function _clearForm() {
  ['f-name', 'f-desc', 'f-skills'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const model = document.getElementById('f-model');
  if (model) model.value = 'sonnet';
}

function _parseSkills(value) {
  const values = Array.isArray(value) ? value : String(value || '').split('\n');
  return [...new Set(values.map(skill => String(skill).trim()).filter(Boolean))].slice(0, 12).map(skill => skill.slice(0, 160));
}

async function _initMcpConnectors() {
  const list = document.getElementById('mcp-list');
  const addButton = document.getElementById('mcp-add');
  const gmailFullModeButton = document.getElementById('mcp-gmail-full-mode');
  const gmailReadOnlyModeButton = document.getElementById('mcp-gmail-readonly-mode');
  if (!list || !addButton) return;
  const selected = () => {
    try { return JSON.parse(localStorage.getItem('bureau3d_mcp_enabled') || '[]'); }
    catch { return []; }
  };
  const saveSelected = value => localStorage.setItem('bureau3d_mcp_enabled', JSON.stringify(value));
  const refresh = async () => {
    try {
      const response = await fetch('/api/mcp', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de lire les connecteurs.');
      const gmailConnector = data.servers.find(server => server.name === 'gmail-connector');
      if (gmailFullModeButton) gmailFullModeButton.disabled = !gmailConnector || gmailConnector.gmailMode === 'full';
      if (gmailReadOnlyModeButton) gmailReadOnlyModeButton.disabled = !gmailConnector || gmailConnector.gmailMode !== 'full';
      list.replaceChildren();
      if (!data.servers.length) {
        list.textContent = 'Aucun connecteur ajouté.';
        return;
      }
      data.servers.forEach(server => {
        const row = document.createElement('label');
        row.className = 'mcp-server';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected().includes(server.name);
        checkbox.addEventListener('change', () => {
          const approval = server.name === 'gmail'
            ? 'Autoriser les agents à rechercher et lire les e-mails, consulter les brouillons et en créer dans Gmail ? Le scope Google composition peut aussi permettre l’envoi par API, mais le serveur MCP actuel ne propose pas d’outil d’envoi.'
            : server.name === 'gmail-connector' && server.gmailMode === 'full'
            ? 'Autoriser les agents à lire Gmail, créer des brouillons, modifier les libellés et archiver. Bureau 3D bloque l’envoi, la suppression, la corbeille et la suppression de libellés.'
            : `Autoriser tous les outils du connecteur « ${server.name} » pour les prochaines tâches ? Certains outils peuvent modifier des données.`;
          if (checkbox.checked && !confirm(approval)) {
            checkbox.checked = false;
            return;
          }
          const enabled = new Set(selected());
          if (checkbox.checked) enabled.add(server.name);
          else enabled.delete(server.name);
          saveSelected([...enabled]);
        });
        const title = document.createElement('span');
        const typeLabel = server.type === 'user_config' ? 'oauth' : server.type === 'stdio' ? 'local' : (server.transport || 'http');
        const modeLabel = server.name === 'gmail-connector' ? (server.gmailMode === 'full' ? ' · brouillons + classement' : ' · lecture seule') : '';
        title.textContent = `${server.name} (${typeLabel}) · ${server.url}${modeLabel}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '✕';
        remove.title = 'Retirer ce connecteur';
        remove.addEventListener('click', async () => {
          const msg = server.managed
            ? `Retirer « ${server.name} » de Bureau 3D et de Claude Code ?`
            : server.type === 'user_config'
            ? `Délier « ${server.name} » de Bureau 3D ? (Il restera dans ta config Claude Code.)`
            : server.type === 'stdio'
            ? `Retirer « ${server.name} » de Bureau 3D ?`
            : `Retirer « ${server.name} » de la configuration MCP utilisateur de Claude Code ?`;
          if (!confirm(msg)) return;
          const result = await fetch('/api/mcp/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: server.name }) });
          const payload = await result.json();
          if (!result.ok) return _showMcpMessage(payload.error || 'Échec du retrait.');
          saveSelected(selected().filter(name => name !== server.name));
          _showMcpMessage(payload.message);
          refresh();
        });
        row.append(checkbox, title, remove);
        list.appendChild(row);
      });
    } catch (error) {
      list.textContent = error.message || 'Serveur local indisponible.';
    }
  };
  addButton.addEventListener('click', async () => {
    const nameInput = document.getElementById('mcp-name');
    const urlInput = document.getElementById('mcp-url');
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    const transport = document.getElementById('mcp-transport').value;
    addButton.disabled = true;
    _showMcpMessage('Ajout en cours dans Claude Code…');
    try {
      const response = await fetch('/api/mcp/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url, transport }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Échec de l'ajout.");
      nameInput.value = '';
      urlInput.value = '';
      _showMcpMessage(`${data.message} Coche-le dans la liste pour autoriser ses outils.`);
      await refresh();
    } catch (error) {
      _showMcpMessage(error.message || "Échec de l'ajout.");
    } finally {
      addButton.disabled = false;
    }
  });

  const gmailButton = document.getElementById('gmail-connect');
  if (gmailButton) {
    gmailButton.addEventListener('click', async () => {
      const clientIdInput = document.getElementById('gmail-client-id');
      const clientSecretInput = document.getElementById('gmail-client-secret');
      const clientId = clientIdInput.value.trim();
      const clientSecret = clientSecretInput.value;
      if (!clientId || !clientSecret) return _showMcpMessage('Renseigne le Client ID et le Client Secret Google pour enregistrer l’autorisation Gmail.');
      gmailButton.disabled = true;
      _showMcpMessage('Configuration de Gmail dans Claude Code…');
      try {
        const response = await fetch('/api/mcp/gmail/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, clientSecret }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Impossible de configurer Gmail.');
        clientSecretInput.value = '';
        _showMcpMessage(data.message);
        await refresh();
      } catch (error) {
        _showMcpMessage(error.message || 'Impossible de configurer Gmail.');
      } finally {
        gmailButton.disabled = false;
      }
    });
  }

  const githubButton = document.getElementById('mcp-github-add');
  if (githubButton) {
    githubButton.addEventListener('click', async () => {
      const tokenInput = document.getElementById('mcp-github-token');
      const token = tokenInput.value.trim();
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        return _showMcpMessage('Le token doit commencer par ghp_ ou github_pat_.');
      }
      githubButton.disabled = true;
      _showMcpMessage('Ajout de GitHub MCP…');
      try {
        const response = await fetch('/api/mcp/add-stdio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'github',
            command: 'npx',
            args: ['-y', '@github/github-mcp-server'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Échec de l'ajout.");
        tokenInput.value = '';
        _showMcpMessage(`${data.message}`);
        await refresh();
      } catch (error) {
        _showMcpMessage(error.message || "Échec de l'ajout.");
      } finally {
        githubButton.disabled = false;
      }
    });
  }

  const gmailConnectorButton = document.getElementById('mcp-gmail-connector-add');
  if (gmailConnectorButton) {
    gmailConnectorButton.addEventListener('click', async () => {
      gmailConnectorButton.disabled = true;
      _showMcpMessage('Ajout de Gmail Connector local…');
      try {
        const response = await fetch('/api/mcp/add-stdio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'gmail-connector',
            command: 'cmd',
            args: ['/c', 'gmail-connector'],
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Échec de l'ajout.");
        _showMcpMessage(data.message);
        await refresh();
      } catch (error) {
        _showMcpMessage(error.message || "Échec de l'ajout.");
      } finally {
        gmailConnectorButton.disabled = false;
      }
    });
  }

  const setGmailConnectorMode = async mode => {
    const button = mode === 'full' ? gmailFullModeButton : gmailReadOnlyModeButton;
    if (!button) return;
    if (mode === 'full' && !confirm('Google demandera les scopes Gmail modification et envoi. Bureau 3D autorisera uniquement les brouillons, libellés et archivage; envoi et suppressions resteront bloqués. Continuer ?')) return;
    button.disabled = true;
    _showMcpMessage(mode === 'full' ? 'Activation des brouillons et du classement…' : 'Retour au mode lecture seule…');
    try {
      const response = await fetch('/api/mcp/gmail-connector/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Impossible de modifier le mode Gmail.');
      _showMcpMessage(data.message);
      await refresh();
    } catch (error) {
      _showMcpMessage(error.message || 'Impossible de modifier le mode Gmail.');
    } finally {
      await refresh();
    }
  };
  gmailFullModeButton?.addEventListener('click', () => setGmailConnectorMode('full'));
  gmailReadOnlyModeButton?.addEventListener('click', () => setGmailConnectorMode('readonly'));

  refresh();
}

function _showMcpMessage(message) {
  const output = document.getElementById('mcp-message');
  if (output) output.textContent = message;
}

function _initLogResize() {
  const panel = document.getElementById('log-panel');
  const handle = document.getElementById('log-resize-handle');
  const expand = document.getElementById('log-expand');
  if (!panel || !handle || !expand) return;
  const minHeight = 120;
  const maxHeight = () => Math.round(window.innerHeight * .75);
  const setHeight = value => {
    const height = Math.max(minHeight, Math.min(maxHeight(), value));
    document.documentElement.style.setProperty('--log-h', `${height}px`);
    localStorage.setItem('bureau3d_log_height', String(height));
    return height;
  };
  const saved = Number(localStorage.getItem('bureau3d_log_height'));
  let normalHeight = saved >= minHeight ? setHeight(saved) : panel.getBoundingClientRect().height;
  let expanded = false;

  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panel.getBoundingClientRect().height;
    expanded = false;
    expand.textContent = 'Agrandir';
    expand.setAttribute('aria-expanded', 'false');
    const move = e => { normalHeight = setHeight(startHeight + startY - e.clientY); };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });

  expand.addEventListener('click', () => {
    expanded = !expanded;
    if (expanded) {
      normalHeight = panel.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--log-h', `${maxHeight()}px`);
      expand.textContent = 'Réduire';
    } else {
      normalHeight = setHeight(normalHeight);
      expand.textContent = 'Agrandir';
    }
    expand.setAttribute('aria-expanded', String(expanded));
  });
  window.addEventListener('resize', () => {
    if (expanded) document.documentElement.style.setProperty('--log-h', `${maxHeight()}px`);
    else normalHeight = setHeight(normalHeight);
  });
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Auto-init
initTeamBuilder();

