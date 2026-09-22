'use strict';
/**
 * Milestone 13 — the real application in a real browser (headless Chrome/Edge
 * over the DevTools Protocol, via demo/test/support/browser.js). Skips cleanly
 * when no browser (or no global WebSocket) is available.
 *
 * Most flows run with ?level=3 (the scene's static quality level) so the test
 * machine's software WebGL cannot starve the server that is doing the real
 * verification work; the scene itself is exercised separately.
 * Run: node demo/test/m13.browser.test.js
 */

const assert = require('assert');
const { start } = require('../server/httpServer');
const dataLoader = require('../server/dataLoader');
const browser = require('./support/browser');

let failures = 0;
// One retry per check. A headless browser rendering WebGL in software on a busy host can miss a deadline
// once (a lost reply, a slow shader compile); a genuine defect fails both attempts and is reported.
async function check(name, fn) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await fn();
      console.log(`  ok  ${name}${attempt > 1 ? '  (passed on retry — host was slow)' : ''}`);
      return;
    } catch (e) {
      if (attempt === 2) {
        failures += 1;
        console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
      } else {
        console.log(`  ..  ${name}: first attempt failed (${e.message.split('\n')[0].slice(0, 90)}) — retrying once`);
        await browser.sleep(1500);
      }
    }
  }
}

const noOverflow = "document.documentElement.scrollWidth <= document.documentElement.clientWidth";
const screenReady = "!!document.querySelector('.screen h1') && !document.querySelector('.screen .loading')";

