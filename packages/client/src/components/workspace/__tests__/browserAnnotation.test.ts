import { describe, it, expect } from 'vitest';
import {
  normalizeRect,
  clampPointToCapture,
  isUsableSelection,
  normalizeBrowserUrl,
  computeAnnotationCrop,
} from '../browserAnnotation';

describe('normalizeRect', () => {
  it('produces a top-left-anchored rect dragging down-right', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('is direction-independent — up-left drag yields the same rect', () => {
    const downRight = normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 });
    const upLeft = normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 });
    expect(upLeft).toEqual(downRight);
  });

  it('a zero-distance drag is a zero-area rect', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe('clampPointToCapture', () => {
  const cap = { width: 800, height: 600 };
  it('passes through an in-bounds point', () => {
    expect(clampPointToCapture({ x: 100, y: 200 }, cap)).toEqual({ x: 100, y: 200 });
  });
  it('clamps negative coordinates to 0', () => {
    expect(clampPointToCapture({ x: -30, y: -1 }, cap)).toEqual({ x: 0, y: 0 });
  });
  it('clamps past-edge coordinates to the capture bounds', () => {
    expect(clampPointToCapture({ x: 9999, y: 9999 }, cap)).toEqual({ x: 800, y: 600 });
  });
});

describe('isUsableSelection', () => {
  it('rejects null', () => {
    expect(isUsableSelection(null)).toBe(false);
  });
  it('rejects a stray sub-threshold click', () => {
    expect(isUsableSelection({ x: 0, y: 0, width: 3, height: 50 })).toBe(false);
    expect(isUsableSelection({ x: 0, y: 0, width: 50, height: 3 })).toBe(false);
  });
  it('accepts a selection at or above the minimum', () => {
    expect(isUsableSelection({ x: 0, y: 0, width: 8, height: 8 })).toBe(true);
    expect(isUsableSelection({ x: 0, y: 0, width: 120, height: 80 })).toBe(true);
  });
  it('honours a custom minimum', () => {
    expect(isUsableSelection({ x: 0, y: 0, width: 10, height: 10 }, 16)).toBe(false);
  });
});

describe('normalizeBrowserUrl', () => {
  it('blank → about:blank', () => {
    expect(normalizeBrowserUrl('')).toBe('about:blank');
    expect(normalizeBrowserUrl('   ')).toBe('about:blank');
  });
  it('prefixes a bare host with https', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
    expect(normalizeBrowserUrl('example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });
  it('treats host:port as ambiguous and leaves it alone (host:port reads as scheme:path)', () => {
    // Known limitation: `localhost:3000` matches the scheme regex, so it is
    // passed through verbatim rather than https-prefixed. Documented, not a bug
    // worth special-casing — users paste full URLs for local dev.
    expect(normalizeBrowserUrl('localhost:3000/x')).toBe('localhost:3000/x');
  });
  it('leaves an explicit scheme intact', () => {
    expect(normalizeBrowserUrl('http://x.test')).toBe('http://x.test');
    expect(normalizeBrowserUrl('https://x.test')).toBe('https://x.test');
    expect(normalizeBrowserUrl('file:///tmp/a.html')).toBe('file:///tmp/a.html');
    expect(normalizeBrowserUrl('about:blank')).toBe('about:blank');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeBrowserUrl('  example.com  ')).toBe('https://example.com');
  });
});

describe('computeAnnotationCrop', () => {
  it('at 1x scale, pads the selection and keeps the highlight aligned', () => {
    const { crop, highlight } = computeAnnotationCrop(
      { x: 100, y: 100, width: 50, height: 40 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      24,
    );
    expect(crop).toEqual({ x: 76, y: 76, width: 98, height: 88 });
    // highlight sits at (selection - crop origin)
    expect(highlight).toEqual({ x: 24, y: 24, width: 50, height: 40 });
  });

  it('scales selection coords when the source image is larger than the capture (retina)', () => {
    // capture 400x300 CSS px, source 800x600 device px → 2x
    const { crop, highlight } = computeAnnotationCrop(
      { x: 50, y: 50, width: 100, height: 60 },
      { width: 400, height: 300 },
      { width: 800, height: 600 },
      0,
    );
    // selection*2 = x100 y100 w200 h120, pad 0
    expect(crop).toEqual({ x: 100, y: 100, width: 200, height: 120 });
    expect(highlight).toEqual({ x: 0, y: 0, width: 200, height: 120 });
  });

  it('clamps the crop origin to 0 near the top-left edge', () => {
    const { crop } = computeAnnotationCrop(
      { x: 5, y: 5, width: 20, height: 20 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      24,
    );
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
  });

  it('clamps crop width/height to the source bounds near the bottom-right edge', () => {
    const { crop } = computeAnnotationCrop(
      { x: 780, y: 580, width: 40, height: 40 },
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      24,
    );
    expect(crop.x + crop.width).toBeLessThanOrEqual(800);
    expect(crop.y + crop.height).toBeLessThanOrEqual(600);
  });
});
