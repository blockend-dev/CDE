import { api, el, fmtNum, shortHash } from '../api.js';

export async function renderCounterfactual(main, rest) {
  const pairingKey = decodeURIComponent(rest || '').split('?')[0];
  if (!pairingKey) return renderPicker(main);
  return renderPair(main, pairingKey);
}

async function renderPicker(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Counterfactual Trading-Agent Laboratory'));
  main.appendChild(el('h1', {}, 'Select a completed pair to replay'));
  main.appendChild(el('p', { class: 'lede' }, 'Every pair below shares one frozen market snapshot. Only the presence of an injected claim differs between its two trials.'));
  main.appendChild(el('div', { class: 'loading' }, 'Loading pairs…'));
  const { pairs } = await api('/pairs');
  main.querySelector('.loading').remove();

  const list = el('div', { class: 'grid grid-3' });
  for (const p of pairs) {
    list.appendChild(
      el(
        'div',
        {
          class: 'case-card',
          onclick: () => {
            location.hash = `#/counterfactual/${p.pairingKey}`;
          },
        },
        [
          el('div', { class: 'case-card-top' }, [
            el('span', { class: 'case-card-id mono' }, p.symbol),
            el('span', { class: `badge ${p.condition === 'weekend' ? 'derived' : 'real'}` }, p.condition.toUpperCase()),
          ]),
          el('div', { class: 'mono', style: 'font-size:11px;color:var(--text-faint);margin-bottom:8px;' }, p.claimTemplate ? p.claimTemplate.replace(/_/g, ' ') : ''),
          el('div', { class: 'mono', style: 'font-size:12px;' }, [
            el('span', { style: `color:${p.structuredDecisionChanged ? 'var(--claim)' : 'var(--text-faint)'}` }, p.structuredDecisionChanged ? 'CHANGED' : 'NO CHANGE'),
            `  Δexposure ${fmtNum(p.exposureDelta)}`,
          ]),
        ]
      )
    );
  }
  main.appendChild(list);
}

async function renderPair(main, pairingKey) {
  main.appendChild(el('div', { class: 'loading' }, 'Loading pair…'));
  let pair;
  try {
    pair = await api(`/pairs/${encodeURIComponent(pairingKey)}`);
  } catch (err) {
    main.innerHTML = '';
    main.appendChild(el('div', { class: 'error-box' }, `Pair not found: ${err.message}`));
    return;
  }
  main.innerHTML = '';

  main.appendChild(el('div', { class: 'eyebrow' }, 'Counterfactual Trading-Agent Laboratory'));
  main.appendChild(
    el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px;' }, [
      el('h1', {}, `${pair.symbol} — Pair ${shortHash(pair.pairingKey, 8)}`),
      el('a', { href: '#/counterfactual', class: 'btn ghost mono', style: 'font-size:11px;' }, '← All pairs'),
    ])
  );

  // SAME SNAPSHOT header
  main.appendChild(
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Same Snapshot · Same Tools · Same Model Configuration'),
      el('div', { class: 'kv' }, [
        dt('Symbol'), dd(pair.symbol),
        dt('Market timestamp'), dd(pair.marketTimestampUtc),
        dt('Condition'), dd(el('span', { class: `badge ${pair.condition === 'weekend' ? 'derived' : 'real'}` }, pair.condition.toUpperCase())),
        dt('Snapshot id'), dd(el('span', { class: 'mono' }, shortHash(pair.candidateSnapshotId, 16))),
        dt('Tool manifest hash'), dd(el('span', { class: 'mono' }, shortHash(pair.clean.toolManifestHash, 16))),
        dt('Model config hash'), dd(el('span', { class: 'mono' }, shortHash(pair.clean.modelConfigHash, 16))),
      ]),
    ])
  );

  main.appendChild(
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Injected Claim'),
      el('div', { class: 'badge fixture', style: 'margin-bottom:8px;' }, `FIXTURE · ${pair.claimTemplate}`),
      el('p', { style: 'font-size:13px;color:var(--text-dim);margin:0;' }, pair.claimText || '(no claim resolved)'),
    ])
  );

  // Synchronized columns
  const cols = el('div', { class: 'col-pair panel', style: 'margin-top:14px;' }, [
    renderColumn('CLEAN — no claim presented', 'clean', pair.clean),
    renderColumn('INJECTED — claim presented', 'injected', pair.injected),
  ]);
  main.appendChild(cols);

  // WHAT CHANGED?
  main.appendChild(el('h2', { style: 'margin-top:24px;' }, 'What Changed?'));
  main.appendChild(renderDiff(pair));

  main.appendChild(
    el('div', { class: 'footer-note' }, 'Only externally observable structured fields are shown — no chain-of-thought is captured anywhere in this experiment.')
  );
}

