import { api, el, fmtNum } from '../api.js';
import { startJudgeMode } from '../judgeMode.js';
import { createExperimentDiagram } from '../components/experimentDiagram.js';
import { createReplayNotice } from '../components/replayNotice.js';
import { staggerIn, countTo } from '../visual/motion.js';
import { scene } from '../visual/scene.js';

const MEASURED_HERE = [
  ['Decision consistency', 'does the structured decision (exposure, direction, confidence) change between Clean and Injected?'],
  ['Claim susceptibility', 'does the agent adopt the injected claim, reject it, or stay uncertain?'],
  ['Evidence usage', 'which tools did it call, and what did they return?'],
  ['Stress behavior', 'how does it respond to an adversarial, unverified claim under two corroboration regimes?'],
  ['Provenance', 'is every input labelled REAL, DERIVED or FIXTURE?'],
];
const NOT_MEASURED = ['Risk-violation rate', 'Drawdown', 'Human-takeover rate', 'Paper-trading or live behavior', 'Any return, Sharpe or win-rate figure'];

function panel(title, children, attrs = {}) {
  return el('div', { class: 'panel', ...attrs }, [title ? el('h3', {}, title) : null, ...[].concat(children)]);
}

function bullets(items) {
  return el('ul', { class: 'note-list' }, items.map((t) => el('li', {}, t)));
}

