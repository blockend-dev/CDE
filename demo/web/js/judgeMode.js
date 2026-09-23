import { el, api } from './api.js';
import { createReplayNotice } from './components/replayNotice.js';
import { slideUp, swapText, prefersReducedMotion } from './visual/motion.js';

/**
 * Judge Mode — a scripted 60-90s walkthrough that navigates through the
 * REAL screens and triggers REAL server operations (the live integrity
 * verification, the input-order re-run, a real tamper attack). Reading pauses
 * between steps are honest pacing for a human to read an already-rendered
 * real screen — never a disguised delay standing in for fake computation.
 * Interrupting navigation (clicking anything else) stops the script
 * immediately.
 *
 * The script is grouped into eight numbered stages so a judge always knows
 * where they are in the argument: what the agent saw, what it was told, what
 * it did, how the clean and injected runs differ, how the result is computed,
 * what it says, and whether it can be trusted.
 */

const STAGES = ['Market state', 'Claim', 'Agent response', 'Evidence X-Ray', 'Clean vs Injected', 'Analysis', 'Result', 'Reproducibility'];

let active = false;
let scriptNavigating = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, intervalMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

function scrollToSelector(selector) {
  return async () => {
    const node = await waitFor(() => document.querySelector(selector), 6000);
    if (node) node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };
}

function clickButton(text) {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  if (btn) btn.click();
  return !!btn;
}

async function pickInterestingPair() {
  try {
    const { pairs } = await api('/pairs?changed=true');
    if (pairs.length > 0) {
      pairs.sort((a, b) => Math.abs(b.exposureDelta) - Math.abs(a.exposureDelta) || Math.abs(b.confidenceDelta) - Math.abs(a.confidenceDelta));
      return pairs[0].pairingKey;
    }
  } catch (_) {}
  const { pairs: all } = await api('/pairs');
  return all[0].pairingKey;
}

const pad = (n) => String(n).padStart(2, '0');

function buildBar(state) {
  // Styling lives in css/main.css (#judge-bar) and css/glass.css so the bar is part of the glass system.
  const bar = el('div', { id: 'judge-bar', role: 'status', 'aria-live': 'polite' });
  const rail = el(
    'ol',
    { class: 'judge-stages', 'aria-label': 'Walkthrough stages' },
    STAGES.map((name, i) => el('li', { class: 'judge-stage', 'data-stage': String(i + 1) }, [el('span', { class: 'n' }, pad(i + 1)), el('span', { class: 't' }, name)]))
  );
  const exitBtn = el('button', { class: 'btn ghost', onclick: () => stopJudgeMode() }, 'EXIT — EXPLORE MANUALLY');
  const line = el('div', { class: 'judge-line' }, [
    el('div', { class: 'judge-step' }, `STEP ${state.i + 1}/${state.total}`),
    el('div', { id: 'judge-text', class: 'judge-text' }, state.currentLabel || ''),
  ]);
  bar.appendChild(el('div', { class: 'judge-head' }, [rail, exitBtn]));
  bar.appendChild(line);
  bar.appendChild(createReplayNotice());
  return bar;
}

function updateBar(i, total, step) {
  const stepLabel = document.querySelector('#judge-bar .judge-step');
  const text = document.getElementById('judge-text');
  if (stepLabel) stepLabel.textContent = `STEP ${i + 1}/${total}`;
  if (text) swapText(text, step.label);
  document.querySelectorAll('#judge-bar .judge-stage').forEach((node) => {
    const n = Number(node.dataset.stage);
    node.classList.toggle('active', n === step.stage);
    node.classList.toggle('done', n < step.stage);
    if (n === step.stage) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  });
}

function removeBar() {
  const bar = document.getElementById('judge-bar');
  if (bar) bar.remove();
}

export function stopJudgeMode() {
  active = false;
  removeBar();
}

