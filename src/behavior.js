import * as THREE from 'three';
import { getAgent, getAllAgents } from './agents.js?v=26';
import { getScene } from './scene.js?v=26';
import { WALK_OBSTACLES, WALK_WALLS, LOUNGE_BREAK_SPOTS } from './office.js?v=26';

export const STATE = {
  IDLE:     'idle',
  WALKING:  'walking',
  THINKING: 'thinking',
  WORKING:  'working',
  DONE:     'done',
  ERROR:    'error',
};

// Mouvements en cours : agentId → { sx, sz, tx, tz, t, speed, cb }
const _moves = new Map();
const _idleFor = new Map();
const _resting = new Map();

// Rayon de délégation actif (THREE.Line) — un seul à la fois
let _beam = null;
let _beamTimer = 0;

// ── Easing ────────────────────────────────────────────────────

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function _dist(m) {
  const dx = m.tx - m.sx, dz = m.tz - m.sz;
  return Math.sqrt(dx * dx + dz * dz) || 0.001;
}

// ── API publique ──────────────────────────────────────────────

export function setAgentState(id, state) {
  const agent = getAgent(id);
  if (agent) {
    if (state !== STATE.IDLE && (_resting.has(id) || _moves.has(id))) {
      if(_resting.has(id))clearTimeout(_resting.get(id));
      _resting.delete(id); _moves.delete(id);
      if (agent.homePosition) { agent.group.position.x = agent.homePosition.x; agent.group.position.z = agent.homePosition.z; }
      agent.setMessage('');
    }
    agent.setState(state);
  }
}

export function setAgentMessage(id, text) {
  const agent = getAgent(id);
  if (agent) agent.setMessage(text);
}

/**
 * Déplace un agent vers (tx, tz). onDone() est appelé à l'arrivée.
 * L'agent passe en WALKING pendant le trajet, puis IDLE (sauf si onDone change l'état).
 */
export function moveAgentTo(id, tx, tz, onDone) {
  const agent = getAgent(id);
  if (!agent) return;

  const start = { x: agent.group.position.x, z: agent.group.position.z };
  const points = _findPath(start, { x: tx, z: tz });
  // Never use a straight-line fallback: when no route exists, staying put is safer
  // than letting a character cut through a desk, wall, or another piece of furniture.
  if (points.length < 2) {
    agent.setState(STATE.IDLE);
    return;
  }
  agent.setState(STATE.WALKING);
  _moves.set(id, { points, segment: 0, t: 0, speed: 1.8, cb: onDone });
}

// A small grid A* keeps characters out of desks and lounge furniture.
function _findPath(start, end) {
  const step = .4, key = (x,z) => `${x},${z}`;
  const cell = p => ({ x: Math.round(p.x/step), z: Math.round(p.z/step) });
  const pos = c => ({ x:c.x*step, z:c.z*step });
  const open=[];
  const push=(node)=>{let i=open.length;open.push(node);while(i>0){const p=(i-1)>>1;if(open[p].score<=node.score)break;open[i]=open[p];i=p;open[i]=node;}};
  const pop=()=>{const first=open[0],last=open.pop();if(open.length){let i=0;open[0]=last;while(true){let c=i*2+1;if(c>=open.length)break;if(c+1<open.length&&open[c+1].score<open[c].score)c++;if(open[i].score<=open[c].score)break;[open[i],open[c]]=[open[c],open[i]];i=c;}}return first;};
  const s=cell(start), goal=cell(end), blocked=(x,z)=>{
    const p=pos({x,z});
    if (Math.hypot(p.x-end.x,p.z-end.z)<.3) return false;
    const wallHit=WALK_WALLS.some(({a,b})=>{
      const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz||1;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/l2));
      return Math.hypot(p.x-(a.x+t*dx),p.z-(a.z+t*dz))<.48;
    });
    const clearance=.48;
    return Math.abs(p.x)>34 || Math.abs(p.z)>34 || wallHit || WALK_OBSTACLES.some(o=>Math.abs(p.x-o.x)<o.halfX+clearance && Math.abs(p.z-o.z)<o.halfZ+clearance);
  };
  const came=new Map(), g=new Map([[key(s.x,s.z),0]]), f=new Map([[key(s.x,s.z),Math.hypot(goal.x-s.x,goal.z-s.z)]]), closed=new Set();
  push({...s,score:f.get(key(s.x,s.z))});
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  while(open.length){
    const cur=pop(), ck=key(cur.x,cur.z);
    if(closed.has(ck)||cur.score>(f.get(ck)??Infinity))continue;
    if(cur.x===goal.x&&cur.z===goal.z){const path=[goal];let k=ck;while(came.has(k)){const c=came.get(k);path.push(c);k=key(c.x,c.z);}path.reverse();return [start,...path.slice(1,-1).map(pos),end];}
    if(closed.has(ck))continue; closed.add(ck);
    for(const [dx,dz] of dirs){const nx=cur.x+dx,nz=cur.z+dz,nk=key(nx,nz); if(closed.has(nk)||blocked(nx,nz))continue;
      if(dx&&dz&&(blocked(cur.x+dx,cur.z)||blocked(cur.x,cur.z+dz)))continue;
      const ng=(g.get(ck)??Infinity)+(dx&&dz?1.414:1); if(ng>=(g.get(nk)??Infinity))continue;
      came.set(nk,cur);g.set(nk,ng);const score=ng+Math.hypot(goal.x-nx,goal.z-nz);f.set(nk,score);push({x:nx,z:nz,score});
    }
  }
  return [];
}

