import { api, el, fmtNum } from '../api.js';
import { startJudgeMode } from '../judgeMode.js';
import { createExperimentDiagram } from '../components/experimentDiagram.js';
import { staggerIn, countTo } from '../visual/motion.js';
import { scene } from '../visual/scene.js';

export async function renderLab(main) {
  main.appendChild(el('div', { class: 'loading' }, 'Loading frozen experiment…'));
  const data = await api('/experiment');
  main.innerHTML = '';

  // ---- first viewport: what this is, and the experiment's structure ----
  const diagramPanel = el('div', { class: 'panel lens' }, [el('h3', {}, 'The Experiment'), createExperimentDiagram(data.completedByCondition)]);
  main.appendChild(
    el('section', { class: 'hero' }, [
      el('div', {}, [
        el('div', { class: 'eyebrow' }, 'Adversarial Research Lab'),
        el('h1', {}, 'CDE'),
        el('p', { class: 'subtitle' }, 'Corroboration Differential Engine'),
        el('p', { class: 'tagline' }, 'An adversarial experiment against an LLM trading agent.'),
        el('p', { class: 'lede', style: 'font-size:14px;' }, 'Can an LLM trading agent distinguish market evidence from a plausible but unverified market claim, and does that ability degrade when independent corroboration is harder to obtain?'),
        el('button', { class: 'btn primary', style: 'margin-top:10px;', onclick: () => startJudgeMode() }, 'START 90-SECOND DEMO'),
      ]),
      diagramPanel,
    ])
  );

  // ---- the evidence boundary, visible immediately ----
  main.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'evidence-row' }, [
        el('span', { class: 'badge confirmatory' }, `${data.completedPairs} PAIRED OBSERVATIONS`),
        el('span', { class: 'badge confirmatory' }, `${data.completedByCondition.weekday} WEEKDAY`),
        el('span', { class: 'badge confirmatory' }, `${data.completedByCondition.weekend} WEEKEND`),
        el('span', { class: 'badge confirmatory' }, 'PRE-REGISTERED'),
        el('span', { class: 'badge confirmatory' }, 'HASH-LOCKED'),
        el('span', { class: 'badge replay' }, 'REPLAY-ONLY'),
        el('span', { class: 'badge real' }, 'REAL HISTORICAL PRICE'),
        el('span', { class: 'badge derived' }, 'DERIVED MARKET FIELDS'),
      ]),
      el('p', { class: 'mono', style: 'margin:10px 0 0 0; font-size:11px; color:var(--text-faint);' }, 'REAL = symbol, timestamp and price taken from the historical record. DERIVED = order book, volume and candles are replay scaffolding, not observed history.'),
    ])
  );

  // ---- what the weekday/weekend manipulation is, without opening another tab ----
  main.appendChild(
    el('div', { class: 'panel' }, [
      el('h3', {}, 'The Manipulation'),
      el('div', { class: 'manip' }, [
        el('div', {}, [
          el('div', { class: 'cond weekday' }, 'Weekday · NYSE open'),
          el('p', {}, 'The normal U.S. equity price-discovery session is available, so independent evidence about the claimed activity can exist.'),
        ]),
        el('div', {}, [
          el('div', { class: 'cond weekend' }, 'Weekend · NYSE closed'),
          el('p', {}, 'That normal independent price-discovery session is unavailable, so the same claim is harder to check against outside evidence.'),
        ]),
      ]),
      el('p', { class: 'manip-note' }, 'This is a corroboration-availability manipulation, not a claim that weekend prices contain no information.'),
    ])
  );

  // ---- the pre-registered result, reported plainly ----
  const p = data.primary;
  const didEl = el('div', { class: 'stat-value accent' }, fmtNum(p.pointEstimate.did));
  const ciEl = el('div', { class: 'stat-value accent' }, `[${fmtNum(p.confidenceInterval.lower)}, ${fmtNum(p.confidenceInterval.upper)}]`);
  const pEl = el('div', { class: 'stat-value accent' }, fmtNum(p.significance.twoSided.pValue));
  main.appendChild(
    el('div', { class: 'panel elevated' }, [
      el('h3', {}, 'Primary Pre-Registered Result'),
      el('div', { class: 'grid grid-3' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, 'DiD (exposureDelta)'), didEl]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, '95% CI'), ciEl]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, 'permutation p'), pEl]),
      ]),
      el('p', { class: 'lede', style: 'margin-top:14px; font-size:12.5px;' }, [
        el('span', { class: 'mono' }, `n = ${p.pointEstimate.weekdayN} weekday / ${p.pointEstimate.weekendN} weekend. `),
        'Reported plainly, without a significance verdict — see the Integrity Console for how this result was locked before collection began.',
      ]),
      el('p', { class: 'mono', style: 'margin:10px 0 0 0; font-size:11.5px; color:var(--text-dim);' },
        `Context (counts from the frozen trials): exposure differed between clean and injected in ${data.descriptive.pairsWithNonzeroExposureDelta} of ${data.descriptive.pairsTotal} pairs; the model chose a non-neutral direction in ${data.descriptive.trialsNonNeutral} of ${data.descriptive.trialsTotal} trials.`),
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
      'This experiment used replayed historical market data, never live Bitget or demo trading — no order was ever placed. "Exposure" is the agent\'s self-reported intended position size, a signed number in [-1, 1], never a profit, return, or P&L figure. No hidden model reasoning is captured or shown anywhere in this instrument — see ',
      el('span', { class: 'mono' }, 'Evidence X-Ray'),
      ' for exactly what was recorded.',
    ])
  );

  // ---- choreography: panels settle in; the three headline numbers count up to their exact values ----
  staggerIn(main.querySelectorAll(':scope > .panel, :scope > .grid'), { each: 60, from: 8 });
  countTo(didEl, p.pointEstimate.did, { format: (v) => fmtNum(v) });
  countTo(pEl, p.significance.twoSided.pValue, { format: (v) => fmtNum(v) });

  // The 3D core (weekday/weekend x clean/injected) sits behind the 2x2 diagram, seen through its glass.
  if (main.isConnected) scene.anchorTo(diagramPanel);
}

function miniStat(label, value) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value)]);
}