export async function startJudgeMode() {
  if (active) return;
  active = true;
  const k = await pickInterestingPair();

  const steps = [
    {
      stage: 1,
      label: 'Market state — symbol, timestamp and last price are real historical values. Order book, volume and candles are derived replay scaffolding.',
      hash: `#/pair/${k}/chain`,
      afterNav: scrollToSelector('.chain-node[data-stage="market"]'),
      waitMs: 5500,
    },
    {
      stage: 1,
      label: 'Provenance — every field is labelled REAL, DERIVED or FIXTURE, so observed data is never confused with scaffolding.',
      hash: `#/pair/${k}/provenance`,
      waitMs: 5000,
    },
    {
      stage: 2,
      label: 'The claim — a locked fixture, shown only in the Injected trial. It is not verified true or false.',
      hash: `#/pair/${k}/chain`,
      afterNav: scrollToSelector('.chain-node[data-stage="claim"]'),
      waitMs: 5000,
    },
    {
      stage: 3,
      label: 'Agent response — what the tools returned when the agent checked the claim, then its own recorded assessment, confidence, direction and exposure.',
      hash: `#/pair/${k}/chain`,
      afterNav: scrollToSelector('.chain-node[data-stage="belief"]'),
      waitMs: 6000,
    },
    {
      stage: 4,
      label: 'Evidence X-Ray — every tool call and returned field, exactly as recorded. No hidden reasoning is captured or shown.',
      hash: `#/pair/${k}/xray`,
      waitMs: 6000,
    },
    {
      stage: 5,
      label: 'Clean vs Injected — same snapshot, same tools, same model configuration; the only difference is whether a claim was presented. Only fields that actually differ are shown.',
      hash: `#/pair/${k}/counterfactual`,
      afterNav: scrollToSelector('.no-change, .diff-row'),
      waitMs: 6500,
    },
    {
      stage: 5,
      label: 'Claim-blind control — a deterministic baseline that cannot see the claim, so its Clean and Injected outputs are identical by construction.',
      hash: `#/pair/${k}/baseline`,
      waitMs: 5000,
    },
    {
      stage: 6,
      label: 'Analysis — DiD compares how the Clean→Injected change differs between weekday and weekend, with a bootstrap interval and a permutation test fixed before any trial ran.',
      hash: '#/lab',
      afterNav: scrollToSelector('#analysis'),
      waitMs: 6000,
    },
    {
      stage: 7,
      label: 'Result — the estimate, its interval and the p-value, with a plain-language reading. Weak statistical evidence of a difference is not evidence that no effect exists.',
      hash: '#/lab',
      afterNav: scrollToSelector('#result'),
      waitMs: 7000,
    },
    {
      stage: 8,
      label: 'Reproducibility — verifying right now: a real re-run of the preflight engine and the locked analysis, not an animation.',
      hash: '#/integrity',
      action: async () => {
        await sleep(500);
        clickButton('VERIFY EXPERIMENT');
        await waitFor(() => document.querySelector('.check-list'), 60000);
      },
      waitMs: 1500,
    },
    {
      stage: 8,
      label: 'Reproducibility — the same analysis re-run under different trial-file orders. The estimate and interval never move; the Monte Carlo p-value moves by about its sampling error.',
      hash: '#/integrity',
      action: async () => {
        await scrollToSelector('#order-sensitivity')();
        clickButton('RE-RUN UNDER DIFFERENT INPUT ORDERS');
        await waitFor(() => document.querySelector('.order-table'), 60000);
      },
      waitMs: 4500,
    },
    {
      stage: 8,
      label: 'Attempting to break the experiment — mutating a disposable copy and watching the real integrity engine catch it.',
      hash: '#/break',
      action: async () => {
        await sleep(500);
        const btn = document.querySelector('button[data-scenario-key="modify-trial"]');
        if (btn) btn.click();
        await waitFor(() => document.querySelector('.pill.fail, .pill.pass'), 15000);
      },
      waitMs: 3500,
    },
  ];

  const bar = buildBar({ i: 0, total: steps.length, currentLabel: steps[0].label });
  document.body.appendChild(bar);
  slideUp(bar);

  for (let i = 0; i < steps.length; i++) {
    if (!active) return;
    const step = steps[i];
    updateBar(i, steps.length, step);
    if (location.hash !== step.hash) {
      scriptNavigating = true;
      location.hash = step.hash;
      await sleep(60); // give the hashchange event (and its listener below) time to fire first
      scriptNavigating = false;
    }
    await sleep(250); // let the real screen render before narrating/acting on it
    if (!active) return;
    if (step.afterNav) await step.afterNav();
    if (!active) return;
    if (step.action) await step.action();
    if (!active) return;
    await sleep(step.waitMs);
  }

  if (active) stopJudgeMode();
}

// Any manual navigation not issued by the script itself (e.g. the judge
// clicking a sidenav link mid-walkthrough) stops the script immediately
// rather than fighting the user for control of the URL.
window.addEventListener('hashchange', () => {
  if (active && !scriptNavigating) stopJudgeMode();
});
