/**
 * The "corroboration field": a restrained ambient Three.js environment that
 * sits behind the application and shows structured evidence moving through a
 * system. It is presentation only — every state it shows is passed in by a
 * screen from real data or a real server result; it never invents activity
 * that stands in for a computation.
 *
 * Layout of the scene:
 *   core     four cells = the experiment's four conditions
 *            (weekday/weekend x clean/injected), pairs linked vertically
 *   network  ~44 nodes + thin links, a few orbital rings, sparse evidence
 *            points, and occasional signal pulses travelling along links
 *   rail     a row of up to 8 nodes used, on demand, for the five-stage
 *            causal chain (Market -> Claim -> Corroboration -> Belief ->
 *            Action) and the eight-component integrity chain of custody
 *
 * Engineering constraints (all enforced here, not left to callers):
 *   - low object count; a quality governor (see QUALITY_LEVELS) that keeps
 *     ambient drift to ~12fps at <=1x resolution and steps down further —
 *     ultimately to a single static render — if the device cannot keep up
 *   - a canvas that is fixed and out of flow, so it can never shift layout
 *   - the loop stops while the tab is hidden and never runs under
 *     prefers-reduced-motion (state changes snap and render once)
 *   - WebGL missing / three failing to load / ?scene=off  ->  a silent
 *     no-op API, so nothing in the app depends on WebGL
 *   - one persistent scene: screens change state, they never create
 *     renderers, so entering/leaving screens cannot leak GPU objects
 */

import { createParticleField, mulberry32 } from './particles.js';
import { prefersReducedMotion, onReducedMotionChange } from './motion.js';

// Quality governor. The field is ambient, so it must never cost the machine more than it
// gives: frame pacing is measured and, if the device cannot keep up, the scene steps down
// (lower rate -> lower resolution -> fully static). It never steps back up within a session.
// Ambient drift needs far fewer frames than scripted sequences (verification, chain).
// Defaults are deliberately conservative: measured on a machine with no GPU (software WebGL),
// rates above ~15fps at full resolution saturated every core, while these stay cheap.
const QUALITY_LEVELS = [
  { ambientFps: 12, scriptedFps: 20, dpr: 1 },
  { ambientFps: 10, scriptedFps: 15, dpr: 0.75 },
  { ambientFps: 8, scriptedFps: 12, dpr: 0.6 },
  { ambientFps: 0, scriptedFps: 0, dpr: 0.6 }, // static: same behaviour as reduced motion
];
const STATIC_LEVEL = 3;

export const RESOLVE_STEP_MS = 140; // per-component cadence shared with the DOM chain so both resolve in lockstep

const COLORS = {
  clean: 0x8fa8bd,
  injected: 0xd8a355,
  accent: 0x5ec8d8,
  weekend: 0xb38fd8,
  pass: 0x57c785,
  fail: 0xe0605a,
  unchecked: 0xd8a355,
  idle: 0x5c6b7a,
  dim: 0x2a3340,
  net: 0x3a6a78,
};

const NODE_STATE = {
  idle: { color: COLORS.idle, opacity: 0.55, scale: 1 },
  dim: { color: COLORS.dim, opacity: 0.3, scale: 0.85 },
  active: { color: COLORS.accent, opacity: 1, scale: 1.55 },
  lit: { color: COLORS.accent, opacity: 0.95, scale: 1.25 },
  pass: { color: COLORS.pass, opacity: 1, scale: 1.25 },
  fail: { color: COLORS.fail, opacity: 1, scale: 1.6 },
  unchecked: { color: COLORS.unchecked, opacity: 0.85, scale: 1.1 },
  notrun: { color: COLORS.dim, opacity: 0.35, scale: 0.9 },
};

// While the scene is still starting, remember the most recent *resting* state a
// screen asked for (a pair highlight or a mode) and replay it once ready. Timed
// sequences (chain / verify / break) are deliberately not replayed.
let starting = false;
let queued = null;
const remember = (name) => (...args) => { if (starting) queued = { name, args }; };

const NOOP_API = {
  status: 'fallback',
  reason: 'not initialised',
  init: async () => NOOP_API,
  setMode: remember('setMode'),
  showPair: remember('showPair'),
  anchorTo: remember('anchorTo'),
  runChain: () => Promise.resolve(),
  beginVerify() {},
  resolveVerify: () => Promise.resolve(),
  showBreak: () => Promise.resolve(),
  restore() { queued = null; },
  pause() {},
  resume() {},
  dispose() {},
  stats: () => null,
};

