/**
 * Combat and tool-use scenarios in a real browser (the production build,
 * software-rendered), checking the action system end to end: animation
 * phases, impact-frame hits, equipment, projectiles, reactions, effects and
 * both input modes.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   PLAYWRIGHT=/path/to/node_modules/playwright node tests/e2e/combat.mjs [outDir]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const URL = process.env.URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'e2e-combat';
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });
const errors = [];
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(120);
  }
  return false;
};
const fastSettings = () => localStorage.setItem('edg.settings.v1', JSON.stringify({ quality: 'low', language: 'pt-BR', graphics: { resolutionScale: 0.5 } }));

async function start(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  await page.addInitScript(fastSettings);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('era-dos-gigantes'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Novo jogo' }).click();
  await until(page, () => window.__edg?.state === 'playing', null, 180000);
  // Quiet world: no animals around unless a scenario spawns them; daylight.
  await ev(page, () => {
    const g = window.__edg;
    g.env.state.weather = 'clear';
    g.env.state.intensity = 0;
    const DAY = g.env.dayLength ?? 1200;
    g.env.state.time = Math.floor(g.env.state.time / DAY) * DAY + 0.42 * DAY;
    for (const a of g.eco.active) { a.x += 400; a.z += 400; }
    g.survival.d.food = g.survival.d.water = 100;
  });
  return { ctx, page };
}

/** Puts an item in hotbar slot `hot` and selects it ('' = empty hands). */
const equip = (page, id, hot = 0) =>
  ev(page, ({ id, hot }) => {
    const g = window.__edg;
    if (!id) {
      g.selectedHotbar = 5;
      g.inventory.data.hotbar[5] = null;
      return;
    }
    let slot = g.inventory.data.slots.findIndex((s) => s?.id === id);
    if (slot < 0) {
      g.inventory.add(id, 1);
      slot = g.inventory.data.slots.findIndex((s) => s?.id === id);
    }
    g.assignHotbar(slot, hot);
    g.selectedHotbar = hot;
  }, { id, hot });
const ready = (page, id) => until(page, (id) => window.__edg.combat.shown === id && window.__edg.combat.phase === 'idle', id, 30000);
const impacts = (page) => ev(page, () => window.__edg.combat.stats.impacts);
const lastAction = (page) => ev(page, () => window.__edg.combat.history.at(-1) ?? null);
const attack = async (page) => {
  const n = await impacts(page);
  await ev(page, () => window.__edg.input.touchPress('attack'));
  await until(page, (n) => window.__edg.combat.stats.impacts > n && window.__edg.combat.phase === 'idle', n, 40000);
  return (await impacts(page)) - n;
};
/** Moves the player to face a point from a given distance on flat-ish ground. */
const face = (page, x, z, dist) =>
  ev(page, ({ x, z, dist }) => {
    const g = window.__edg;
    const p = g.player.s;
    const ang = Math.atan2(p.x - x, p.z - z);
    p.x = x + Math.sin(ang) * dist;
    p.z = z + Math.cos(ang) * dist;
    p.y = g.terrain.height(p.x, p.z);
    p.yaw = Math.atan2(x - p.x, z - p.z);
    p.pitch = -0.1;
    g.player.bodyYaw = p.yaw;
  }, { x, z, dist });
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });
/** Spawns one animal `dist` m in front of the player, calm. */
const spawn = (page, species, dist) =>
  ev(page, ({ species, dist }) => {
    const g = window.__edg;
    const p = g.player.s;
    const grp = g.eco.spawnGroup(species, p.x, p.z, g.rng);
    const a = grp[0];
    for (const o of grp.slice(1)) { o.x += 300; o.z += 300; }
    a.x = p.x + Math.sin(p.yaw) * dist;
    a.z = p.z + Math.cos(p.yaw) * dist;
    a.y = g.terrain.height(a.x, a.z);
    a.state = 'graze';
    a.fear = 0;
    a.speed = 0;
    a.hunger = 0.2;
    return { id: a.id, hp: a.health };
  }, { species, dist });

