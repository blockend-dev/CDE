import { el } from './api.js';
import { renderLab } from './screens/lab.js';
import { renderPairDetail } from './screens/pairDetail.js';
import { renderIntegrity } from './screens/integrity.js';
import { renderBreak } from './screens/break.js';
import { renderCaseFiles } from './screens/casefiles.js';
import { renderTimeline } from './screens/timeline.js';
import { initScene, scene } from './visual/scene.js';
import { initGlass } from './visual/glass.js';
import { enter, cancelAll } from './visual/motion.js';

const NAV = [
  { idx: '01', hash: '#/lab', label: 'The Lab', render: renderLab },
  { idx: '02', hash: '#/cases', label: 'Case Files', render: renderCaseFiles },
  { idx: '03', hash: '#/pair', label: 'Counterfactual Lab', render: renderPairDetail },
  { idx: '04', hash: '#/integrity', label: 'Integrity Console', render: renderIntegrity },
  { idx: '05', hash: '#/break', label: 'Break The Experiment', render: renderBreak },
  { idx: '06', hash: '#/timeline', label: 'Timeline', render: renderTimeline },
];

const app = document.getElementById('app');

function buildShell() {
  const sidenav = el('nav', { class: 'sidenav', 'aria-label': 'Primary' }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'brand-mark' }, 'CDE // Adversarial Lab'),
      el('div', { class: 'brand-sub' }, 'Corroboration Differential Engine'),
    ]),
    el('ul', { class: 'navlist', id: 'navlist' }),
  ]);
  const main = el('main', { class: 'main', id: 'main' });
  app.appendChild(el('div', { class: 'shell' }, [sidenav, main]));
  renderNav();
}

function renderNav() {
  const list = document.getElementById('navlist');
  list.innerHTML = '';
  const current = location.hash || NAV[0].hash;
  for (const item of NAV) {
    const active = current.startsWith(item.hash);
    list.appendChild(
      el('li', {}, [
        el('a', { class: `navlink${active ? ' active' : ''}`, href: item.hash, 'aria-current': active ? 'page' : null }, [el('span', { class: 'idx' }, item.idx), item.label]),
      ])
    );
  }
}

function currentRoute() {
  const hash = location.hash || NAV[0].hash;
  const [base] = hash.split('?');
  const match = NAV.find((n) => base === n.hash || base.startsWith(n.hash + '/'));
  return match || NAV[0];
}

async function renderRoute() {
  cancelAll(); // stop every in-flight animation from the screen we are leaving
  scene.restore(); // and return the ambient field to its resting state
  renderNav();
  const main = document.getElementById('main');
  // Each render gets its own container. If the user navigates again while an
  // older screen is still loading, that screen writes into a detached node
  // and can never paint over the new one.
  const screen = el('div', { class: 'screen' });
  main.replaceChildren(screen);
  enter(screen);
  const route = currentRoute();
  const hash = location.hash || NAV[0].hash;
  const rest = hash.slice(route.hash.length).replace(/^\//, '');
  try {
    await route.render(screen, rest);
  } catch (err) {
    screen.appendChild(el('div', { class: 'error-box' }, `Failed to render screen: ${err.message}`));
    console.error(err);
  }
}

window.addEventListener('hashchange', renderRoute);

buildShell();
initGlass();
if (!location.hash) history.replaceState(null, '', NAV[0].hash); // no hashchange event, so no double render
renderRoute();
// The ambient scene starts in parallel and never blocks first paint; any
// scene state a screen requested before it was ready is replayed on start.
initScene(document.getElementById('scene-canvas'));

export { NAV };
