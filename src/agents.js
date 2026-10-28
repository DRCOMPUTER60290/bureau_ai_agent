import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { getScene, getCamera } from './scene.js?v=26';
import { DESK_SLOTS, PATRON_SLOT } from './office.js?v=26';

export const ROLE_COLORS = {
  developer:  0x5b7fa6,
  designer:   0xa65b8f,
  analyst:    0x5ba67a,
  writer:     0xa6955b,
  researcher: 0x7a5ba6,
};

const ROLE_LABELS = {
  developer: 'Développeur', designer: 'Designer', analyst: 'Analyste',
  writer: 'Rédacteur', researcher: 'Chercheur',
};

// Registre global des agents instanciés
const _agents = new Map(); // id → AgentCharacter
let _provider = localStorage.getItem('bureau3d_provider') === 'chatgpt' ? 'chatgpt' : 'claude';

const CHATGPT_MARK = new THREE.TextureLoader().load(new URL('./assets/chatgpt-mascot.png', import.meta.url).href);
CHATGPT_MARK.colorSpace = THREE.SRGBColorSpace;

function _createChatGPTBackdrop() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#02090c';
  ctx.beginPath(); ctx.arc(64, 64, 59, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const CHATGPT_BACKDROP = _createChatGPTBackdrop();

function _createChatGPTMaterial() {
  const material = new THREE.SpriteMaterial({ map: CHATGPT_MARK, transparent: true, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\nif (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) < 0.035) discard;'
    );
  };
  material.customProgramCacheKey = () => 'chatgpt-mascot-black-key-v1';
  return material;
}

function _setProvider(provider) {
  _provider = provider === 'chatgpt' ? 'chatgpt' : 'claude';
  for (const agent of _agents.values()) agent._setProvider(_provider);
}

document.getElementById('provider-select')?.addEventListener('change', event => _setProvider(event.target.value));

function _escapeHTML(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class AgentCharacter {
  constructor({ id, name, role, isPatron = false }) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.isPatron = isPatron;
    this.state = 'idle';
    this.lastMessage = '';

    this.group = this._buildMesh(isPatron);
    this._setProvider(_provider);
    this.label = this._buildLabel(name, role, isPatron);
    this.group.add(this.label);

    // Animation
    this._bobOffset = Math.random() * Math.PI * 2;
    this._bobBase = 0;

    getScene().add(this.group);
    _agents.set(id, this);

    // Écoute de la boucle de rendu
    window.addEventListener('scene:update', e => this._update(e.detail.delta));
  }

  _buildMesh(isPatron) {
    const g = new THREE.Group();
    const claudeForm = new THREE.Group();
    g.add(claudeForm);
    const scale = isPatron ? 1.3 : 1.0;
    const orange = new THREE.MeshLambertMaterial({ color: 0xf47b20 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x171717 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(.9*scale,.62*scale,.58*scale), orange);
    body.position.y = .57*scale;
    body.castShadow = true;
    claudeForm.add(body);
    this._body = body;
    this._claudeForm = claudeForm;
    const chatGPT = new THREE.Sprite(_createChatGPTMaterial());
    const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: CHATGPT_BACKDROP, transparent: true, depthWrite: false }));
    face.scale.set(isPatron ? .72 : .56, isPatron ? .72 : .56, 1);
    face.position.y = isPatron ? .86 : .68;
    face.renderOrder = 1;
    g.add(face);
    chatGPT.scale.set(isPatron ? 1.32 : 1.02, isPatron ? 1.32 : 1.02, 1);
    chatGPT.position.y = isPatron ? .86 : .68;
    chatGPT.visible = false;
    chatGPT.renderOrder = 2;
    g.add(chatGPT);
    this._chatGPTAvatar = chatGPT;
    // Pixel-like square eyes and a tiny nose on the front face.
    [-.23,.23].forEach(x=>{const eye=new THREE.Mesh(new THREE.BoxGeometry(.13*scale,.13*scale,.045*scale),dark); eye.position.set(x,.65*scale,.305*scale); claudeForm.add(eye);});
    const nose=new THREE.Mesh(new THREE.BoxGeometry(.08*scale,.07*scale,.05*scale),dark); nose.position.set(0,.48*scale,.31*scale); claudeForm.add(nose);
    // Four little feet create the squat, friendly toy silhouette.
    this._feet=[];
    [[-.29,.13,-.16],[.29,.13,-.16],[-.29,.13,.16],[.29,.13,.16]].forEach(([x,y,z],i)=>{
      const foot=new THREE.Mesh(new THREE.BoxGeometry(.2*scale,.28*scale,.2*scale),orange); foot.position.set(x,y*scale,z*scale); foot.castShadow=true; claudeForm.add(foot); this._feet.push(foot);
    });
    const tail=new THREE.Mesh(new THREE.BoxGeometry(.22*scale,.16*scale,.16*scale),orange); tail.position.set(0,.58*scale,-.37*scale); tail.rotation.y=.35; claudeForm.add(tail); this._tail=tail;

    // Couronne patron
    if (isPatron) {
      const crownMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.22, 5), crownMat);
      crown.position.y = .98 * scale;
      crown.castShadow = true;
      claudeForm.add(crown);

      // Petites billes dorées
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 5), crownMat);
        bead.position.set(
          Math.cos(angle) * 0.18 * scale,
          .94 * scale,
          Math.sin(angle) * 0.18 * scale
        );
        claudeForm.add(bead);
      }
    }

    return g;
  }

  _setProvider(provider) {
    const isChatGPT = provider === 'chatgpt';
    this._claudeForm.visible = !isChatGPT;
    this._chatGPTAvatar.visible = isChatGPT;
  }

  _buildLabel(name, role, isPatron) {
    const div = document.createElement('div');
    div.style.cssText = `
      background: rgba(25,31,41,0.94);
      border: 1px solid ${isPatron ? '#d9a05a' : '#69b7a6'};
      border-radius: 9px;
      padding: 5px 10px;
      box-shadow: 0 5px 18px rgba(0,0,0,.3);
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #edf2f7;
      white-space: nowrap;
      pointer-events: none;
      line-height: 1.4;
    `;
    div.innerHTML = `<strong style="color:${isPatron ? '#f0bd79' : '#91d5c5'}">${_escapeHTML(name)}</strong><br><span style="opacity:.8">${_escapeHTML(ROLE_LABELS[role] || role)}</span>`;
    this._labelDiv = div;

    const obj = new CSS2DObject(div);
    obj.position.set(0, (this.isPatron ? 1.3 : 1) + .38, 0);
    return obj;
  }

  // ── Positionnement ──────────────────────────────────────────

  setPosition(x, z) {
    this._bobBase = 0;
    this.group.position.set(x, 0, z);
    this.homePosition = { x, z };
  }

  lookAt(tx, tz) {
    const dx = tx - this.group.position.x;
    const dz = tz - this.group.position.z;
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  // ── États visuels ────────────────────────────────────────────

  setState(state) {
    this.state = state;
    const indicators = { idle: '', thinking: '💭', working: '⚡', done: '✅', error: '❌', walking: '🚶' };
    const indicator = indicators[state] || '';
    const name = this.name;
    const role = ROLE_LABELS[this.role] || this.role;
    const isPatron = this.isPatron;
    this._labelDiv.innerHTML = `
      <strong style="color:${isPatron ? '#c85c1c' : '#397568'}">${_escapeHTML(name)}</strong>
      ${indicator ? `<span style="margin-left:4px">${indicator}</span>` : ''}
      <br>
      <span style="opacity:.7">${_escapeHTML(this.lastMessage || role)}</span>
    `;
  }

  setMessage(text) {
    const short = text.length > 40 ? text.slice(0, 40) + '…' : text;
    this.lastMessage = short;
    this.setState(this.state);
  }

  // ── Boucle d'animation ────────────────────────────────────────

  _update(delta) {
    this._bobOffset += delta * (this.state === 'working' ? 4.0 : 1.4);
    const bob = Math.sin(this._bobOffset) * (this.state === 'working' ? 0.045 : 0.018);
    this.group.position.y = bob;
    if (this._body) this._body.rotation.z = Math.sin(this._bobOffset * .55) * .025;
    this._feet?.forEach((foot,i)=>{ foot.rotation.x = this.state === 'walking' ? Math.sin(this._bobOffset*3+i*Math.PI)*.45 : 0; });
    if (this._tail) this._tail.rotation.y = .35 + Math.sin(this._bobOffset*2)*.35;
  }

  dispose() {
    getScene().remove(this.group);
    _agents.delete(this.id);
  }
}

