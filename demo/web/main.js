import { el } from './api.js';
import { renderLab } from './screens/lab.js';

const NAV = [
  { idx: '01', hash: '#/lab', label: 'The Lab', render: renderLab },
];

const app = document.getElementById('app');

function buildShell() {
  const sidenav = el('nav', { class: 'sidenav' }, [
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
        el('a', { class: `navlink${active ? ' active' : ''}`, href: item.hash }, [el('span', { class: 'idx' }, item.idx), item.label]),
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
  renderNav();
  const main = document.getElementById('main');
  main.innerHTML = '';
  const route = currentRoute();
  const hash = location.hash || NAV[0].hash;
  const rest = hash.slice(route.hash.length).replace(/^\//, '');
  try {
    await route.render(main, rest);
  } catch (err) {
    main.appendChild(el('div', { class: 'error-box' }, `Failed to render screen: ${err.message}`));
    console.error(err);
  }
}

window.addEventListener('hashchange', renderRoute);

buildShell();
if (!location.hash) location.hash = NAV[0].hash;
renderRoute();

export { NAV };
