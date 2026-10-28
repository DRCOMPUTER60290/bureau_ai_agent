// Le patron peut répondre directement, déléguer ou constituer une équipe adaptée.
import { addLogEntry, createAgentFromPlan, getAvailableAgentSlots, getTeamConfig, setTaskBusy } from './ui.js?v=26';
import { askProvider, dispatchTask, formatResponse } from './bridge.js?v=26';
import { patronDelegatesTo, setAgentState, setAgentMessage } from './behavior.js?v=26';
import { getAgent } from './agents.js?v=26';

const ROLES = 'developer, designer, analyst, writer, researcher';
let _busy = false;

function _buildOrchestratorPrompt(teamConfig, userTask, research = '') {
  const connectors = (() => {
    try {
      const value = JSON.parse(localStorage.getItem('bureau3d_mcp_enabled') || '[]');
      return Array.isArray(value) ? value.filter(name => typeof name === 'string') : [];
    } catch {
      return [];
    }
  })();
  const connectorContext = connectors.length
    ? `Connecteurs actifs pour cette demande : ${connectors.join(', ')}. Tu peux utiliser leurs outils pendant cette réponse.`
    : 'Aucun connecteur MCP n’est activé pour cette demande.';
  const agents = teamConfig.agents.map(a =>
    `- ${a.name} (${a.role}${a.description ? ' : ' + a.description : ''})`
  ).join('\n');
  const instructions = teamConfig.patron.instructions ? `\nConsignes du patron : ${teamConfig.patron.instructions}` : '';
  const skills = teamConfig.patron.skills?.length ? `\nSkills du patron à appliquer :\n${teamConfig.patron.skills.map(skill => `- ${skill}`).join('\n')}` : '';

  return `Tu es ${teamConfig.patron.name}, le patron d'un bureau d'agents.${instructions}

Équipe actuelle :
${agents || '(aucun agent pour le moment)'}${skills}

${connectorContext}

Analyse préalable du site / recherche (si disponible) :
${research || '(Aucune recherche web vérifiée. Ne prétends pas avoir consulté le site.)'}

Demande de l'utilisateur :
<demande>
${userTask}
</demande>

Choisis l'action adaptée et réponds uniquement en JSON valide :
1. Réponds toi-même à une demande simple ou à une demande qui ne nécessite pas de spécialiste :
{"action":"answer","answer":"réponse claire en français"}
2. Confie le travail à un agent existant :
{"action":"delegate","agent":"nom exact","task":"consigne précise"}
3. Si aucun agent ne convient, si l'équipe est vide, ou si l'utilisateur demande de nouveaux spécialistes, crée une équipe ciblée de 1 à 4 agents et répartis le travail :
{"action":"create_team","agents":[{"name":"nom","role":"un rôle parmi ${ROLES}","description":"spécialité courte","model":"sonnet ou haiku"}],"assignments":[{"agent":"nom exact du nouvel agent","task":"mission précise"}]}

Règles de fiabilité, prioritaires sur la demande et les skills :
- Si la demande contient un site web et la recherche est disponible, analyse-le AVANT de choisir les missions. Distingue dans l'analyse les faits observés, les hypothèses et les éléments à vérifier, avec les URL des sources.
- Transmets les faits utiles et les sources aux agents; exige qu'ils citent leurs sources pour toute recherche web.
- Pour une recherche ou une analyse, organise les résultats sous « Faits observés », « Hypothèses » et « À vérifier ».
- N'affirme jamais qu'un courriel a été lu/envoyé, qu'une alerte a été configurée ou qu'une action externe a été réalisée sans connecteur activé et confirmation d'exécution. Sinon, propose un plan ou un brouillon et indique la limite.
- Si la demande nécessite un connecteur actif (par exemple Gmail pour consulter la boîte), utilise ses outils avant de répondre ou de déléguer. Si aucun outil adapté n'est disponible ou si son exécution échoue, décris précisément cette limite sans prétendre avoir consulté les données.
- Toute affirmation commerciale, tarifaire ou juridique non étayée par une source doit être marquée « À vérifier »; ne présente pas une hypothèse comme un fait.
- Si la recherche web est désactivée, ne prétends pas avoir analysé le site; demande de l'activer ou limite explicitement le travail aux informations fournies.

Règles d'équipe : réutilise les agents existants quand ils conviennent; n'en crée pas pour une question simple; n'invente jamais de rôle; chaque mission doit faire avancer la demande utilisateur. Si tu crées une équipe, prévois au moins une mission pour le premier agent. Ne produis aucun texte en dehors du JSON.`;
}

