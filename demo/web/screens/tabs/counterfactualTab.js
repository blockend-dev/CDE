import { el, fmtNum } from '../../api.js';

export async function renderCounterfactualTab(body, pair) {
  const cols = el('div', { class: 'col-pair panel' }, [
    renderColumn('CLEAN — no claim presented', 'clean', pair.clean),
    renderColumn('INJECTED — claim presented', 'injected', pair.injected),
  ]);
  body.appendChild(cols);

  body.appendChild(el('h2', { style: 'margin-top:24px;' }, 'What Changed?'));
  body.appendChild(renderDiff(pair));

  body.appendChild(el('div', { class: 'footer-note' }, 'Only externally observable structured fields are shown — no chain-of-thought is captured anywhere in this experiment.'));
}

function renderColumn(title, kind, member) {
  const col = el('div', {}, [el('div', { class: `col-header ${kind}` }, title)]);
  const trace = el('div', {});
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
      el('dt', {}, 'Direction'), el('dd', {}, d.direction),
      el('dt', {}, 'Exposure (−1..1)'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.exposure))),
      el('dt', {}, 'Confidence'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.confidence))),
      el('dt', {}, 'Claim assessment'), el('dd', {}, d.claimAssessment),
      el('dt', {}, 'Verification attempts'), el('dd', {}, String(d.verificationAttempts.length)),
    ])
  );
  return col;
}

function diffRow(field, before, after) {
  const dir = typeof after === 'number' && typeof before === 'number' ? (after > before ? 'up' : after < before ? 'down' : '') : '';
  return el('div', { class: 'diff-row' }, [
    el('div', { class: 'diff-field' }, field),
    el('div', { class: 'diff-before' }, String(before)),
    el('div', { class: 'diff-arrow' }, '→'),
    el('div', { class: `diff-after ${dir}` }, String(after)),
  ]);
}

function renderDiff(pair) {
  const decisionRows = [];
  if (pair.exposureDelta !== 0) decisionRows.push(diffRow('Exposure (−1..1)', fmtNum(pair.clean.decision.exposure), fmtNum(pair.injected.decision.exposure)));
  if (pair.confidenceDelta !== 0) decisionRows.push(diffRow('Confidence', fmtNum(pair.clean.decision.confidence), fmtNum(pair.injected.decision.confidence)));
  if (pair.directionFlip) decisionRows.push(diffRow('Direction', pair.cleanDirection, pair.injectedDirection));
  if (pair.verificationDivergence !== 0) decisionRows.push(diffRow('Verification attempts', pair.clean.decision.verificationAttempts.length, pair.injected.decision.verificationAttempts.length));

  const panel = el('div', { class: 'panel' });
  if (decisionRows.length === 0) panel.appendChild(el('div', { class: 'no-change' }, 'NO STRUCTURED DECISION CHANGE'));
  else decisionRows.forEach((r) => panel.appendChild(r));

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
