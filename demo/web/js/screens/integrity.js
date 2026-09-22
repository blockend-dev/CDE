import { api, el } from '../api.js';
import { createIntegrityChain } from '../components/integrityChain.js';
import { scene, RESOLVE_STEP_MS } from '../visual/scene.js';
import { staggerIn, prefersReducedMotion } from '../visual/motion.js';

export async function renderIntegrity(main) {
  main.appendChild(el('div', { class: 'eyebrow' }, 'Research Integrity Console'));
  main.appendChild(el('h1', {}, "Experiment's Cryptographic Identity"));
  main.appendChild(el('p', { class: 'lede' }, 'Every component that affects this experiment\'s outcome is content-hashed and locked before collection begins. Nothing below is decorative — every check below re-executes the real Phase 5 verification code when you click VERIFY EXPERIMENT.'));

  main.appendChild(el('div', { class: 'loading' }, 'Loading identity…'));
  const { identity } = await api('/integrity/identity');
  main.querySelector('.loading').remove();

  const chain = createIntegrityChain(identity);
  main.appendChild(
    el('p', { style: 'font-size:11.5px; color:var(--text-faint); margin-bottom:8px;' }, 'These hashes are read from the committed lock/manifest files — not yet independently cross-checked. Each node says ON RECORD until a real verification has run. Click VERIFY EXPERIMENT to recompute and check them right now.')
  );
  const idPanel = el('div', { class: 'panel elevated' }, [chain.el]);
  main.appendChild(idPanel);

  const verifySection = el('div', { class: 'panel', style: 'margin-top:18px;' });
  const btn = el('button', { class: 'btn primary' }, 'VERIFY EXPERIMENT');
  const resultsBox = el('div', { style: 'margin-top:16px;' });
  verifySection.appendChild(el('h3', {}, 'Re-Verify Now'));
  verifySection.appendChild(el('p', { style: 'font-size:12.5px; color:var(--text-dim); margin-bottom:14px;' }, 'Re-runs the real preflight engine (cde/phase5/preflight.js) and re-executes the locked statistical analysis right now, comparing its hash to the committed result. Takes several seconds — this is real computation, not a staged animation.'));
  verifySection.appendChild(btn);
  verifySection.appendChild(resultsBox);
  main.appendChild(verifySection);

  staggerIn([idPanel, verifySection], { each: 80, from: 8 });
  scene.setMode('integrity');

  let resolveTimers = [];
  const clearResolve = () => { resolveTimers.forEach(clearTimeout); resolveTimers = []; };

  btn.addEventListener('click', async () => {
    clearResolve();
    btn.disabled = true;
    btn.textContent = 'VERIFYING…';
    resultsBox.innerHTML = '';
    resultsBox.appendChild(el('div', { class: 'loading' }, 'Re-executing checks against the frozen dataset…'));
    chain.setAllChecking();
    scene.beginVerify(); // freeze the field and scan the rail while the real computation runs
    try {
      const result = await api('/integrity/verify', { method: 'POST' });
      if (!resultsBox.isConnected) return;
      resultsBox.innerHTML = '';

      // Resolve the chain one component at a time, from the REAL result, in step with the 3D rail.
      const finish = () => {
        if (!resultsBox.isConnected) return;
        const list = el('div', { class: 'check-list' });
        result.checks.forEach((c) => {
          list.appendChild(
            el('div', { class: `check-row ${c.pass ? 'pass' : 'fail'}` }, [
              el('span', { class: 'status' }, c.pass ? 'PASS' : 'FAIL'),
              el('span', { class: 'name' }, c.label),
              c.detail ? el('span', { class: 'detail' }, JSON.stringify(c.detail)) : null,
            ])
          );
        });
        resultsBox.appendChild(list);
        resultsBox.appendChild(
          el('div', { class: 'panel', style: `margin-top:14px; border-color:${result.allPassed ? 'var(--pass-dim)' : 'var(--fail-dim)'};` }, [
            el('span', { class: `pill ${result.allPassed ? 'pass' : 'fail'}` }, result.allPassed ? 'ALL CHECKS PASSED' : 'VERIFICATION FAILED'),
          ])
        );
        staggerIn(list.children, { each: 35, from: 6 });
        btn.disabled = false;
        btn.textContent = 'VERIFY EXPERIMENT';
      };
      const instant = prefersReducedMotion();
      result.components.forEach((c, i) => {
        const apply = () => { if (idPanel.isConnected) chain.setState(c.key, c.status); };
        if (instant) apply();
        else resolveTimers.push(setTimeout(apply, i * RESOLVE_STEP_MS));
      });
      if (instant) finish();
      else resolveTimers.push(setTimeout(finish, result.components.length * RESOLVE_STEP_MS + 150));
      scene.resolveVerify(result.components);
      return;
    } catch (err) {
      chain.reset();
      scene.setMode('integrity');
      resultsBox.innerHTML = '';
      resultsBox.appendChild(el('div', { class: 'error-box' }, `Verification run crashed: ${err.message}`));
    }
    btn.disabled = false;
    btn.textContent = 'VERIFY EXPERIMENT';
  });
}