async function main() {
  if (!browser.available()) {
    console.log('SKIP  no Chrome/Edge (or no global WebSocket) available — browser tests not run');
    return;
  }
  const server = start(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  const pairKey = dataLoader.load().pairs.find((p) => p.condition === 'weekend' && p.structuredDecisionChanged).pairingKey;

  const b = await browser.launch({ webgl: true });
  try {
    await b.viewport(1440, 900);

    await check('every route renders in a real browser with no console errors and no horizontal overflow (desktop)', async () => {
      const routes = ['#/lab', '#/cases', `#/pair/${pairKey}/counterfactual`, `#/pair/${pairKey}/chain`, `#/pair/${pairKey}/xray`, `#/pair/${pairKey}/provenance`, `#/pair/${pairKey}/baseline`, '#/integrity', '#/break', '#/timeline'];
      await b.goto(`${base}/?level=3#/lab`, 300);
      for (const r of routes) {
        await b.eval(`location.hash = ${JSON.stringify(r)}`);
        assert.ok(await b.waitFor(screenReady, 120000), `${r} never finished rendering`);
        await b.sleep(500);
        assert.ok(await b.eval(noOverflow), `${r} overflows horizontally at 1440px`);
      }
      assert.deepStrictEqual(b.errors(), [], JSON.stringify(b.errors()));
    });

    await check('the Lab states the experiment and the manipulation on first load: CDE, design, evidence boundary, and the corroboration-availability caveat', async () => {
      await b.goto(`${base}/?level=3#/lab`, 300);
      assert.ok(await b.waitFor(screenReady, 30000));
      const text = await b.eval('document.querySelector(".screen").innerText');
      for (const s of ['CDE', 'CORROBORATION DIFFERENTIAL ENGINE', 'An adversarial experiment against an LLM trading agent.', '41 PAIRED OBSERVATIONS', 'REPLAY-ONLY', 'REAL HISTORICAL PRICE', 'DERIVED MARKET FIELDS', 'NYSE open', 'NYSE closed', 'not a claim that weekend prices contain no information']) {
        assert.ok(text.toLowerCase().includes(s.toLowerCase()), `Lab is missing: ${s}`);
      }
      // the headline numbers count up (~0.7s) and must always land on their exact final values
      assert.ok(await b.waitFor("(() => { const t = document.querySelector('.screen').innerText; return t.includes('0.4909') && t.includes('-0.0025') && t.includes('[-0.0075, 0.0000]'); })()", 10000), 'result numbers never landed on their exact values');
    });

    await check('the Three.js scene really starts (scene-on, an active WebGL renderer) and can be driven', async () => {
      await b.goto(`${base}/#/lab`, 300);
      assert.ok(await b.waitFor("document.documentElement.classList.contains('scene-on')", 150000), 'scene never started');
      const stats = await b.eval("import('/js/visual/scene.js').then(m => ({ status: m.scene.status, s: m.scene.stats() }))");
      assert.strictEqual(stats.status, 'active');
      assert.ok(stats.s.calls > 0 && stats.s.geometries > 5, `renderer looks idle: ${JSON.stringify(stats.s)}`);
      assert.strictEqual(await b.eval("!!document.getElementById('scene-canvas') && getComputedStyle(document.getElementById('scene-canvas')).position === 'fixed'"), true, 'canvas must be fixed so it cannot shift layout');
      assert.strictEqual(await b.eval("import('/js/visual/motion.js').then(async m => { await m.motionReady(); return m.motionAvailable(); })"), true, 'Anime.js must load in the browser');
    });

    await check('the integrity chain says ON RECORD before any verification, then resolves from the real server result (Prompt stays RECORDED ONLY)', async () => {
      await b.goto(`${base}/?level=3#/integrity`, 300);
      assert.ok(await b.waitFor("document.querySelectorAll('.custody-node').length === 8", 30000));
      const before = await b.eval("[...document.querySelectorAll('.custody-node .pill')].map(p => p.textContent)");
      assert.deepStrictEqual(before, Array(8).fill('ON RECORD'));
      assert.ok(!(await b.eval('document.body.innerText')).includes('VERIFIED'), 'nothing may claim VERIFIED before a check has run');
      assert.ok(await b.clickText('button', 'VERIFY EXPERIMENT'));
      assert.ok(await b.waitFor("!!document.querySelector('.check-list')", 170000), 'verification never finished');
      const after = await b.eval("[...document.querySelectorAll('.custody-node')].map(n => n.dataset.key + ':' + n.dataset.state)");
      assert.deepStrictEqual(after, ['methodology:pass', 'analysis:pass', 'dataset:pass', 'model:pass', 'prompt:unchecked', 'tools:pass', 'corpus:pass', 'stopping:pass']);
      assert.ok((await b.eval('document.body.innerText')).includes('ALL CHECKS PASSED'));
    });

    await check('a tamper attack is shown as a broken chain on a disposable copy, names the invariant, and reports the canonical data untouched', async () => {
      await b.eval("location.hash = '#/break'");
      assert.ok(await b.waitFor("!!document.querySelector('button[data-scenario-key=\"methodology-hash\"]')", 30000));
      assert.ok(await b.click('button[data-scenario-key="methodology-hash"]'));
      assert.ok(await b.waitFor("document.querySelectorAll('.custody.compact .custody-node').length === 8", 120000), 'attack result never rendered');
      await b.sleep(3500);
      const states = await b.eval("Object.fromEntries([...document.querySelectorAll('.custody.compact .custody-node')].map(n => [n.dataset.key, n.dataset.state]))");
      assert.strictEqual(states.methodology, 'fail');
      assert.strictEqual(states.corpus, 'fail');
      assert.strictEqual(states.prompt, 'unchecked');
      const text = await b.eval('document.querySelector(".screen").innerText');
      assert.ok(text.includes('MUTATED A DISPOSABLE COPY') && text.includes('CANONICAL DATA: UNTOUCHED') && text.includes('pipeline_refused_to_run'));
    });

    await check('direct navigation and refresh both land on the same deep-linked screen', async () => {
      const url = `${base}/?level=3#/pair/${pairKey}/xray`;
      await b.goto(url, 300);
      assert.ok(await b.waitFor(screenReady, 30000));
      const hasXray = async () => (await b.eval('document.querySelector(".screen").innerText')).toLowerCase().includes('structured evidence x-ray');
      assert.ok(await hasXray());
      await b.send('Page.reload');
      await b.sleep(500);
      assert.ok(await b.waitFor(screenReady, 30000));
      assert.ok(await hasXray());
    });

    await check('an unknown pair and a zero-result filter show explicit states, not a blank or broken screen', async () => {
      await b.eval("location.hash = '#/pair/not-a-real-key/counterfactual'");
      assert.ok(await b.waitFor("!!document.querySelector('.error-box')", 30000));
      await b.eval("location.hash = '#/cases'");
      assert.ok(await b.waitFor("document.querySelectorAll('.case-card').length === 41", 30000));
      await b.eval("(() => { const sels = document.querySelectorAll('select'); sels[0].value = 'weekday'; sels[0].dispatchEvent(new Event('change')); sels[2].value = 'short'; sels[2].dispatchEvent(new Event('change')); })()");
      assert.ok(await b.waitFor("!!document.querySelector('.empty-state')", 30000));
    });

    await check('reduced motion: the scene goes fully static, numbers still land exactly, and nothing is left hidden', async () => {
      await b.reducedMotion(true);
      await b.goto(`${base}/#/lab`, 300);
      assert.ok(await b.waitFor("document.documentElement.classList.contains('scene-on')", 150000));
      const stats = await b.eval("import('/js/visual/scene.js').then(m => m.scene.stats())");
      assert.strictEqual(stats.reduced, true);
      assert.strictEqual(stats.still, true);
      assert.strictEqual(stats.looping, false, 'no animation loop may run under reduced motion');
      assert.ok((await b.eval('document.querySelector(".screen").innerText')).includes('0.4909'));
      assert.strictEqual(await b.eval("[...document.querySelectorAll('.panel')].every(p => getComputedStyle(p).opacity === '1')"), true);
      await b.reducedMotion(false);
    });

    await check('a forced quality level is respected, and level 0 runs the animation loop', async () => {
      await b.goto(`${base}/?level=0#/lab`, 300);
      assert.ok(await b.waitFor("document.documentElement.classList.contains('scene-on')", 150000));
      const s = await b.eval("import('/js/visual/scene.js').then(m => m.scene.stats())");
      assert.strictEqual(s.level, 0, 'a forced level must be respected');
      assert.strictEqual(s.looping, true);
    });

    await check('mobile (390px): the main screens have no horizontal overflow and hashes wrap instead of clipping', async () => {
      await b.viewport(390, 844, true);
      await b.goto(`${base}/?level=3#/lab`, 300);
      for (const r of ['#/lab', '#/cases', `#/pair/${pairKey}/counterfactual`, '#/integrity', '#/timeline']) {
        await b.eval(`location.hash = ${JSON.stringify(r)}`);
        assert.ok(await b.waitFor(screenReady, 120000), r);
        await b.sleep(500);
        assert.ok(await b.eval(noOverflow), `${r} overflows horizontally at 390px`);
      }
      await b.viewport(768, 1024, true);
      for (const r of ['#/lab', '#/integrity']) {
        await b.eval(`location.hash = ${JSON.stringify(r)}`);
        assert.ok(await b.waitFor(screenReady, 30000), r);
        assert.ok(await b.eval(noOverflow), `${r} overflows horizontally at 768px`);
      }
      await b.viewport(1440, 900);
    });

    await check('Judge Mode can be interrupted by the judge, and manual exploration works normally afterwards', async () => {
      await b.goto(`${base}/?level=3#/lab`, 300);
      assert.ok(await b.waitFor(screenReady, 30000));
      assert.ok(await b.clickText('button', 'START 90-SECOND DEMO'));
      assert.ok(await b.waitFor("!!document.getElementById('judge-bar')", 30000), 'judge bar never appeared');
      await b.sleep(1500);
      assert.ok(await b.click('a.navlink[href="#/cases"]'));
      assert.ok(await b.waitFor("!document.getElementById('judge-bar')", 15000), 'clicking elsewhere must stop the walkthrough');
      assert.ok(await b.waitFor("document.querySelectorAll('.case-card').length === 41", 30000), 'manual navigation must work after an interruption');
      await b.sleep(3000);
      assert.strictEqual(await b.eval("!!document.getElementById('judge-bar')"), false, 'the walkthrough must not resume by itself');
    });

    await check('the whole browser session raised no console errors or uncaught exceptions', async () => {
      // The only console error allowed is the browser's own log of the deliberate 404 from the unknown-pair check above.
      const unexpected = b.errors().filter((e) => !/status of 404.*\/api\/pairs\/not-a-real-key/.test(e.text));
      assert.deepStrictEqual(unexpected, [], JSON.stringify(unexpected));
    });
  } finally {
    await b.close();
  }

  // ---- a browser with WebGL switched off entirely: the app must work without it ----
  const nb = await browser.launch({ webgl: false });
  try {
    await nb.viewport(1440, 900);
    await check('WebGL fallback (browser with WebGL disabled): the app renders, scene-off is set, and a tamper attack still resolves', async () => {
      await nb.goto(`${base}/#/lab`, 300);
      assert.ok(await nb.waitFor(screenReady, 30000));
      assert.ok(await nb.waitFor("document.documentElement.classList.contains('scene-off')", 90000), 'fallback class never set');
      assert.strictEqual(await nb.eval("document.documentElement.classList.contains('scene-on')"), false);
      await nb.eval("location.hash = '#/break'");
      assert.ok(await nb.waitFor("!!document.querySelector('button[data-scenario-key=\"duplicate-pair\"]')", 30000));
      assert.ok(await nb.click('button[data-scenario-key="duplicate-pair"]'));
      assert.ok(await nb.waitFor("document.querySelectorAll('.custody.compact .custody-node').length === 8", 120000));
      await nb.sleep(3500);
      assert.strictEqual(await nb.eval("document.querySelector('.custody-node[data-key=\"dataset\"]').dataset.state"), 'fail');
      assert.deepStrictEqual(nb.errors(), [], JSON.stringify(nb.errors()));
    });
  } finally {
    await nb.close();
  }

  await new Promise((r) => server.close(r));
  console.log(`\n${failures === 0 ? 'ALL DEMO M13 (BROWSER) TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M13 test runner crashed:', err);
  process.exitCode = 1;
});
