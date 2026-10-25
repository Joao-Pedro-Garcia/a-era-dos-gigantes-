/**
 * Co-op end to end: two real browsers on one server.
 *
 *   npm run build
 *   PLAYWRIGHT=/path/to/node_modules/playwright node tests/e2e/coop.mjs [outDir]
 *
 * Starts server/server.ts serving dist/, then: the host creates a room through the menu,
 * the guest joins with the code read from the host's screen, and the checks cover both
 * players seeing each other, the host's animals reaching the guest, chat, a guest's blow
 * reaching the host's animal, an animal's blow reaching the guest, reconnection and host
 * migration when the host leaves.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? 'e2e-out/coop';
mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PORT) || 8795;
const URL = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['server/server.ts'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', STATIC_DIR: 'dist' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
await sleep(800);

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// One browser process per player: two software-rendered games sharing one process starve each
// other (the background one stops drawing frames, so it stops sending snapshots).
const browsers = [];
const errors = [];
async function newPage(tag) {
  const browser = await chromium.launch({ args });
  browsers.push(browser);
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('edg.settings.v1', JSON.stringify({ firstPerson: false, quality: 'low', graphics: { resolutionScale: 0.5 } })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${tag}: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__edg, null, { timeout: 180000, polling: 500 });
  return page;
}
const waitPlaying = (page) => page.waitForFunction(() => window.__edg?.state === 'playing', null, { timeout: 480000, polling: 500 });

let ok = true;
try {
  // Host: Multiplayer → name → Create room.
  const host = await newPage('host');
  await host.getByRole('button', { name: 'Multijogador' }).click();
  await host.locator('label:has-text("Seu nome") input').fill('Ana');
  await host.getByRole('button', { name: 'Criar sala' }).click();
  await waitPlaying(host);
  const code = await host.evaluate(() => window.__edg.coop?.code);
  check('host creates a room and enters its world', /^[A-Z2-9]{6}$/.test(code ?? ''), `code ${code}`);
  const seedHost = await host.evaluate(() => window.__edg.seed);

  // Guest: joins with the code.
  const guest = await newPage('guest');
  await guest.getByRole('button', { name: 'Multijogador' }).click();
  await guest.locator('label:has-text("Seu nome") input').fill('Bruno');
  await guest.locator('label:has-text("Código de convite") input').fill(code.toLowerCase());
  await guest.getByRole('button', { name: 'Entrar na sala' }).click();
  await waitPlaying(guest).catch(async (e) => {
    const why = await guest.evaluate(() => ({ state: window.__edg.state, coop: window.__edg.coop && { status: window.__edg.coop.status, error: window.__edg.coop.error }, msg: document.querySelector('.coop-status')?.textContent }));
    throw new Error(`guest did not enter the world: ${JSON.stringify(why)} (${e})`);
  });
  const g0 = await guest.evaluate(() => ({ seed: window.__edg.seed, guest: window.__edg.coop?.isGuest, me: window.__edg.coop?.me }));
  check('guest joins the same world (same seed) as a guest', g0.seed === seedHost && g0.guest === true, `seed ${g0.seed}/${seedHost}`);

  // Each side draws the other once its state packets arrive (frame rates are low here: wait).
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => [...window.__edg.coop.remotes.values()].some((r) => r.view && r.shown), null, { timeout: 120000, polling: 500 }).catch(() => {})));
  const seen = await Promise.all([host, guest].map((p) => p.evaluate(() => { const c = window.__edg.coop; return [...c.remotes.values()].map((r) => ({ name: r.info.name, view: !!r.view, x: r.shown?.x })); })));
  check('the host sees the guest', seen[0].length === 1 && seen[0][0].name === 'Bruno' && seen[0][0].view, JSON.stringify(seen[0]));
  check('the guest sees the host', seen[1].length === 1 && seen[1][0].name === 'Ana' && seen[1][0].view, JSON.stringify(seen[1]));

  await guest.waitForFunction(() => window.__edg.eco.active.some((a) => a.alive), null, { timeout: 120000, polling: 500 }).catch(() => {});
  const animals = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__edg.eco.active.filter((a) => a.alive).map((a) => a.id))));
  // Every puppet is one of the host's animals (one snapshot of lag allowed: an animal that just
  // left the host's active set may still be shown for a moment).
  const known = await host.evaluate((ids) => ids.filter((id) => !!window.__edg.eco.get(id)).length, animals[1]);
  check("the host's animals reach the guest (puppets)", animals[1].length > 0 && known >= animals[1].length - 1, `${animals[1].length} on the guest, ${known} known to the host`);

  // Chat both ways.
  await guest.locator('.coop-input').fill('oi Ana!');
  await guest.locator('.coop-input').press('Enter');
  await host.waitForFunction(() => [...document.querySelectorAll('.coop-line')].some((l) => l.textContent.includes('oi Ana!')), null, { timeout: 5000, polling: 500 }).then(
    () => check('chat reaches the other player', true),
    () => check('chat reaches the other player', false),
  );

  const diag = async (tag) => {
    const d = await Promise.all([host, guest].map((p) => p.evaluate(() => { const g = window.__edg; return { st: g.state, net: g.coop?.status, role: g.coop?.role, alive: g.eco.active.filter((a) => a.alive).length, frames: g.frames, hp: Math.round(g.survival?.d.health ?? -1) }; }).catch((e) => String(e))));
    console.log(`  [${tag}] host ${JSON.stringify(d[0])} guest ${JSON.stringify(d[1])}`);
  };
  await diag('before blow');
  // A guest's blow on an animal near the guest is applied by the host. The host first puts a
  // dodo 8 m from the guest (the server only forwards blows within reach).
  const spawned = await host.evaluate((me) => {
    const g = window.__edg;
    const s = g.coop.remotes.get(me)?.shown;
    if (!s) return null;
    const [a] = g.eco.spawnGroup('dodo', s.x + 8, s.z, g.rng, 0);
    return a?.id ?? null;
  }, g0.me);
  await guest.waitForFunction((id) => !!window.__edg.eco.get(id) && window.__edg.eco.active.some((a) => a.id === id), spawned, { timeout: 120000, polling: 500 }).catch(() => {});
  const target = await guest.evaluate(() => {
    const g = window.__edg;
    const p = g.player.s;
    const a = g.eco.active.filter((x) => x.alive).sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
    return a ? { id: a.id, x: a.x, z: a.z, d: Math.hypot(a.x - p.x, a.z - p.z) } : null;
  });
  if (target && target.d < 38) {
    const before = await host.evaluate((id) => window.__edg.eco.get(id)?.health, target.id);
    await guest.evaluate((t) => window.__edg.coop.sendHit(t.id, 7, t.x, t.z), target);
    await sleep(800);
    const after = await host.evaluate((id) => window.__edg.eco.get(id)?.health, target.id);
    check("a guest's blow is applied to the host's animal", after < before, `${before} → ${after}`);
  } else check("a guest's blow is applied to the host's animal", false, `no animal within reach (${target?.d})`);

  await diag('before damage');
  // An animal's blow on the guest (as the host's AI reports it) hurts the guest.
  const hpBefore = await guest.evaluate(() => window.__edg.survival.d.health);
  await host.evaluate((me) => {
    const g = window.__edg;
    const a = g.eco.active.find((x) => x.alive);
    g.coop.sendDamage(me, 6, a, null);
  }, g0.me);
  await sleep(800);
  const hpAfter = await guest.evaluate(() => window.__edg.survival.d.health);
  check("an animal's blow (host AI) hurts the guest", hpAfter < hpBefore, `${hpBefore.toFixed(1)} → ${hpAfter.toFixed(1)}`);

  // Building: a foundation the guest builds appears in the host's world, and goes when demolished.
  const built = await guest.evaluate(() => {
    const g = window.__edg;
    g.inventory.add('wood', 6);
    g.inventory.add('stone', 4);
    const p = g.player.s;
    const pc = g.buildingSys.place({ type: 'foundation', x: p.x + 5, y: g.terrain.height(p.x + 5, p.z), z: p.z, rot: 0, valid: true }, g.inventory, 1);
    if (!pc) return null;
    g.addPieceView(pc);
    g.coop.sendPlace(pc);
    return { local: pc.id, net: g.coop.netPieceId(pc.id) };
  });
  const arrived = built && (await host.waitForFunction((id) => window.__edg.buildingSys.pieces.has(id), built.net, { timeout: 60000, polling: 500 }).then(() => true, () => false));
  check("a guest's structure appears in the host's world", !!arrived, JSON.stringify(built));
  if (built) {
    await guest.evaluate((id) => {
      const g = window.__edg;
      g.buildingSys.demolish(id, g.inventory);
      g.coop.sendRemove(id);
    }, built.local);
    const gone = await host.waitForFunction((id) => !window.__edg.buildingSys.pieces.has(id), built.net, { timeout: 60000, polling: 500 }).then(() => true, () => false);
    check('demolishing it removes it for the host too', gone);
  }

  await guest.screenshot({ path: `${out}/guest-view.png` });
  await host.screenshot({ path: `${out}/host-view.png` });

  // Reconnection: drop the guest's socket; it resumes as the same player.
  await guest.evaluate(() => window.__edg.coop.net.ws.close());
  await guest.waitForFunction(() => window.__edg.coop.status === 'reconnecting', null, { timeout: 5000, polling: 500 }).catch(() => {});
  await guest.waitForFunction(() => window.__edg.coop.status === 'online', null, { timeout: 15000, polling: 500 }).then(
    async () => check('the guest reconnects as the same player', (await guest.evaluate(() => window.__edg.coop.me)) === g0.me),
    () => check('the guest reconnects as the same player', false, 'did not come back online'),
  );

  await diag('before host leaves');
  // Host leaves: the guest takes over the world's simulation.
  await host.close();
  await guest.waitForFunction(() => window.__edg.coop.isHost, null, { timeout: 70000, polling: 500 }).then(
    () => check('the guest becomes host when the host leaves', true),
    () => check('the guest becomes host when the host leaves', false),
  );
  const before = await guest.evaluate(() => window.__edg.eco.active.filter((a) => a.alive).map((a) => [a.id, a.x, a.z]));
  // Under the new host the ecosystem runs here: within a while some animal must have moved.
  let afterMove = [];
  let moved = 0;
  for (let i = 0; i < 30 && !moved; i++) {
    await sleep(2000);
    afterMove = await guest.evaluate(() => window.__edg.eco.active.filter((a) => a.alive).map((a) => [a.id, a.x, a.z]));
    moved = afterMove.filter(([id, x, z]) => before.some(([j, bx, bz]) => j === id && Math.hypot(x - bx, z - bz) > 0.05)).length;
  }
  check('animals keep living under the new host', afterMove.length > 0 && moved > 0, `${moved}/${afterMove.length} moved`);
} catch (e) {
  ok = false;
  check('run', false, String(e));
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const b of browsers) await b.close().catch(() => {});
server.kill();
const failed = results.filter((r) => !r.ok);
writeFileSync(`${out}/coop.json`, JSON.stringify({ results, serverLog: serverLog.split('\n').slice(-20) }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length || !ok ? 1 : 0);
