import { api, el, clickable, fmtNum } from '../api.js';
import { staggerIn } from '../visual/motion.js';

const FILTER_DEFS = [
  { key: 'condition', label: 'Condition', options: ['', 'weekday', 'weekend'] },
  { key: 'claimTemplate', label: 'Claim Category', options: ['', 'unusual_accumulation', 'unusual_distribution', 'unscheduled_analyst_action'] },
  { key: 'direction', label: 'Injected Direction', options: ['', 'long', 'short', 'neutral'] },
  { key: 'changed', label: 'Structured Change', options: ['', 'true', 'false'], labels: { true: 'changed', false: 'no change' } },
  { key: 'claimAssessment', label: 'Claim Assessment', options: ['', 'accepted', 'rejected', 'uncertain'] },
];

export async function renderCaseFiles(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Replay Case Files'));
  main.appendChild(el('h1', {}, 'All 41 Completed Pairs'));
  main.appendChild(el('p', { class: 'lede' }, 'Every card is a forensic case file: one frozen snapshot, replayed clean and injected. Filter by regime, claim category, or outcome — this is the full confirmatory dataset, nothing exploratory is mixed in.'));

  const filterBar = el('div', { class: 'panel', style: 'display:flex; gap:14px; flex-wrap:wrap; margin:16px 0;' });
  const state = {};
  for (const f of FILTER_DEFS) {
    const select = el(
      'select',
      {
        style: 'background:var(--bg-raised); color:var(--text); border:1px solid var(--border); border-radius:3px; padding:6px 8px; font-family:var(--mono); font-size:11.5px;',
        onchange: (e) => {
          state[f.key] = e.target.value;
          refresh();
        },
      },
      f.options.map((o) => el('option', { value: o }, o === '' ? `${f.label}: any` : f.labels && f.labels[o] ? f.labels[o] : o))
    );
    filterBar.appendChild(el('div', {}, [el('div', { class: 'stat-label' }, f.label), select]));
  }
  main.appendChild(filterBar);

  const countLine = el('div', { class: 'mono', style: 'font-size:11px; color:var(--text-faint); margin-bottom:10px;' });
  main.appendChild(countLine);
  const grid = el('div', { class: 'grid grid-3' });
  main.appendChild(grid);

  async function refresh() {
    grid.innerHTML = '';
    countLine.textContent = 'Loading…';
    const query = Object.fromEntries(Object.entries(state).filter(([, v]) => v));
    const qs = new URLSearchParams(query).toString();
    const { count, pairs } = await api(`/pairs${qs ? `?${qs}` : ''}`);
    countLine.textContent = `${count} of 41 pairs match`;
    if (count === 0) {
      grid.appendChild(el('div', { class: 'empty-state', style: 'grid-column: 1 / -1;' }, 'No pairs match this filter combination. Loosen a filter above — this is the full 41-pair confirmatory dataset, nothing is hidden.'));
      return;
    }
    for (const p of pairs) grid.appendChild(card(p));
    staggerIn(grid.children, { each: 16, from: 6, duration: 220 });
  }

  await refresh();
}

function card(p) {
  return clickable(
    'div',
    { class: 'case-card', 'aria-label': `${p.symbol}, ${p.condition}, open counterfactual replay`, onclick: () => (location.hash = `#/pair/${p.pairingKey}/counterfactual`) },
    [
      el('div', { class: 'case-card-top' }, [
        el('span', { class: 'case-card-id mono' }, p.symbol),
        el('span', { class: `badge ${p.condition}` }, p.condition.toUpperCase()),
      ]),
      el('div', { class: 'mono', style: 'font-size:11px;color:var(--text-faint);margin-bottom:8px;' }, p.claimTemplate ? p.claimTemplate.replace(/_/g, ' ') : ''),
      el('div', { class: 'mono', style: 'font-size:12px; display:flex; justify-content:space-between;' }, [
        el('span', { style: `color:${p.structuredDecisionChanged ? 'var(--claim)' : 'var(--text-faint)'}` }, p.structuredDecisionChanged ? 'CHANGED' : 'NO CHANGE'),
        el('span', {}, `Δexp ${fmtNum(p.exposureDelta)}`),
      ]),
      el('div', { class: 'mono', style: 'font-size:11px; color:var(--text-faint); margin-top:6px;' }, `${p.injectedDirection} · ${p.injectedClaimAssessment}`),
    ]
  );
}
