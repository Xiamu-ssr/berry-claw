import { useCallback, useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Globe2,
  MousePointer2,
  RefreshCw,
} from 'lucide-react';
import type { AnnotationBlock } from './types';
import {
  clampPointToCapture,
  computeAnnotationCrop,
  isUsableSelection,
  normalizeBrowserUrl,
  normalizeRect,
} from './browserAnnotation';

export function BrowserRail({
  onAnnotationCreated,
}: {
  onAnnotationCreated: (block: AnnotationBlock) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('https://example.com');
  const [currentUrl, setCurrentUrl] = useState('');
  const [available, setAvailable] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capture, setCapture] = useState<BerryDesktopBrowserCapture | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const syncBounds = useCallback(() => {
    const api = window.berryDesktopBrowser;
    const host = hostRef.current;
    if (!api?.isAvailable() || !host) return;
    const rect = host.getBoundingClientRect();
    void api.setBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: !capture && rect.width > 0 && rect.height > 0,
    });
  }, [capture]);

  useEffect(() => {
    const api = window.berryDesktopBrowser;
    const ok = !!api && api.isAvailable();
    setAvailable(ok);
    if (!api || !ok) return;
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    if (hostRef.current) observer.observe(hostRef.current);
    window.addEventListener('resize', syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
      void api.setBounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
    };
  }, [syncBounds]);

  const navigate = useCallback(async () => {
    const api = window.berryDesktopBrowser;
    if (!api?.isAvailable()) return;
    const target = normalizeBrowserUrl(url);
    setError(null);
    setCurrentUrl(target);
    await api.navigate(target);
    syncBounds();
  }, [syncBounds, url]);

  const startAnnotation = useCallback(async () => {
    const api = window.berryDesktopBrowser;
    if (!api?.isAvailable()) return;
    setError(null);
    setCapturing(true);
    try {
      const shot = await api.capture();
      setCapture(shot);
      setSelection(null);
      setAnnotationText('');
      await api.setBounds({ x: 0, y: 0, width: 0, height: 0, visible: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(false);
    }
  }, []);

  const closeAnnotation = useCallback(() => {
    setCapture(null);
    setSelection(null);
    setAnnotationText('');
    requestAnimationFrame(syncBounds);
  }, [syncBounds]);

  const commitAnnotation = useCallback(async () => {
    if (!capture || !selection || !annotationText.trim()) return;
    const image = await buildHighlightedAnnotationImage(capture, selection);
    onAnnotationCreated({
      type: 'annotation',
      body: annotationText.trim(),
      source: { url: capture.url || currentUrl || url, title: capture.title },
      rect: selection,
      viewport: { width: capture.width, height: capture.height },
      image,
    });
    closeAnnotation();
  }, [annotationText, capture, closeAnnotation, currentUrl, onAnnotationCreated, selection, url]);

  if (!available) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] px-5 text-center">
        <Globe2 className="mb-3 text-zinc-600" size={28} />
        <div className="text-sm font-medium text-zinc-200">桌面浏览器不可用</div>
        <div className="mt-1 text-xs leading-5 text-zinc-500">
          内置浏览器 v1 依赖 Berry Claw Desktop。Web 和移动端先保留这个降级面板。
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-150px)] flex-col gap-3">
      <div className="flex items-center gap-1">
        <button type="button" title="Back" onClick={() => window.berryDesktopBrowser?.back()} className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200">
          <ChevronLeft size={15} />
        </button>
        <button type="button" title="Forward" onClick={() => window.berryDesktopBrowser?.forward()} className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200">
          <ChevronRight size={15} />
        </button>
        <button type="button" title="Reload" onClick={() => window.berryDesktopBrowser?.reload()} className="rounded-lg p-2 text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200">
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          disabled={capturing}
          title="Annotate visible area"
          onClick={startAnnotation}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-sky-300/20 bg-sky-300/10 px-2.5 py-2 text-xs font-medium text-sky-200 disabled:opacity-50"
        >
          <MousePointer2 size={13} />
          注解
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate();
        }}
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-sky-300/35"
        />
        <button type="submit" className="rounded-lg bg-white/[0.06] px-3 text-xs text-zinc-200 hover:bg-white/[0.10]">
          Open
        </button>
      </form>
      {error && <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div ref={hostRef} className="relative min-h-[520px] flex-1 overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
        {!currentUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
            Open a page to begin
          </div>
        )}
        {capture && (
          <AnnotationOverlay
            capture={capture}
            selection={selection}
            dragStart={dragStart}
            annotationText={annotationText}
            onDragStart={setDragStart}
            onSelectionChange={setSelection}
            onTextChange={setAnnotationText}
            onCancel={closeAnnotation}
            onCommit={() => void commitAnnotation()}
          />
        )}
      </div>
    </div>
  );
}

