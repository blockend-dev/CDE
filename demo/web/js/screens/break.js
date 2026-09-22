import { api, el } from '../api.js';
import { createIntegrityChain } from '../components/integrityChain.js';
import { scene } from '../visual/scene.js';
import { staggerIn, prefersReducedMotion } from '../visual/motion.js';

const BREAK_STEP_MS = 320; // matches the 3D rail's per-node cadence in scene.showBreak

export async function renderBreak(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Break the Experiment'));
  main.appendChild(el('h1', {}, 'Try to break it.'));
  main.appendChild(
    el('p', { class: 'lede' }, 'Each attack below mutates a throwaway copy of the run directory — never the canonical dataset — and then runs the real integrity engine against it. The canonical directory\'s hash is checked before and after every attack.')
  );

  main.appendChild(el('div', { class: 'loading' }, 'Loading attack presets…'));
  const { scenarios } = await api('/tamper/scenarios');
  main.querySelector('.loading').remove();

  const grid = el('div', { class: 'grid grid-3' });
  const resultBox = el('div', { style: 'margin-top:18px;' });
  let sequenceTimers = [];
  const clearSequence = () => { sequenceTimers.forEach(clearTimeout); sequenceTimers = []; };

  for (const s of scenarios) {
    const card = el('div', { class: 'panel', 'data-scenario-key': s.key }, [
      el('h3', {}, s.label),
      el('div', { class: 'mono', style: 'font-size:11px; color:var(--text-faint); margin-bottom:12px;' }, `expected: ${s.expected}`),
      el('button', { class: 'btn danger', 'data-scenario-key': s.key, onclick: () => runAttack(s.key, card) }, 'RUN ATTACK'),
    ]);
    grid.appendChild(card);
  }
  main.appendChild(grid);
  main.appendChild(resultBox);
  staggerIn(grid.children, { each: 60, from: 8 });
  scene.setMode('break');

  async function runAttack(key, card) {
    clearSequence();
    const btn = card.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'ATTACKING…';
    resultBox.innerHTML = '';
    resultBox.appendChild(el('div', { class: 'loading' }, `Running "${key}" against a disposable copy…`));
    scene.beginVerify(); // the verifier is executing: hold the field still and scan the chain
    try {
      const result = await api(`/tamper/${key}`, { method: 'POST' });
      if (!resultBox.isConnected) return;
      resultBox.innerHTML = '';
      const panel = renderResult(result);
      resultBox.appendChild(panel);
      staggerIn([panel], { from: 8 });
      playBreak(panel, result);
      scene.showBreak(result.components);
    } catch (err) {
      scene.setMode('break');
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'error-box' }, `Attack runner crashed: ${err.message}`));
    }
    btn.disabled = false;
    btn.textContent = 'RUN ATTACK';
  }

  /** Resolve the compact chain from the real per-component result: pass ... pass, then the break, then the rest. */
  function playBreak(panel, result) {
    const chain = panel.__chain;
    const comps = result.components;
    const firstFail = comps.findIndex((c) => c.status === 'fail');
    const stopAt = firstFail >= 0 ? firstFail : comps.length - 1;
    const apply = (i) => { if (panel.isConnected) chain.setState(comps[i].key, comps[i].status); };
    if (prefersReducedMotion()) { comps.forEach((_, i) => apply(i)); return; }
    for (let i = 0; i <= stopAt; i++) sequenceTimers.push(setTimeout(() => apply(i), i * BREAK_STEP_MS));
    sequenceTimers.push(setTimeout(() => { for (let i = stopAt + 1; i < comps.length; i++) apply(i); }, (stopAt + 1) * BREAK_STEP_MS + 120));
  }
}

function renderResult(result) {
  const panel = el('div', { class: 'panel elevated' }, [
    el('div', { style: 'display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap;' }, [
      el('span', { class: 'badge disposable' }, 'MUTATED A DISPOSABLE COPY'),
      el('span', { style: 'color:var(--text-faint);' }, '— the canonical dataset was never opened for writing.'),
    ]),
    el('h3', {}, result.label),
    el('p', { style: 'font-size:12.5px; color:var(--text-dim); margin-bottom:14px;' }, result.mutationDescription),
    el('div', { style: 'display:flex; align-items:center; gap:14px; font-family:var(--mono); font-size:13px; flex-wrap:wrap;' }, [
      el('span', { class: 'pill pass' }, 'CANONICAL: PASS'),
      el('span', { style: 'color:var(--text-faint);' }, '→'),
      el('span', { class: `pill ${result.preflightPassed ? 'pass' : 'fail'}` }, `MUTATED COPY: ${result.preflightPassed ? 'PASS' : 'FAIL'}`),
    ]),
  ]);

  // Chain of custody for the mutated copy, resolved from what the verifier actually reported.
  panel.appendChild(el('div', { class: 'divider' }));
  panel.appendChild(el('h3', {}, 'Chain of custody — mutated copy'));
  const chain = createIntegrityChain(result.components.map((c) => ({ key: c.key, chainLabel: c.label, verifiedBy: c.verifiedBy })), { compact: true, showHash: false });
  panel.__chain = chain;
  panel.appendChild(chain.el);

  if (result.preflightPassed) {
    panel.appendChild(el('div', { class: 'divider' }));
    panel.appendChild(el('p', { style: 'font-size:12.5px; color:var(--claim);' }, 'This mutation did not trip any integrity check — worth investigating rather than hiding.'));
  }

  if (!result.preflightPassed) {
    panel.appendChild(el('div', { class: 'divider' }));
    panel.appendChild(el('h3', {}, 'Invariant(s) that caught it'));
    const list = el('div', { class: 'check-list' });
    result.failedChecks.forEach((c) => {
      list.appendChild(
        el('div', { class: 'check-row fail' }, [
          el('span', { class: 'status' }, 'FAIL'),
          el('span', { class: 'name' }, c.name),
          c.detail ? el('span', { class: 'detail' }, JSON.stringify(c.detail)) : null,
        ])
      );
    });
    panel.appendChild(list);
  }

  panel.appendChild(el('div', { class: 'divider' }));
  panel.appendChild(
    el('div', { class: 'hashline' }, [
      el('span', { class: `pill ${result.canonicalDataUntouched ? 'pass' : 'fail'}` }, result.canonicalDataUntouched ? 'CANONICAL DATA: UNTOUCHED' : 'CANONICAL DATA CHANGED — INVESTIGATE'),
    ])
  );
  return panel;
}
