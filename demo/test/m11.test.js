'use strict';
/**
 * Phase 7 — honesty/terminology guardrails. Static checks over the demo
 * sources so the wording fixes from the hostile-judge audit cannot
 * silently regress: no pre-verification "VERIFIED" claim, no
 * significance/profit language, no reuse of REAL/DERIVED styling for the
 * unrelated weekday/weekend condition, and every web import resolves.
 * Run: node demo/test/m11.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { start } = require('../server/httpServer');
const { fetchRetry: fetch } = require('./testUtil');

const DEMO = path.join(__dirname, '..');
const REPO = path.join(DEMO, '..');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
  }
}

function sources(dir, exts) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => p.endsWith(e))) out.push({ p, src: fs.readFileSync(p, 'utf8') });
    }
  })(dir);
  return out;
}

async function main() {
  const web = sources(path.join(DEMO, 'web'), ['.js', '.html']);
  const server = sources(path.join(DEMO, 'server'), ['.js']);

  await check('no interpretive statistical or performance language anywhere in demo/ (significant, robust, vulnerable, profit, performance, accuracy, prediction)', () => {
    const banned = /\b(significant|insignificant|robust|vulnerable|vulnerability|profit|profitable|performance|accuracy|accurate|prediction|predictive)\b/i;
    for (const { p, src } of [...web, ...server]) {
      // The one sanctioned use is the Lab's explicit negation: "never a profit, return, or P&L figure".
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/never a profit, return, or P&L figure/g, '');
      const m = stripped.match(banned);
      assert.ok(!m, `${path.relative(REPO, p)} contains "${m && m[0]}"`);
    }
  });

  await check('the identity list is not stamped VERIFIED before any check has run (only PASS/FAIL after a real verification)', () => {
    const integrity = fs.readFileSync(path.join(DEMO, 'web', 'screens', 'integrity.js'), 'utf8');
    assert.ok(!/'VERIFIED'/.test(integrity), 'integrity.js must not hardcode a VERIFIED badge');
    assert.ok(integrity.includes('ON RECORD'));
    assert.ok(!integrity.includes('Live Verification'));
  });

  await check('weekday/weekend badges never reuse the REAL/DERIVED provenance badge classes', () => {
    for (const { p, src } of web) {
      assert.ok(!/condition === 'weekend' \? 'derived'/.test(src), `${path.relative(REPO, p)} conflates condition with provenance styling`);
    }
    const css = fs.readFileSync(path.join(DEMO, 'web', 'styles', 'main.css'), 'utf8');
    assert.ok(css.includes('.badge.weekend') && css.includes('.badge.weekday'));
  });

  await check('exposure is always labeled with its scale wherever a raw exposure value is shown', () => {
    for (const { p, src } of web) {
      assert.ok(!/el\('dt', \{\}, 'Exposure'\)/.test(src), `${path.relative(REPO, p)} shows an unlabeled Exposure value`);
    }
  });

  await check('the claim-template corpus is labeled "Claim corpus", not "Attack corpus", so it cannot be confused with Break the Experiment', async () => {
    const s = start(0);
    await new Promise((r) => s.once('listening', r));
    const base = `http://localhost:${s.address().port}`;
    const { identity } = await (await fetch(`${base}/api/integrity/identity`)).json();
    const labels = identity.map((r) => r.label);
    assert.ok(labels.includes('Claim corpus') && !labels.includes('Attack corpus'));
    const keys = (await (await fetch(`${base}/api/pairs`)).json()).pairs;
    const prov = await (await fetch(`${base}/api/pairs/${keys[0].pairingKey}/provenance`)).json();
    assert.strictEqual(prov.experiment.classification, 'CONFIRMATORY DATASET');
    await new Promise((r) => s.close(r));
  });

  await check('the Case Files gallery has an explicit empty state for zero-result filters, and the API really can return zero', async () => {
    const s = start(0);
    await new Promise((r) => s.once('listening', r));
    const base = `http://localhost:${s.address().port}`;
    const body = await (await fetch(`${base}/api/pairs?condition=weekday&direction=short`)).json();
    assert.strictEqual(body.count, 0);
    assert.ok(fs.readFileSync(path.join(DEMO, 'web', 'screens', 'casefiles.js'), 'utf8').includes('empty-state'));
    await new Promise((r) => s.close(r));
  });

  await check('every web ES-module import resolves to a real export', () => {
    let problems = 0;
    for (const { p, src } of web.filter((f) => f.p.endsWith('.js'))) {
      for (const m of src.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)) {
        const target = path.join(path.dirname(p), m[2]);
        assert.ok(fs.existsSync(target), `${path.relative(REPO, p)} imports missing file ${m[2]}`);
        const tsrc = fs.readFileSync(target, 'utf8');
        for (const name of m[1].split(',').map((s) => s.trim())) {
          const re = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`);
          if (!re.test(tsrc)) problems += 1;
        }
      }
    }
    assert.strictEqual(problems, 0);
  });

  await check('keyboard focus styling exists and clickable non-button elements are keyboard-operable', () => {
    const css = fs.readFileSync(path.join(DEMO, 'web', 'styles', 'main.css'), 'utf8');
    assert.ok(css.includes(':focus-visible'));
    const api = fs.readFileSync(path.join(DEMO, 'web', 'api.js'), 'utf8');
    assert.ok(/export function clickable/.test(api) && api.includes("'Enter'"));
    assert.ok(fs.readFileSync(path.join(DEMO, 'web', 'screens', 'casefiles.js'), 'utf8').includes('clickable('));
  });

  await check('npm run demo works on Windows/UNC checkouts: .npmrc pins a script shell that can start there', () => {
    const rc = fs.readFileSync(path.join(REPO, '.npmrc'), 'utf8');
    assert.ok(/^script-shell=/m.test(rc));
  });

  console.log(`\n${failures === 0 ? 'ALL DEMO M11 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('Demo M11 test runner crashed:', err);
  process.exitCode = 1;
});
