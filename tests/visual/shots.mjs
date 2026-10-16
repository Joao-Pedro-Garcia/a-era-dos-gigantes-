/**
 * Visual capture of fixed scenes for before/after comparisons.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   PLAYWRIGHT=/path/to/node_modules/playwright node tests/visual/shots.mjs outDir [quality]
 *
 * Software rendering (SwiftShader) is slow, so every scene waits for frames
 * instead of fixed sleeps. Images are real renders of the production build.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const URL = process.env.URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'high';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(out, { recursive: true });
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });

const frames = async (page, n, ms = 120000) => {
  const f0 = await page.evaluate(() => window.__edg?.frames ?? 0);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__edg?.frames ?? 0)) >= f0 + n) return;
    await page.waitForTimeout(200);
  }
};

async function game(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console', m.type(), m.text().slice(0, 400)));
  await page.addInitScript((q) => localStorage.setItem('edg.settings.v1', JSON.stringify({ quality: q, language: 'pt-BR' })), quality);
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('era-dos-gigantes'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Novo jogo' }).click();
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && (await page.evaluate(() => window.__edg?.state)) !== 'playing') await page.waitForTimeout(250);
  return { ctx, page };
}

/** Moves the player, sets the time of day (0..1) and the view. */
const setScene = (page, s) =>
  page.evaluate((s) => {
    const g = window.__edg;
    const DAY = g.env.dayLength ?? 1200;
    if (s.time != null) g.env.state.time = Math.floor(g.env.state.time / DAY) * DAY + s.time * DAY;
    if (s.weather) { g.env.state.weather = s.weather; g.env.state.intensity = s.intensity ?? 0.8; }
    if (s.clear) { g.env.state.weather = 'clear'; g.env.state.intensity = 0; }
    if (s.x != null) { g.player.s.x = s.x; g.player.s.z = s.z; g.player.s.y = g.terrain.height(s.x, s.z); }
    if (s.yaw != null) g.player.s.yaw = s.yaw;
    if (s.pitch != null) g.player.s.pitch = s.pitch;
    if (s.fp != null) g.applySettings({ firstPerson: s.fp });
    if (s.dist != null) g.rig.distance = s.dist;
  }, s);

/** Finds a spot in a given biome near the start. */
const findBiome = (page, biome) =>
  page.evaluate((biome) => {
    const g = window.__edg;
    const p = g.player.s;
    for (let r = 0; r < 3000; r += 40)
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (g.terrain.biomeAt(x, z) === biome && g.terrain.height(x, z) > g.env.waterLevel + 1) return { x, z };
      }
    return null;
  }, biome);

const scenes = /** @type {[string, (page: any) => Promise<void>][]} */ ([
  ['01-start-third-person', async (page) => { await setScene(page, { time: 0.4, clear: true, pitch: -0.12, dist: 5 }); }],
  ['02-landscape', async (page) => { await setScene(page, { time: 0.42, clear: true, pitch: 0.05, dist: 7 }); }],
  ['03-forest', async (page) => { const s = await findBiome(page, 'forest') ?? await findBiome(page, 'jungle'); if (s) await setScene(page, { ...s, time: 0.45, clear: true, pitch: -0.05, dist: 5 }); }],
  ['04-dinosaur', async (page) => {
    await page.evaluate(() => {
      const g = window.__edg;
      const p = g.player.s;
      let best = null; let bd = Infinity;
      for (const a of g.eco.animals.values()) { const d = Math.hypot(a.x - p.x, a.z - p.z); if (d < bd && d > 8 && a.alive) { bd = d; best = a; } }
      if (best) { p.x = best.x + 12; p.z = best.z + 12; p.y = g.terrain.height(p.x, p.z); p.yaw = Math.atan2(best.x - p.x, best.z - p.z); }
    });
    await setScene(page, { time: 0.38, clear: true, pitch: -0.05, dist: 5 });
  }],
  ['05-sunset', async (page) => { await setScene(page, { time: 0.73, clear: true, pitch: 0.02, dist: 6 }); }],
  ['06-rain', async (page) => { await setScene(page, { time: 0.5, weather: 'rain', intensity: 0.8, pitch: -0.05, dist: 5 }); }],
  ['07-first-person', async (page) => { await setScene(page, { time: 0.45, clear: true, pitch: -0.1, fp: true }); }],
  ['08-night', async (page) => { await setScene(page, { time: 0.95, clear: true, pitch: -0.05, dist: 5, fp: false }); }],
  ['11-water', async (page) => {
    // A shoreline: dry ground a few metres from open water, facing the water.
    const spot = await page.evaluate(() => {
      const g = window.__edg;
      const p = g.player.s;
      for (let r = 20; r < 3000; r += 15)
        for (let a = 0; a < Math.PI * 2; a += 0.2) {
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          if (g.terrain.height(x, z) < g.env.waterLevel - 1.5) {
            // Walk back toward the player until on dry land.
            for (let k = 1; k < 40; k++) {
              const bx = x - Math.cos(a) * k * 2;
              const bz = z - Math.sin(a) * k * 2;
              if (g.terrain.height(bx, bz) > g.env.waterLevel + 0.8) return { x: bx - Math.cos(a) * 4, z: bz - Math.sin(a) * 4, yaw: Math.atan2(Math.cos(a), Math.sin(a)) };
            }
          }
        }
      return null;
    });
    if (spot) await setScene(page, { ...spot, time: 0.42, clear: true, pitch: -0.12, dist: 5, fp: false });
  }],
]);

{
  const { ctx, page } = await game({ width: 1280, height: 720 });
  for (const [name, fn] of scenes) {
    if (only && !only.some((o) => name.includes(o))) continue;
    await fn(page);
    await frames(page, 25);
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
    console.log('shot', name);
  }
  await ctx.close();
}
if (!only || only.includes('phone')) {
  const { ctx, page } = await game({ width: 412, height: 915 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await setScene(page, { time: 0.4, clear: true, pitch: -0.12 });
  await frames(page, 25);
  await page.screenshot({ path: `${out}/09-phone-portrait.png` });
  console.log('shot 09-phone-portrait');
  await ctx.close();
}
if (!only || only.includes('showcase')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  for (const id of ['tyrannosaurus', 'triceratops', 'parasaurolophus', 'velociraptor']) {
    await page.goto(`${URL}?showcase&species=${id}&side`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__showcaseReady, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/10-species-${id}.png` });
    console.log('shot species', id);
  }
  await ctx.close();
}
await browser.close();