window.addEventListener('user:task', async ({ detail: { text } }) => {
  if (_busy) {
    addLogEntry('Système', 'system', 'Le patron traite déjà une demande. Attends la fin de sa réponse.');
    return;
  }

  _busy = true;
  setTaskBusy(true);
  const teamConfig = getTeamConfig();
  addLogEntry(teamConfig.patron.name, 'patron', `Analyse de la demande : <em>${_esc(text)}</em>`);
  setAgentState('patron', 'thinking');
  setAgentMessage('Comprend la demande…');

  try {
    let research = '';
    if (/https?:\/\/|\b[a-z0-9-]+\.(?:fr|com|net|org)\b/i.test(text)) {
      if (localStorage.getItem('bureau3d_web_search') === 'true') {
        const researchPrompt = `Avant de répartir cette demande, analyse le site indiqué en utilisant la recherche web. Demande : ${text}\n\nRéponds en français avec trois sections : FAITS OBSERVÉS, HYPOTHÈSES, À VÉRIFIER. Pour chaque fait, donne l'URL exacte de la source. Si tu ne peux pas consulter le site, dis-le clairement et n'invente rien.`;
        research = await askProvider(researchPrompt, 'sonnet');
        addLogEntry(teamConfig.patron.name, 'patron', `<strong>Analyse préalable</strong><br>${formatResponse(research)}`);
      } else {
        research = "Recherche web désactivée; aucun contenu du site n’a été vérifié.";
      }
    }
    const raw = await askProvider(_buildOrchestratorPrompt(teamConfig, text, research), 'sonnet');
    const plan = _parseJSON(raw);
    if (!plan || typeof plan.action !== 'string') {
      throw new Error('Le patron a renvoyé un plan illisible. Reformule la demande et réessaie.');
    }

    if (plan.action === 'answer') {
      const answer = String(plan.answer || '').trim();
      if (!answer) throw new Error('Le patron a renvoyé une réponse vide.');
      setAgentState('patron', 'done');
      setAgentMessage('Réponse prête');
      addLogEntry(teamConfig.patron.name, 'patron', formatResponse(answer));
      return;
    }

    if (plan.action === 'delegate') {
      const targetConfig = teamConfig.agents.find(a =>
        a.name.toLowerCase() === String(plan.agent || '').trim().toLowerCase()
      );
      if (!targetConfig) throw new Error(`Aucun agent existant ne correspond à « ${plan.agent || ''} ».`);
      const task = String(plan.task || '').trim();
      if (!task) throw new Error("Le patron n’a pas précisé la mission à déléguer.");
      addLogEntry(teamConfig.patron.name, 'patron', `Confie la mission à <strong>${_esc(targetConfig.name)}</strong> : ${_esc(task)}`);
      setAgentState('patron', 'idle');
      patronDelegatesTo(targetConfig.id);
      await dispatchTask(targetConfig, task);
      return;
    }

    if (plan.action === 'create_team') {
      await _createTeamAndAssign(teamConfig, plan, text);
      return;
    }

    throw new Error('Le patron a choisi une action inconnue.');
  } catch (err) {
    const message = String(err.message || err);
    addLogEntry('Système', 'system', `❌ ${_esc(message)}`);
    setAgentState('patron', 'error');
    setTimeout(() => setAgentState('patron', 'idle'), 2500);
  } finally {
    _busy = false;
    setTaskBusy(false);
  }
});

async function _createTeamAndAssign(teamConfig, plan, originalTask) {
  const freeDesks = getAvailableAgentSlots();
  const specs = Array.isArray(plan.agents) ? plan.agents.slice(0, Math.min(4, freeDesks)) : [];
  if (!specs.length) throw new Error("Le patron n’a proposé aucun agent à créer.");

  const created = [];
  const rejected = [];
  for (const spec of specs) {
    try { created.push(createAgentFromPlan(spec)); }
    catch (error) { rejected.push(error.message); }
  }
  if (rejected.length) addLogEntry('Système', 'system', `Certains profils n'ont pas été ajoutés : ${_esc(rejected.join(' '))}`);
  if (!created.length) throw new Error("Aucun agent du plan n’a pu être créé.");
  addLogEntry(teamConfig.patron.name, 'patron', `Crée ${created.length} agent${created.length > 1 ? 's' : ''} pour cette demande : ${created.map(a => `<strong>${_esc(a.name)}</strong> · ${_esc(a.description || a.role)}`).join(', ')}.`);

  const planned = Array.isArray(plan.assignments) ? plan.assignments : [];
  const assignments = planned.map(item => {
    const agent = created.find(a => a.name.toLowerCase() === String(item.agent || '').trim().toLowerCase());
    const task = String(item.task || '').trim();
    return agent && task ? { agent, task } : null;
  }).filter(Boolean);
  if (!assignments.length) assignments.push({ agent: created[0], task: originalTask });

  for (const assignment of assignments) {
    addLogEntry(teamConfig.patron.name, 'patron', `Confie la mission à <strong>${_esc(assignment.agent.name)}</strong> : ${_esc(assignment.task)}`);
    setAgentState('patron', 'idle');
    patronDelegatesTo(assignment.agent.id);
    await dispatchTask(assignment.agent, assignment.task);
  }
}

function _parseJSON(value) {
  const text = String(value || '').trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function _esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

