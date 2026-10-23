// Turns the base-colour textures of a GLB grey (luminance × gain × tint), keeping the
// strongly coloured details (eyes, mouth) as they are.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { metalRough } from '@gltf-transform/functions';
// usage: node tools/grey-texture.mjs src.glb dst.glb [gain] [r,g,b tint] [all]  (all: recolour the
// coloured details too)
const [src, dst, gain = '1.8', tint = '0.98,1,1.03', mode = ''] = process.argv.slice(2);
const k = Number(gain);
const T = tint.split(',').map(Number);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
// Fur is not metal: spec/gloss conversions can leave metallic values that read as black.
for (const m of doc.getRoot().listMaterials()) { m.setMetallicFactor(0); m.setMetallicRoughnessTexture(null); m.setRoughnessFactor(0.9); }
const done = new Set();
for (const m of doc.getRoot().listMaterials()) {
  const t = m.getBaseColorTexture();
  if (!t || done.has(t)) continue;
  done.add(t);
  const { data, info } = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const w = mode === 'all' ? 1 : Math.max(0, Math.min(1, 1 - (sat - 0.45) / 0.2)); // greys and browns
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, data[i + c] * (1 - w) + lum * k * T[c] * w);
  }
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  t.setImage(new Uint8Array(out)).setMimeType('image/png');
}
await io.write(dst, doc);
console.log('ok', dst);