{
  const { ctx, page } = await start();
  try {
    await ev(page, () => window.__edg.applySettings({ firstPerson: true }));

    // 1. Punch (bare hands): phases run and the impact is registered once.
    await equip(page, '');
    await ready(page, '');
    const phases = new Set();
    const n0 = await impacts(page);
    await ev(page, () => window.__edg.input.touchPress('attack'));
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      phases.add(await ev(page, () => window.__edg.combat.phase));
      if ((await impacts(page)) > n0 && (await ev(page, () => window.__edg.combat.phase)) === 'idle') break;
      await page.waitForTimeout(40);
    }
    const shotPunch = await ev(page, () => window.__edg.viewmodel.visible);
    check('1 punch: one impact, phases seen', (await impacts(page)) - n0 === 1 && phases.has('idle'), `phases seen: ${[...phases].join(',')}`);
    check('1 punch: first-person arms drawn', shotPunch);

    // 2. Left/right: quick consecutive punches alternate hands.
    const hands = [];
    for (let i = 0; i < 3; i++) {
      const n = await impacts(page);
      await ev(page, () => window.__edg.input.touchPress('attack'));
      await until(page, (n) => window.__edg.combat.stats.impacts > n, n);
      hands.push((await lastAction(page)).hand);
    }
    check('2 punches alternate right/left', hands.join('') === 'RLR' || hands.join('') === 'LRL', hands.join(''));
    await until(page, () => window.__edg.combat.phase === 'idle');

    // 3. Equip: the hands show the selected item, one model only.
    await equip(page, 'stone_axe');
    const eq = await ready(page, 'stone_axe');
    const models = await ev(page, () => {
      let n = 0;
      window.__edg.viewmodel.scene.traverse((o) => (o.name.startsWith('item:') ? n++ : 0));
      let m = 0;
      window.__edg.playerView.root.traverse((o) => (o.name.startsWith('item:') ? m++ : 0));
      return { fp: n, tp: m };
    });
    check('3 equip axe: shown in both views, no duplicates', eq && models.fp === 1 && models.tp === 1, JSON.stringify(models));
    await shot(page, 'c03-fp-axe-ready');

    // 4. Each weapon performs its own action.
    const kinds = {};
    for (const id of ['stone_axe', 'stone_pickaxe', 'spear', 'stone_knife', 'wooden_club', 'torch']) {
      await equip(page, id);
      await ready(page, id);
      await ev(page, () => { window.__edg.player.s.pitch = 0.9; }); // at the sky: nothing to hit
      await attack(page);
      const a = await lastAction(page);
      kinds[id] = a && a.item === id ? a.kind : `wrong:${a?.item}`;
    }
    check('4 each weapon has its action', JSON.stringify(kinds) === JSON.stringify({ stone_axe: 'chop', stone_pickaxe: 'mine', spear: 'thrust', stone_knife: 'slash', wooden_club: 'bash', torch: 'bash' }), JSON.stringify(kinds));

    // 5. Miss: swinging at the sky changes nothing in the world.
    await equip(page, 'stone_axe');
    await ready(page, 'stone_axe');
    const before5 = await ev(page, () => ({ wood: window.__edg.inventory.count('wood'), fx: window.__edg.fx.active }));
    await ev(page, () => { window.__edg.player.s.pitch = 0.9; });
    const hit5 = await attack(page);
    const after5 = await ev(page, () => ({ wood: window.__edg.inventory.count('wood'), fx: window.__edg.fx.active }));
    check('5 miss: impact frame reached, no harvest, no effects', hit5 === 1 && after5.wood === before5.wood && after5.fx === 0, JSON.stringify({ before5, after5 }));

    // 6/13. Hit: spear on a protoceratops in reach → damage, effects, flinch, AI reaction.
    await equip(page, 'spear');
    await ready(page, 'spear');
    await ev(page, () => { window.__edg.player.s.pitch = -0.1; });
    const target = await spawn(page, 'protoceratops', 2.4);
    await until(page, (id) => !!window.__edg.animalViews.get(id), target.id);
    await ev(page, () => window.__edg.input.touchPress('attack'));
    await until(page, (hp) => window.__edg.eco.active.some((a) => a.health < hp), target.hp, 40000);
    const hit6 = await ev(page, (id) => {
      const g = window.__edg;
      const a = g.eco.get(id);
      const v = g.animalViews.get(id);
      return { hp: a.health, state: a.state, fx: g.fx.active, hitT: v?.hitT ?? -1 };
    }, target.id);
    await shot(page, 'c06-fp-spear-hit');
    check('6 hit: damage applied at the impact frame', hit6.hp < target.hp, `${target.hp.toFixed(1)} → ${hit6.hp.toFixed(1)}`);
    check('6 hit: impact effects spawned', hit6.fx > 0, `particles ${hit6.fx}`);
    check('13 target reaction: flinch + AI interrupted', hit6.hitT >= 0 && hit6.hitT < 0.9 && hit6.state !== 'graze', `state ${hit6.state}, hitT ${hit6.hitT.toFixed?.(2)}`);
    await until(page, () => window.__edg.combat.phase === 'idle');

    // 7. Out of range: the same attack at 7 m does nothing.
    const far = await spawn(page, 'protoceratops', 7);
    await attack(page);
    const farHp = await ev(page, (id) => window.__edg.eco.get(id).health, far.id);
    // (Health may tick up from natural regeneration; any damage would lower it.)
    check('7 out of range: no damage', farHp >= far.hp, `${far.hp.toFixed(2)} → ${farHp.toFixed(2)}`);

    // 8. Attack while running: the strike happens while moving at speed.
    await ev(page, () => { for (const a of window.__edg.eco.active) { a.x += 500; } });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ShiftLeft');
    await until(page, () => window.__edg.player.horizontalSpeed > 3, null, 20000);
    const speed8 = await ev(page, () => window.__edg.player.horizontalSpeed);
    const n8 = await attack(page);
    const speed8b = await ev(page, () => window.__edg.player.horizontalSpeed);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
    check('8 attack while running', n8 === 1 && speed8 > 3 && speed8b > 2, `speed ${speed8.toFixed(1)} / ${speed8b.toFixed(1)} m/s`);

    // 9. Swap during the wind-up: the old weapon never hits; the next attack uses the new one.
    await equip(page, 'stone_axe');
    await ready(page, 'stone_axe');
    await ev(page, () => { window.__edg.player.s.pitch = 0.9; });
    const before9 = await ev(page, () => window.__edg.combat.history.length);
    await ev(page, () => window.__edg.input.touchPress('attack'));
    await until(page, () => window.__edg.combat.phase === 'windup', null, 10000);
    await equip(page, 'spear');
    await ready(page, 'spear');
    await attack(page);
    const hist9 = await ev(page, (n) => window.__edg.combat.history.slice(n).map((h) => h.item), before9);
    check('9 swap mid-swing: no hit with the old item, new item used', !hist9.includes('stone_axe') && hist9.includes('spear'), hist9.join(','));

    // 10. Equip/unequip spam.
    for (let i = 0; i < 24; i++) await equip(page, ['stone_axe', '', 'spear', 'bow', 'stone_knife'][i % 5], i % 5 === 1 ? 5 : i % 3);
    await equip(page, 'stone_pickaxe', 2);
    const spam = await ready(page, 'stone_pickaxe');
    const models10 = await ev(page, () => {
      let n = 0;
      window.__edg.viewmodel.scene.traverse((o) => (o.name.startsWith('item:') ? n++ : 0));
      let m = 0;
      window.__edg.playerView.root.traverse((o) => (o.name.startsWith('item:') ? m++ : 0));
      return { fp: n, tp: m };
    });
    check('10 equip spam settles on the last item, one model per view', spam && models10.fp === 1 && models10.tp === 1, JSON.stringify(models10));

    // 11. Tools on resources: axe on a tree, pickaxe on a rock.
    const node = (kinds) =>
      ev(page, (kinds) => {
        const g = window.__edg;
        const p = g.player.s;
        const list = g.sectors.nodesNear(p.x, p.z, 120).filter((n) => kinds.includes(n.kind));
        list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const n = list[0];
        return n ? { x: n.x, z: n.z, kind: n.kind, scale: n.scale } : null;
      }, kinds);
    const tree = await node(['conifer', 'broadleaf', 'palm', 'deadTree']);
    if (tree) {
      await equip(page, 'stone_axe');
      await ready(page, 'stone_axe');
      await face(page, tree.x, tree.z, 1.6);
      const w0 = await ev(page, () => window.__edg.inventory.count('wood'));
      await attack(page);
      const w1 = await ev(page, () => window.__edg.inventory.count('wood'));
      await shot(page, 'c11-fp-axe-tree');
      check('11 axe on a tree gives wood', w1 > w0, `${tree.kind}: wood ${w0} → ${w1}`);
    } else check('11 axe on a tree gives wood', false, 'no tree within 120 m');
    const rock = await node(['rock', 'boulder']);
    if (rock) {
      await equip(page, 'stone_pickaxe');
      await ready(page, 'stone_pickaxe');
      await face(page, rock.x, rock.z, rock.kind === 'boulder' ? 2.6 : 1.4);
      const s0 = await ev(page, () => window.__edg.inventory.count('stone'));
      await attack(page);
      const s1 = await ev(page, () => window.__edg.inventory.count('stone'));
      check('11 pickaxe on a rock gives stone', s1 > s0, `${rock.kind}: stone ${s0} → ${s1}`);
    } else check('11 pickaxe on a rock gives stone', false, 'no rock within 120 m');

    // 12. Bow: draw while held, release, the arrow starts at the bow and falls along a curve.
    await equip(page, 'bow');
    await ev(page, () => window.__edg.inventory.add('arrow', 5));
    await ready(page, 'bow');
    await ev(page, () => { window.__edg.player.s.pitch = 0.05; window.__edg.actions.projectiles.length = 0; });
    await ev(page, () => window.__edg.input.touchHold('attack', true));
    await until(page, () => window.__edg.combat.draw >= 0.99, null, 40000);
    await shot(page, 'c12-fp-bow-drawn');
    const arrows0 = await ev(page, () => window.__edg.inventory.count('arrow'));
    await ev(page, () => window.__edg.input.touchHold('attack', false));
    await until(page, () => window.__edg.actions.projectiles.length > 0, null, 20000);
    const traj = [];
    const start12 = await ev(page, () => {
      const g = window.__edg;
      const pr = g.actions.projectiles[0];
      return { pos: [pr.origin.x, pr.origin.y, pr.origin.z], cam: [g.camera.position.x, g.camera.position.y, g.camera.position.z], speed: pr.vel.length() };
    });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(400);
      const pt = await ev(page, () => { const pr = window.__edg.actions.projectiles[0]; return pr ? [pr.pos.x, pr.pos.y, pr.pos.z, pr.vel.y] : null; });
      if (pt) traj.push(pt);
    }
    const arrows1 = await ev(page, () => window.__edg.inventory.count('arrow'));
    const dStart = Math.hypot(start12.pos[0] - start12.cam[0], start12.pos[1] - start12.cam[1], start12.pos[2] - start12.cam[2]);
    const falling = traj.length >= 2 && traj.at(-1)[3] < traj[0][3];
    check('12 bow: one arrow used, starts at the bow (near the view), gravity curves it', arrows1 === arrows0 - 1 && dStart < 1.2 && falling, `start ${dStart.toFixed(2)} m from the eye, speed ${start12.speed.toFixed(1)} m/s, vy ${traj.map((p) => p[3].toFixed(1)).join(' → ')}`);

    // 14. Camera switch in the middle of a swing: the swing completes once.
    await equip(page, 'stone_axe');
    await ready(page, 'stone_axe');
    await ev(page, () => { window.__edg.player.s.pitch = 0.9; });
    const n14 = await impacts(page);
    await ev(page, () => window.__edg.input.touchPress('attack'));
    await until(page, () => window.__edg.combat.phase === 'windup', null, 10000);
    await ev(page, () => window.__edg.applySettings({ firstPerson: false }));
    await until(page, (n) => window.__edg.combat.stats.impacts > n && window.__edg.combat.phase === 'idle', n14);
    await ev(page, () => { window.__edg.player.s.pitch = -0.1; });
    await page.waitForTimeout(500);
    await shot(page, 'c14-tp-axe');
    check('14 switch to third person mid-swing: completes once', (await impacts(page)) - n14 === 1 && !(await ev(page, () => window.__edg.viewmodel.visible)));
  } catch (e) {
    check('combat scenarios ran', false, e.message);
  }
  await ctx.close().catch(() => {});
}

