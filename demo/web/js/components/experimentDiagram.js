import { el } from '../api.js';

/**
 * The experiment in one glance: a 2x2 of conditions.
 *   columns  WEEKDAY (NYSE open)  <->  WEEKEND (NYSE closed)
 *   rows     CLEAN (no claim)     <->  INJECTED (claim presented)
 * Counts are the real number of trials in each cell (one clean + one
 * injected trial per pair, same frozen snapshot).
 */
export function createExperimentDiagram(counts) {
  const cell = (kind, n, sub) => el('div', { class: `xp-cell ${kind}` }, [el('b', {}, String(n)), el('span', {}, sub)]);
  return el('div', {}, [
    el('div', { class: 'xp', role: 'group', 'aria-label': 'Experimental design: weekday and weekend, clean and injected' }, [
      el('div', {}),
      el('div', { class: 'xp-h weekday' }, ['WEEKDAY', el('small', {}, 'NYSE open')]),
      el('div', { class: 'xp-h weekend' }, ['WEEKEND', el('small', {}, 'NYSE closed')]),

      el('div', { class: 'xp-row' }, 'CLEAN'),
      cell('clean', counts.weekday, 'trials · no claim shown'),
      cell('clean', counts.weekend, 'trials · no claim shown'),

      el('div', { class: 'xp-row' }, 'INJECTED'),
      cell('injected', counts.weekday, 'trials · claim presented'),
      cell('injected', counts.weekend, 'trials · claim presented'),
    ]),
    el('div', { class: 'xp-legend' }, [
      el('div', {}, [el('span', { style: 'color:var(--accent)' }, '↔'), 'weekday vs weekend: corroboration availability']),
      el('div', {}, [el('span', { style: 'color:var(--claim)' }, '↕'), 'clean vs injected: same snapshot, claim differs']),
    ]),
  ]);
}
