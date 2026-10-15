import { Game, webglAvailable } from './core/game';
import { loadSettings } from './core/config';
import { setLanguage, t } from './localization/i18n';
import { runShowcase } from './dev/showcase';

const canvas = document.getElementById('game') as HTMLCanvasElement;

if (!webglAvailable()) {
  setLanguage(loadSettings().language);
  document.getElementById('ui')!.innerHTML = `<div class="menu"><div class="card"><h1>${t('game.title')}</h1><p>${t('menu.noWebgl')}</p></div></div>`;
} else if (new URLSearchParams(location.search).has('showcase')) {
  runShowcase(canvas);
} else {
  const game = new Game(canvas);
  void game.boot();
}

// Offline support: cache the built game after the first visit (production only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline mode is optional */
    });
  });
}
