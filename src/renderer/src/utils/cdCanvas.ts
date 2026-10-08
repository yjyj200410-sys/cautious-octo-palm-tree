export type CanvasCamera = { x: number; y: number; zoom: number };
export type CanvasSize = { width: number; height: number };
export type CanvasPoint = { x: number; y: number };
export const CD_CELL = { width: 174, height: (174 * Math.sqrt(3)) / 2, disc: 160 };
export const CD_ZOOM = { min: 0.25, max: 2 };
export const CD_LENS = { minScale: 0.58, maxScale: 1.24, push: 0.24, radius: CD_CELL.width * 3 };

/**
 * Request small Netease CDN variants through Volo's existing cover proxy; local artwork and unknown
 * image providers retain their original URLs.
 */
export function cdCoverUrl(cover: string | undefined, size: number) {
  if (!cover) return cover;
  try {
    const url = new URL(cover);
    const proxied = url.pathname === '/cover' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    const asset = proxied ? new URL(url.searchParams.get('url') ?? '') : url;
    if (!/(?:^|\.)126\.net$/i.test(asset.hostname)) return cover;
    asset.searchParams.set('param', `${size}y${size}`);
    if (proxied) {
      url.searchParams.set('url', asset.toString());
      return url.toString();
    }
    return asset.toString();
  } catch {
    return cover;
  }
}

export type CDLayout = {
  centers: CanvasPoint[];
  cells: Map<string, number>;
  rings: number;
  bounds: { left: number; top: number; width: number; height: number };
};

/**
 * Center-out axial hex rings, as used by Folia's hexViewport. Song order is stable when a library
 * grows; no rectangular row reflow moves existing discs.
 */
export function buildCdLayout(count: number): CDLayout {
  const centers: CanvasPoint[] = [];
  const cells = new Map<string, number>();
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  const add = (q: number, r: number) => {
    const x = (q + r / 2) * CD_CELL.width;
    const y = r * CD_CELL.height;
    cells.set(`${q}:${r}`, centers.length);
    centers.push({ x, y });
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  if (count > 0) add(0, 0);
  const directions = [
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
    [1, 0],
    [1, -1]
  ];
  let rings = 0;
  for (let ring = 1; centers.length < count; ring++) {
    rings = ring;
    let q = ring;
    let r = 0;
    for (const [dq, dr] of directions) {
      for (let step = 0; step < ring && centers.length < count; step++) {
        q += dq;
        r += dr;
        add(q, r);
      }
    }
  }
  return {
    centers,
    cells,
    rings,
    bounds: {
      left: left - CD_CELL.disc / 2,
      top: top - CD_CELL.disc / 2,
      width: right - left + CD_CELL.disc,
      height: bottom - top + CD_CELL.disc
    }
  };
}

export function cdPosition(index: number, layout: CDLayout) {
  const center = layout.centers[index] ?? { x: 0, y: 0 };
  return { x: center.x - CD_CELL.disc / 2, y: center.y - CD_CELL.disc / 2 };
}

/** Preserve the page point under the cursor, including at the zoom limits. */
export function zoomCdCamera(
  camera: CanvasCamera,
  zoom: number,
  anchor: CanvasPoint
): CanvasCamera {
  const next = Math.min(CD_ZOOM.max, Math.max(CD_ZOOM.min, zoom));
  const ratio = next / camera.zoom;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    zoom: next
  };
}

/**
 * Enumerate viewport cells through the axial lookup, including maximum lens displacement. Panning
 * work depends on the viewport, not the song count.
 */
export function visibleCds(layout: CDLayout, camera: CanvasCamera, size: CanvasSize) {
  if (!layout.centers.length || size.width <= 0 || size.height <= 0) return [];
  const buffer = (CD_CELL.disc * CD_LENS.maxScale) / 2 + CD_LENS.radius * CD_LENS.push + 40;
  const left = -camera.x / camera.zoom - buffer;
  const right = (size.width - camera.x) / camera.zoom + buffer;
  const top = -camera.y / camera.zoom - buffer;
  const bottom = (size.height - camera.y) / camera.zoom + buffer;
  const firstRow = Math.max(-layout.rings, Math.ceil(top / CD_CELL.height));
  const lastRow = Math.min(layout.rings, Math.floor(bottom / CD_CELL.height));
  const indices: number[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const firstCol = Math.max(
      -layout.rings,
      -r - layout.rings,
      Math.ceil(left / CD_CELL.width - r / 2)
    );
    const lastCol = Math.min(
      layout.rings,
      -r + layout.rings,
      Math.floor(right / CD_CELL.width - r / 2)
    );
    for (let q = firstCol; q <= lastCol; q++) {
      const index = layout.cells.get(`${q}:${r}`);
      if (index !== undefined) indices.push(index);
    }
  }
  return indices.sort((a, b) => a - b);
}

/**
 * The lens spans three cover spacings. Outside that radius, CDs have exactly their resting size;
 * the influence follows canvas zoom with the covers.
 */
export function cdLensFrame(center: CanvasPoint, camera: CanvasCamera, focus: CanvasPoint) {
  const dx = center.x - (focus.x - camera.x) / camera.zoom;
  const dy = center.y - (focus.y - camera.y) / camera.zoom;
  const weight = Math.max(0, 1 - (dx * dx + dy * dy) / CD_LENS.radius ** 2) ** 3;
  return {
    x: dx * CD_LENS.push * weight,
    y: dy * CD_LENS.push * weight,
    scale: CD_LENS.minScale + (CD_LENS.maxScale - CD_LENS.minScale) * weight,
    opacity: 0.7 + 0.3 * weight,
    layer: Math.round(weight * 100)
  };
}

export function cameraAtCd(
  index: number,
  layout: CDLayout,
  camera: CanvasCamera,
  size: CanvasSize
): CanvasCamera {
  const center = layout.centers[index] ?? { x: 0, y: 0 };
  return {
    x: size.width / 2 - center.x * camera.zoom,
    y: size.height / 2 - center.y * camera.zoom,
    zoom: camera.zoom
  };
}

/** Visual arrow navigation across staggered hex neighbours, including partial rings. */
export function nextCdInDirection(layout: CDLayout, index: number, key: string) {
  const directions: Record<string, CanvasPoint> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }
  };
  const axis = directions[key];
  const from = layout.centers[index];
  if (!axis || !from) return index;
  let best = index;
  let score = Infinity;
  layout.centers.forEach((point, candidate) => {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const forward = dx * axis.x + dy * axis.y;
    if (forward <= 1) return;
    const sideways = dx * axis.y - dy * axis.x;
    const distance = forward * forward + sideways * sideways * 3;
    if (distance < score) {
      score = distance;
      best = candidate;
    }
  });
  return best;
}