let api = { ...NOOP_API };
export const scene = new Proxy({}, { get: (_, key) => api[key] });

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

function fallback(reason) {
  starting = false;
  queued = null;
  api = { ...NOOP_API, reason };
  document.documentElement.classList.remove('scene-on');
  document.documentElement.classList.add('scene-off');
  return api;
}

/** Initialise once. Always resolves; never throws. Returns the live API (or the no-op fallback). */
export async function initScene(canvas) {
  starting = true;
  try {
    if (new URLSearchParams(location.search).get('scene') === 'off') return fallback('disabled by ?scene=off');
    if (!canvas) return fallback('no canvas element');
    if (!hasWebGL()) return fallback('WebGL unavailable');
    const THREE = await import('three');
    api = build(THREE, canvas);
    document.documentElement.classList.remove('scene-off');
    document.documentElement.classList.add('scene-on');
    const replay = queued;
    starting = false;
    queued = null;
    if (replay) api[replay.name](...replay.args);
    return api;
  } catch (err) {
    return fallback(`scene failed to start: ${err && err.message}`);
  }
}

function build(THREE, canvas) {
  const V3 = THREE.Vector3;
  const rand = mulberry32(20260919);
  let reducedPref = prefersReducedMotion();
  const params = new URLSearchParams(location.search);
  const forced = params.get('level');
  // QA-only overrides (?fps=N&dpr=X) used to characterise rendering cost; never set by the app itself.
  const qaFps = Number(params.get('fps')) || 0;
  const qaDpr = Number(params.get('dpr')) || 0;
  let level = forced !== null && Number.isFinite(Number(forced)) ? Math.max(0, Math.min(STATIC_LEVEL, Number(forced))) : 0;
  // "still" = no ambient motion, states snap and render once. True for reduced motion AND for the governor's last level.
  const still = () => reducedPref || level >= STATIC_LEVEL;

  // ---------- renderer / camera / scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: params.get('aa') !== '0', alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const dprFor = () => Math.min(window.devicePixelRatio || 1, qaDpr || QUALITY_LEVELS[level].dpr);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  camera.position.set(0, 0, 16);
  const root = new THREE.Scene();
  root.fog = new THREE.FogExp2(0x07090d, 0.02);

  // soft round sprite shared by every point/halo
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  const world = new THREE.Group(); // positioned responsively; holds core + network
  root.add(world);

  // ---------- core: the four experimental cells ----------
  const CELL_DEFS = [
    { key: 'weekday_clean', x: -1.55, y: -1.1, color: COLORS.clean },
    { key: 'weekday_injected', x: -1.55, y: 1.1, color: COLORS.injected },
    { key: 'weekend_clean', x: 1.55, y: -1.1, color: COLORS.clean },
    { key: 'weekend_injected', x: 1.55, y: 1.1, color: COLORS.injected },
  ];
  const cellGeo = new THREE.IcosahedronGeometry(0.72, 0);
  const cellEdges = new THREE.EdgesGeometry(cellGeo);
  const cellCoreGeo = new THREE.OctahedronGeometry(0.2, 0);
  const cells = CELL_DEFS.map((d) => {
    const g = new THREE.Group();
    g.position.set(d.x, d.y, 0);
    const wire = new THREE.LineSegments(cellEdges, new THREE.LineBasicMaterial({ color: d.color, transparent: true, opacity: 0.6, depthWrite: false }));
    const core = new THREE.Mesh(cellCoreGeo, new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.85 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: d.color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(2.1);
    g.add(wire, core, halo);
    world.add(g);
    return { ...d, group: g, wire, core, halo, emph: 0.55, emphTarget: 0.55, spin: 0.15 + rand() * 0.15 };
  });
  const cellByKey = Object.fromEntries(cells.map((c) => [c.key, c]));

  // pairing links: clean <-> injected (vertical, brighter) and same-claim-status links across conditions (dashed)
  const linkMat = new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.4, depthWrite: false });
  const dashMat = new THREE.LineDashedMaterial({ color: COLORS.weekend, transparent: true, opacity: 0.28, dashSize: 0.14, gapSize: 0.12, depthWrite: false });
  const addLink = (a, b, mat) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a.group.position, b.group.position]);
    const line = new THREE.Line(geo, mat);
    if (mat.isLineDashedMaterial) line.computeLineDistances();
    world.add(line);
    return line;
  };
  const pairLinks = [addLink(cellByKey.weekday_clean, cellByKey.weekday_injected, linkMat), addLink(cellByKey.weekend_clean, cellByKey.weekend_injected, linkMat)];
  addLink(cellByKey.weekday_clean, cellByKey.weekend_clean, dashMat);
  addLink(cellByKey.weekday_injected, cellByKey.weekend_injected, dashMat);

  // ---------- network: nodes, links, evidence particles, orbits ----------
  const NODE_COUNT = 44;
  const nodePos = [];
  while (nodePos.length < NODE_COUNT) {
    const r = 4.2 + rand() * 8;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    const p = new V3(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.72, r * Math.cos(ph) * 0.4 - 1.5);
    if (Math.hypot(p.x, p.y) < 3.4) continue; // keep the core clear
    nodePos.push(p);
  }
  const nodeGeo = new THREE.BufferGeometry().setFromPoints(nodePos);
  const nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({ color: 0x6fb8c8, size: 0.26, map: tex, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  world.add(nodePoints);

  const edgeSet = new Set();
  const edges = []; // {a: V3, b: V3} in world-local space
  const addEdge = (a, b, ia, ib) => {
    const k = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push({ a, b });
  };
  nodePos.forEach((p, i) => {
    nodePos
      .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
      .filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .forEach((o) => addEdge(p, nodePos[o.j], i, o.j));
  });
  cells.forEach((c, ci) => {
    nodePos
      .map((q, j) => ({ j, d: c.group.position.distanceToSquared(q) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 2)
      .forEach((o) => addEdge(c.group.position, nodePos[o.j], 1000 + ci, o.j));
  });
  const edgePts = [];
  edges.forEach((e) => edgePts.push(e.a, e.b));
  const netLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edgePts), new THREE.LineBasicMaterial({ color: COLORS.net, transparent: true, opacity: 0.55, depthWrite: false }));
  world.add(netLines);

  const rings = [3.3, 4.7].map((radius, i) => {
    const pts = [];
    for (let s = 0; s <= 96; s++) pts.push(new V3(Math.cos((s / 96) * Math.PI * 2) * radius, Math.sin((s / 96) * Math.PI * 2) * radius, 0));
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.32, depthWrite: false }));
    ring.rotation.x = i === 0 ? 1.15 : 0.55;
    ring.rotation.y = i === 0 ? 0.3 : -0.4;
    world.add(ring);
    return { ring, radius, speed: i === 0 ? 0.18 : -0.11, phase: rand() * 6 };
  });
  const orbitDots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(rings.length * 3), 3)), new THREE.PointsMaterial({ color: COLORS.accent, size: 0.2, map: tex, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  orbitDots.frustumCulled = false;
  world.add(orbitDots);

  const field = createParticleField(THREE, { count: 120, seed: 7, texture: tex });
  root.add(field.points);

  // ---------- signals: pulses travelling along links (ambient) or scripted paths ----------
  const MAX_SIGNALS = 24;
  const sigPos = new Float32Array(MAX_SIGNALS * 3);
  const sigCol = new Float32Array(MAX_SIGNALS * 3);
  const sigGeo = new THREE.BufferGeometry();
  sigGeo.setAttribute('position', new THREE.BufferAttribute(sigPos, 3));
  sigGeo.setAttribute('color', new THREE.BufferAttribute(sigCol, 3));
  const sigPoints = new THREE.Points(sigGeo, new THREE.PointsMaterial({ size: 0.36, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  sigPoints.frustumCulled = false;
  root.add(sigPoints);
  const signals = [];
  const tmp = new V3();

  function addSignal(s) {
    if (signals.length >= MAX_SIGNALS) return;
    signals.push({ u: 0, delay: 0, loop: false, tag: 'ambient', c: null, color: new THREE.Color(COLORS.accent), ...s });
  }
  function clearSignals(tag) {
    for (let i = signals.length - 1; i >= 0; i--) if (!tag || signals[i].tag === tag) signals.splice(i, 1);
  }
  function pathAt(s, u, out) {
    if (s.c) {
      const iu = 1 - u;
      return out.set(iu * iu * s.a.x + 2 * iu * u * s.c.x + u * u * s.b.x, iu * iu * s.a.y + 2 * iu * u * s.c.y + u * u * s.b.y, iu * iu * s.a.z + 2 * iu * u * s.c.z + u * u * s.b.z);
    }
    return out.lerpVectors(s.a, s.b, u);
  }

  // ---------- rail: the reusable node row (5-stage chain / 8-component chain of custody) ----------
  const rail = new THREE.Group();
  root.add(rail);
  const RAIL_MAX = 8;
  const railNodes = [];
  const railSegs = [];
  const nodeGeoR = new THREE.OctahedronGeometry(0.17, 0);
  for (let i = 0; i < RAIL_MAX; i++) {
    const mesh = new THREE.Mesh(nodeGeoR, new THREE.MeshBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: COLORS.idle, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.95);
    mesh.add(halo);
    mesh.visible = false;
    rail.add(mesh);
    railNodes.push({ mesh, halo, color: new THREE.Color(COLORS.idle), target: { ...NODE_STATE.idle, color: new THREE.Color(COLORS.idle) }, opacity: 0, scale: 1 });
  }
  for (let i = 0; i < RAIL_MAX - 1; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]);
    const solid = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0, depthWrite: false }));
    const dashed = new THREE.Line(geo.clone(), new THREE.LineDashedMaterial({ color: COLORS.fail, transparent: true, opacity: 0, dashSize: 0.1, gapSize: 0.1, depthWrite: false }));
    solid.visible = dashed.visible = false;
    rail.add(solid, dashed);
    railSegs.push({ solid, dashed, style: 'solid', op: 0, opTarget: 0 });
  }
  const railState = { count: 0, opacity: 0, opacityTarget: 0, nodeX: [] };

  function layoutRail(count) {
    railState.count = count;
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z * camera.aspect;
    const width = Math.min(halfW * (camera.aspect < 1 ? 1.7 : 1.5), 12);
    railState.nodeX = [];
    for (let i = 0; i < RAIL_MAX; i++) {
      const x = count > 1 ? -width / 2 + (width * i) / (count - 1) : 0;
      railNodes[i].mesh.position.set(x, 0, 0);
      railNodes[i].mesh.visible = i < count;
      railState.nodeX.push(x);
    }
    for (let i = 0; i < RAIL_MAX - 1; i++) {
      const seg = railSegs[i];
      const show = i < count - 1;
      seg.solid.visible = seg.dashed.visible = show;
      if (show) {
        for (const line of [seg.solid, seg.dashed]) {
          const p = line.geometry.attributes.position;
          p.setXYZ(0, railState.nodeX[i], 0, 0);
          p.setXYZ(1, railState.nodeX[i + 1], 0, 0);
          p.needsUpdate = true;
          if (line === seg.dashed) line.computeLineDistances();
        }
      }
    }
  }
  const railWorldPos = (i, out) => out.copy(railNodes[i].mesh.position).add(rail.position);

  function setRailNode(i, stateName, weight) {
    const t = NODE_STATE[stateName] || NODE_STATE.idle;
    const n = railNodes[i];
    n.target = { color: new THREE.Color(t.color), opacity: weight !== undefined ? Math.max(0.4, weight) : t.opacity, scale: t.scale };
  }
  function setRailSeg(i, style) {
    const seg = railSegs[i];
    seg.style = style;
    seg.opTarget = style === 'off' ? 0 : style === 'solid' ? 0.55 : style === 'lit' ? 0.85 : 0.5;
  }
  function showRail(count) {
    layoutRail(count);
    railState.opacityTarget = 1;
    for (let i = 0; i < RAIL_MAX; i++) setRailNode(i, 'idle');
    for (let i = 0; i < RAIL_MAX - 1; i++) setRailSeg(i, 'solid');
  }
  function hideRail() {
    railState.opacityTarget = 0;
  }

  // ---------- responsive layout ----------
  // A screen may anchor the four-cell core behind one of its own elements (the Lab's experiment
  // diagram), so the 3D structure echoes the 2x2 design shown in the DOM. Cleared on restore().
  let anchorEl = null;
  const CORE_HALF_WIDTH = 2.3; // cell spacing 1.55 + cell radius 0.72, in world units
  function applyAnchor() {
    if (!anchorEl || !anchorEl.isConnected) return;
    const r = anchorEl.getBoundingClientRect();
    const W = window.innerWidth || 1280;
    const H = window.innerHeight || 800;
    if (!r.width || !r.height || r.bottom < 0 || r.top > H) return;
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    world.position.set(((cx / W) * 2 - 1) * halfW, -((cy / H) * 2 - 1) * halfH, 0);
    const worldWidth = (r.width / W) * 2 * halfW;
    world.scale.setScalar(Math.max(0.5, Math.min(1.7, (worldWidth * 0.8) / (CORE_HALF_WIDTH * 2))));
  }
  function anchorTo(el) {
    anchorEl = el || null;
    resize();
  }

  function resize() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 800;
    renderer.setPixelRatio(dprFor());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const narrow = camera.aspect < 0.85;
    camera.position.z = narrow ? 21 : 16;
    camera.updateProjectionMatrix();
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    if (narrow) world.position.set(0, halfH * 0.42, 0);
    else world.position.set(halfW * 0.44, 0.3, 0);
    world.scale.setScalar(narrow ? 0.72 : 1);
    rail.position.set(narrow ? 0 : halfW * 0.06, -halfH * (narrow ? 0.62 : 0.66), 1);
    applyAnchor();
    layoutRail(railState.count || 0);
    renderOnce();
  }

  // ---------- state ----------
  const S = { freeze: 0, freezeTarget: 0, mode: 'ambient', pairCondition: null, timers: [], trajectories: [] };
  const trajMat = {
    clean: new THREE.LineBasicMaterial({ color: COLORS.clean, transparent: true, opacity: 0, depthWrite: false }),
    injected: new THREE.LineBasicMaterial({ color: COLORS.injected, transparent: true, opacity: 0, depthWrite: false }),
  };
  const trajLines = ['clean', 'injected'].map((k) => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(41).fill(0).map(() => new V3())), trajMat[k]);
    line.visible = false;
    line.frustumCulled = false;
    root.add(line);
    return { kind: k, line, opTarget: 0 };
  });

  const schedule = (ms, fn) => S.timers.push({ at: performance.now() + ms, fn });
  const clearTimers = () => { S.timers = []; };

  function setCellEmphasis(activeCondition) {
    for (const c of cells) {
      if (!activeCondition) c.emphTarget = 0.55;
      else c.emphTarget = c.key.startsWith(activeCondition) ? 1 : 0.22;
    }
  }

  function restore() {
    if (anchorEl) { anchorEl = null; resize(); }
    clearTimers();
    clearSignals('script');
    S.mode = 'ambient';
    S.pairCondition = null;
    S.freezeTarget = 0;
    setCellEmphasis(null);
    trajLines.forEach((t) => { t.opTarget = 0; });
    hideRail();
    if (still()) { snapAll(); renderOnce(); }
  }

  // ---------- public state API ----------
  function setMode(mode) {
    if (mode === 'integrity' || mode === 'break') {
      clearTimers(); clearSignals('script');
      S.mode = mode;
      setCellEmphasis(null);
      trajLines.forEach((t) => { t.opTarget = 0; });
      showRail(8);
      for (let i = 0; i < 8; i++) setRailNode(i, 'idle');
      if (still()) { snapAll(); renderOnce(); }
    } else restore();
  }

  function showPair({ condition } = {}) {
    clearTimers(); clearSignals('script');
    S.mode = 'pair';
    S.pairCondition = condition === 'weekend' ? 'weekend' : 'weekday';
    setCellEmphasis(S.pairCondition);
    hideRail();
    // two trajectories leave the selected condition's cells: clean (cool) and injected (amber), distinct but restrained
    const dirs = { clean: -1, injected: 1 };
    for (const t of trajLines) {
      const cell = cellByKey[`${S.pairCondition}_${t.kind}`];
      const a = new V3().copy(cell.group.position).multiply(world.scale).add(world.position);
      // both leave toward the open right side of the frame (the content column is on the left)
      const b = new V3(world.position.x + 3.7 * world.scale.x, a.y + dirs[t.kind] * 2.3 * world.scale.x, -1.2);
      const c = new V3((a.x + b.x) / 2, (a.y + b.y) / 2 + dirs[t.kind] * 1.4, 0.8);
      const pts = t.line.geometry.attributes.position;
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const iu = 1 - u;
        pts.setXYZ(i, iu * iu * a.x + 2 * iu * u * c.x + u * u * b.x, iu * iu * a.y + 2 * iu * u * c.y + u * u * b.y, iu * iu * a.z + 2 * iu * u * c.z + u * u * b.z);
      }
      pts.needsUpdate = true;
      t.line.visible = true;
      t.opTarget = 0.5;
      if (!still()) addSignal({ a, c, b, dur: t.kind === 'clean' ? 2.6 : 2.0, loop: true, tag: 'script', color: new THREE.Color(COLORS[t.kind]), delay: t.kind === 'clean' ? 0 : 0.5 });
    }
    if (still()) { snapAll(); renderOnce(); }
  }

  /** stages: [{key, weight?, severed?}] — severed draws the link INTO that stage dashed (e.g. corroboration unavailable). */
  function runChain(stages) {
    clearTimers(); clearSignals('script');
    S.mode = 'chain';
    setCellEmphasis(null);
    trajLines.forEach((t) => { t.opTarget = 0; });
    const n = stages.length;
    showRail(n);
    const finalize = () => {
      stages.forEach((st, i) => {
        setRailNode(i, 'lit', st.weight);
        if (i > 0) setRailSeg(i - 1, st.severed ? 'dashed' : 'lit');
      });
    };
    if (still()) { finalize(); snapAll(); renderOnce(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const STEP = 520;
      stages.forEach((st, i) => {
        schedule(i * STEP, () => {
          setRailNode(i, 'active');
          if (i > 0) {
            setRailSeg(i - 1, st.severed ? 'dashed' : 'lit');
            const a = railWorldPos(i - 1, new V3());
            const b = railWorldPos(i, new V3());
            addSignal({ a, b, dur: (STEP * 0.9) / 1000, tag: 'script', color: new THREE.Color(st.severed ? COLORS.fail : COLORS.accent) });
          }
        });
        schedule(i * STEP + STEP * 0.85, () => setRailNode(i, 'lit', st.weight));
      });
      schedule(n * STEP + 250, resolve);
    });
  }

  function beginVerify() {
    clearTimers(); clearSignals('script');
    S.mode = 'verifying';
    setCellEmphasis(null);
    trajLines.forEach((t) => { t.opTarget = 0; });
    showRail(8);
    S.freezeTarget = 1; // hold the ambient field still while the real verification runs
    if (still()) { for (let i = 0; i < 8; i++) setRailNode(i, 'active'); snapAll(); renderOnce(); return; }
    const scan = () => {
      for (let i = 0; i < 7; i++) {
        const a = railWorldPos(i, new V3());
        const b = railWorldPos(i + 1, new V3());
        addSignal({ a, b, dur: 0.5, delay: i * 0.5, loop: true, tag: 'script' });
      }
    };
    scan();
    for (let i = 0; i < 8; i++) setRailNode(i, 'active', 0.55);
  }

  /** components: [{status: pass|fail|unchecked|notrun}] — the actual server result. */
  function resolveVerify(components) {
    clearTimers(); clearSignals('script');
    S.mode = 'verified';
    const apply = (i) => {
      const st = components[i].status;
      setRailNode(i, st === 'pass' ? 'pass' : st === 'fail' ? 'fail' : st === 'unchecked' ? 'unchecked' : 'notrun');
      if (i > 0) setRailSeg(i - 1, st === 'fail' || components[i - 1].status === 'fail' ? 'dashed' : 'lit');
    };
    if (still()) {
      components.forEach((_, i) => apply(i));
      S.freezeTarget = 0;
      snapAll(); renderOnce();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      components.forEach((_, i) => schedule(i * RESOLVE_STEP_MS, () => {
        apply(i);
        if (i > 0) addSignal({ a: railWorldPos(i - 1, new V3()), b: railWorldPos(i, new V3()), dur: 0.35, tag: 'script', color: new THREE.Color(components[i].status === 'fail' ? COLORS.fail : COLORS.pass) });
      }));
      schedule(components.length * RESOLVE_STEP_MS + 1300, () => { restore(); resolve(); });
    });
  }

  /** Break: signal travels the custody chain and is interrupted at the first failed component. */
  function showBreak(components) {
    clearTimers(); clearSignals('script');
    S.mode = 'broken';
    setCellEmphasis(null);
    showRail(8);
    S.freezeTarget = 1;
    const firstFail = components.findIndex((c) => c.status === 'fail');
    const apply = (i) => {
      const st = components[i].status;
      setRailNode(i, st === 'fail' ? 'fail' : st === 'pass' ? 'pass' : st === 'unchecked' ? 'unchecked' : 'notrun');
    };
    const finalize = () => {
      components.forEach((_, i) => {
        apply(i);
        if (i > 0) setRailSeg(i - 1, firstFail >= 0 && i > firstFail ? 'dashed' : i === firstFail ? 'dashed' : 'lit');
      });
    };
    if (still()) { finalize(); snapAll(); renderOnce(); return Promise.resolve(); }
    return new Promise((resolve) => {
      const stopAt = firstFail >= 0 ? firstFail : components.length - 1;
      for (let i = 0; i <= stopAt; i++) {
        schedule(i * 320, () => {
          apply(i);
          if (i > 0) {
            setRailSeg(i - 1, i === firstFail ? 'dashed' : 'lit');
            addSignal({ a: railWorldPos(i - 1, new V3()), b: railWorldPos(i, new V3()), dur: 0.3, tag: 'script', color: new THREE.Color(i === firstFail ? COLORS.fail : COLORS.pass) });
          }
        });
      }
      schedule((stopAt + 1) * 320 + 120, finalize);
      schedule((stopAt + 1) * 320 + 4200, () => { restore(); resolve(); });
    });
  }

  // ---------- frame loop ----------
  let raf = 0;
  let last = 0;
  let clock = 0;
  let spawnIn = 1.2;
  const EASE_RATE = 9;
  const smooth = (cur, target, dt) => cur + (target - cur) * Math.min(1, dt * EASE_RATE);

  // snap = jump straight to every target (reduced motion / on-demand render); otherwise ease toward them
  function step(dt, snap) {
    S.freeze = snap ? S.freezeTarget : smooth(S.freeze, S.freezeTarget, dt);
    const motion = still() ? 0 : 1 - S.freeze;

    clock += dt * motion;
    field.update(dt, clock, motion);

    for (const c of cells) {
      c.emph = snap ? c.emphTarget : smooth(c.emph, c.emphTarget, dt);
      const e = c.emph;
      c.wire.material.opacity = 0.18 + 0.75 * e;
      c.core.material.opacity = 0.25 + 0.7 * e;
      c.halo.material.opacity = 0.05 + 0.35 * e * e;
      const s = 0.95 + 0.4 * e;
      c.group.scale.setScalar(s);
      c.group.rotation.y += dt * c.spin * motion;
      c.group.rotation.x += dt * c.spin * 0.5 * motion;
    }
    linkMat.opacity = 0.3 + 0.4 * (S.pairCondition ? 1 : 0.6);
    rings.forEach((r, i) => { r.ring.rotation.z += dt * r.speed * motion; });
    {
      const p = orbitDots.geometry.attributes.position;
      rings.forEach((r, i) => {
        const a = clock * r.speed * 2.6 + r.phase;
        // orbitDots is a child of `world`, like the rings, so positions stay in world-local space
        tmp.set(Math.cos(a) * r.radius, Math.sin(a) * r.radius, 0).applyEuler(r.ring.rotation);
        p.setXYZ(i, tmp.x, tmp.y, tmp.z);
      });
      p.needsUpdate = true;
    }
    camera.position.x = Math.sin(clock * 0.06) * 0.45;
    camera.position.y = Math.cos(clock * 0.05) * 0.25;
    camera.lookAt(0, 0, 0);

    // timers (scripted sequences run in real time, independent of motion scale).
    // Collect what is due first: a due callback may call restore(), which clears the list.
    const now = performance.now();
    const due = [];
    S.timers = S.timers.filter((t) => (t.at <= now ? (due.push(t), false) : true));
    due.sort((x, y) => x.at - y.at).forEach((t) => t.fn());

    // ambient pulses along the network, only while the field is alive
    if (!still() && motion > 0.5 && (S.mode === 'ambient' || S.mode === 'pair')) {
      spawnIn -= dt;
      if (spawnIn <= 0) {
        spawnIn = 1.4 + rand() * 1.8;
        const e = edges[Math.floor(rand() * edges.length)];
        const a = new V3().copy(e.a).multiply(world.scale).add(world.position);
        const b = new V3().copy(e.b).multiply(world.scale).add(world.position);
        addSignal({ a, b, dur: 1.3 + rand() * 1.4, tag: 'ambient', color: new THREE.Color(rand() > 0.72 ? COLORS.injected : COLORS.accent) });
      }
    }
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.u += dt / s.dur;
      if (s.u >= 1) { if (s.loop) s.u = 0; else signals.splice(i, 1); }
    }
    for (let i = 0; i < MAX_SIGNALS; i++) {
      const s = signals[i];
      if (!s || s.delay > 0) { sigCol[i * 3] = sigCol[i * 3 + 1] = sigCol[i * 3 + 2] = 0; continue; }
      pathAt(s, s.u, tmp);
      const env = Math.min(1, s.u * 6, (1 - s.u) * 6);
      sigPos[i * 3] = tmp.x; sigPos[i * 3 + 1] = tmp.y; sigPos[i * 3 + 2] = tmp.z;
      sigCol[i * 3] = s.color.r * env; sigCol[i * 3 + 1] = s.color.g * env; sigCol[i * 3 + 2] = s.color.b * env;
    }
    sigGeo.attributes.position.needsUpdate = true;
    sigGeo.attributes.color.needsUpdate = true;

    // pair trajectories
    for (const t of trajLines) {
      const m = t.line.material;
      m.opacity = snap ? t.opTarget : smooth(m.opacity, t.opTarget, dt);
      if (m.opacity < 0.01 && t.opTarget === 0) t.line.visible = false;
    }

    // rail
    railState.opacity = snap ? railState.opacityTarget : smooth(railState.opacity, railState.opacityTarget, dt);
    for (let i = 0; i < RAIL_MAX; i++) {
      const n = railNodes[i];
      const tgt = n.target;
      n.color.lerp(tgt.color, snap ? 1 : Math.min(1, dt * EASE_RATE));
      n.opacity = snap ? tgt.opacity : smooth(n.opacity, tgt.opacity, dt);
      n.scale = snap ? tgt.scale : smooth(n.scale, tgt.scale, dt);
      n.mesh.material.color.copy(n.color);
      n.mesh.material.opacity = n.opacity * railState.opacity;
      n.halo.material.color.copy(n.color);
      n.halo.material.opacity = 0.7 * n.opacity * railState.opacity;
      n.mesh.scale.setScalar(n.scale);
      n.mesh.rotation.y += dt * 0.6 * motion;
    }
    for (const seg of railSegs) {
      seg.op = snap ? seg.opTarget : smooth(seg.op, seg.opTarget, dt);
      const dashed = seg.style === 'dashed';
      seg.solid.material.opacity = dashed ? 0 : seg.op * railState.opacity;
      seg.dashed.material.opacity = dashed ? seg.op * railState.opacity : 0;
    }
  }

  function draw() { renderer.render(root, camera); }
  // Only reduced motion snaps on a plain re-render; otherwise a resize would jump animated states.
  function renderOnce() { step(0.016, still()); draw(); }
  function snapAll() { step(0.016, true); }

  // ---- governor: compare the time between rendered frames with the interval we asked for ----
  let paceEma = 1;
  let costEma = 0; // ms spent inside step()+draw(); a saturated GPU shows up here as backpressure
  let paceSamples = 0;
  let strained = 0;
  function targetIntervalMs() {
    const L = QUALITY_LEVELS[level];
    // The verification wait is exactly when the server needs the CPU: stay at the ambient rate while it runs.
    const scripted = S.mode !== 'verifying' && (S.timers.length > 0 || signals.some((s) => s.tag === 'script'));
    const fps = qaFps || (scripted ? L.scriptedFps : L.ambientFps);
    return fps > 0 ? 1000 / fps : Infinity;
  }
  function stepDown() {
    if (level >= STATIC_LEVEL || forced !== null) return;
    level += 1;
    paceEma = 1; costEma = 0; paceSamples = 0; strained = 0;
    resize(); // applies the new pixel ratio and re-renders
    if (still()) { stopLoop(); clearSignals(); snapAll(); renderOnce(); }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const interval = targetIntervalMs();
    const dtMs = now - last;
    if (dtMs < interval - 4) return; // rate cap for the current level: this is ambient, not a game
    last = now;
    const t0 = performance.now();
    step(Math.min(dtMs / 1000, 0.1), false);
    draw();
    const cost = performance.now() - t0;
    if (paceSamples++ > 12 && dtMs < 1000) { // ignore start-up frames (shader compile) and tab-switch gaps
      paceEma = paceEma * 0.85 + (dtMs / interval) * 0.15;
      costEma = costEma * 0.85 + cost * 0.15;
      strained = paceEma > 1.7 || costEma > 12 ? strained + 1 : 0;
      if (strained > 8) stepDown();
    }
  }
  function startLoop() {
    if (raf || still()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function onVisibility() { if (document.hidden) stopLoop(); else if (!still()) startLoop(); }

  let resizeTimer = 0;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  const offReduced = onReducedMotionChange((matches) => {
    reducedPref = matches;
    if (still()) { stopLoop(); clearSignals(); snapAll(); renderOnce(); } else startLoop();
  });

  resize();
  layoutRail(0);
  renderOnce();
  startLoop();

  return {
    status: 'active',
    reason: '',
    init: async () => api,
    setMode, showPair, anchorTo, runChain, beginVerify, resolveVerify, showBreak, restore,
    pause: stopLoop,
    resume: () => { if (!still()) startLoop(); },
    dispose() {
      stopLoop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      offReduced();
      field.dispose();
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      tex.dispose();
      renderer.dispose();
    },
    // read-only counters for tests / diagnostics
    stats: () => ({ signals: signals.length, timers: S.timers.length, mode: S.mode, reduced: reducedPref, level, costMs: Number(costEma.toFixed(2)), still: still(), looping: !!raf, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries }),
  };
}
