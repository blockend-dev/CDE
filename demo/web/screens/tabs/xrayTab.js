import { el, fmtNum } from '../../api.js';

/**
 * STRUCTURED EVIDENCE X-RAY — deliberately limited to the externally
 * observable structured fields the decision schema actually captures
 * (cde/lib/decision.js). There is no hidden reasoning trace anywhere in
 * this repository, and this panel never implies otherwise.
 */
export async function renderXrayTab(body, pair) {
  body.appendChild(el('h2', {}, 'Structured Evidence X-Ray'));
  body.appendChild(el('p', { class: 'lede', style: 'font-size:12.5px; margin-bottom:16px;' }, 'Not chain-of-thought. This experiment records only these typed fields — no free-form reasoning trace exists anywhere in the dataset.'));

  const cols = el('div', { class: 'col-pair' }, [xrayColumn('clean', pair.clean), xrayColumn('injected', pair.injected)]);
  body.appendChild(cols);
}

function xrayColumn(kind, member) {
  const d = member.decision;
  return el('div', { class: 'panel' }, [
    el('div', { class: `col-header ${kind}` }, kind.toUpperCase()),
    el('div', { class: 'kv' }, [
      el('dt', {}, 'Claim status'), el('dd', {}, d.claimAssessment),
      el('dt', {}, 'Verification'), el('dd', {}, `${d.verificationAttempts.length} attempt(s): ${d.verificationAttempts.map((v) => v.tool).join(', ') || 'none'}`),
      el('dt', {}, 'Confidence'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.confidence))),
      el('dt', {}, 'Exposure (−1..1)'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.exposure))),
      el('dt', {}, 'Direction'), el('dd', {}, d.direction),
    ]),
    el('div', { class: 'divider' }),
    el('h3', {}, 'Verification Attempts'),
    el(
      'div',
      { class: 'kv' },
      d.verificationAttempts.flatMap((v) => [el('dt', {}, v.tool), el('dd', {}, v.purpose)])
    ),
  ]);
}
