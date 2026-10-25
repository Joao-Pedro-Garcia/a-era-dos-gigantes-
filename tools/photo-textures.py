#!/usr/bin/env python3
"""Builds the photographic terrain layers in public/textures/ from Poly Haven
(CC0) 1k downloads.

Usage:
  node tools/procedural-stats.ts > procstats.json
  python3 -I tools/photo-textures.py SRC_DIR procstats.json OUT_DIR

SRC_DIR holds, per layer, <layer>_col.jpg, <layer>_nrm.jpg (OpenGL normal),
<layer>_rough.jpg and <layer>_disp.png. procstats.json has the mean linear
colour, height mean/std, roughness mean, fine-detail contrast and normal-map
strength of the game's procedural layers. The photos are matched to them, so
they keep the game's calibrated palette, blending and bumpiness; a photo whose
fine detail is weaker than the procedural layer is sharpened up to it (never
the other way round, the photo detail is the point). Every map is written at 1024 and 512 px as
<size>/<layer>_{col,nrm,h,r}.webp.
"""
import json
import sys

import numpy as np
from PIL import Image

# Real width of each source photo in metres vs the 2.6 m terrain tile:
# small photos are repeated so pebbles and leaves keep a believable size.
REPEAT = {'dirt': 2, 'mud': 2}
# Grass, leaf litter and snow stay procedural. Grass: compared in the game, the
# photo read darker and flatter than the procedural blades even after the
# contrast match. Litter: the photo hid the reddish litter patches in the forest.
# Snow: the free snow photos all carry footprints or tyre tracks, which would
# repeat every 2.6 m.
LAYERS = ['dirt', 'rock', 'sand', 'mud']


def load(path, mode):
    return Image.open(path).convert(mode).resize((1024, 1024), Image.LANCZOS)


def wrap_resize(img, n):
    """Resizes a tileable image without edge seams (resamples a 3x3 mosaic)."""
    w = img.size[0]
    big = Image.new(img.mode, (w * 3, w * 3))
    for y in range(3):
        for x in range(3):
            big.paste(img, (x * w, y * w))
    return big.resize((n * 3, n * 3), Image.LANCZOS).crop((n, n, 2 * n, 2 * n))


def tile(img, k):
    if k == 1:
        return img
    small = wrap_resize(img, 1024 // k)
    out = Image.new(img.mode, (1024, 1024))
    for y in range(k):
        for x in range(k):
            out.paste(small, (x * 1024 // k, y * 1024 // k))
    return out


def wrap_blur(arr, sigma):
    """Gaussian blur done in the frequency domain, so it wraps and the result still tiles."""
    h, w = arr.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    if arr.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(arr) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(arr[..., c]) * g)) for c in range(arr.shape[2])], -1)


def to_lin(a):
    return (a / 255.0) ** 2.2


def to_srgb(a):
    return np.clip(a, 0, 1) ** (1 / 2.2) * 255.0


def save(arr, mode, path):
    Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), mode).save(path, 'WEBP', quality=88, method=6)


def main(src, stats_path, out):
    stats = json.load(open(stats_path))
    for layer in LAYERS:
        st = stats[layer]
        k = REPEAT.get(layer, 1)
        col = to_lin(np.asarray(tile(load(f'{src}/{layer}_col.jpg', 'RGB'), k), np.float64))
        # Halve the large-scale tone swings (they show up as repeating blotches).
        low = wrap_blur(col, 96)
        mean = col.reshape(-1, 3).mean(0)
        col = col - low * 0.3 + mean * 0.3
        # Match the procedural layer's mean colour (same palette, photo detail).
        gain = np.clip(np.array(st['rgb']) / np.maximum(col.reshape(-1, 3).mean(0), 1e-4), 0.1, 3.0)
        col = col * gain
        lum = col @ np.array([0.3, 0.59, 0.11])
        detail = (lum - wrap_blur(lum, 14.6)).std()
        c = float(np.clip(st['detail'] / max(detail, 1e-6), 1.0, 3.0))
        if c > 1.0:
            lo = wrap_blur(col, 14.6)
            col = np.maximum(lo + (col - lo) * c, 0)
        col = to_srgb(col)

        h = np.asarray(tile(load(f'{src}/{layer}_disp.png', 'F'), k), np.float64)
        h = (h - h.mean()) / max(h.std(), 1e-6) * st['hstd'] + st['h']
        h = np.clip(h, 0, 1) * 255.0

        r = np.asarray(tile(load(f'{src}/{layer}_rough.jpg', 'L'), k), np.float64) / 255.0
        r = np.clip(r - r.mean() + st['rough'], 0.02, 1.0) * 255.0

        nrm = np.asarray(tile(load(f'{src}/{layer}_nrm.jpg', 'RGB'), k), np.float64) / 127.5 - 1.0
        ns = float(np.clip(st['nstr'] / max(np.hypot(nrm[..., 0], nrm[..., 1]).mean(), 1e-6), 0.8, 2.5))
        nrm[..., :2] *= ns
        nrm[..., 2] = np.maximum(nrm[..., 2], 0.05)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        nrm = (nrm + 1.0) * 127.5

        for size in (1024, 512):
            def rs(a, mode):
                im = Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8), mode)
                return np.asarray(wrap_resize(im, size) if size != 1024 else im, np.float64)
            save(rs(col, 'RGB'), 'RGB', f'{out}/{size}/{layer}_col.webp')
            save(rs(nrm, 'RGB'), 'RGB', f'{out}/{size}/{layer}_nrm.webp')
            save(rs(h, 'L'), 'L', f'{out}/{size}/{layer}_h.webp')
            save(rs(r, 'L'), 'L', f'{out}/{size}/{layer}_r.webp')
        print(layer, 'gain', np.round(gain, 2), 'contrast', round(c, 2), 'normal', round(ns, 2))


if __name__ == '__main__':
    main(*sys.argv[1:4])
