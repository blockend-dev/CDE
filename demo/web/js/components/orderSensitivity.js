import { api, el, fmtNum } from '../api.js';
import { staggerIn } from '../visual/motion.js';

const ci = ([lower, upper]) => `[${fmtNum(lower)}, ${fmtNum(upper)}]`;

function orderTable(orders) {
  const row = (o) =>
    el('tr', {}, [
      el('td', {}, o.label),
      el('td', { class: 'mono' }, fmtNum(o.did)),
      el('td', { class: 'mono' }, ci(o.confidenceInterval)),
      el('td', { class: 'mono' }, [fmtNum(o.pValue), o.matchesCommittedPValue ? el('span', { class: 'pill pass', style: 'margin-left:8px;' }, 'MATCHES COMMITTED RESULT') : null]),
    ]);
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'order-table' }, [
      el('thead', {}, el('tr', {}, ['Input order', 'DiD', '95% CI', 'permutation p'].map((h) => el('th', {}, h)))),
      el('tbody', {}, orders.map(row)),
    ]),
  ]);
}

function summary(r) {
  const s = r.shuffled;
  return el('div', { class: 'reading' }, [
    el('p', { class: 'mono context' }, `Across ${s.count} further shuffled input orders the p-value ranges from ${fmtNum(s.pMin)} to ${fmtNum(s.pMax)} (median ${fmtNum(s.pMedian)}, standard deviation ${fmtNum(s.pStandardDeviation)}). The Monte Carlo standard error of a p-value near ${fmtNum(r.committed.pValue, 2)} with ${r.numPermutations.toLocaleString('en-US')} permutations is about ${fmtNum(r.monteCarloStandardError)}. ${s.belowAlphaCount} of ${s.count} shuffled orders fall below α = ${r.alpha}.`),
    el('p', { class: 'mono context' }, `The DiD ${r.invariant.did ? 'is identical' : 'DIFFERS'} and the bootstrap interval ${r.invariant.confidenceInterval ? 'is identical' : 'DIFFERS'} in every order. The committed p-value is the one produced under the recorded input order, which this demo replays; the frozen loader is unchanged, and the dependence on order is disclosed here rather than hidden.`),
  ]);
}

/** A real re-computation, on demand: the locked analysis re-run in memory under several input orders. Writes nothing. */
export function createOrderSensitivityPanel() {
  const btn = el('button', { class: 'btn' }, 'RE-RUN UNDER DIFFERENT INPUT ORDERS');
  const out = el('div', { style: 'margin-top:16px;' });
  const panel = el('div', { class: 'panel', id: 'order-sensitivity' }, [
    el('h3', {}, 'Input-Order Sensitivity of the p-Value'),
    el('p', { style: 'font-size:12.5px; color:var(--text-dim); margin-bottom:14px;' }, 'The frozen analysis loader reads trial files without sorting, and its seeded permutation test shuffles a pooled array built in that order, so the Monte Carlo p-value depends slightly on input order. This re-runs the locked analysis in memory under several orders. Nothing is written and no frozen file is touched.'),
    btn,
    out,
  ]);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'RE-RUNNING…';
    out.innerHTML = '';
    out.appendChild(el('div', { class: 'loading' }, 'Re-running the locked analysis under several input orders…'));
    try {
      const result = await api('/reproducibility/order-sensitivity');
      if (!out.isConnected) return;
      out.innerHTML = '';
      out.appendChild(orderTable(result.orders));
      out.appendChild(summary(result));
      staggerIn(out.children, { each: 60, from: 6 });
    } catch (err) {
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'error-box' }, `Re-run failed: ${err.message}`));
    }
    btn.disabled = false;
    btn.textContent = 'RE-RUN UNDER DIFFERENT INPUT ORDERS';
  });

  return panel;
}