/**
 * Affiche un rayon lumineux entre fromId et toId pendant `duration` secondes.
 * Signifie visuellement une délégation de tâche.
 */
export function showDelegationBeam(fromId, toId, duration = 1.6) {
  _clearBeam();

  const from = getAgent(fromId);
  const to   = getAgent(toId);
  if (!from || !to) return;

  const points = [
    new THREE.Vector3(
      from.group.position.x, 1.2, from.group.position.z
    ),
    new THREE.Vector3(
      to.group.position.x, 1.2, to.group.position.z
    ),
  ];

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({
    color: 0xe97319,
    transparent: true,
    opacity: 0.85,
    linewidth: 2,          // hint seulement (WebGL limite à 1 sur la plupart des GPU)
  });

  _beam = new THREE.Line(geo, mat);
  getScene().add(_beam);
  _beamTimer = duration;
}

/**
 * Séquence animée : patron s'oriente vers l'agent, rayon, état THINKING.
 * Utilisé par l'orchestrateur à l'étape 7.
 */
export function patronDelegatesTo(agentId) {
  const patron = getAgent('patron');
  const agent  = getAgent(agentId);
  if (!patron || !agent) return;

  // Patron regarde l'agent
  patron.lookAt(agent.group.position.x, agent.group.position.z);
  patron.setState(STATE.WORKING);

  // Rayon de délégation
  showDelegationBeam('patron', agentId, 2.0);

  // Agent passe en THINKING
  setTimeout(() => {
    agent.setState(STATE.THINKING);
    patron.setState(STATE.IDLE);
  }, 400);
}

// ── Boucle de mise à jour ─────────────────────────────────────

window.addEventListener('scene:update', ({ detail: { delta } }) => {
  _idleFor.forEach((elapsed,id)=>{
    const agent=getAgent(id);
    if(!agent||agent.isPatron||agent.state!=='idle'||_moves.has(id)||_resting.has(id))return;
    const next=elapsed+delta; _idleFor.set(id,next);
    if(next<32||!agent.homePosition)return;
    _idleFor.set(id,0);
    // Short café break beside the sofa; route planning follows clear floor tiles around furniture.
    const breakSpot=LOUNGE_BREAK_SPOTS[(agent.slotIndex||0)%LOUNGE_BREAK_SPOTS.length];
    moveAgentTo(id,breakSpot.x,breakSpot.z,()=>{
      if(agent.state!=='idle')return;
      agent.setMessage('Petite pause ☕');
      const timer=setTimeout(()=>{
        _resting.delete(id);
        if(agent.state==='idle')moveAgentTo(id,agent.homePosition.x,agent.homePosition.z,()=>agent.setMessage(''));
      },7000);
      _resting.set(id,timer);
    });
  });
  // Mouvements
  _moves.forEach((m, id) => {
    const agent = getAgent(id);
    if (!agent) { _moves.delete(id); return; }

    let from={x:agent.group.position.x,z:agent.group.position.z}, to=m.points[m.segment+1];
    if(!to){_moves.delete(id);agent.setState(STATE.IDLE);if(m.cb)m.cb();return;}
    const totalDist=Math.hypot(to.x-from.x,to.z-from.z)||.001;
    m.t=Math.min(1,m.t+(delta*m.speed)/totalDist); const ease=_easeInOut(m.t);
    agent.group.position.x=from.x+(to.x-from.x)*ease; agent.group.position.z=from.z+(to.z-from.z)*ease;

    // Orientation vers la destination
    const dx = to.x - from.x, dz = to.z - from.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      agent.group.rotation.y = Math.atan2(dx, dz);
    }

    if(m.t>=1){m.segment++;m.t=0;if(m.segment>=m.points.length-1){_moves.delete(id);agent.setState(STATE.IDLE);if(m.cb)m.cb();}}
  });

  // Rayon de délégation : fondu
  if (_beam && _beamTimer > 0) {
    _beamTimer -= delta;
    _beam.material.opacity = Math.max(0, _beamTimer / 1.6) * 0.85;
    if (_beamTimer <= 0) _clearBeam();
  }

  // Mise à jour des cartes UI d'état
  _syncCards();
});

function _clearBeam() {
  if (_beam) { getScene().remove(_beam); _beam.geometry.dispose(); _beam.material.dispose(); _beam = null; }
}

// Synchro légère : met à jour l'émoji d'état sur les cartes du panel
let _syncThrottle = 0;
function _syncCards() {
  _syncThrottle++;
  if (_syncThrottle % 12 !== 0) return;   // ~5 fois/s à 60fps
  getAllAgents().forEach(agent => {
    const card = document.querySelector(`.agent-card[data-id="${agent.id}"]`);
    if (!card) return;
    const stateEl = card.querySelector('.agent-state');
    if (!stateEl) return;
    const icons = { idle: '💤', walking: '🚶', thinking: '💭', working: '⚡', done: '✅', error: '❌' };
    stateEl.textContent = icons[agent.state] || '💤';
  });
}

export function initBehavior() { /* auto-init via import */ }

window.addEventListener('team:updated',()=>{
  getAllAgents().forEach(agent=>{if(!agent.isPatron&&!_idleFor.has(agent.id))_idleFor.set(agent.id,0);});
  for(const id of _idleFor.keys())if(!getAgent(id))_idleFor.delete(id);
});
window.addEventListener('scene:update',()=>{
  getAllAgents().forEach(agent=>{if(!agent.isPatron&&!_idleFor.has(agent.id))_idleFor.set(agent.id,0);});
});

