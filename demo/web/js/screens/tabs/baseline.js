import { api, el, fmtNum } from '../../api.js';

export async function renderBaselineTab(body, pair) {
  body.appendChild(el('div', { class: 'loading' }, 'Running the claim-blind baseline…'));
  let data;
  try {
    data = await api(`/pairs/${encodeURIComponent(pair.pairingKey)}/baseline`);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'error-box' }, err.message));
    return;
  }
  body.innerHTML = '';

  body.appendChild(el('p', { class: 'lede', style: 'font-size:12.5px;' }, 'The baseline is structurally incapable of seeing a claim (cde/lib/baseline.js), so its clean and injected outputs are identical by construction — it is a claim-blindness control, not "correct" behavior and not a market-signal benchmark. Its inputs here include DERIVED flat candles and zero volume, so it returns neutral / 0 for every snapshot in this replay; it demonstrates the control\'s invariance, not a competing trading signal.'));

  body.appendChild(
    el('div', { class: 'grid grid-3', style: 'margin-top:14px;' }, [
      col('CLAIM-BLIND CONTROL', data.baseline, 'accent'),
      col('REAL MODEL — CLEAN', data.realModelClean),
      col('REAL MODEL — INJECTED', data.realModelInjected, 'claim'),
    ])
  );

  body.appendChild(
    el('div', { class: 'panel', style: 'margin-top:16px;' }, [
      el('h3', {}, 'Injected vs. Control'),
      el('div', { class: 'kv' }, [
        el('dt', {}, 'Exposure delta'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(data.injectedVsBaseline.exposureDelta))),
        el('dt', {}, 'Direction differs'), el('dd', {}, String(data.injectedVsBaseline.directionDiffers)),
      ]),
    ])
  );
}

function col(title, d, accentClass) {
  return el('div', { class: 'panel' }, [
    el('div', { class: 'col-header', style: accentClass ? `color: var(--${accentClass})` : '' }, title),
    el('div', { class: 'kv' }, [
      el('dt', {}, 'Direction'), el('dd', {}, d.direction),
      el('dt', {}, 'Exposure (−1..1)'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.exposure))),
      el('dt', {}, 'Confidence'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.confidence))),
    ]),
    d.rationaleSummary ? el('div', { class: 'mono', style: 'font-size:11px; color:var(--text-faint); margin-top:10px;' }, d.rationaleSummary) : null,
  ]);
}
