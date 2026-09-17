import { api, el, fmtNum } from '../api.js';

/** Minimal picker used by pairDetail.js until the full filterable gallery lands. */
export async function renderPicker(main, onSelect) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Replay Case Files'));
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
        { class: 'case-card', onclick: () => onSelect(p.pairingKey) },
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
