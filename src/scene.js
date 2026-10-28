import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

let scene, camera, renderer, css2dRenderer, controls, clock;
const _roomTargets = [];
const _roomRaycaster = new THREE.Raycaster();
const _roomPointer = new THREE.Vector2();
let _viewTransition = null;

export function registerRoomTarget(mesh, room) {
  mesh.userData.roomId = room.id;
  mesh.userData.roomName = room.name;
  mesh.userData.roomX = room.x;
  mesh.userData.roomZ = room.z;
  _roomTargets.push(mesh);
}

export function initScene() {
  const wrap = document.getElementById('canvas-wrap');

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171c25);
  scene.fog = new THREE.Fog(0x171c25, 78, 120);

  // Camera — vue légèrement isométrique
  camera = new THREE.PerspectiveCamera(42, wrap.clientWidth / wrap.clientHeight, 0.1, 180);
  camera.position.set(32, 43, 32);
  camera.lookAt(-1, 0, -6);

  // Renderer WebGL
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.insertBefore(renderer.domElement, document.getElementById('css2d-overlay'));

  // CSS2DRenderer pour les labels au-dessus des agents
  css2dRenderer = new CSS2DRenderer();
  css2dRenderer.setSize(wrap.clientWidth, wrap.clientHeight);
  css2dRenderer.domElement.style.position = 'absolute';
  css2dRenderer.domElement.style.top = '0';
  css2dRenderer.domElement.style.pointerEvents = 'none';
  document.getElementById('css2d-overlay').appendChild(css2dRenderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minDistance = 10;
  controls.maxDistance = 85;
  controls.target.set(-1, 0, -6);

  let pointerStart = null;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
      pointerStart = null;
      return;
    }
    pointerStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    _roomPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _roomPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    _roomRaycaster.setFromCamera(_roomPointer, camera);
    const hit = _roomRaycaster.intersectObjects(_roomTargets, false)[0];
    if (hit) focusOnRoom(hit.object.userData.roomX, hit.object.userData.roomZ);
  });

  // Lumières
  const ambient = new THREE.AmbientLight(0xdbe5f0, 0.72);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe8c8, 1.15);
  sun.position.set(8, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  scene.add(sun);

  // Lumière d'appoint froide (contre-jour)
  const fill = new THREE.DirectionalLight(0x9bc7d8, 0.72);
  fill.position.set(-6, 6, -8);
  scene.add(fill);

  clock = new THREE.Clock();

  // Resize
  const ro = new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    css2dRenderer.setSize(w, h);
  });
  ro.observe(wrap);

  // Boucle de rendu
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    _updateViewTransition();
    controls.update();
    // Les autres modules appellent leurs update via l'event 'scene:update'
    window.dispatchEvent(new CustomEvent('scene:update', { detail: { delta } }));
    renderer.render(scene, camera);
    css2dRenderer.render(scene, camera);
  }
  animate();

  return { scene, camera, renderer, controls };
}

export function getScene()    { return scene; }
export function getCamera()   { return camera; }
export function getRenderer() { return renderer; }
export function getClock()    { return clock; }

export function focusOnRoom(x, z) {
  if (!camera || !controls) return;
  _viewTransition = {
    started: performance.now(),
    duration: 650,
    fromTarget: controls.target.clone(),
    fromPosition: camera.position.clone(),
    toTarget: new THREE.Vector3(x, 0, z),
  };
}

function _updateViewTransition() {
  if (!_viewTransition) return;
  const t = Math.min(1, (performance.now() - _viewTransition.started) / _viewTransition.duration);
  const eased = 1 - Math.pow(1 - t, 3);
  const shift = _viewTransition.toTarget.clone().sub(_viewTransition.fromTarget).multiplyScalar(eased);
  controls.target.copy(_viewTransition.fromTarget).add(shift);
  camera.position.copy(_viewTransition.fromPosition).add(shift);
  if (t >= 1) _viewTransition = null;
}

// Auto-init dès que le DOM est prêt
initScene();

