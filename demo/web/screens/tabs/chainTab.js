import { el, fmtNum } from '../../api.js';

/**
 * MARKET -> CLAIM -> CORROBORATION -> BELIEF -> ACTION, built entirely from
 * the INJECTED trial member's recorded tool calls and decision — the clean
 * member never sees a claim, so there is no corroboration/belief step to
 * chain for it (its parallel outcome is one click away, on the
 * Counterfactual tab).
 */
export async function renderChainTab(body, pair) {
  const d = pair.injected.decision;
  const quote = toolResponse(d, 'get_quote');
  const orderbook = toolResponse(d, 'get_orderbook');
  const marketStatus = toolResponse(d, 'get_market_status');
  const claimsFeed = toolResponse(d, 'get_claims_feed');

  const chain = el('div', { class: 'chain' });
  const addNode = (title, content, delay) => {
    chain.appendChild(el('div', { class: 'chain-connector' }));
    chain.appendChild(el('div', { class: 'chain-node', style: `animation-delay:${delay}ms` }, [el('div', { class: 'chain-node-title' }, title), content]));
  };

  // MARKET
  addNode(
    'Market',
    el('div', {}, [
      el('div', { style: 'display:flex; gap:8px; margin-bottom:10px;' }, [el('span', { class: 'badge real' }, 'REAL'), el('span', { style: 'color:var(--text-dim); font-size:12px;' }, 'price · symbol · timestamp — from the precondition-study historical record')]),
      el('div', { class: 'kv', style: 'margin-bottom:10px;' }, [
        el('dt', {}, 'Symbol'), el('dd', {}, el('span', { class: 'mono' }, pair.symbol)),
        el('dt', {}, 'Last price'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(quote ? quote.last : null, 3))),
        el('dt', {}, 'Timestamp'), el('dd', {}, el('span', { class: 'mono' }, pair.marketTimestampUtc)),
      ]),
      el('div', { style: 'display:flex; gap:8px; margin-bottom:10px;' }, [el('span', { class: 'badge derived' }, 'DERIVED'), el('span', { style: 'color:var(--text-dim); font-size:12px;' }, 'orderbook · volume · candles — synthetic replay scaffolding, never independently observed')]),
      marketStatus
        ? el('div', { class: 'kv' }, [
            el('dt', {}, 'Underlying market'), el('dd', {}, marketStatus.underlyingNyseOpen ? 'OPEN (weekday)' : 'CLOSED (weekend)'),
          ])
        : null,
    ]),
    0
  );

  // CLAIM
  addNode(
    'Claim',
    el('div', {}, [
      el('span', { class: 'badge fixture' }, 'INJECTED CLAIM — not verified true or false'),
      el('p', { style: 'margin:10px 0 0 0; color:var(--text); font-size:13px;' }, pair.claimText),
    ]),
    120
  );

  // CORROBORATION
  const claimItems = claimsFeed ? claimsFeed.items || [] : [];
  addNode(
    'Corroboration',
    el('div', {}, [
      el('p', { style: 'margin:0 0 10px 0; font-size:12.5px; color:var(--text-dim);' }, 'Exactly what the available tools returned when the agent tried to verify the claim:'),
      el('div', { class: 'kv' }, [
        el('dt', {}, 'Claims feed'), el('dd', {}, `${claimItems.length} item(s) — the claim itself, not independent confirmation`),
        el('dt', {}, 'Order book'), el('dd', {}, orderbook ? `${orderbook.depthLevels} level (synthetic placeholder)` : '—'),
        el('dt', {}, 'Underlying market'), el('dd', {}, marketStatus ? (marketStatus.underlyingNyseOpen ? 'open — independent reopen behavior could corroborate/refute' : 'closed — no independent reopen signal available') : '—'),
      ]),
    ]),
    240
  );

  // BELIEF
  addNode(
    'Belief',
    el('div', { class: 'kv' }, [
      el('dt', {}, 'Claim assessment'), el('dd', {}, d.claimAssessment),
      el('dt', {}, 'Confidence'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.confidence))),
      el('dt', {}, 'Verification attempts'), el('dd', {}, String(d.verificationAttempts.length)),
    ]),
    360
  );

  // ACTION
  addNode(
    'Action',
    el('div', { class: 'kv' }, [
      el('dt', {}, 'Direction'), el('dd', {}, d.direction),
      el('dt', {}, 'Exposure (−1..1)'), el('dd', {}, el('span', { class: 'mono' }, fmtNum(d.exposure))),
    ]),
    480
  );

  body.appendChild(chain);
  body.appendChild(
    el('div', { class: 'footer-note' }, 'This is the entire causal path recorded for the injected trial. Belief fields are the model\'s own structured output, never inferred or fabricated by this instrument.')
  );
}

function toolResponse(decision, toolName) {
  const call = decision.toolCalls.find((tc) => tc.toolName === toolName);
  return call ? call.response : null;
}
