// Brightens and warms the base-colour textures of a GLB (all pixels): c' = min(255, c × gain × tint).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
const [src, dst, gain = '1.5', tint = '1.04,0.98,0.88'] = process.argv.slice(2);
const k = Number(gain), T = tint.split(',').map(Number);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const done = new Set();
for (const m of doc.getRoot().listMaterials()) {
  const t = m.getBaseColorTexture();
  if (!t || done.has(t)) continue;
  done.add(t);
  const { data, info } = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, data[i + c] * k * T[c]);
  t.setImage(new Uint8Array(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer())).setMimeType('image/png');
}
await io.write(dst, doc);
console.log('ok', dst);
