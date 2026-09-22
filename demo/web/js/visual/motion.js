/**
 * UI choreography on top of Anime.js. Short, precise, almost instrument-like:
 * motion is used to establish hierarchy, causality and state change — never
 * as decoration. Three guarantees:
 *   1. If Anime.js fails to load, or the user prefers reduced motion, every
 *      helper applies the FINAL state immediately. Nothing is ever left hidden.
 *   2. Every running animation is tracked and cancelled on route change
 *      (cancelAll), so screens can be entered and left repeatedly without
 *      leaking timers.
 *   3. Numbers always end at their exact final value.
 */

let A = null; // the animejs module, once loaded
const ready = import('animejs').then((m) => { A = m; return true; }).catch(() => false);
const running = new Set();

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion() {
  return !!(mq && mq.matches);
}

/** Subscribe to live changes of the OS/browser reduced-motion setting. */
export function onReducedMotionChange(cb) {
  if (!mq) return () => {};
  const handler = () => cb(mq.matches);
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else if (mq.addListener) mq.addListener(handler);
  return () => (mq.removeEventListener ? mq.removeEventListener('change', handler) : mq.removeListener(handler));
}

export function motionReady() { return ready; }
export function motionAvailable() { return !!A && !prefersReducedMotion(); }

function track(anim) {
  if (!anim) return anim;
  running.add(anim);
  const done = () => running.delete(anim);
  if (anim.then) anim.then(done, done);
  return anim;
}

function clearInline(nodes) {
  for (const n of nodes) {
    if (n && n.style) { n.style.opacity = ''; n.style.transform = ''; n.style.backgroundColor = ''; }
  }
}

/** Cancel everything in flight (called on every route change). */
export function cancelAll() {
  for (const a of running) { try { a.cancel(); } catch (_) {} }
  running.clear();
}

/** Screen transition: a quick fade + 8px rise of the whole screen. */
export function enter(el) {
  if (!el || !motionAvailable()) return;
  track(A.animate(el, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: 260,
    ease: 'outQuad',
    onComplete: () => clearInline([el]),
  }));
}

/** Sequence a list of elements in (glass panels, chain nodes, trace steps, rows). */
export function staggerIn(nodes, { each = 45, from = 6, duration = 260, axis = 'translateY' } = {}) {
  const list = [...nodes].filter(Boolean);
  if (!list.length || !motionAvailable()) return Promise.resolve();
  const anim = track(A.animate(list, {
    opacity: [0, 1],
    [axis]: [from, 0],
    duration,
    ease: 'outQuad',
    delay: A.stagger(each),
    onComplete: () => clearInline(list),
  }));
  return anim && anim.then ? anim.then(() => undefined, () => undefined) : Promise.resolve();
}

/** Animate a number in an element; always finishes on the exact formatted final value. */
export function countTo(el, to, { format = (v) => String(v), duration = 700, from = 0 } = {}) {
  if (!el) return;
  const final = format(to);
  if (!motionAvailable() || typeof to !== 'number' || !Number.isFinite(to)) {
    el.textContent = final;
    return;
  }
  const state = { v: from };
  el.textContent = format(from);
  track(A.animate(state, {
    v: to,
    duration,
    ease: 'outExpo',
    onUpdate: () => { el.textContent = format(state.v); },
    onComplete: () => { el.textContent = final; },
  }));
}

/** Diff highlight: a short accent wash that fades out, marking what changed. */
export function flash(el, color = 'rgba(94, 200, 216, 0.22)', delay = 0) {
  if (!el || !motionAvailable()) return;
  track(A.animate(el, {
    backgroundColor: [color, 'rgba(0, 0, 0, 0)'],
    duration: 900,
    delay,
    ease: 'outQuad',
    onComplete: () => clearInline([el]),
  }));
}

/** PASS / FAIL resolution: a tiny settle so the state change is felt, not just seen. */
export function settle(el) {
  if (!el || !motionAvailable()) return;
  track(A.animate(el, {
    scale: [1.06, 1],
    duration: 320,
    ease: 'outBack',
    onComplete: () => { if (el.style) el.style.transform = ''; },
  }));
}

/** Slide a fixed bar (Judge Mode) in from the bottom. */
export function slideUp(el) {
  if (!el || !motionAvailable()) return;
  track(A.animate(el, {
    translateY: ['100%', '0%'],
    opacity: [0, 1],
    duration: 320,
    ease: 'outQuad',
    onComplete: () => clearInline([el]),
  }));
}

/** Cross-fade a text node's content (used by Judge Mode step labels). */
export function swapText(el, text) {
  if (!el) return;
  if (!motionAvailable()) { el.textContent = text; return; }
  track(A.animate(el, {
    opacity: [1, 0],
    duration: 110,
    ease: 'outQuad',
    onComplete: () => {
      el.textContent = text;
      track(A.animate(el, { opacity: [0, 1], duration: 180, ease: 'outQuad', onComplete: () => clearInline([el]) }));
    },
  }));
}
