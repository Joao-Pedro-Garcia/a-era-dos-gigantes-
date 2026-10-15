/**
 * End-to-end checks in a real browser (Chromium via Playwright).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   PLAYWRIGHT=/path/to/node_modules/playwright node tests/e2e/run.mjs [outDir]
 *
 * Playwright is not a project dependency (it downloads browsers); point the
 * PLAYWRIGHT env var at an existing installation. Results are printed as
 * PASS/FAIL lines and a JSON summary; screenshots go to outDir.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const URL = process.env.URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'e2e-out';
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const browser = await chromium.launch({ args });
const errors = [];
const external = new Set();

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript(fastSettings);
  page.on('pageerror', (e) => errors.push(`${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    if (!r.url().startsWith(URL) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.add(r.url());
  });
  return { ctx, page };
}
const waitState = async (page, state, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__edg?.state)) === state) return true;
    await page.waitForTimeout(250);
  }
  return false;
};
const ev = (page, fn, arg) => page.evaluate(fn, arg);
/** Polls a condition in the page (software rendering is slow: never rely on fixed sleeps). */
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
/** Presses a key and waits until the game has processed at least two frames. */
const press = async (page, key) => {
  const f0 = await page.evaluate(() => window.__edg.frames ?? 0);
  await page.keyboard.press(key);
  await until(page, (f) => (window.__edg.frames ?? 0) > f + 1, f0, 10000);
};
const fastSettings = () => localStorage.setItem('edg.settings.v1', JSON.stringify({ quality: 'low', graphics: { resolutionScale: 0.5 } }));

