// Copies dist/ for publishing as a claude.ai artifact, which does not serve .glb:
// each GLB becomes a self-contained glTF JSON (buffers and images as data URIs,
// named *.gltf.json); models/manifest.json and the service-worker list follow.
// Usage: node tools/artifact-build.mjs dist out-dir   (needs @gltf-transform/core + extensions)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
const [src, out] = process.argv.slice(2);
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const renames = {};
for (const f of fs.readdirSync(path.join(out, 'models')).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(path.join(out, 'models', f));
  const { json, resources } = await io.writeJSON(doc);
  const mime = (u) => (u.endsWith('.webp') ? 'image/webp' : u.endsWith('.png') ? 'image/png' : u.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream');
  for (const b of json.buffers ?? []) if (b.uri) b.uri = `data:application/octet-stream;base64,${Buffer.from(resources[b.uri]).toString('base64')}`;
  for (const im of json.images ?? []) if (im.uri) im.uri = `data:${mime(im.uri)};base64,${Buffer.from(resources[im.uri]).toString('base64')}`;
  const name = f.replace(/\.glb$/, '.gltf.json');
  fs.writeFileSync(path.join(out, 'models', name), JSON.stringify(json));
  fs.rmSync(path.join(out, 'models', f));
  renames[f] = name;
  console.log(f, '->', name, fs.statSync(path.join(out, 'models', name)).size);
}
const mf = path.join(out, 'models', 'manifest.json');
let m = fs.readFileSync(mf, 'utf8');
let sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
for (const [a, b] of Object.entries(renames)) {
  m = m.split(`"${a}"`).join(`"${b}"`);
  sw = sw.split(`models/${a}`).join(`models/${b}`);
}
fs.writeFileSync(mf, m);
fs.writeFileSync(path.join(out, 'sw.js'), sw);
