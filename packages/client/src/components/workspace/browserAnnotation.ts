// ============================================================
// Browser annotation — pure geometry / url helpers
// ============================================================
// The selection-rectangle math and url normalisation behind the in-app
// browser's 圈画 (annotate) flow. Kept pure (no React, no DOM, no Electron)
// so the core of the Mac app's headline feature is unit-testable without a
// window. BrowserRail.tsx wires these into pointer events and the canvas
// crop; the actual capturePage()/highlighted-crop lives there because it
// needs the DOM canvas API.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Normalise a drag (anchor → current pointer) into a top-left-anchored rect
 * with non-negative width/height, regardless of drag direction. Dragging
 * up-left produces the same rect as dragging down-right across the same two
 * corners.
 */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * Clamp a raw pointer position to the capture's bounds, so a selection can
 * never extend past the screenshot edges (the overlay is drawn at capture
 * resolution).
 */
export function clampPointToCapture(point: Point, capture: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(capture.width, point.x)),
    y: Math.max(0, Math.min(capture.height, point.y)),
  };
}

/** A selection only counts once it crosses a minimum size (avoids stray clicks
 *  producing zero-area "annotations"). */
export function isUsableSelection(rect: Rect | null, min = 8): rect is Rect {
  return !!rect && rect.width >= min && rect.height >= min;
}

/**
 * Turn whatever the user typed in the address bar into a navigable URL.
 *   - blank            → about:blank
 *   - has a scheme     → left as-is (http:, https:, file:, about:, …)
 *   - bare host/path   → prefixed with https://
 */
export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'about:blank';
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Map a selection rect (in capture CSS pixels) to source-image pixels and add
 * a padding margin, clamped to the source bounds. Returns the crop box used to
 * carve the annotation thumbnail out of the full screenshot, plus where the
 * highlight sits inside that crop. Pure — the actual drawImage happens in the
 * component against a real canvas.
 */
export function computeAnnotationCrop(
  selection: Rect,
  capture: { width: number; height: number },
  source: { width: number; height: number },
  pad = 24,
): { crop: Rect; highlight: Rect } {
  const scaleX = source.width / capture.width;
  const scaleY = source.height / capture.height;
  const sx = Math.max(0, Math.floor(selection.x * scaleX) - pad);
  const sy = Math.max(0, Math.floor(selection.y * scaleY) - pad);
  const sw = Math.min(source.width - sx, Math.ceil(selection.width * scaleX) + pad * 2);
  const sh = Math.min(source.height - sy, Math.ceil(selection.height * scaleY) + pad * 2);
  return {
    crop: { x: sx, y: sy, width: sw, height: sh },
    highlight: {
      x: selection.x * scaleX - sx,
      y: selection.y * scaleY - sy,
      width: selection.width * scaleX,
      height: selection.height * scaleY,
    },
  };
}
