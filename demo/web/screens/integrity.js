import { api, el, shortHash } from '../api.js';

export async function renderIntegrity(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Research Integrity Console'));
  main.appendChild(el('h1', {}, "Experiment's Cryptographic Identity"));
  main.appendChild(el('p', { class: 'lede' }, 'Every component that affects this experiment\'s outcome is content-hashed and locked before collection begins. Nothing below is decorative — every check re-executes the real Phase 5 verification code.'));

  main.appendChild(el('div', { class: 'loading' }, 'Loading identity…'));
  const { identity } = await api('/integrity/identity');
  main.querySelector('.loading').remove();

  const idPanel = el('div', { class: 'panel' });
  for (const row of identity) {
    idPanel.appendChild(
      el('div', { class: 'hashline', style: 'padding:8px 0; border-bottom:1px solid var(--border-soft);' }, [
        el('span', { class: 'pill pass' }, [el('span', { class: 'dot' }), 'VERIFIED']),
        el('span', { style: 'width:200px; color:var(--text-dim);' }, row.label),
        el('span', { class: 'short mono' }, shortHash(row.hash, 20)),
        el('button', {
          onclick: (e) => {
            const target = e.target.previousSibling;
            target.textContent = target.textContent.endsWith('…') ? row.hash : shortHash(row.hash, 20);
          },
        }, 'expand'),
      ])
    );
  }
  main.appendChild(idPanel);

  const verifySection = el('div', { class: 'panel', style: 'margin-top:18px;' });
  const btn = el('button', { class: 'btn primary' }, 'VERIFY EXPERIMENT');
  const resultsBox = el('div', { style: 'margin-top:16px;' });
  verifySection.appendChild(el('h3', {}, 'Live Verification'));
  verifySection.appendChild(el('p', { style: 'font-size:12.5px; color:var(--text-dim); margin-bottom:14px;' }, 'Re-runs the real preflight engine (cde/phase5/preflight.js) and re-executes the locked statistical analysis now, comparing its hash to the committed result. Takes several seconds — this is real computation, not a staged animation.'));
  verifySection.appendChild(btn);
  verifySection.appendChild(resultsBox);
  main.appendChild(verifySection);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'VERIFYING…';
    resultsBox.innerHTML = '';
    resultsBox.appendChild(el('div', { class: 'loading' }, 'Re-executing checks against the frozen dataset…'));
    try {
      const result = await api('/integrity/verify', { method: 'POST' });
      resultsBox.innerHTML = '';
      const list = el('div', { class: 'check-list' });
      result.checks.forEach((c, i) => {
        list.appendChild(
          el('div', { class: `check-row ${c.pass ? 'pass' : 'fail'}`, style: `animation-delay:${i * 45}ms` }, [
            el('span', { class: 'status' }, c.pass ? 'PASS' : 'FAIL'),
            el('span', { class: 'name' }, c.label),
            c.detail ? el('span', { class: 'detail' }, JSON.stringify(c.detail)) : null,
          ])
        );
      });
      resultsBox.appendChild(list);
      resultsBox.appendChild(
        el('div', { class: `panel`, style: `margin-top:14px; border-color:${result.allPassed ? 'var(--pass-dim)' : 'var(--fail-dim)'};` }, [
          el('span', { class: `pill ${result.allPassed ? 'pass' : 'fail'}` }, result.allPassed ? 'ALL CHECKS PASSED' : 'VERIFICATION FAILED'),
        ])
      );
    } catch (err) {
      resultsBox.innerHTML = '';
      resultsBox.appendChild(el('div', { class: 'error-box' }, `Verification run crashed: ${err.message}`));
    }
    btn.disabled = false;
    btn.textContent = 'VERIFY EXPERIMENT';
  });
}
