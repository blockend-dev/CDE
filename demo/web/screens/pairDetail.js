import { api, el, shortHash } from '../api.js';
import { renderCounterfactualTab } from './tabs/counterfactualTab.js';
import { renderChainTab } from './tabs/chainTab.js';
import { renderXrayTab } from './tabs/xrayTab.js';
import { renderPicker } from './casefiles.js';

const TABS = [
  { key: 'counterfactual', label: 'Counterfactual', render: renderCounterfactualTab },
  { key: 'chain', label: 'Truth → Belief → Action', render: renderChainTab },
  { key: 'xray', label: 'Evidence X-Ray', render: renderXrayTab },
];

export async function renderPairDetail(main, rest) {
  const parts = decodeURIComponent(rest || '').split('?')[0].split('/').filter(Boolean);
  const pairingKey = parts[0];
  const tabKey = parts[1] || 'counterfactual';

  if (!pairingKey) return renderPicker(main, (key) => (location.hash = `#/pair/${key}/counterfactual`));

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

  main.appendChild(el('div', { class: 'eyebrow' }, 'Adversarial Research Lab'));
  main.appendChild(
    el('div', { style: 'display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:10px;' }, [
      el('h1', {}, `${pair.symbol} — ${pair.condition.toUpperCase()}`),
      el('a', { href: '#/pair', class: 'btn ghost mono', style: 'font-size:11px;' }, '← All pairs'),
    ])
  );

  main.appendChild(
    el('div', { class: 'panel' }, [
      el('h3', {}, 'Same Snapshot · Same Tools · Same Model Configuration'),
      el('div', { class: 'kv' }, [
        el('dt', {}, 'Symbol'), el('dd', {}, pair.symbol),
        el('dt', {}, 'Market timestamp'), el('dd', {}, pair.marketTimestampUtc),
        el('dt', {}, 'Condition'), el('dd', {}, el('span', { class: `badge ${pair.condition === 'weekend' ? 'derived' : 'real'}` }, pair.condition.toUpperCase())),
        el('dt', {}, 'Snapshot id'), el('dd', {}, el('span', { class: 'mono' }, shortHash(pair.candidateSnapshotId, 16))),
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

  const tabBar = el('div', { class: 'tabs', style: 'margin-top:14px;' });
  const body = el('div', { id: 'tab-body' });
  for (const t of TABS) {
    tabBar.appendChild(
      el('div', { class: `tab${t.key === tabKey ? ' active' : ''}`, onclick: () => (location.hash = `#/pair/${pairingKey}/${t.key}`) }, t.label)
    );
  }
  main.appendChild(tabBar);
  main.appendChild(body);

  const active = TABS.find((t) => t.key === tabKey) || TABS[0];
  await active.render(body, pair);
}
