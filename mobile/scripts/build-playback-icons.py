"""Trace the approved marker contours and add editable, clipped white hatching."""

from pathlib import Path
import html
import random
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'design' / 'playback-icons'
ASSETS = ROOT / 'app' / 'src' / 'main' / 'assets'
DESIGN.mkdir(parents=True, exist_ok=True)
SOURCES = {
    'repeat': 'exec-fee4eea0-0d2f-463e-a325-94d61b96888f.png',
    'shuffle': 'exec-aa07aff6-7e71-4efc-97c6-6da905c39b14.png',
    'download': 'exec-f8cdbec1-971b-4121-8a44-8989fa5f558d.png',
}
GENERATED = Path.home() / '.codex/generated_images/01a1d069-82c0-7ac0-aaac-7729fa62dd68'


def path_of(contour):
    points = cv2.approxPolyDP(contour, .65, True).reshape(-1, 2) / 5
    return 'M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in points) + ' Z'


for kind, filename in SOURCES.items():
    reference = DESIGN / f'reference-{kind}.png'
    if not reference.exists():
        reference.write_bytes((GENERATED / filename).read_bytes())
    raster = cv2.imdecode(np.frombuffer(reference.read_bytes(), dtype='uint8'), 0)
    _, mask = cv2.threshold(raster, 150, 255, cv2.THRESH_BINARY)
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    hierarchy = hierarchy[0]
    outline = ' '.join(path_of(c) for c in contours if abs(cv2.contourArea(c)) >= 3)
    if kind == 'shuffle':
        # The lower-right arrow is deliberately open at the crossing. Close only
        # the temporary fill-analysis mask; the original outline remains intact.
        fill_mask = mask.copy()
        cv2.line(fill_mask, (614, 742), (676, 697), 255, 18)
        contours, hierarchy = cv2.findContours(fill_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        hierarchy = hierarchy[0]
    holes = [c for i, c in enumerate(contours)
             if hierarchy[i][3] >= 0 and abs(cv2.contourArea(c)) > 1600
             and hierarchy[hierarchy[i][3]][3] == -1]
    inside = ' '.join(path_of(c) for c in holes)
    hole_mask = np.zeros_like(mask)
    cv2.drawContours(hole_mask, holes, -1, 255, cv2.FILLED)
    if not inside:
        raise RuntimeError(f'No hollow interior found for {kind}')
    rng = random.Random(73)
    ink = []
    for x in range(-230, 280, 27):
        # Straight, imperfect marker strokes: no sinusoidal/wavy edges.
        offset = rng.uniform(-.65, .65)
        width = rng.uniform(12.0,13.4)
        # Trim invisible parts so sequential native drawing starts immediately.
        runs = []
        run = []
        for t in np.linspace(0, 1, 1400):
            px, py = x + offset + t * 278, 258 - t * 278
            ix, iy = round(px * 5), round(py * 5)
            visible = 0 <= ix < mask.shape[1] and 0 <= iy < mask.shape[0] and hole_mask[iy, ix] > 0
            if visible:
                run.append((px, py))
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        for points in runs:
            if len(points) < 3:
                continue
            a, b = points[0], points[-1]
            ink.append(f'<path class="ink" stroke-width="{width:.2f}" '
                       f'd="M{a[0]:.2f} {a[1]:.2f} L{b[0]:.2f} {b[1]:.2f}"/>')
    single = ('<path class="single" fill="none" stroke="#fff" stroke-width="6.8" '
              'd="M115 120 L127 108 L128 144 M117 145 L140 145"/>') if kind == 'repeat' else ''
    check = ('<path class="check" fill="none" stroke="#fff" stroke-width="12.5" '
             'd="M82 122 L109 150 L170 95"/>') if kind == 'download' else ''

    def document(active=False, one=False, complete=False):
        return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">
  <title>Hand-drawn {html.escape(kind)}</title>
  <defs><clipPath id="inside"><path class="interior" fill="#fff" fill-rule="evenodd" d="{inside}"/></clipPath></defs>
  <g stroke="#fff" stroke-linecap="round" stroke-linejoin="round" clip-path="url(#inside)" opacity="{int(active)}">{''.join(ink)}</g>
  <path class="outline" fill="#fff" fill-rule="evenodd" d="{outline}"/>
  <g stroke-linecap="round" stroke-linejoin="round" opacity="{int(one)}">{single}</g>
  <g stroke-linecap="round" stroke-linejoin="round" opacity="{int(complete)}">
    {('<path fill="none" stroke="#000" stroke-width="18.5" d="M82 122 L109 150 L170 95"/>' + check) if check else ''}
  </g>
</svg>
'''

    base = document()
    (DESIGN / f'{kind}.svg').write_text(base, encoding='utf-8')
    (ASSETS / f'hand-drawn-{kind}.svg').write_text(base, encoding='utf-8')
    if kind in ('repeat', 'shuffle'):
        (DESIGN / f'{kind}-active.svg').write_text(document(active=True), encoding='utf-8')
    if kind == 'repeat':
        (DESIGN / 'repeat-one.svg').write_text(document(active=True, one=True), encoding='utf-8')
    if kind == 'download':
        (DESIGN / 'download-complete.svg').write_text(document(active=True, complete=True), encoding='utf-8')

names = ['repeat', 'repeat-active', 'repeat-one', 'shuffle', 'shuffle-active', 'download', 'download-complete']
cards = ''.join(f'<figure><img src="{name}.svg"><figcaption>{name}</figcaption></figure>' for name in names)
(DESIGN / 'preview.html').write_text('<!doctype html><meta charset="utf-8"><title>Playback icons</title>'
    '<style>body{background:#000;color:#aaa;font:14px system-ui;display:flex;flex-wrap:wrap}'
    'figure{margin:16px;text-align:center}img{display:block;width:160px;height:160px}</style>' + cards,
    encoding='utf-8')
print('Built 7 SVG states and 3 Android SVG assets from approved marker contours.')
