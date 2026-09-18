import { api, el, shortHash } from '../../api.js';

const CLASS_BADGE = { REAL: 'real', DERIVED: 'derived', FIXTURE: 'fixture' };

export async function renderProvenanceTab(body, pair) {
  body.appendChild(el('div', { class: 'loading' }, 'Regenerating snapshot from the frozen population/replay logic…'));
  let prov;
  try {
    prov = await api(`/pairs/${encodeURIComponent(pair.pairingKey)}/provenance`);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'error-box' }, `Could not reproduce provenance: ${err.message}`));
    return;
  }
  body.innerHTML = '';

  body.appendChild(
    el('div', { class: 'mono', style: 'font-size:11px; color:var(--text-faint); margin-bottom:14px;' }, [
      'EXPERIMENT', ' → ', 'DATASET', ' → ', `PAIR ${shortHash(prov.pair.pairingKey, 8)}`, ' → ', 'SNAPSHOT', ' → ', 'FIELD',
    ])
  );

  body.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        el('span', { class: 'badge confirmatory' }, prov.experiment.classification),
        el('span', { style: 'color:var(--text-dim); font-size:12.5px;' }, prov.experiment.note),
      ]),
      el('div', { class: 'hashline', style: 'margin-top:10px;' }, ['snapshot provenance marker:', el('span', { class: 'short mono' }, prov.snapshot.provenanceMarker)]),
      el('div', { class: 'hashline' }, ['isLive:', el('span', { class: 'short mono' }, String(prov.snapshot.isLive))]),
    ])
  );

  body.appendChild(el('h2', { style: 'margin-top:22px;' }, 'Snapshot Fields'));
  const fieldPanel = el('div', { class: 'panel' });
  prov.snapshot.fields.forEach((f) => {
    fieldPanel.appendChild(
      el('div', { style: 'padding:10px 0; border-bottom:1px solid var(--border-soft);' }, [
        el('div', { style: 'display:flex; align-items:center; gap:10px; margin-bottom:4px;' }, [
          el('span', { class: `badge ${CLASS_BADGE[f.classification]}` }, f.classification),
          el('span', { class: 'mono', style: 'font-size:12.5px;' }, f.path),
        ]),
        el('div', { class: 'mono', style: 'font-size:11.5px; color:var(--text-dim); margin-left:2px;' }, typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)),
        el('div', { style: 'font-size:11.5px; color:var(--text-faint); margin-top:3px;' }, f.note),
      ])
    );
  });
  body.appendChild(fieldPanel);

  body.appendChild(el('h2', { style: 'margin-top:22px;' }, 'Claim'));
  body.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { style: 'display:flex; align-items:center; gap:10px; margin-bottom:8px;' }, [el('span', { class: 'badge fixture' }, prov.claim.classification), el('span', { class: 'mono', style: 'font-size:12px;' }, prov.claim.id)]),
      el('p', { style: 'font-size:13px; color:var(--text); margin:0 0 8px 0;' }, prov.claim.text),
      el('div', { style: 'font-size:11.5px; color:var(--text-faint);' }, prov.claim.note),
    ])
  );

  body.appendChild(
    el('div', { class: 'footer-note' }, 'Never use color alone: every classification above is also a text label. REAL = historical observation. DERIVED = replay scaffolding. FIXTURE = locked synthetic experiment input.')
  );
}
