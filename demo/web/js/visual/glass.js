/**
 * Glass helpers. The look itself is pure CSS (css/glass.css + tokens.css);
 * this module adds only the two things CSS cannot do:
 *   1. feature-detect backdrop-filter and tag <html> so styles can adapt;
 *   2. a soft "light follows the pointer" highlight on glass surfaces,
 *      implemented as two CSS variables set on the hovered surface only,
 *      rAF-throttled, skipped for touch input and for reduced motion.
 * Never touches layout, never runs a loop.
 */

import { prefersReducedMotion } from './motion.js';

const SURFACES = '.panel, .case-card';

export function supportsBackdropBlur() {
  return !!(window.CSS && CSS.supports && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')));
}

export function initGlass() {
  const root = document.documentElement;
  root.classList.add(supportsBackdropBlur() ? 'glass-blur' : 'glass-solid');

  let pending = null;
  let target = null;

  const onMove = (e) => {
    if (e.pointerType === 'touch' || prefersReducedMotion()) return;
    const surface = e.target.closest && e.target.closest(SURFACES);
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    target = { surface, x, y };
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      if (!target) return;
      target.surface.style.setProperty('--mx', `${target.x.toFixed(1)}%`);
      target.surface.style.setProperty('--my', `${target.y.toFixed(1)}%`);
    });
  };

  const onLeave = (e) => {
    const surface = e.target && e.target.closest ? e.target.closest(SURFACES) : null;
    if (surface && !surface.contains(e.relatedTarget)) {
      surface.style.removeProperty('--mx');
      surface.style.removeProperty('--my');
    }
  };

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerout', onLeave, { passive: true });
  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerout', onLeave);
    if (pending) cancelAnimationFrame(pending);
  };
}
