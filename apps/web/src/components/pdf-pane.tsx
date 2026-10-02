'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { Geometry, Revision } from '../../../../packages/domain';
import {
  rotatePoint,
  rotateGeometry,
  rectangle,
  type Point,
} from '../../../../packages/viewer/geometry';

export type Tool = 'pan' | 'rectangle' | 'pin' | 'measure' | 'exclude';
export type Mark = {
  id: string;
  geometry: Geometry;
  kind: 'issue' | 'proposed' | 'change' | 'exclusion';
  label: string;
};
type Props = {
  projectId: string;
  revision: Revision;
  page: number;
  zoom: number;
  rotation: number;
  tool: Tool;
  marks: Mark[];
  onDraw: (g: Geometry) => void;
  onMark: (id: string) => void;
  view?: { x: number; y: number; source: string };
  onView: (v: { x: number; y: number; source: string }) => void;
  paneId: string;
  focus?: Geometry;
  opacity?: number;
};
export function PdfPane(props: Props) {
  const {
    revision,
    page,
    zoom,
    rotation,
    projectId,
    tool,
    marks,
    onDraw,
    onMark,
    view,
    onView,
    paneId,
    focus,
  } = props;
  const scroller = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    renderTask = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(''),
    [rendering, setRendering] = useState(false),
    [tick, setTick] = useState(0),
    [drawing, setDrawing] = useState<Geometry | null>(null),
    [measurement, setMeasurement] = useState('');
  const drag = useRef<{ start: Point; client: Point; scroll: Point } | null>(null),
    syncing = useRef(false);
  const metadata = revision.pages[page - 1];
  const angle = ((metadata?.rotation || 0) + rotation) % 360;
  const naturalW = metadata?.width || 600,
    naturalH = metadata?.height || 800;
  const width = (angle % 180 ? naturalH : naturalW) * zoom,
    height = (angle % 180 ? naturalW : naturalH) * zoom;
  useEffect(() => {
    if (revision.mime !== 'application/pdf') return;
    let disposed = false;
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | undefined;
    void import('pdfjs-dist')
      .then((pdf) => {
        if (disposed) return;
        pdf.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        task = pdf.getDocument({
          url: `/api/projects/${projectId}/files/${revision.id}`,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
        });
        return task.promise;
      })
      .then((doc) => {
        if (!disposed && doc) {
          setDocument(doc);
          setError('');
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      renderTask.current?.cancel();
      void task?.destroy();
    };
  }, [projectId, revision.id, revision.mime]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvas.current || !scroller.current || !metadata) return;
    let disposed = false;
    const previous = renderTask.current;
    previous?.cancel();
    const timeout = setTimeout(() => {
      void (async () => {
        await previous?.promise.catch(() => {});
        if (disposed) return;
        const pdfPage = await document.getPage(page);
        if (disposed) return;
        const viewport = pdfPage.getViewport({
          scale: zoom / (metadata.user_unit || 1),
          rotation: angle,
        });
        const scroll = scroller.current!,
          target = canvas.current!;
        const x = Math.max(0, scroll.scrollLeft - 32),
          y = Math.max(0, scroll.scrollTop - 32);
        const tileW = Math.max(1, Math.min(viewport.width - x, scroll.clientWidth + 64)),
          tileH = Math.max(1, Math.min(viewport.height - y, scroll.clientHeight + 64));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.ceil(tileW * dpr);
        target.height = Math.ceil(tileH * dpr);
        target.style.width = `${tileW}px`;
        target.style.height = `${tileH}px`;
        target.style.left = `${x}px`;
        target.style.top = `${y}px`;
        const context = target.getContext('2d');
        if (!context) return;
        setRendering(true);
        const task = pdfPage.render({
          canvas: target,
          canvasContext: context,
          viewport,
          transform: [dpr, 0, 0, dpr, -x * dpr, -y * dpr],
          annotationMode: 0,
        });
        renderTask.current = task;
        try {
          await task.promise;
          if (!disposed) setError('');
        } catch (e) {
          if (!disposed && (e as Error).name !== 'RenderingCancelledException') setError(String(e));
        } finally {
          if (!disposed) setRendering(false);
        }
      })().catch((e) => {
        if (!disposed) setError(String(e));
      });
    }, 50);
    return () => {
      disposed = true;
      clearTimeout(timeout);
      renderTask.current?.cancel();
    };
  }, [document, page, zoom, angle, tick, metadata]);
  useEffect(() => {
    if (!view || view.source === paneId || !scroller.current) return;
    const element = scroller.current;
    syncing.current = true;
    element.scrollLeft = view.x * width - element.clientWidth / 2 + 32;
    element.scrollTop = view.y * height - element.clientHeight / 2 + 32;
    setTick((n) => n + 1);
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, [view, paneId, width, height]);
  useEffect(() => {
    if (!focus || !scroller.current) return;
    const g = rotateGeometry(focus, angle),
      el = scroller.current;
    el.scrollLeft = (g.x + g.width / 2) * width - el.clientWidth / 2 + 32;
    el.scrollTop = (g.y + g.height / 2) * height - el.clientHeight / 2 + 32;
    setTick((n) => n + 1);
  }, [focus, width, height, angle]);
  function point(event: React.PointerEvent): Point {
    const bounds = surface.current!.getBoundingClientRect();
    return rotatePoint(
      {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      },
      360 - angle,
    );
  }
  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      start: point(event),
      client: { x: event.clientX, y: event.clientY },
      scroll: { x: scroller.current!.scrollLeft, y: scroller.current!.scrollTop },
    };
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    if (tool === 'pan') {
      scroller.current!.scrollLeft = start.scroll.x + start.client.x - event.clientX;
      scroller.current!.scrollTop = start.scroll.y + start.client.y - event.clientY;
    } else setDrawing(rectangle(start.start, point(event)));
  }
  function up(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    drag.current = null;
    if (!start || tool === 'pan') return;
    const end = point(event),
      g =
        tool === 'pin'
          ? { ...rectangle(end, end), kind: 'pin' as const }
          : rectangle(start.start, end);
    if (tool === 'measure') {
      const distance = Math.hypot(
        (end.x - start.start.x) * naturalW,
        (end.y - start.start.y) * naturalH,
      );
      setMeasurement(
        metadata?.user_unit
          ? `${((distance * metadata.user_unit * 25.4) / 72).toFixed(2)} mm in PDF coordinates · confirm output scale`
          : 'Physical scale unknown for this image',
      );
    } else if (tool === 'pin' || (g.width > 0.002 && g.height > 0.002)) onDraw(g);
    setDrawing(null);
  }
  if (!metadata) return <div className="viewer-state">This page is unavailable.</div>;
  return (
    <div className="pane">
      <div className="pane-label">
        <span>REVISION {String(revision.sequence).padStart(2, '0')}</span>
        <span>
          {page} / {revision.pages.length} ·{' '}
          {rendering ? 'Rendering detail…' : `${Math.round(zoom * 100)}%`}
        </span>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div
        ref={scroller}
        className="canvas-scroll"
        onScroll={() => {
          setTick((n) => n + 1);
          if (!syncing.current && scroller.current) {
            const e = scroller.current;
            onView({
              x: (e.scrollLeft + e.clientWidth / 2 - 32) / width,
              y: (e.scrollTop + e.clientHeight / 2 - 32) / height,
              source: paneId,
            });
          }
        }}
      >
        <div className="page-stage" style={{ width: width + 64, minHeight: height + 64 }}>
          <div
            ref={surface}
            className={`pdf-surface tool-${tool}`}
            style={{ width, height, opacity: props.opacity ?? 1 }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => {
              drag.current = null;
              setDrawing(null);
            }}
          >
            {revision.mime === 'application/pdf' ? (
              <canvas ref={canvas} aria-label={`Revision ${revision.sequence}, page ${page}`} />
            ) : (
              <img
                draggable={false}
                alt={`Revision ${revision.sequence}`}
                src={`/api/projects/${projectId}/files/${revision.id}`}
                style={{
                  width: naturalW * zoom,
                  height: naturalH * zoom,
                  transform: `rotate(${angle}deg)`,
                  transformOrigin: 'center',
                  position: 'absolute',
                  left: (width - naturalW * zoom) / 2,
                  top: (height - naturalH * zoom) / 2,
                }}
              />
            )}
            <svg className="annotation-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <defs>
                <pattern
                  id={`hatch-${paneId}`}
                  width="12"
                  height="12"
                  patternUnits="userSpaceOnUse"
                >
                  <path d="M0 12L12 0" stroke="#e4a653" strokeWidth="3" />
                </pattern>
              </defs>
              {[
                ...marks,
                ...(drawing
                  ? [
                      {
                        id: 'drawing',
                        geometry: drawing,
                        kind: tool === 'exclude' ? 'exclusion' : 'issue',
                        label: 'New region',
                      } as Mark,
                    ]
                  : []),
              ].map((mark) => {
                const g = rotateGeometry(mark.geometry, angle);
                return (
                  <g
                    key={mark.id}
                    className={`mark ${mark.kind}`}
                    onPointerDown={(event) => {
                      if (mark.id !== 'drawing' && tool === 'pan') {
                        event.stopPropagation();
                        onMark(mark.id);
                      }
                    }}
                  >
                    <title>{mark.label}</title>
                    {g.kind === 'pin' ? (
                      <circle cx={g.x * 1000} cy={g.y * 1000} r="6" />
                    ) : (
                      <rect
                        x={g.x * 1000}
                        y={g.y * 1000}
                        width={g.width * 1000}
                        height={g.height * 1000}
                        fill={mark.kind === 'exclusion' ? `url(#hatch-${paneId})` : undefined}
                      />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
      {measurement && (
        <div className="measure-result">
          {measurement}
          <button onClick={() => setMeasurement('')} aria-label="Dismiss measurement">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
