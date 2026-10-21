import * as THREE from '/vendor/three/three.module.js';

const QUALITY = {
  low:      { n: 12000, pr: 1,   seg: 32 },
  balanced: { n: 28000, pr: 1.5, seg: 48 },
  high:     { n: 56000, pr: 2,   seg: 64 }
};
const CAM_Z = 14, LENS_Z = 3, FOV = 35;
const rnd = Math.random;
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

// ---------------- shapes (each returns Float32Array of n*3) ----------------
function ribbon(n) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const slat = Math.floor(rnd() * 110) / 110;
    const u = slat + rnd() * 0.0035, v = rnd() - 0.5;
    const ang = u * Math.PI * 3.2 + 0.4;
    const w = 2.2 * (0.55 + 0.45 * Math.sin(u * 9 + 1));
    a[i * 3]     = (u - 0.5) * 17 + 1.2;
    a[i * 3 + 1] = Math.sin(u * 4.6) * 1.5 + Math.sin(ang) * v * w - 0.4;
    a[i * 3 + 2] = Math.cos(ang) * v * w + Math.cos(u * 3) * 0.9;
  }
  return a;
}
function sheet(n) { // tilted ledger of floating cards
  const a = new Float32Array(n * 3);
  const cards = Array.from({ length: 8 }, () => ({ x: (rnd() - 0.5) * 9, z: (rnd() - 0.5) * 5, y: 0.5 + rnd() * 1.6 }));
  const cy = Math.cos(-0.95), sy = Math.sin(-0.95), cr = Math.cos(0.5), sr = Math.sin(0.5);
  for (let i = 0; i < n; i++) {
    let x, y, z;
    if (rnd() < 0.55) { x = (rnd() - 0.5) * 15; z = (rnd() - 0.5) * 9; y = 0; if (rnd() < 0.7) { x = Math.round(x * 1.4) / 1.4; z = Math.round(z * 1.4) / 1.4; } }
    else {
      const c = cards[(rnd() * cards.length) | 0];
      let px = (rnd() - 0.5) * 2.6, pz = (rnd() - 0.5) * 1.6;
      if (rnd() < 0.5) { if (rnd() < 0.5) px = Math.sign(px) * 1.3; else pz = Math.sign(pz) * 0.8; }
      x = c.x + px; z = c.z + pz; y = c.y;
    }
    const y1 = y * cy - z * sy, z1 = y * sy + z * cy;
    a[i * 3] = x * cr - z1 * sr + 1; a[i * 3 + 1] = y1 - 0.4; a[i * 3 + 2] = x * sr + z1 * cr;
  }
  return a;
}
function burst(n) { // spiky bloom
  const a = new Float32Array(n * 3);
  const axes = Array.from({ length: 70 }, () => { const t = rnd() * Math.PI * 2, p = Math.acos(2 * rnd() - 1); return [Math.sin(p) * Math.cos(t), Math.cos(p), Math.sin(p) * Math.sin(t)]; });
  for (let i = 0; i < n; i++) {
    let d, r;
    if (rnd() < 0.62) { const ax = axes[(rnd() * axes.length) | 0]; d = [ax[0] + gauss() * 0.16, ax[1] + gauss() * 0.16, ax[2] + gauss() * 0.16]; r = 1 + Math.pow(rnd(), 1.6) * 3.8; }
    else { d = [gauss(), gauss(), gauss()]; r = 0.7 + rnd() * 0.7; }
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    a[i * 3] = (d[0] / l) * r + 2; a[i * 3 + 1] = (d[1] / l) * r; a[i * 3 + 2] = (d[2] / l) * r;
  }
  return a;
}
function lensShape(n) { // a big magnifier outline: ring + handle + glass
  const a = new Float32Array(n * 3);
  const R = 3.1, rot = -0.35;
  for (let i = 0; i < n; i++) {
    const k = rnd();
    let x, y, z;
    if (k < 0.5) { const t = rnd() * Math.PI * 2, r = R + gauss() * 0.16; x = Math.cos(t) * r; y = Math.sin(t) * r; z = gauss() * 0.22; }
    else if (k < 0.72) { const s = rnd(), r = 0.2 + s * 0.05; const t = rnd() * Math.PI * 2; const d = R + 0.1 + s * 3.6; x = d * 0.7071 + Math.cos(t) * r; y = -d * 0.7071 + Math.sin(t) * r; z = Math.cos(t) * r * 0.5; }
    else { const t = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (R - 0.15); x = Math.cos(t) * r; y = Math.sin(t) * r; z = gauss() * 0.08; }
    a[i * 3] = x * Math.cos(rot) - y * Math.sin(rot) + 2.2; a[i * 3 + 1] = x * Math.sin(rot) + y * Math.cos(rot) + 0.8; a[i * 3 + 2] = z;
  }
  return a;
}

