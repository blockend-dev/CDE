/**
 * Sparse ambient particles for the corroboration field. Two populations, one
 * draw call:
 *   - dust: dim, slow, unobtrusive depth cues
 *   - evidence points: every 6th particle, slightly brighter with a slow
 *     breathing, standing for discrete pieces of evidence moving through the
 *     system
 * Layout is seeded so the scene is identical on every load. Low count on
 * purpose; the caller passes motionScale = 0 to freeze it entirely (reduced
 * motion, hidden tab, verification "freeze").
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createParticleField(THREE, { count = 120, seed = 7, texture = null } = {}) {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const base = new Float32Array(count); // base brightness

  const dust = new THREE.Color(0x4f6b78);
  const evidence = new THREE.Color(0x9fdde8);

  for (let i = 0; i < count; i++) {
    // spherical shell, flattened in z so depth stays subtle
    const r = 5 + rand() * 11;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.75;
    positions[i * 3 + 2] = r * Math.cos(phi) * 0.45 - 2;
    velocities[i * 3] = (rand() - 0.5) * 0.06;
    velocities[i * 3 + 1] = (rand() - 0.5) * 0.06;
    velocities[i * 3 + 2] = (rand() - 0.5) * 0.02;
    phase[i] = rand() * Math.PI * 2;
    const isEvidence = i % 6 === 0;
    base[i] = isEvidence ? 0.95 : 0.42;
    const c = isEvidence ? evidence : dust;
    colors[i * 3] = c.r * base[i];
    colors[i * 3 + 1] = c.g * base[i];
    colors[i * 3 + 2] = c.b * base[i];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.17,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: texture || null,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const LIMIT = 17;

  return {
    points,
    /** dt seconds, t seconds, motionScale 0..1 */
    update(dt, t, motionScale) {
      if (motionScale <= 0) return;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        positions[k] += velocities[k] * dt * motionScale;
        positions[k + 1] += velocities[k + 1] * dt * motionScale;
        positions[k + 2] += velocities[k + 2] * dt * motionScale;
        if (positions[k] > LIMIT) positions[k] = -LIMIT; else if (positions[k] < -LIMIT) positions[k] = LIMIT;
        if (positions[k + 1] > LIMIT * 0.75) positions[k + 1] = -LIMIT * 0.75; else if (positions[k + 1] < -LIMIT * 0.75) positions[k + 1] = LIMIT * 0.75;
        if (i % 6 === 0) {
          const breathe = base[i] * (0.8 + 0.2 * Math.sin(t * 0.7 + phase[i]));
          colors[k] = evidence.r * breathe;
          colors[k + 1] = evidence.g * breathe;
          colors[k + 2] = evidence.b * breathe;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