function AnnotationOverlay({
  capture,
  selection,
  dragStart,
  annotationText,
  onDragStart,
  onSelectionChange,
  onTextChange,
  onCancel,
  onCommit,
}: {
  capture: BerryDesktopBrowserCapture;
  selection: { x: number; y: number; width: number; height: number } | null;
  dragStart: { x: number; y: number } | null;
  annotationText: string;
  onDragStart: (point: { x: number; y: number } | null) => void;
  onSelectionChange: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  onTextChange: (text: string) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const rectFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return clampPointToCapture(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      capture,
    );
  };

  return (
    <div className="absolute inset-0 z-20 bg-black">
      <img
        src={`data:${capture.mediaType};base64,${capture.data}`}
        alt="browser capture"
        className="h-full w-full select-none object-fill"
        draggable={false}
      />
      <div
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={(event) => {
          const point = rectFromEvent(event);
          onDragStart(point);
          onSelectionChange({ ...point, width: 0, height: 0 });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragStart) return;
          const point = rectFromEvent(event);
          onSelectionChange(normalizeRect(dragStart, point));
        }}
        onPointerUp={() => onDragStart(null)}
      >
        {selection && selection.width > 2 && selection.height > 2 && (
          <div
            className="absolute border-2 border-sky-300 bg-sky-400/15 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{
              left: `${selection.x}px`,
              top: `${selection.y}px`,
              width: `${selection.width}px`,
              height: `${selection.height}px`,
            }}
          />
        )}
      </div>
      <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-white/[0.10] bg-[#111315]/95 p-3 shadow-2xl backdrop-blur-xl">
        <textarea
          value={annotationText}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="添加注解..."
          className="h-20 w-full resize-none rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-300/40"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200">
            取消
          </button>
          <button
            type="button"
            disabled={!isUsableSelection(selection) || !annotationText.trim()}
            onClick={onCommit}
            className="rounded-lg bg-sky-300 px-3 py-1.5 text-xs font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            加入输入框
          </button>
        </div>
      </div>
    </div>
  );
}

async function buildHighlightedAnnotationImage(
  capture: BerryDesktopBrowserCapture,
  selection: { x: number; y: number; width: number; height: number },
): Promise<AnnotationBlock['image']> {
  const source = await loadImage(`data:${capture.mediaType};base64,${capture.data}`);
  const { crop, highlight } = computeAnnotationCrop(
    selection,
    { width: capture.width, height: capture.height },
    { width: source.naturalWidth, height: source.naturalHeight },
  );

  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
  ctx.fillRect(highlight.x, highlight.y, highlight.width, highlight.height);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.strokeRect(highlight.x + 2, highlight.y + 2, Math.max(0, highlight.width - 4), Math.max(0, highlight.height - 4));

  const dataUrl = canvas.toDataURL('image/png');
  return {
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mediaType: 'image/png',
    width: crop.width,
    height: crop.height,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load browser screenshot'));
    img.src = src;
  });
}