// ---------------- shaders ----------------
const VERT = /* glsl */`
attribute vec3 aB; attribute vec3 aC; attribute vec3 aD;
attribute float aRand; attribute float aT;
uniform float uStage, uTime, uSize, uPR, uAspect, uLensR, uMag, uLensOn, uAppear, uMotion;
uniform vec2 uLens;
varying float vT; varying float vIn; varying float vTw; varying float vRand;
float ease(float x){ return x*x*(3.-2.*x); }
void main(){
  float m1 = ease(clamp(uStage*1.5 - aRand*0.5, 0., 1.));
  float m2 = ease(clamp((uStage-1.)*1.5 - aRand*0.5, 0., 1.));
  float m3 = ease(clamp((uStage-2.)*1.5 - aRand*0.5, 0., 1.));
  vec3 p = mix(position, aB, m1); p = mix(p, aC, m2); p = mix(p, aD, m3);
  float t = uTime*0.45*uMotion;
  p += vec3(sin(t + p.y*1.3 + aRand*6.283), cos(t*1.1 + p.x*1.1 + aRand*6.283), sin(t*0.9 + p.z + aRand*3.))*0.07;
  p.y += sin(p.x*0.7 + uTime*0.8*uMotion) * 0.28 * (1.-m1);          // ribbon undulation
  p *= mix(2.6, 1., ease(uAppear));                                    // intro: gather inward
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  vec2 d = (ndc - uLens) * vec2(uAspect, 1.);
  float tt = clamp(length(d)/uLensR, 0., 1.);
  float bulge = (1. - ease(tt)) * uMag * uLensOn;                      // magnify what sits under the glass
  vec2 nd = uLens + (d*(1.+bulge)) / vec2(uAspect, 1.);
  gl_Position = vec4(nd*clip.w, clip.z, clip.w);
  gl_PointSize = uSize * uPR * (1. + bulge*0.9) * (14. / -mv.z);
  vT = fract(aT + uStage*0.11 + p.x*0.02);
  vIn = (1. - smoothstep(0.78, 1., tt)) * uLensOn;
  vTw = 0.72 + 0.28*sin(uTime*2.1*uMotion + aRand*60.);
  vRand = aRand;
}`;
const FRAG = /* glsl */`
uniform vec3 uA, uB, uC, uClean; uniform float uDim, uAppear;
varying float vT; varying float vIn; varying float vTw; varying float vRand;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 g = vT < 0.5 ? mix(uA, uB, vT*2.) : mix(uB, uC, (vT-0.5)*2.);
  vec3 col = mix(g, uClean, vIn*0.88);          // under the lens the noise turns clean
  float tw = mix(vTw, 1., vIn);
  float a = smoothstep(0.5, 0., d) * (0.5 + vIn*0.45) * tw * uDim * uAppear;
  gl_FragColor = vec4(col, a);
}`;