// 15. Mobile: touch device, touch button press and hold; duplicated input is debounced.
{
  const { ctx, page } = await start({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  try {
    const mode = await ev(page, () => window.__edg.input.mode);
    await ev(page, () => window.__edg.applySettings({ firstPerson: true }));
    await equip(page, 'stone_knife');
    await ready(page, 'stone_knife');
    await ev(page, () => { window.__edg.player.s.pitch = 0.9; });
    // (a) The on-screen button and a mouse click for the same tap in the same frame merge into one attack.
    const d0 = await ev(page, () => ({ ...window.__edg.combat.stats }));
    await ev(page, () => { const g = window.__edg; g.input.touchPress('attack'); g.input.pressed.add('attack'); });
    await until(page, (n) => window.__edg.combat.stats.impacts > n && window.__edg.combat.phase === 'idle', d0.impacts);
    const d1 = await ev(page, () => ({ ...window.__edg.combat.stats }));
    // (b) Two attack requests arriving back to back (two event paths) → the second is debounced.
    await ev(page, () => { const g = window.__edg; g.combat.request(); g.combat.request(); });
    await until(page, (n) => window.__edg.combat.stats.impacts > n && window.__edg.combat.phase === 'idle', d1.impacts);
    const d2 = await ev(page, () => ({ ...window.__edg.combat.stats }));
    check('15 mobile: touch mode', mode === 'touch', mode);
    check('15 mobile: duplicated tap → one attack', d1.impacts - d0.impacts === 1 && d2.impacts - d1.impacts === 1 && d2.debounced - d1.debounced === 1, JSON.stringify({ sameFrame: d1.impacts - d0.impacts, backToBack: d2.impacts - d1.impacts, debounced: d2.debounced - d1.debounced }));
    // Holding the on-screen button repeats attacks at the action's rate.
    const h0 = await impacts(page);
    await ev(page, () => window.__edg.input.touchHold('attack', true));
    await until(page, (n) => window.__edg.combat.stats.impacts >= n + 2, h0, 60000);
    await ev(page, () => window.__edg.input.touchHold('attack', false));
    check('15 mobile: holding the button repeats', (await impacts(page)) - h0 >= 2);
    await shot(page, 'c15-mobile');
  } catch (e) {
    check('mobile scenario ran', false, e.message);
  }
  await ctx.close().catch(() => {});
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close().catch(() => {});
writeFileSync(`${out}/combat-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
