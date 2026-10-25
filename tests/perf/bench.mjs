/**
 * Reproducible performance benchmark (real browser, production build).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   PLAYWRIGHT=/path/to/node_modules/playwright node tests/perf/bench.mjs [out.json] [quality]
 *
 * Scenarios, each on a fresh new world (fixed seed):
 *   idle   – standing at the start for 8 s;
 *   herd   – 12 groups of animals spawned around the player, 8 s;
 *   travel – walking/teleporting through new sectors for 8 s (streaming).
 * For each: frame interval average / 1 % / max, CPU ms per game section (the
 * same profiler as the F3 panel), GPU ms when the browser exposes timer
 * queries, draw calls, triangles, JS heap, and the top self-time functions of
 * a Chrome CPU profile. Nothing is estimated: unavailable values are null.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const URL = process.env.URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'perf-out.json';
const quality = process.argv[3] ?? 'low';
const SEED = 4242;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });

async function scenario(name, setup) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((q) => localStorage.setItem('edg.settings.v1', JSON.stringify({ quality: q, graphics: { resolutionScale: q === 'low' ? 0.5 : 1 } })), quality);
  await page.goto(URL);
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('era-dos-gigantes'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
  await page.reload();
  await page.waitForTimeout(1500);
  await page.fill('input[type=number]', String(SEED)).catch(() => {});
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Novo jogo' }).click();
  while ((await page.evaluate(() => window.__edg?.state)) !== 'playing') {
    if (Date.now() - t0 > 180000) throw new Error('world did not load');
    await page.waitForTimeout(100);
  }
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  await page.evaluate(setup);
  await page.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const res = await page.evaluate(async () => {
    const g = window.__edg;
    // Builds without the profiler (older versions) still get frame statistics.
    if (g.profiler) {
      g.profiler.enabled = true;
      g.profiler.reset();
    }
    const moving = window.__benchMove;
    const t0 = performance.now();
    const intervals = [];
    let last = t0;
    await new Promise((r) => {
      const step = (now) => {
        intervals.push(now - last);
        last = now;
        if (moving) moving(now - t0);
        if (now - t0 < 8000) requestAnimationFrame(step);
        else r();
      };
      requestAnimationFrame(step);
    });
    const sorted = intervals.slice(1).sort((a, b) => a - b);
    const frameStats = { frameAvg: sorted.reduce((a, b) => a + b, 0) / sorted.length, frameP99: sorted[Math.floor(sorted.length * 0.99)], frameMax: sorted[sorted.length - 1], frames: sorted.length };
    const s = g.profiler ? { ...g.profiler.summary(), ...frameStats } : { ...frameStats, sections: {}, sectionMax: {}, cpuTotal: 0, gpu: null, worst: { cpu: 0, sections: {} } };
    const r = g.renderer.info;
    return {
      ...s,
      calls: r.render.calls,
      triangles: r.render.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      animals: { active: g.eco.active.length, total: g.eco.animals.size },
    };
  });
  const { profile } = await cdp.send('Profiler.stop');
  // Self time per function (samples × interval).
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dts = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dts[i] ?? 0) / 1000);
  });
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n);
  const callers = new Map();
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    const chain = [];
    let p = parent.get(id);
    for (let k = 0; k < 4 && p; k++, p = parent.get(p.id)) chain.push(p.callFrame.functionName || '(anon)');
    const m = callers.get(key) ?? new Map();
    const c = chain.join(' < ');
    m.set(c, (m.get(c) ?? 0) + (dts[i] ?? 0) / 1000);
    callers.set(key, m);
  });
  const totalMs = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => ({ fn: k, ms: +v.toFixed(1), pct: +((v / totalMs) * 100).toFixed(1), via: [...(callers.get(k) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c, t]) => `${c} (${t.toFixed(1)})`) }));
  const idle = (self.get('(idle) :0') ?? 0) / totalMs;
  const shaderMs = [...self.entries()].filter(([k]) => /getProgramInfoLog|getShaderInfoLog|compileShader|linkProgram/.test(k)).reduce((a, [, v]) => a + v, 0);
  const gcMs = [...self.entries()].filter(([k]) => k.startsWith('(garbage collector)')).reduce((a, [, v]) => a + v, 0);
  await ctx.close();
  const r = { name, quality, loadMs, ...res, idleFraction: +idle.toFixed(3), shaderCompileMs: +shaderMs.toFixed(1), gcMs: +gcMs.toFixed(1), topSelf: top, errors };
  console.log(`\n== ${name} (${quality}) load ${loadMs} ms · frame avg ${res.frameAvg.toFixed(1)} ms · 1% ${res.frameP99.toFixed(1)} · max ${res.frameMax.toFixed(0)} · CPU sections ${res.cpuTotal.toFixed(1)} ms · GPU ${res.gpu ?? 'n/d'} · ${res.calls} dc · ${Math.round(res.triangles / 1000)}k tri · heap ${res.heapMB} MB · animals ${res.animals.active}/${res.animals.total} · shader compile ${shaderMs.toFixed(0)} ms · GC ${gcMs.toFixed(0)} ms`);
  console.log(`   worst frame CPU ${res.worst.cpu.toFixed(0)} ms:`, JSON.stringify(res.worst.sections));
  console.log('   sections:', Object.entries(res.sections).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
  for (const t of top.slice(0, 10)) console.log(`   ${t.ms.toFixed(1).padStart(7)} ms  ${t.fn}  ← ${t.via.join(' ; ')}`);
  if (errors.length) console.log('   ERRORS', errors);
  return r;
}

const results = [];
results.push(await scenario('idle', () => {}));
results.push(
  await scenario('herd', () => {
    const g = window.__edg;
    const p = g.player.s;
    const ids = ['parasaurolophus', 'triceratops', 'stegosaurus', 'tyrannosaurus', 'pachycephalosaurus', 'gallimimus'];
    for (let i = 0; i < 12; i++) g.eco.spawnGroup(ids[i % ids.length], p.x + Math.cos(i) * (20 + i * 3), p.z + Math.sin(i) * (20 + i * 3), g.rng);
  }),
);
results.push(
  await scenario('travel', () => {
    const g = window.__edg;
    const p = g.player.s;
    const x0 = p.x;
    const z0 = p.z;
    // Moves the player 30 m/s along a straight line (forces new sectors to stream in).
    window.__benchMove = (ms) => {
      p.x = x0 + (ms / 1000) * 30;
      p.z = z0 + (ms / 1000) * 12;
    };
  }),
);
writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), url: URL, results }, null, 2));
await browser.close();