// ---------------- scene controller ----------------
export function createScene(canvas, { onLens, mobile = false } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { return null; }
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = CAM_Z;

  // environment for reflections on the metal rim
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x14141c);
  const panel = (w, h, x, y, z, v, tint) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(v), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m); };
  panel(14, 3, 0, 8, 2, 9, '#ffffff'); panel(3, 10, -8, 0, 3, 6, '#ffffff'); panel(3, 10, 8, 1, -2, 5, '#9ab6ff'); panel(10, 2, 0, -7, 4, 3, '#ffd2f2');
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;

  // ---- particles ----
  const uniforms = {
    uStage: { value: 0 }, uTime: { value: 0 }, uSize: { value: 2.4 }, uPR: { value: 1 }, uAspect: { value: 1 },
    uLensR: { value: 0.3 }, uMag: { value: 0.9 }, uLensOn: { value: 1 }, uAppear: { value: 0 }, uMotion: { value: 1 },
    uLens: { value: new THREE.Vector2(0.5, 0) }, uDim: { value: 1 },
    uA: { value: new THREE.Color('#ff4fd8') }, uB: { value: new THREE.Color('#8b5cff') }, uC: { value: new THREE.Color('#3aa0ff') }, uClean: { value: new THREE.Color('#ffffff') }
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const group = new THREE.Group(); scene.add(group);
  let points = null, qualityKey = 'balanced';

  function buildParticles(n) {
    if (points) { group.remove(points); points.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(ribbon(n), 3));
    g.setAttribute('aB', new THREE.BufferAttribute(sheet(n), 3));
    g.setAttribute('aC', new THREE.BufferAttribute(burst(n), 3));
    g.setAttribute('aD', new THREE.BufferAttribute(lensShape(n), 3));
    g.setAttribute('aRand', new THREE.BufferAttribute(Float32Array.from({ length: n }, rnd), 1));
    g.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from({ length: n }, rnd), 1));
    points = new THREE.Points(g, material); points.frustumCulled = false; group.add(points);
  }

  // ---- the magnifier ----
  const lens = new THREE.Group(); lens.position.z = LENS_Z; scene.add(lens);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdfe2ee, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x8b5cff, metalness: 0.2, roughness: 0.45, envMapIntensity: 0.9 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xb57bff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  let lensParts = [];
  function buildLens(seg) {
    lensParts.forEach((m) => { lens.remove(m); m.geometry.dispose(); }); lensParts = [];
    const add = (geo, mat, fn) => { const m = new THREE.Mesh(geo, mat); fn && fn(m); lens.add(m); lensParts.push(m); return m; };
    add(new THREE.TorusGeometry(1, 0.085, 28, seg * 2), rimMat);
    add(new THREE.CircleGeometry(0.96, seg), glassMat, (m) => { m.position.z = -0.01; });
    add(new THREE.TorusGeometry(0.9, 0.012, 8, seg * 2), ringMat);
    add(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 24), rimMat, (m) => { m.position.set(1.06 * 0.7071, -1.06 * 0.7071, 0); m.rotation.z = -Math.PI * 0.75; });
    add(new THREE.CylinderGeometry(0.115, 0.15, 1.7, 28), gripMat, (m) => { m.position.set(1.95 * 0.7071, -1.95 * 0.7071, 0); m.rotation.z = -Math.PI * 0.75; });
    add(new THREE.SphereGeometry(0.16, 20, 16), rimMat, (m) => { m.position.set(2.82 * 0.7071, -2.82 * 0.7071, 0); });
    scanArc = add(new THREE.TorusGeometry(0.9, 0.035, 8, 40, Math.PI * 0.55), ringMat);
  }
  let scanArc;

  // ---- state ----
  const S = {
    stageTarget: 0, stage: 0, w: 1, h: 1, aspect: 1,
    pointer: null, lastMove: 0, pos: new THREE.Vector2(0.5, 0), vel: new THREE.Vector2(),
    lensOn: true, size: 1, follow: 0.4, reduce: false, busy: false, flash: 0, flashColor: new THREE.Color(), press: 0, appear: 0,
    scaleNow: 1, light: false, dim: 1, dimTarget: 1
  };
  const rest = () => (S.aspect < 0.9 ? new THREE.Vector2(0.38, 0.22) : new THREE.Vector2(0.5, 0.04));
  S.pos.copy(rest());

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    S.w = w; S.h = h; S.aspect = w / h;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[qualityKey].pr));
    renderer.setSize(w, h, false);
    camera.aspect = S.aspect; camera.updateProjectionMatrix();
    uniforms.uAspect.value = S.aspect; uniforms.uPR.value = renderer.getPixelRatio();
    const fit = mobile ? (S.aspect < 1 ? 0.86 : 1) : Math.min(1, S.aspect / 1.35);          // shrink the particle world on narrow screens
    group.scale.setScalar(fit); group.position.x = (mobile || S.aspect < 0.9) ? 0 : 0.6; group.position.y = mobile && S.aspect < 1 ? 0.6 : 0;
  }
  const lensPxRadius = () => Math.min(180, Math.max(70, Math.min(S.w, S.h) * 0.17)) * S.size;

  // ---- input ----
  const setPointer = (x, y) => { S.pointer = new THREE.Vector2((x / S.w) * 2 - 1, -(y / S.h) * 2 + 1); S.lastMove = performance.now(); };
  addEventListener('pointermove', (e) => setPointer(e.clientX, e.clientY), { passive: true });
  addEventListener('pointerdown', (e) => { setPointer(e.clientX, e.clientY); S.press = 1; }, { passive: true });
  addEventListener('pointerup', () => { S.press = 0; }, { passive: true });
  document.addEventListener('mouseleave', () => { S.pointer = null; });
  addEventListener('resize', resize);

  // ---- quality / adaptivity ----
  function setQualityKey(k) { qualityKey = QUALITY[k] ? k : 'balanced'; buildParticles(QUALITY[qualityKey].n); buildLens(QUALITY[qualityKey].seg); resize(); }
  let frames = 0, acc = 0, adaptive = true;

  // ---- loop ----
  const clock = new THREE.Clock();
  let running = true, raf = 0;
  const v3 = new THREE.Vector3();
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = (uniforms.uTime.value += dt);
    S.appear = Math.min(1, S.appear + dt / 1.8); uniforms.uAppear.value = S.appear;
    S.stage += (S.stageTarget - S.stage) * (1 - Math.exp(-dt * (S.reduce ? 8 : 3.2))); uniforms.uStage.value = S.stage;
    S.dim += (S.dimTarget - S.dim) * (1 - Math.exp(-dt * 3)); uniforms.uDim.value = S.dim;

    // lens target: cursor, or its resting place on the right of the front page
    const idle = !S.pointer;
    const tgt = idle ? rest() : S.pointer;
    if (idle) { tgt.y += Math.sin(t * 0.8) * 0.025; tgt.x += Math.cos(t * 0.6) * 0.012; }
    const speed = S.reduce ? 40 : 18 - S.follow * 14.5;
    const prev = S.pos.clone();
    S.pos.x += (tgt.x - S.pos.x) * (1 - Math.exp(-dt * speed));
    S.pos.y += (tgt.y - S.pos.y) * (1 - Math.exp(-dt * speed));
    S.vel.lerp(S.pos.clone().sub(prev).divideScalar(Math.max(dt, 1e-3)), 0.2);

    // place the 3D magnifier
    const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (CAM_Z - LENS_Z), halfW = halfH * S.aspect;
    const worldPerPx = (halfH * 2) / S.h;
    const intro = 1 - Math.pow(1 - Math.min(1, S.appear * 1.4), 3);
    const press = (S.press ? 0.93 : 1), busyPulse = S.busy ? 1 + Math.sin(t * 7) * 0.03 : 1;
    S.scaleNow += (lensPxRadius() * worldPerPx * press * busyPulse - S.scaleNow) * (1 - Math.exp(-dt * 14));
    lens.visible = S.lensOn;
    lens.scale.setScalar(Math.max(0.001, S.scaleNow * intro));
    lens.position.set(S.pos.x * halfW, S.pos.y * halfH, LENS_Z);
    const sway = S.reduce ? 0 : 1;
    lens.rotation.y = THREE.MathUtils.clamp(-S.vel.x * 0.18, -0.5, 0.5) + Math.sin(t * 0.7) * 0.06 * sway - 0.12;
    lens.rotation.x = THREE.MathUtils.clamp(S.vel.y * 0.18, -0.5, 0.5) + Math.cos(t * 0.5) * 0.04 * sway;
    lens.rotation.z = THREE.MathUtils.clamp(-S.vel.x * 0.05, -0.2, 0.2) + (idle ? Math.sin(t * 0.9) * 0.04 * sway : 0);
    if (scanArc) { scanArc.rotation.z += dt * (S.busy ? 7 : 0.6); scanArc.visible = true; }
    S.flash = Math.max(0, S.flash - dt * 1.4);
    ringMat.color.copy(S.flashColor).lerp(ringMat.userData.base || S.flashColor, 1 - S.flash);
    ringMat.opacity = 0.75 + S.flash * 0.25;

    // tell the particle shader (and the page) where the glass is
    const ndcR = (lensPxRadius() * 0.98 / S.h) * 2;           // radius in NDC-y units (aspect-corrected in shader)
    uniforms.uLens.value.copy(S.pos); uniforms.uLensR.value = ndcR; uniforms.uLensOn.value = S.lensOn ? 1 : 0;
    group.rotation.y = Math.sin(t * 0.12) * 0.08 + S.pos.x * 0.06; group.rotation.x = S.pos.y * 0.04;
    onLens && onLens((S.pos.x * 0.5 + 0.5) * S.w, (0.5 - S.pos.y * 0.5) * S.h, lensPxRadius(), S.lensOn);

    renderer.render(scene, camera);

    // adaptive quality: if the machine struggles, step down once or twice
    if (adaptive && S.appear >= 1) {
      frames++; acc += dt;
      if (acc > 2.5) {
        const fps = frames / acc; frames = 0; acc = 0;
        if (fps < 38 && qualityKey !== 'low') setQualityKey(qualityKey === 'high' ? 'balanced' : 'low');
      }
    }
  }
  document.addEventListener('visibilitychange', () => { running = !document.hidden; clock.getDelta(); });

  // ---- public API ----
  const api = {
    setStage(v) { S.stageTarget = v; S.dimTarget = v < 0.35 ? 1 : 0.62; },
    setTheme(sceneColors, isLight) {
      uniforms.uA.value.set(sceneColors.a); uniforms.uB.value.set(sceneColors.b); uniforms.uC.value.set(sceneColors.c); uniforms.uClean.value.set(sceneColors.clean);
      material.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending; material.needsUpdate = true;
      uniforms.uSize.value = isLight ? 2.9 : 2.4;
      ringMat.color.set(sceneColors.b); ringMat.userData.base = new THREE.Color(sceneColors.b); S.flashColor.set(sceneColors.b);
      ringMat.blending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending; ringMat.needsUpdate = true;
      gripMat.color.set(sceneColors.b);
    },
    setQuality(q) {
      if (q === 'auto') {
        adaptive = true;
        const weak = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(pointer: coarse)').matches;
        setQualityKey(weak ? 'low' : 'balanced');
      } else { adaptive = false; setQualityKey(q); }
    },
    setLens({ on, size, follow }) { if (on !== undefined) S.lensOn = on; if (size !== undefined) S.size = size; if (follow !== undefined) S.follow = follow; },
    setReduceMotion(v) { S.reduce = v; uniforms.uMotion.value = v ? 0 : 1; },
    setBusy(v) { S.busy = v; },
    setPointerNDC(x, y) { S.pointer = new THREE.Vector2(x, y); S.lastMove = performance.now(); },
    flash(color) { S.flashColor.set(color); S.flash = 1; },
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); }
  };
  setQualityKey('balanced'); resize(); frame();
  return api;
}