// ── API publique ──────────────────────────────────────────────────

export function initAgents() {
  // Instancié à la demande par ui.js via spawnAgent()
}

export function spawnAgent(config) {
  if (_agents.has(config.id)) return _agents.get(config.id);
  const agent = new AgentCharacter(config);

  // Placer à son bureau
  if (config.isPatron) {
    agent.setPosition(PATRON_SLOT.x, PATRON_SLOT.z);
    agent.group.rotation.y = PATRON_SLOT.ry;
  } else {
    const slotIndex = config.slotIndex ?? 0;
    agent.slotIndex = slotIndex;
    const slot = DESK_SLOTS[slotIndex % DESK_SLOTS.length];
    agent.setPosition(slot.standX, slot.standZ);
    agent.group.rotation.y = slot.ry + Math.PI; // face à l'écran
  }

  return agent;
}

export function removeAgent(id) {
  const agent = _agents.get(id);
  if (agent) agent.dispose();
}

export function getAgent(id) { return _agents.get(id); }
export function getAllAgents() { return [..._agents.values()]; }

// Spawn du patron par défaut
spawnAgent({ id: 'patron', name: 'Claude Manager', role: 'developer', isPatron: true });

// ── Tooltip au survol ─────────────────────────────────────────

const _raycaster = new THREE.Raycaster();
const _mouse     = new THREE.Vector2();
const _tooltip   = document.getElementById('agent-tooltip');
let   _tooltipId = null;

document.getElementById('canvas-wrap')?.addEventListener('mousemove', e => {
  const wrap   = document.getElementById('canvas-wrap');
  const rect   = wrap.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _mouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

  const camera = getCamera();
  if (!camera) return;
  _raycaster.setFromCamera(_mouse, camera);

  const meshes = [];
  _agents.forEach(a => a.group.traverse(obj => { if (obj.isMesh) meshes.push(obj); }));
  const hits = _raycaster.intersectObjects(meshes);

  if (hits.length) {
    const hitMesh = hits[0].object;
    let found = null;
    _agents.forEach(a => {
      if (!found) a.group.traverse(obj => { if (obj === hitMesh) found = a; });
    });
    if (found && found.id !== _tooltipId) {
      _tooltipId = found.id;
      document.getElementById('tt-name').textContent = found.name;
      document.getElementById('tt-role').textContent = ROLE_LABELS[found.role] || found.role;
      document.getElementById('tt-last').textContent = found.lastMessage || '';
      if (_tooltip) _tooltip.style.display = 'block';
    }
    if (_tooltip) {
      _tooltip.style.left = (e.clientX + 14) + 'px';
      _tooltip.style.top  = (e.clientY - 10) + 'px';
    }
  } else {
    _tooltipId = null;
    if (_tooltip) _tooltip.style.display = 'none';
  }
});

