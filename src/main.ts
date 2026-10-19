import { Game, webglAvailable } from './core/game';
import { loadSettings } from './core/config';
import { setLanguage, t } from './localization/i18n';
import { runShowcase } from './dev/showcase';

const canvas = document.getElementById('game') as HTMLCanvasElement;
let game: Game | null = null;

if (!webglAvailable()) {
  setLanguage(loadSettings().language);
  document.getElementById('ui')!.innerHTML = `<div class="menu"><div class="card"><h1>${t('game.title')}</h1><p>${t('menu.noWebgl')}</p></div></div>`;
} else if (new URLSearchParams(location.search).has('showcase')) {
  runShowcase(canvas);
} else {
  game = new Game(canvas);
  void game.boot();
}

/** Offline support: register the generated service worker and report its cache state in the menu. */
function setStatus(text: string): void {
  const net = navigator.onLine ? '' : ` · ${t('offline.noNetwork')}`;
  game?.hud.setOfflineStatus(text + net);
  (window as unknown as { __offline: string }).__offline = text;
}

if (!('serviceWorker' in navigator)) setStatus(t('offline.unavailable'));
else if (!import.meta.env.PROD) setStatus(t('offline.dev'));
else {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; cached: number; total: number };
    if (d?.type !== 'offline-status') return;
    setStatus(d.cached >= d.total ? t('offline.ready') : t('offline.caching', { n: d.cached, m: d.total }));
  });
  // An updated version took over (new models, new code): reload once so this visit
  // already shows them instead of what the previous version had cached.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then(async () => {
      const reg = await navigator.serviceWorker.ready;
      const ask = () => (navigator.serviceWorker.controller ?? reg.active)?.postMessage('status');
      ask();
      const timer = setInterval(ask, 1500);
      setTimeout(() => clearInterval(timer), 60000);
    })
    .catch(() => setStatus(t('offline.unavailable')));
  addEventListener('online', () => navigator.serviceWorker.controller?.postMessage('status'));
  addEventListener('offline', () => setStatus(t('offline.noNetwork')));
}