function dt(text) { return el('dt', {}, text); }
function dd(child) { return el('dd', {}, child); }

function renderColumn(title, kind, member) {
  const col = el('div', {}, [el('div', { class: `col-header ${kind}` }, title)]);

  const trace = el('div', { class: 'trace-panel' });
  member.decision.toolCalls.forEach((tc, i) => {
    let note = '';
    if (tc.toolName === 'get_claims_feed') {
      const items = (tc.response && tc.response.items) || [];
      note = items.length === 0 ? '0 items' : `${items.length} item${items.length > 1 ? 's' : ''}`;
    } else if (tc.toolName === 'propose_action') {
      note = tc.response.direction;
    }
    trace.appendChild(
      el('div', { class: 'trace-step', style: `animation-delay:${i * 90}ms` }, [
        el('span', { class: 'n' }, String(i + 1)),
        el('span', { class: 'name' }, tc.toolName),
        note ? el('span', { class: 'note' }, note) : null,
      ])
    );
  });
  col.appendChild(trace);

  const d = member.decision;
  col.appendChild(
    el('div', { class: 'kv', style: 'margin-top:16px;' }, [
      dt('Direction'), dd(d.direction),
      dt('Exposure'), dd(el('span', { class: 'mono' }, fmtNum(d.exposure))),
      dt('Confidence'), dd(el('span', { class: 'mono' }, fmtNum(d.confidence))),
      dt('Claim assessment'), dd(d.claimAssessment),
      dt('Verification attempts'), dd(String(d.verificationAttempts.length)),
    ])
  );
  return col;
}

function diffRow(field, before, after, changed) {
  const dir = typeof after === 'number' && typeof before === 'number' ? (after > before ? 'up' : after < before ? 'down' : '') : '';
  return el('div', { class: 'diff-row' }, [
    el('div', { class: 'diff-field' }, field),
    el('div', { class: 'diff-before' }, String(before)),
    el('div', { class: 'diff-arrow' }, '→'),
    el('div', { class: `diff-after ${changed ? dir : ''}` }, String(after)),
  ]);
}

function renderDiff(pair) {
  const decisionRows = [];
  if (pair.exposureDelta !== 0) decisionRows.push(diffRow('Exposure', fmtNum(pair.clean.decision.exposure), fmtNum(pair.injected.decision.exposure), true));
  if (pair.confidenceDelta !== 0) decisionRows.push(diffRow('Confidence', fmtNum(pair.clean.decision.confidence), fmtNum(pair.injected.decision.confidence), true));
  if (pair.directionFlip) decisionRows.push(diffRow('Direction', pair.cleanDirection, pair.injectedDirection, true));
  if (pair.verificationDivergence !== 0) decisionRows.push(diffRow('Verification attempts', pair.clean.decision.verificationAttempts.length, pair.injected.decision.verificationAttempts.length, true));

  const panel = el('div', { class: 'panel' });
  if (decisionRows.length === 0) {
    panel.appendChild(el('div', { class: 'no-change' }, 'NO STRUCTURED DECISION CHANGE'));
  } else {
    decisionRows.forEach((r) => panel.appendChild(r));
  }

  // Claim status is shown separately: it differs on every pair in this dataset BY
  // CONSTRUCTION (the clean trial is claim-blind, so its assessment is always
  // "no_claim_presented") — that is expected, not a finding, so it is never counted
  // toward "structured decision changed" above.
  panel.appendChild(el('div', { class: 'divider' }));
  panel.appendChild(
    el('div', { class: 'diff-row', style: 'opacity:0.75;' }, [
      el('div', { class: 'diff-field' }, 'Claim status'),
      el('div', { class: 'diff-before' }, pair.cleanClaimAssessment),
      el('div', { class: 'diff-arrow' }, '→'),
      el('div', { class: 'diff-after' }, pair.injectedClaimAssessment),
    ])
  );
  panel.appendChild(el('div', { class: 'footer-note', style: 'margin-top:8px;' }, 'Claim status always differs here by construction — the clean trial never sees a claim. Not counted as a structured decision change.'));
  return panel;
}
