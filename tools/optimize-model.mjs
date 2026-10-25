// Normalizes and optimizes a downloaded GLB for the game:
// +Z forward, Y up, feet at y=0, 1 unit = 1 m; keeps and renames only the mapped clips;
// converts spec/gloss to metal/rough, resizes textures to WebP and compresses with meshopt.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough, prune, dedup, resample, textureCompress, meshopt, weld, simplify, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [src, dst, cfgJson] = process.argv.slice(2);
const cfg = JSON.parse(cfgJson);
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const root = doc.getRoot();
if (root.listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
// Clips: keep only the mapped ones, renamed to the game's names.
const keep = new Map(Object.entries(cfg.clips).map(([game, srcName]) => [srcName, game]));
for (const a of root.listAnimations()) { const g = keep.get(a.getName()); if (g) a.setName(g); else a.dispose(); }
// Normalization node above everything in the scene.
const scene = root.listScenes()[0];
const norm = doc.createNode('normalize').setScale([cfg.scale, cfg.scale, cfg.scale]).setTranslation([0, -cfg.floor * cfg.scale, 0]);
if (cfg.rotY) { const h = cfg.rotY / 2; norm.setRotation([0, Math.sin(h), 0, Math.cos(h)]); }
for (const c of scene.listChildren()) { scene.removeChild(c); norm.addChild(c); }
scene.addChild(norm);
const steps = [dedup(), prune(), resample()];
if (cfg.simplify) steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: cfg.simplify, error: 0.002 }));
steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 82 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
await doc.transform(...steps);
await io.write(dst, doc);
let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
console.log(dst, 'clips', root.listAnimations().map((a) => a.getName()).join(','), 'tris', tris, 'tex', root.listTextures().length);
