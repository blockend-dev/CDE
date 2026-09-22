import { el, shortHash } from '../api.js';
import { settle } from '../visual/motion.js';

/**
 * Chain of custody: the experiment's eight cryptographic components as a
 * linked list of nodes. A node says ON RECORD until a real verification has
 * run; only then does it become PASS/FAIL — and a component that no real
 * check covers (the prompt) says RECORDED ONLY rather than a fake PASS.
 */
const STATE_UI = {
  record: { pill: 'pending', text: 'ON RECORD' },
  checking: { pill: 'pending', text: 'CHECKING…' },
  pass: { pill: 'pass', text: 'PASS' },
  fail: { pill: 'fail', text: 'FAIL' },
  unchecked: { pill: 'neutral', text: 'RECORDED ONLY' },
  notrun: { pill: 'pending', text: 'NOT RUN' },
};

/**
 * @param {Array<{key, label, chainLabel, hash?, verifiedBy: string[]}>} components
 * @param {{compact?: boolean, showHash?: boolean}} [opts]
 */
export function createIntegrityChain(components, { compact = false, showHash = true } = {}) {
  const root = el('div', { class: `custody${compact ? ' compact' : ''}`, role: 'list', 'aria-label': 'Experiment chain of custody' });
  const nodes = new Map();

  for (const c of components) {
    const pill = el('span', { class: 'pill pending' }, STATE_UI.record.text);
    const hashSpan = showHash && c.hash ? el('span', { class: 'hash mono' }, shortHash(c.hash, 20)) : null;
    const expand =
      hashSpan &&
      el(
        'button',
        {
          class: 'expand',
          'aria-label': `Show full ${c.chainLabel} hash`,
          onclick: () => {
            hashSpan.textContent = hashSpan.textContent.endsWith('…') ? c.hash : shortHash(c.hash, 20);
          },
        },
        'expand'
      );
    const cap = compact
      ? null
      : el(
          'div',
          { class: 'custody-cap' },
          c.verifiedBy && c.verifiedBy.length
            ? `checked by: ${c.verifiedBy.join(' · ')}`
            : 'no independent check exists — this hash is recorded, not verified'
        );
    const row = el('div', { class: 'custody-node', role: 'listitem', 'data-key': c.key, 'data-state': 'record' }, [
      el('div', { class: 'rail' }, el('span', { class: 'pip' })),
      el('div', { class: 'custody-body' }, [
        el('div', { class: 'custody-top' }, [el('span', { class: 'label' }, c.chainLabel), hashSpan, expand, pill]),
        cap,
      ]),
    ]);
    root.appendChild(row);
    nodes.set(c.key, { row, pill });
  }

  function setState(key, state, { animate = true } = {}) {
    const n = nodes.get(key);
    const ui = STATE_UI[state];
    if (!n || !ui) return;
    n.row.setAttribute('data-state', state);
    n.pill.className = `pill ${ui.pill}`;
    n.pill.textContent = ui.text;
    if (animate && (state === 'pass' || state === 'fail')) settle(n.pill);
  }

  return {
    el: root,
    keys: components.map((c) => c.key),
    setState,
    setAllChecking() { for (const k of nodes.keys()) setState(k, 'checking', { animate: false }); },
    reset() { for (const k of nodes.keys()) setState(k, 'record', { animate: false }); },
  };
}
