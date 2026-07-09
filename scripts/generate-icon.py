#!/usr/bin/env python3
# Regenerate the HorseMD app icon as a macOS squircle (rounded superellipse,
# transparent corners) from the full-bleed white square source, then build
# build/icon.icns (mac) + build/icon.ico (Windows). macOS does NOT auto-mask
# custom app icons to the squircle, so the rounded shape must be baked in.
import os, subprocess, tempfile
from PIL import Image

ROOT = '/Users/yangtingyi/vibe_everything/horseMD'
SRC = os.path.join(ROOT, 'icon.png')
N = 5.0          # superellipse exponent (Apple squircle ≈ 4–5)
SIZE = 1024
SS = 2           # oversample for anti-aliased edges

def squircle_mask(size, n):
    big = size * SS
    m = Image.new('L', (big, big), 0)
    px = m.load()
    cx = cy = (big - 1) / 2
    half = big / 2
    for y in range(big):
        ny = (y - cy) / half
        rem = 1 - abs(ny) ** n
        if rem <= 0:
            continue
        hw = (rem ** (1 / n)) * half
        x0 = max(0, int(round(cx - hw)))
        x1 = min(big - 1, int(round(cx + hw)))
        for x in range(x0, x1 + 1):
            px[x, y] = 255
    return m.resize((size, size), Image.LANCZOS)  # downsample → AA edge

# 1. master: source scaled to SIZE, squircle alpha (transparent corners)
src = Image.open(SRC).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)
src.putalpha(squircle_mask(SIZE, N))
master = src  # 1024 RGBA, squircle, transparent corners

with tempfile.TemporaryDirectory() as d:
    iconset = os.path.join(d, 'icon.iconset')
    os.makedirs(iconset)
    sizes = [16, 32, 64, 128, 256, 512, 1024]
    # Apple .icns needs: 16,32,128,256,512 (+ @2x). We generate the standard set.
    for s in [16, 32, 128, 256, 512]:
        master.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
        master.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
    # build .icns
    out_icns = os.path.join(ROOT, 'build/icon.icns')
    subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', out_icns], check=True)
    print('wrote', out_icns)

# 2. Windows .ico (multi-size; largest 256)
ico = os.path.join(ROOT, 'build/icon.ico')
master.resize((256, 256), Image.LANCZOS).save(
    ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('wrote', ico)

# 3. also drop a 512 preview for visual check
master.resize((512, 512), Image.LANCZOS).save('/tmp/icon-squircle-512.png')
print('preview /tmp/icon-squircle-512.png')
