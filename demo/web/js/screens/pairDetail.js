import { api, el, clickable, shortHash, fmtNum, pickInterestingPair } from '../api.js';
import { renderCounterfactualTab } from './tabs/counterfactual.js';
import { renderChainTab } from './tabs/chain.js';
import { renderXrayTab } from './tabs/xray.js';
import { renderProvenanceTab } from './tabs/provenance.js';
import { renderBaselineTab } from './tabs/baseline.js';
import { scene } from '../visual/scene.js';
import { staggerIn } from '../visual/motion.js';

const TABS = [
  { key: 'counterfactual', label: 'Counterfactual', render: renderCounterfactualTab },
  { key: 'chain', label: 'Truth → Belief → Action', render: renderChainTab },
  { key: 'xray', label: 'Evidence X-Ray', render: renderXrayTab },
  { key: 'provenance', label: 'Provenance', render: renderProvenanceTab },
  { key: 'baseline', label: 'Baseline Control', render: renderBaselineTab },
];

let lastPairKey = null; // switching tabs within one pair should not replay the whole header entrance

function nyseOpen(pair) {
  const call = pair.clean.decision.toolCalls.find((tc) => tc.toolName === 'get_market_status');
  return call ? call.response.underlyingNyseOpen : null;
}

function decisionLine(member) {
  const d = member.decision;
  return `${d.direction} · exposure ${fmtNum(d.exposure)} · confidence ${fmtNum(d.confidence)}`;
}

/** CLEAN ⟷ INJECTED: what is held constant, and the one thing that differs. Every value is read from the trial pair. */
function pairBanner(pair) {
  const open = nyseOpen(pair);
  const same = (text) => el('div', { class: 'row' }, text);
  return el('div', { class: 'panel elevated' }, [
    el('div', { class: 'pair-banner' }, [
      el('div', { class: 'side clean' }, [
        el('h3', {}, 'Clean'),
        el('div', { class: 'big' }, 'no claim presented'),
        el('div', { class: 'mono', style: 'font-size:11.5px; color:var(--text-dim); margin-top:8px;' }, decisionLine(pair.clean)),
      ]),
      el('div', { class: 'same' }, [
        same(`same snapshot · ${shortHash(pair.candidateSnapshotId, 16)}`),
        same(`same timestamp · ${pair.marketTimestampUtc}`),
        same('same market tools'),
        same('same model configuration'),
        same('same experiment'),
        el('div', { class: 'row differs' }, 'different claim presentation'),
        el('div', { class: 'cond' }, [
          el('span', { class: `badge ${pair.condition}` }, pair.condition.toUpperCase()),
          ' ',
          open === null ? '' : open ? 'NYSE open — normal price-discovery session available' : 'NYSE closed — that normal session is unavailable',
        ]),
      ]),
      el('div', { class: 'side injected' }, [
        el('h3', {}, 'Injected'),
        el('div', { class: 'big' }, 'claim presented'),
        el('div', { class: 'mono', style: 'font-size:11.5px; color:var(--text-dim); margin-top:8px;' }, decisionLine(pair.injected)),
      ]),
    ]),
  ]);
}

export async function renderPairDetail(main, rest) {
  const parts = decodeURIComponent(rest || '').split('?')[0].split('/').filter(Boolean);
  let pairingKey = parts[0];
  let tabKey = parts[1] || 'counterfactual';

  // "Counterfactual Lab" in the sidenav links to the bare `#/pair` (no key
  // yet chosen) — that used to fall through to the exact same screen as
  // "Case Files", making the two nav items indistinguishable. Landing here
  // now resolves to one real, demonstrative pair instead, and updates the
  // address bar to name it (replaceState: no extra history entry, no second
  // hashchange/render pass).
  if (!pairingKey) {
    pairingKey = await pickInterestingPair();
    tabKey = 'counterfactual';
    history.replaceState(null, '', `#/pair/${pairingKey}/${tabKey}`);
  }

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
      el('a', { href: '#/cases', class: 'btn ghost mono', style: 'font-size:11px;' }, '← All pairs'),
    ])
  );

  const banner = pairBanner(pair);
  main.appendChild(banner);

  const claim = el('div', { class: 'panel' }, [
    el('h3', {}, 'Injected Claim'),
    el('div', { class: 'badge fixture', style: 'margin-bottom:8px;' }, `FIXTURE · ${pair.claimTemplate}`),
    el('p', { style: 'font-size:13px;color:var(--text-dim);margin:0;' }, pair.claimText || '(no claim resolved)'),
  ]);
  main.appendChild(claim);

  const tabBar = el('div', { class: 'tabs', role: 'tablist', style: 'margin-top:14px;' });
  const body = el('div', { id: 'tab-body' });
  for (const t of TABS) {
    tabBar.appendChild(
      clickable('div', { class: `tab${t.key === tabKey ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t.key === tabKey), onclick: () => (location.hash = `#/pair/${pairingKey}/${t.key}`) }, t.label)
    );
  }
  main.appendChild(tabBar);
  main.appendChild(body);

  if (lastPairKey !== pairingKey) staggerIn([banner, claim], { each: 70, from: 8 });
  lastPairKey = pairingKey;
  if (main.isConnected) scene.showPair({ condition: pair.condition });

  const active = TABS.find((t) => t.key === tabKey) || TABS[0];
  await active.render(body, pair);
  if (body.isConnected) staggerIn(body.children, { each: 55, from: 6 });
}