// ---------------------------------------------------------------- main flow
{
  const { ctx, page } = await newPage();
  try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('era-dos-gigantes'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  check('boot: main menu visible', await page.locator('.menu .card h1').isVisible());
  const offline = await page.evaluate(() => window.__offline ?? '');
  check('boot: offline status reported', offline.length > 0, offline);

  await page.getByRole('button', { name: 'Novo jogo' }).click();
  check('new game reaches playing state', await waitState(page, 'playing'));
  await page.screenshot({ path: `${out}/e2e-01-start.png` });

  // Movement with the real keyboard.
  const p0 = await ev(page, () => ({ ...window.__edg.player.s }));
  await page.keyboard.down('KeyW');
  await until(page, (p) => Math.hypot(window.__edg.player.s.x - p.x, window.__edg.player.s.z - p.z) > 1, p0, 15000);
  await page.keyboard.up('KeyW');
  const p1 = await ev(page, () => ({ ...window.__edg.player.s }));
  check('movement: W moves the player forward', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.5, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);

  // Collision against a tree trunk.
  const col = await ev(page, () => {
    const g = window.__edg;
    const n = g.sectors.nodesNear(g.player.s.x, g.player.s.z, 120).find((x) => x.colliderId && (x.kind === 'broadleaf' || x.kind === 'conifer' || x.kind === 'palm'));
    if (!n) return null;
    const c = g.collision.get(n.colliderId);
    g.player.s.x = n.x;
    g.player.s.z = n.z - c.r - 3;
    g.player.s.y = g.terrain.height(g.player.s.x, g.player.s.z);
    g.player.s.yaw = 0;
    return { x: n.x, z: n.z, r: c.r };
  });
  if (col) {
    await page.keyboard.down('KeyW');
    const f0 = await page.evaluate(() => window.__edg.frames);
    await until(page, (f) => window.__edg.frames > f + 40, f0, 30000);
    await page.keyboard.up('KeyW');
    const pp = await ev(page, () => ({ ...window.__edg.player.s }));
    check('collision: player cannot walk through a tree', Math.hypot(pp.x - col.x, pp.z - col.z) >= col.r + 0.3, `dist ${Math.hypot(pp.x - col.x, pp.z - col.z).toFixed(2)} r ${col.r.toFixed(2)}`);
    // Gather with E (real key) while facing the tree.
    const before = await ev(page, () => window.__edg.inventory.count('wood'));
    await until(page, () => /Coletar/.test(document.querySelector('.prompt')?.textContent ?? ''));
    const prompt = await page.locator('.prompt').textContent();
    await press(page, 'KeyE');
    const after = await ev(page, () => window.__edg.inventory.count('wood'));
    check('gathering: E collects wood from the tree in front', after > before, `prompt="${prompt}" ${before}->${after}`);
  } else check('collision: found a tree to test', false);

  // Crafting through the UI (Tab → Fabricação → Fabricar).
  await ev(page, () => window.__edg.inventory.addAll({ fiber: 20, flint: 6, wood: 10 }));
  await press(page, 'Tab');
  await until(page, () => window.__edg.hud.panelOpen);
  await page.locator('.tabs button', { hasText: 'Fabricação' }).click();
  await page.waitForTimeout(300);
  await page.locator('.recipe').first().getByRole('button', { name: 'Fabricar' }).click(); // first recipe: rope
  const q = await ev(page, () => window.__edg.crafting.queue.length);
  check('crafting: UI button starts a job and consumes materials', q === 1 && (await ev(page, () => window.__edg.inventory.count('fiber'))) === 17);
  await page.screenshot({ path: `${out}/e2e-02-crafting.png` });
  for (const tab of ['Habilidades', 'Animais', 'Diário de campo', 'Mapa']) {
    await page.locator('.tabs button', { hasText: tab }).click();
    await page.waitForTimeout(tab === 'Mapa' ? 2500 : 300);
    await page.screenshot({ path: `${out}/e2e-03-tab-${tab.replace(/\W+/g, '_')}.png` });
  }
  check('panels: skills/animals/journal/map render', (await page.locator('.panel-body canvas').count()) === 1);
  await press(page, 'Escape');
  await until(page, () => !window.__edg.hud.panelOpen);

  // Building: B, place a foundation in front, demolish it.
  await ev(page, () => { const g = window.__edg; g.inventory.addAll({ wood: 30, stone: 30 }); g.player.s.pitch = -0.2; });
  await press(page, 'KeyB');
  await until(page, () => window.__edg.building && !!document.querySelector('.buildbar:not(.hidden)'));
  await until(page, () => /encaixe/.test(document.querySelector('.buildbar .info')?.textContent ?? ''));
  const placed = await ev(page, () => window.__edg.buildingSys.pieces.size);
  for (let i = 0; i < 5 && (await ev(page, () => window.__edg.buildingSys.pieces.size)) === placed; i++) {
    await ev(page, () => window.__edg.input.touchPress('attack'));
    await until(page, (n) => window.__edg.buildingSys.pieces.size > n, placed, 3000);
    if ((await ev(page, () => window.__edg.buildingSys.pieces.size)) === placed) await ev(page, () => { window.__edg.player.s.yaw += 0.8; });
  }
  const placedAfter = await ev(page, () => window.__edg.buildingSys.pieces.size);
  await page.screenshot({ path: `${out}/e2e-04-build.png` });
  check('building: preview + place adds a piece', placedAfter === placed + 1, `${placed}->${placedAfter} (${await page.locator('.buildbar .info').textContent()})`);
  await press(page, 'KeyX');
  check('building: X demolishes it', await until(page, (n) => window.__edg.buildingSys.pieces.size === n, placed, 5000));
  await press(page, 'KeyB');
  await until(page, () => !window.__edg.building);

  // Taming: offer preferred food with E to a nearly-tame animal, then command it from the panel.
  const tame = await ev(page, () => {
    const g = window.__edg;
    const p = g.player.s;
    const rng = g.rng;
    const grp = g.eco.spawnGroup('protoceratops', p.x, p.z + 4, rng);
    const a = grp[0];
    a.x = p.x; a.z = p.z + 3; a.hunger = 0.9; a.tameProgress = 0.97; a.fear = 0; a.trustPlayer = 0.3; a.state = 'idle';
    p.yaw = 0;
    g.inventory.add('feed_mix', 3);
    const slot = g.inventory.data.slots.findIndex((s) => s?.id === 'feed_mix');
    g.assignHotbar(slot, 5);
    g.selectedHotbar = 5;
    return a.id;
  });
  await page.waitForTimeout(500);
  await ev(page, (id) => { const a = window.__edg.eco.get(id); const p = window.__edg.player.s; a.x = p.x; a.z = p.z + 3; a.state = 'idle'; a.fear = 0; }, tame);
  await until(page, () => /Oferecer/.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 8000);
  await press(page, 'KeyE');
  await until(page, (id) => !!window.__edg.eco.get(id)?.tame, tame, 5000);
  const isTame = await ev(page, (id) => !!window.__edg.eco.get(id)?.tame, tame);
  check('taming: feeding with E completes taming', isTame);
  if (isTame) {
    await ev(page, (id) => window.__edg.openAnimalPanel(id), tame);
    await page.waitForTimeout(400);
    // A well-fed, trained animal (hungry ones may ignore commands by design).
    await ev(page, (id) => { const a = window.__edg.eco.get(id); a.tame.obedience = 1; a.hunger = 0.1; a.thirst = 0.1; a.fear = 0; }, tame);
    await page.locator('.box.animal').first().getByRole('button', { name: 'Ficar' }).click();
    await until(page, (id) => window.__edg.eco.get(id).tame.command === 'stay', tame, 5000);
    await page.screenshot({ path: `${out}/e2e-05-animals.png` });
    check('taming: command from the animals panel', (await ev(page, (id) => window.__edg.eco.get(id).tame.command, tame)) === 'stay');
    await press(page, 'Escape');
    await until(page, () => !window.__edg.hud.panelOpen);
  }

  // Cave: clear rubble, enter with E, read the painting, leave.
  const cave = await ev(page, () => {
    const g = window.__edg;
    const s = g.sectors ? null : null;
    void s;
    const site = { x: -900, z: -900, id: 'cave_spine_east' };
    g.player.s.x = site.x; g.player.s.z = site.z + 6; g.player.s.y = g.terrain.height(site.x, site.z + 6) + 1;
    g.sectors.update(site.x, site.z, g.quality(), g.env.state.time, 1e9);
    const rubble = g.sectors.nodesNear(site.x, site.z, 20).find((n) => n.kind === 'rubble');
    if (rubble) while (!g.sectors.hitNode(rubble, g.env.state.time, 1));
    g.player.s.yaw = Math.PI;
    g.player.s.z = site.z + 4;
    g.inventory.add('torch', 1);
    return site;
  });
  await until(page, () => /Entrar/.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 10000);
  await press(page, 'KeyE');
  await until(page, () => !!window.__edg.inCave, undefined, 5000);
  check('cave: entering with E after clearing rubble', (await ev(page, () => window.__edg.inCave)) === 'cave_spine_east');
  await ev(page, () => { const g = window.__edg; const t = g.inventory.data.slots.findIndex((s) => s?.id === 'torch'); g.assignHotbar(t, 0); g.selectedHotbar = 0; g.player.s.z = -900 - 10; g.player.s.x = -900; g.player.s.yaw = Math.PI; });
  await until(page, () => /pintura/i.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 10000);
  await page.screenshot({ path: `${out}/e2e-06-cave.png` });
  await press(page, 'KeyE');
  await until(page, () => window.__edg.mysteries.paintingsSeen() === 1, undefined, 5000);
  check('cave: painting read and counted', (await ev(page, () => window.__edg.mysteries.paintingsSeen())) === 1);
  await page.screenshot({ path: `${out}/e2e-07-painting.png` });
  if (await ev(page, () => window.__edg.hud.documentOpen)) {
    await page.getByRole('button', { name: 'Fechar' }).click();
    await until(page, () => !window.__edg.hud.documentOpen);
  }
  await ev(page, (c) => { const g = window.__edg; g.player.s.x = c.x; g.player.s.z = c.z + 11; g.player.s.yaw = 0; }, cave);
  await until(page, () => /Sair/.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 10000);
  await press(page, 'KeyE');
  await until(page, () => window.__edg.inCave === null, undefined, 5000);
  check('cave: leaving returns to the surface', (await ev(page, () => window.__edg.inCave)) === null);

  // Mystery: open the bunker with the keycard and reach the secret ending.
  const bunker = await ev(page, () => {
    const g = window.__edg;
    const site = { x: 1600, z: -1100 };
    g.player.s.x = site.x; g.player.s.z = site.z; g.player.s.y = g.terrain.height(site.x, site.z) + 1;
    g.sectors.update(site.x, site.z, g.quality(), g.env.state.time, 1e9);
    const door = g.sectors.interactablesNear(site.x, site.z, 120).find((i) => i.id === 'door:bunker');
    g.inventory.add('keycard', 1);
    g.player.s.x = door.x + Math.sin(0) * 0; // stand in front of the door, facing it
    const ang = Math.random();
    void ang;
    g.player.s.x = door.x; g.player.s.z = door.z - 2; g.player.s.yaw = 0;
    return { x: door.x, z: door.z };
  });
  await page.waitForTimeout(600);
  let opened = false;
  for (const [dx, dz, yaw] of [[0, -2, 0], [0, 2, Math.PI], [-2, 0, Math.PI / 2], [2, 0, -Math.PI / 2]]) {
    await ev(page, ([b, dx, dz, yaw]) => { const g = window.__edg; g.player.s.x = b.x + dx; g.player.s.z = b.z + dz; g.player.s.yaw = yaw; }, [bunker, dx, dz, yaw]);
    await until(page, () => /trancada/.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 4000);
    await press(page, 'KeyE');
    if (await until(page, () => window.__edg.mysteries.d.bunkerOpen, undefined, 3000)) { opened = true; break; }
  }
  check('mystery: keycard opens the bunker door', opened);
  await ev(page, () => {
    const g = window.__edg;
    for (const id of ['outpost_log', 'jungle_log', 'swamp_log', 'observatory_log', 'bunker_log', 'painting_spine', 'painting_ice', 'painting_lava']) g.mysteries.read(id, true, () => true);
    g.inventory.add('calibration_core', 1);
    g.inventory.add('battery', 2);
    const site = { x: -400, z: -2600 };
    g.player.s.x = site.x; g.player.s.z = site.z; g.player.s.y = g.terrain.height(site.x, site.z) + 1;
    g.sectors.update(site.x, site.z, g.quality(), g.env.state.time, 1e9);
    const b = g.sectors.interactablesNear(site.x, site.z, 120).find((i) => i.id === 'beacon');
    g.player.s.x = b.x; g.player.s.z = b.z - 2.5; g.player.s.yaw = 0;
  });
  await until(page, () => /farol/i.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 10000);
  await press(page, 'KeyE'); // install batteries
  await until(page, () => window.__edg.mysteries.d.beaconPowered, undefined, 5000);
  await until(page, () => /Ativar/.test(document.querySelector('.prompt')?.textContent ?? ''), undefined, 5000);
  await press(page, 'KeyE'); // activate
  await until(page, () => window.__edg.state === 'ending', undefined, 5000);
  const ending = await ev(page, () => window.__edg.state);
  await page.screenshot({ path: `${out}/e2e-08-ending.png` });
  check('mystery: beacon leads to the optional secret ending', ending === 'ending');
  if (ending === 'ending') {
    await page.getByRole('button', { name: 'Ficar no continente' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Continuar' }).click();
    check('mystery: game continues after choosing to stay', await waitState(page, 'playing', 5000));
  }

  // Save → export (download) → import through the menu.
  await ev(page, () => window.__edg.save(true));
  await press(page, 'Escape');
  await until(page, () => window.__edg.state === 'paused');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar salvamento' }).click()]);
  const savePath = `${out}/export.json`;
  await download.saveAs(savePath);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(savePath, 'utf8'));
  check('export: file is a valid v2 save with checksum', exported.version === 2 && typeof exported.checksum === 'string' && exported.mysteries.ending === 'stay');
  // Invalid file must be rejected with a message.
  writeFileSync(`${out}/bad.json`, '{"hello": 1}');
  await page.locator('input[type=file]').setInputFiles(`${out}/bad.json`);
  await page.waitForTimeout(800);
  const note = await page.locator('.note').first().textContent();
  check('import: invalid file rejected with a clear message', /inválid|incomplet/i.test(note ?? ''), note);
  // Valid import restores the world.
  await page.locator('input[type=file]').setInputFiles(savePath);
  check('import: valid file loads the world', await waitState(page, 'playing'));
  check('import: data preserved (ending, tamed animal)', (await ev(page, () => window.__edg.mysteries.d.ending)) === 'stay' && (await ev(page, () => window.__edg.tamedAnimals().length)) >= 1);

  // Language switch through settings.
  await press(page, 'Escape');
  await until(page, () => window.__edg.state === 'paused');
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.locator('label', { hasText: 'Idioma' }).locator('select').selectOption('en');
  await page.waitForTimeout(300);
  const en = await page.getByRole('button', { name: 'Back' }).isVisible();
  check('language: switching to English updates the UI', en);
  for (const tab of ['Graphics', 'Audio', 'Accessibility']) {
    await page.locator('.filters button', { hasText: tab }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/e2e-09-settings-${tab}.png` });
  }
  await page.locator('.filters button', { hasText: 'General' }).click();
  await page.locator('label', { hasText: 'Language' }).locator('select').selectOption('pt-BR');
  await page.waitForTimeout(200);
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('edg.settings.v1')).language);
  check('language: choice persisted in local settings', pref === 'pt-BR');
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('button', { name: 'Retomar' }).click();

  // Memory: teleport around the continent and check GPU resources stay bounded.
  const mem0 = await ev(page, () => ({ ...window.__edg.renderer.info.memory }));
  const spots = [[-2000, 1700], [2100, 2000], [-300, -3000], [2050, -1250], [600, 300], [-1500, -1050], [120, 700]];
  const memSeries = [];
  for (let round = 0; round < 3; round++)
    for (const [x, z] of spots) {
      await ev(page, ([x, z]) => { const g = window.__edg; g.player.s.x = x; g.player.s.z = z; g.player.s.y = g.terrain.height(x, z) + 1; g.sectors.update(x, z, g.quality(), g.env.state.time, 1e9); }, [x, z]);
      await page.waitForTimeout(700);
      memSeries.push(await ev(page, () => window.__edg.renderer.info.memory.geometries));
    }
  const mem1 = await ev(page, () => ({ ...window.__edg.renderer.info.memory }));
  const r = [0, 1, 2].map((i) => Math.max(...memSeries.slice(i * spots.length, (i + 1) * spots.length)));
  check('memory: geometries stay bounded when revisiting the same places', r[2] <= r[1] * 1.05 + 5, `start ${mem0.geometries} · max per round ${r.join(' / ')} · end ${mem1.geometries} · textures ${mem1.textures}`);
  const sectors = await ev(page, () => ({ loaded: window.__edg.sectors.loadedCount, colliders: window.__edg.collision.size }));
  check('sectors: only the area around the player stays loaded', sectors.loaded <= 9 * 9, JSON.stringify(sectors));

  // Many objects: lots of animals near the player.
  const perf = await ev(page, async () => {
    const g = window.__edg;
    const p = g.player.s;
    for (let i = 0; i < 25; i++) g.eco.spawnGroup('parasaurolophus', p.x + (i % 5) * 20 - 40, p.z + Math.floor(i / 5) * 20 - 40, g.rng);
    const t0 = performance.now();
    let frames = 0;
    await new Promise((r) => { const step = () => { frames++; if (performance.now() - t0 < 5000) requestAnimationFrame(step); else r(); }; requestAnimationFrame(step); });
    return { animals: g.eco.animals.size, active: g.eco.active.length, fps: frames / 5, quality: g.qualityLevel, calls: g.renderer.info.render.calls };
  });
  check('stress: game keeps running with ~200 extra animals (software rendering)', perf.fps > 0.5, JSON.stringify(perf));

  // Corrupted save → fallback to backup.
  await ev(page, () => window.__edg.save(true));
  await page.waitForTimeout(600);
  await ev(page, () => window.__edg.save(true));
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('era-dos-gigantes', 1); q.onsuccess = () => { const tx = q.result.transaction('saves', 'readwrite'); tx.objectStore('saves').put({ broken: true }, 'main'); tx.oncomplete = () => { q.result.close(); r(); }; }; }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Continuar' }).click();
  check('recovery: corrupted main save falls back to the backup', await waitState(page, 'playing'));
  const notes = await page.locator('.note').allTextContents();
  check('recovery: the player is told the backup was used', notes.some((n) => /cópia de segurança/i.test(n)), notes.join(' | '));
  } catch (e) {
    check('main flow finished without script errors', false, String(e).split('\n')[0]);
    await page.screenshot({ path: `${out}/e2e-error.png` }).catch(() => {});
  }
  await ctx.close();
}

// ---------------------------------------------------------------- screen sizes
const sizes = [
  { name: 'phone-portrait', viewport: { width: 360, height: 640 }, touch: true },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, touch: true },
  { name: 'tablet', viewport: { width: 768, height: 1024 }, touch: true },
  { name: 'desktop-fhd', viewport: { width: 1920, height: 1080 }, touch: false },
];
for (const s of sizes) {
  const { ctx, page } = await newPage({ viewport: s.viewport, hasTouch: s.touch, isMobile: s.touch, deviceScaleFactor: s.touch ? 2 : 1 });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/e2e-size-${s.name}-menu.png` });
  await page.evaluate(() => window.__edg.newGame(42));
  await waitState(page, 'playing');
  if (s.touch) await page.evaluate(() => window.__edg.input.setMode('touch'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/e2e-size-${s.name}-hud.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  let small = [];
  if (s.touch) small = await page.evaluate(() => [...document.querySelectorAll('.tbtn, .joy')].map((b) => b.getBoundingClientRect()).filter((r) => r.width < 40 || r.height < 40).length);
  await page.evaluate(() => window.__edg.openPanel('inventory'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/e2e-size-${s.name}-inventory.png` });
  const panel = await page.evaluate(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1; });
  await page.evaluate(() => window.__edg.openPanel('skills'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/e2e-size-${s.name}-skills.png` });
  check(`layout ${s.name}: no horizontal overflow, panel inside the screen${s.touch ? ', touch targets ≥ 40px' : ''}`, !overflow && panel && (!s.touch || small === 0), `overflow=${overflow} panel=${panel} smallTargets=${small}`);
  await ctx.close();
}

// ---------------------------------------------------------------- offline (real)
{
  const { ctx, page } = await newPage();
  await page.goto(URL, { waitUntil: 'load' });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await page.waitForTimeout(500);
    ready = /✓/.test(await page.evaluate(() => window.__offline ?? ''));
  }
  check('offline: service worker reports every file cached', ready, await page.evaluate(() => window.__offline));
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const menu = await page.locator('.menu .card h1').isVisible().catch(() => false);
  check('offline: game page opens with the network disabled', menu);
  await page.evaluate(() => window.__edg.newGame(7));
  check('offline: a new world generates and plays offline', await waitState(page, 'playing'));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/e2e-10-offline.png` });
  await ev(page, () => window.__edg.save(true));
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => window.__edg.hasSave);
  check('offline: saving works offline', saved);
  await ctx.close();
}

check('no external network requests', external.size === 0, [...external].join(', '));
check('no uncaught errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
writeFileSync(`${out}/e2e-results.json`, JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
