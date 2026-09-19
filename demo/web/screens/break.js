import { api, el } from '../api.js';

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

  async function runAttack(key, card) {
    const btn = card.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'ATTACKING…';
    resultBox.innerHTML = '';
    resultBox.appendChild(el('div', { class: 'loading' }, `Running "${key}" against a disposable copy…`));
    try {
      const result = await api(`/tamper/${key}`, { method: 'POST' });
      resultBox.innerHTML = '';
      resultBox.appendChild(renderResult(result));
    } catch (err) {
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'error-box' }, `Attack runner crashed: ${err.message}`));
    }
    btn.disabled = false;
    btn.textContent = 'RUN ATTACK';
  }
}

function renderResult(result) {
  const outcome = result.preflightPassed ? 'PASS' : 'FAIL';
  const panel = el('div', { class: 'panel' }, [
    el('div', { style: 'display:flex; align-items:center; gap:12px; margin-bottom:12px;' }, [
      el('span', { class: `pill ${result.preflightPassed ? 'pass' : 'fail'}`, style: 'font-size:14px; padding:6px 14px;' }, `PASS → ${outcome}`),
      el('span', { class: `badge disposable` }, 'DISPOSABLE COPY'),
    ]),
    el('h3', {}, result.label),
    el('p', { style: 'font-size:12.5px; color:var(--text-dim);' }, result.mutationDescription),
  ]);

  if (!result.preflightPassed) {
    panel.appendChild(el('div', { class: 'divider' }));
    panel.appendChild(el('h3', {}, 'Invariant(s) that caught it'));
    const list = el('div', { class: 'check-list' });
    result.failedChecks.forEach((c, i) => {
      list.appendChild(
        el('div', { class: 'check-row fail', style: `animation-delay:${i * 60}ms` }, [
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
