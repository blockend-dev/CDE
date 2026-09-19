import { api, el, shortHash } from '../api.js';

export async function renderTimeline(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Experiment Timeline'));
  main.appendChild(el('h1', {}, 'The Methodology Existed Before The Result'));
  main.appendChild(el('p', { class: 'lede' }, 'Every stage below is anchored to a real commit SHA and a real content hash — not prose dates.'));

  main.appendChild(el('div', { class: 'loading' }, 'Loading timeline…'));
  const { timeline } = await api('/timeline');
  main.querySelector('.loading').remove();

  const chain = el('div', { class: 'chain' });
  timeline.forEach((p, i) => {
    chain.appendChild(el('div', { class: 'chain-connector' }));
    chain.appendChild(
      el('div', { class: 'chain-node', style: `animation-delay:${i * 90}ms` }, [
        el('div', { class: 'chain-node-title' }, `${p.phase} — ${p.title}`),
        el('p', { style: 'font-size:12.5px; color:var(--text-dim); margin:0 0 10px 0;' }, p.note),
        el('div', { class: 'kv' }, [
          el('dt', {}, p.hashLabel), el('dd', {}, el('span', { class: 'mono' }, shortHash(p.hash, 20))),
          el('dt', {}, 'commit'), el('dd', {}, p.commit ? el('span', { class: 'mono' }, `${p.commit.sha.slice(0, 10)} — ${p.commit.subject}`) : '—'),
        ]),
        p.bundledWithNextPhases ? el('div', { style: 'font-size:11px; color:var(--text-faint); margin-top:8px;' }, 'Landed in the same commit as the next phase — this repository bundled Phases 0–2 into its first commit.') : null,
        p.firstCommit ? el('div', { style: 'font-size:11px; color:var(--text-faint); margin-top:4px;' }, `Engine work began at ${p.firstCommit.sha.slice(0, 10)} — "${p.firstCommit.subject}".`) : null,
      ])
    );
  });
  main.appendChild(chain);
}