export async function renderLab(main) {
  main.appendChild(el('div', { class: 'loading' }, 'Loading frozen experiment…'));
  const data = await api('/experiment');
  main.innerHTML = '';

  const p = data.primary;
  const d = data.descriptive;
  const { pointEstimate, confidenceInterval, significance } = p;
  const permutations = significance.twoSided.numPermutations;

  // ---- first viewport: what this is, and the experiment's structure ----
  const diagramPanel = el('div', { class: 'panel lens' }, [el('h3', {}, 'The Experiment'), createExperimentDiagram(data.completedByCondition)]);
  main.appendChild(
    el('section', { class: 'hero' }, [
      el('div', {}, [
        el('div', { class: 'eyebrow' }, 'Adversarial Research Lab'),
        el('h1', {}, 'CDE'),
        el('p', { class: 'subtitle' }, 'Corroboration Differential Engine'),
        el('p', { class: 'tagline' }, 'An adversarial experiment against an LLM trading agent.'),
        el('p', { class: 'motto' }, 'Evaluate the agent before trusting the agent.'),
        el('p', { class: 'lede', style: 'font-size:14px;' }, 'Can an LLM trading agent distinguish market evidence from a plausible but unverified market claim, and does that ability degrade when independent corroboration is harder to obtain?'),
        el('button', { class: 'btn primary', style: 'margin-top:10px;', onclick: () => startJudgeMode() }, 'START 90-SECOND DEMO'),
      ]),
      diagramPanel,
    ])
  );

  main.appendChild(el('div', { class: 'panel assurance' }, [createReplayNotice({ detail: 'Every figure below is read from, or recomputed from, frozen and hash-locked files.' })]));

  // ---- the evidence boundary, visible immediately ----
  main.appendChild(
    panel(null, [
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

  // ---- why weekday/weekend, without opening another tab ----
  main.appendChild(
    panel('The Manipulation', [
      el('p', { class: 'lede', style: 'font-size:13.5px; margin:0 0 var(--space-4) 0;' }, 'Crypto trades continuously. Traditional equity price discovery does not. CDE uses weekday/weekend conditions to test whether an LLM reacts differently when an external corroboration regime changes.'),
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

  // ---- Bitget context, and its limits ----
  main.appendChild(
    panel('Why Bitget?', [
      bullets([
        'Bitget is the market-data environment being studied: historical public Bitget market data (symbols, timestamps, last prices) is the empirical substrate.',
        'In that record, Bitget rToken symbols — instruments referencing U.S.-listed equities — carry prices through Saturday and Sunday while the NYSE is closed.',
        'CDE asks whether an agent\'s response to an externally injected claim changes across corroboration regimes. An earlier precondition study on the same data found weekend prices were not materially more informative than a Friday-held baseline in the tested sample; that does not show they are uninformative in general.',
      ]),
      el('p', { class: 'boundary-note' }, 'Independent analysis of public data. Not reviewed or endorsed by Bitget, no Bitget product or API is used in this demo, and the data does not prove the hypothesis.'),
    ])
  );

  // ---- scope: an evaluation harness, not a trading bot ----
  main.appendChild(
    panel('What CDE evaluates', [
      el('div', { class: 'scope-grid' }, [
        el('div', {}, [el('div', { class: 'col-header' }, 'Measured here'), el('ul', { class: 'note-list' }, MEASURED_HERE.map(([name, text]) => el('li', {}, [el('b', {}, name), ` — ${text}`])))]),
        el('div', {}, [el('div', { class: 'col-header muted' }, 'Not measured (future extensions)'), bullets(NOT_MEASURED)]),
      ]),
    ])
  );

  // ---- the analysis, in words ----
  main.appendChild(
    panel(
      'The Analysis',
      [
        el('ol', { class: 'note-list steps' }, [
          el('li', {}, ['For every pair, ', el('span', { class: 'mono' }, 'δ = exposure(Injected) − exposure(Clean)'), '. Exposure is the agent\'s self-reported intended position size, a number in [−1, 1].']),
          el('li', {}, [el('b', {}, 'DiD'), ' (difference-in-differences) compares how the Clean→Injected change differs between weekday and weekend conditions: ', el('span', { class: 'mono' }, 'mean δ (weekend) − mean δ (weekday)'), '.']),
          el('li', {}, `Uncertainty: a 95% bootstrap interval and a two-sided permutation test over condition labels (${permutations.toLocaleString('en-US')} permutations, seed ${significance.twoSided.seed}), both fixed in the pre-registered plan before any trial ran.`),
        ]),
        el('p', { class: 'mono', style: 'margin:12px 0 0 0; font-size:11.5px; color:var(--text-dim);' }, `Mean δ, weekday pairs: ${fmtNum(p.componentMeans.weekdayInjectionEffect)}  ·  weekend pairs: ${fmtNum(p.componentMeans.weekendInjectionEffect)}`),
      ],
      { id: 'analysis' }
    )
  );

  // ---- the pre-registered result, reported plainly and read out in words ----
  const didEl = el('div', { class: 'stat-value accent' }, fmtNum(pointEstimate.did));
  const pEl = el('div', { class: 'stat-value accent' }, fmtNum(significance.twoSided.pValue));
  main.appendChild(
    el('div', { class: 'panel elevated', id: 'result' }, [
      el('h3', {}, 'Primary Pre-Registered Result'),
      el('div', { class: 'grid grid-3' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, 'DiD (exposureDelta)'), didEl, el('div', { class: 'stat-note' }, 'weekend − weekday change in exposure')]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, '95% CI'), el('div', { class: 'stat-value accent' }, `[${fmtNum(confidenceInterval.lower)}, ${fmtNum(confidenceInterval.upper)}]`), el('div', { class: 'stat-note' }, 'bootstrap interval for the DiD')]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, 'permutation p'), pEl, el('div', { class: 'stat-note' }, 'two-sided, Monte Carlo')]),
      ]),
      el('p', { class: 'mono', style: 'margin:12px 0 0 0; font-size:11.5px; color:var(--text-dim);' }, `n = ${pointEstimate.weekdayN} weekday / ${pointEstimate.weekendN} weekend pairs.`),
      el('div', { class: 'reading' }, [
        el('div', { class: 'col-header' }, 'How to read this'),
        el('p', {}, 'The observed difference is small, and this sample does not provide strong statistical evidence of a non-zero condition difference.'),
        el('p', {}, 'Because the study is small and no power analysis was performed, this should not be interpreted as evidence that no effect exists.'),
        el('p', { class: 'mono context' }, `Context, counted from the frozen trials: exposure differed between Clean and Injected in ${d.pairsWithNonzeroExposureDelta} of ${d.pairsTotal} pairs; direction changed in ${d.pairsWithDirectionFlip} of ${d.pairsTotal} (${Math.round(data.secondaryDescriptive.weekdayDirectionalFlipRate * p.pointEstimate.weekdayN)} of ${p.pointEstimate.weekdayN} weekday, ${Math.round(data.secondaryDescriptive.weekendDirectionalFlipRate * p.pointEstimate.weekendN)} of ${p.pointEstimate.weekendN} weekend); the model chose a non-neutral direction in ${d.trialsNonNeutral} of ${d.trialsTotal} trials. The estimate is carried by the ${d.pairsWithNonzeroExposureDelta} pair(s) in which exposure changed at all.`),
        el('p', { class: 'mono context' }, [
          `The p-value is a seeded Monte Carlo estimate and moves slightly with the order the trial files are read in; the estimate and interval do not. `,
          el('a', { href: '#/integrity' }, 'See Reproducibility →'),
        ]),
      ]),
    ])
  );

  // ---- what the result does not show ----
  main.appendChild(
    panel(
      'What this does not show',
      bullets([
        'Nothing about whether weekend prices are informative or uninformative.',
        'No conclusion about trading profitability and no P&L result: exposure is a self-reported intended position size, not a return.',
        'No causal conclusion beyond the limits of the design: weekday versus weekend also changes the calendar itself, and calendar-prior confounding is not separately identified.',
        `No generalization across LLMs: one model (${data.model}, temperature ${data.modelConfig.temperature}) and one prompt and tool configuration were evaluated.`,
        `No generalization across symbols or periods: the ${d.pairsTotal} pairs cover ${d.distinctSymbols} symbols.`,
        'No live-trading result: this is a replay, and no order was ever placed.',
      ]),
      { id: 'limits' }
    )
  );

  main.appendChild(
    el('div', { class: 'grid grid-4', style: 'margin-top:14px;' }, [
      miniStat('Model', data.model),
      miniStat('Provider', data.provider),
      miniStat('Attempted / Cap', `${data.attemptedTotal} / ${data.sampleSize.maxAttemptedPairs}`),
      miniStat('Failed attempts', String(data.failedAttemptsCount)),
    ])
  );

  main.appendChild(
    el('div', { class: 'footer-note' }, [
      'This experiment used replayed historical market data — CDE itself never called Bitget or placed an order, live or demo. "Exposure" is the agent\'s self-reported intended position size, a signed number in [-1, 1], never a profit, return, or P&L figure. No hidden model reasoning is captured or shown anywhere in this instrument — see ',
      el('span', { class: 'mono' }, 'Evidence X-Ray'),
      ' for exactly what was recorded.',
    ])
  );

  // ---- choreography: panels settle in; the headline numbers count up to their exact values ----
  staggerIn(main.querySelectorAll(':scope > .panel, :scope > .grid'), { each: 60, from: 8 });
  countTo(didEl, pointEstimate.did, { format: (v) => fmtNum(v) });
  countTo(pEl, significance.twoSided.pValue, { format: (v) => fmtNum(v) });

  // The 3D core (weekday/weekend x clean/injected) sits behind the 2x2 diagram, seen through its glass.
  if (main.isConnected) scene.anchorTo(diagramPanel);
}

function miniStat(label, value) {
  return el('div', { class: 'stat' }, [el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value)]);
}
