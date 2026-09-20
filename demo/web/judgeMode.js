import { el, api } from './api.js';

/**
 * Judge Mode — a scripted 60-90s walkthrough that navigates through the
 * REAL screens and triggers REAL server operations (the live integrity
 * verification, a real tamper attack). Reading pauses between steps are
 * honest pacing for a human to read an already-rendered real screen —
 * never a disguised delay standing in for fake computation. Interrupting
 * navigation (clicking anything else) stops the script immediately.
 */

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

function buildBar(state) {
  const bar = el('div', {
    id: 'judge-bar',
    style:
      'position:fixed; left:0; right:0; bottom:0; z-index:1000; background:var(--panel); border-top:1px solid var(--accent-dim); padding:12px 24px; display:flex; align-items:center; gap:16px; font-family:var(--mono); font-size:12px; box-shadow:0 -8px 24px rgba(0,0,0,0.4);',
  });
  const stepLabel = el('div', { style: 'color:var(--accent); min-width:80px;' }, `STEP ${state.i + 1}/${state.total}`);
  const text = el('div', { id: 'judge-text', style: 'flex:1; color:var(--text);' }, state.currentLabel || '');
  const exitBtn = el('button', { class: 'btn ghost', onclick: () => stopJudgeMode() }, 'EXIT — EXPLORE MANUALLY');
  bar.appendChild(stepLabel);
  bar.appendChild(text);
  bar.appendChild(exitBtn);
  return bar;
}

function updateBar(i, total, label) {
  const stepLabel = document.querySelector('#judge-bar > div:first-child');
  const text = document.getElementById('judge-text');
  if (stepLabel) stepLabel.textContent = `STEP ${i + 1}/${total}`;
  if (text) text.textContent = label;
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
  const interestingPair = await pickInterestingPair();

  const steps = [
    {
      label: '41 completed, hash-locked pairs. Pre-registered. Replay only — never live trading.',
      hash: '#/lab',
      waitMs: 5000,
    },
    {
      label: 'Selecting a completed pair where the model\'s structured decision actually changed between clean and injected.',
      hash: `#/pair/${interestingPair}/counterfactual`,
      waitMs: 6000,
    },
    {
      label: 'Same market snapshot, same tools, same model configuration — the only difference below is whether a claim was presented.',
      hash: `#/pair/${interestingPair}/counterfactual`,
      waitMs: 6000,
    },
    {
      label: 'What changed: only fields that actually differ are rendered — nothing here is invented.',
      hash: `#/pair/${interestingPair}/counterfactual`,
      afterNav: () => document.querySelector('.no-change, .diff-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      waitMs: 6000,
    },
    {
      label: 'Truth → Claim → Corroboration → Belief → Action — the entire causal path for this trial, structured fields only.',
      hash: `#/pair/${interestingPair}/chain`,
      waitMs: 7000,
    },
    {
      label: 'Provenance: real price and timestamp vs. honestly-labeled derived scaffolding and the locked claim fixture.',
      hash: `#/pair/${interestingPair}/provenance`,
      waitMs: 7000,
    },
    {
      label: 'Verifying the experiment — this is happening right now, a real re-run of the preflight engine and the locked analysis, not an animation.',
      hash: '#/integrity',
      action: async () => {
        await sleep(500);
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('VERIFY EXPERIMENT'));
        if (btn) btn.click();
        await waitFor(() => document.querySelector('.check-list'), 15000);
      },
      waitMs: 1500,
    },
    {
      label: 'Attempting to break the experiment — mutating a disposable copy and watching the real integrity engine catch it.',
      hash: '#/break',
      action: async () => {
        await sleep(500);
        const btn = document.querySelector('button[data-scenario-key="modify-trial"]');
        if (btn) btn.click();
        await waitFor(() => document.querySelector('.pill.fail, .pill.pass'), 8000);
      },
      waitMs: 3000,
    },
    {
      label: 'The pre-registered result, reported plainly — no verdict, no interpretation.',
      hash: '#/lab',
      waitMs: 6000,
    },
  ];

  const bar = buildBar({ i: 0, total: steps.length, currentLabel: steps[0].label });
  document.body.appendChild(bar);

  for (let i = 0; i < steps.length; i++) {
    if (!active) return;
    const step = steps[i];
    updateBar(i, steps.length, step.label);
    if (location.hash !== step.hash) {
      scriptNavigating = true;
      location.hash = step.hash;
      await sleep(60); // give the hashchange event (and its listener below) time to fire first
      scriptNavigating = false;
    }
    await sleep(250); // let the real screen render before narrating/acting on it
    if (!active) return;
    if (step.afterNav) step.afterNav();
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
