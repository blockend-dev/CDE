import { api, el, fmtNum } from '../api.js';
import { startJudgeMode } from '../judgeMode.js';

export async function renderLab(main) {
  main.appendChild(el('div', { class: 'loading' }, 'Loading frozen experiment…'));
  const data = await api('/experiment');
  main.innerHTML = '';

  main.appendChild(el('div', { class: 'eyebrow' }, 'Corroboration Differential Engine'));
  main.appendChild(el('h1', {}, 'LLM Trading Agent — Adversarial Research Lab'));
  main.appendChild(
    el('p', { class: 'lede' }, 'Can an LLM trading agent distinguish market evidence from a plausible but unverified market claim, and does that ability degrade when independent corroboration is harder to obtain?')
  );

  main.appendChild(
    el('button', { class: 'btn primary', style: 'margin-top:18px;', onclick: () => startJudgeMode() }, 'START 90-SECOND DEMO')
  );

  const tags = [
    `${data.completedPairs} COMPLETED PAIRS`,
    `${data.completedByCondition.weekday} WEEKDAY`,
    `${data.completedByCondition.weekend} WEEKEND`,
    'PRE-REGISTERED',
    'HASH-LOCKED',
    'REPLAY ONLY',
  ];
  main.appendChild(el('div', { class: 'panel', style: 'margin-top:22px; display:flex; gap:8px; flex-wrap:wrap;' }, tags.map((t) => el('span', { class: 'badge confirmatory' }, t))));

  const p = data.primary;
  main.appendChild(
    el('div', { class: 'panel', style: 'margin-top:14px;' }, [
      el('h3', {}, 'Primary Pre-Registered Result'),
      el('div', { class: 'grid grid-3' }, [
        stat('DiD (exposureDelta)', fmtNum(p.pointEstimate.did)),
        stat('95% CI', `[${fmtNum(p.confidenceInterval.lower)}, ${fmtNum(p.confidenceInterval.upper)}]`),
        stat('permutation p', fmtNum(p.significance.twoSided.pValue)),
      ]),
      el('p', { class: 'lede', style: 'margin-top:14px; font-size:12.5px;' }, [
        el('span', { class: 'mono' }, `n = ${p.pointEstimate.weekdayN} weekday / ${p.pointEstimate.weekendN} weekend. `),
        'Reported plainly, without a significance verdict — see the Integrity Console for how this result was locked before collection began.',
      ]),
    ])
  );

  main.appendChild(
    el('div', { class: 'grid grid-4', style: 'margin-top:14px;' }, [
      miniStat('Model', data.model),
      miniStat('Provider', data.provider),
      miniStat('Attempted / Cap', `${data.attemptedTotal} / 120`),
      miniStat('Failed attempts', String(data.failedAttemptsCount)),
    ])
  );

  main.appendChild(
    el('div', { class: 'footer-note' }, [
      'This experiment used replayed historical market data, never live Bitget or demo trading. No hidden model reasoning is captured or shown anywhere in this instrument — see ',
      el('span', { class: 'mono' }, 'Evidence X-Ray'),
      ' for exactly what was recorded.',
    ])
  );
}

function stat(label, value) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value accent' }, value)]);
}

function miniStat(label, value) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value)]);
}
