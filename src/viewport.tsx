import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { FACES, Face, Facelets, Move } from "./cube";
import { COLOURS, Colours, CubeView } from "./scene3d";
import { Texts } from "./texts";

// The cube in the page: the 3D view (CubeView) with buttons to turn the view, or the net without WebGL. The view
// object hangs on its element (cubeView) for tests.

/** Where each face goes in the net: column and row, in stickers. */
const NET: Record<Face, [number, number]> = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] };

/** The cube unfolded: U on top, L F R B in a row, D below. */
export const Net = ({ facelets, cell = 12, label, testId, colours = COLOURS }: { facelets: Facelets; cell?: number; label: string; testId?: string; colours?: Colours }) => (
  <svg viewBox="-0.1 -0.1 12.2 9.2" width={12 * cell} height={9 * cell} role="img" aria-label={label} data-testid={testId} className="block max-w-full h-auto">
    {FACES.map((face, f) =>
      Array.from({ length: 9 }, (_, i) => (
        <rect key={`${face}${i}`} x={NET[face][0] + (i % 3) + 0.05} y={NET[face][1] + Math.floor(i / 3) + 0.05} width={0.9} height={0.9} rx={0.14}
          fill={colours[facelets[f * 9 + i] as Face] ?? "#94a3b8"} stroke="#1e293b" stroke-width={0.05} />
      ))
    )}
  </svg>
);

const ICONS: Record<string, string> = {
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  flip: "M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4",
};

const ViewButton = ({ icon, label, onClick, pressed }: { icon: string; label: string; onClick: () => void; pressed?: boolean }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} aria-pressed={pressed}
    className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-700">
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={ICONS[icon]} />
    </svg>
  </button>
);

export const Viewport = ({ facelets, move, height, texts: t, reducedMotion, onTurn, colours = COLOURS }: {
  facelets: Facelets;
  /** The turn that made this cube (animated), or null. */
  move: { move: Move | null; id: number };
  height: number;
  texts: Texts;
  reducedMotion: boolean;
  /** The on-screen cube: dragging a sticker turns its face. */
  onTurn: ((move: Move) => void) | null;
  /** The colours of the faces (coloursFor: white or yellow on top). */
  colours?: Colours;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<CubeView | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [back, setBack] = useState(false);

  useLayoutEffect(() => {
    if (!host.current) return;
    try {
      view.current = new CubeView(host.current, colours);
      view.current.canvas.addEventListener("webglcontextlost", () => setWebgl(false));
      (host.current as any).cubeView = view.current;
    } catch {
      setWebgl(false);
      return;
    }
    return () => {
      view.current?.dispose();
      view.current = null;
      if (host.current) (host.current as any).cubeView = null;
    };
  }, [webgl]);

  useLayoutEffect(() => {
    if (view.current) view.current.reducedMotion = reducedMotion;
  }, [reducedMotion, webgl]);
  const turn = useRef(onTurn);
  turn.current = onTurn;
  useLayoutEffect(() => {
    if (view.current) view.current.onTurn = onTurn ? (m) => turn.current?.(m) : null;
  }, [!!onTurn, webgl]);
  // every new turn (its id) is shown once, animated; a cube without a turn is painted
  useLayoutEffect(() => {
    view.current?.show(facelets, move.move);
  }, [facelets, move.id, webgl]);

  const flip = () => {
    const next = !back;
    setBack(next);
    view.current?.resetView(next);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const v = view.current;
    if (!v) return;
    const step = e.shiftKey ? 45 : 15;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => v.turn(-step, 0),
      ArrowRight: () => v.turn(step, 0),
      ArrowUp: () => v.turn(0, step),
      ArrowDown: () => v.turn(0, -step),
      Home: () => v.resetView(back),
    };
    if (!actions[e.key]) return;
    e.preventDefault();
    e.stopPropagation();
    actions[e.key]();
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-200/60" style={{ height: `${height}px` }}>
      {webgl ? (
        <div ref={host} data-testid="viewport" role="application" tabIndex={0} aria-label={`${t.cube}. ${onTurn ? t.cubeTurnHelp : t.cubeHelp}`} onKeyDown={onKeyDown}
          className="sc-viewport absolute inset-0 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-sky-700" />
      ) : (
        <div data-testid="no-webgl" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm text-slate-700">
          <Net facelets={facelets} cell={24} label={t.cube} testId="net" colours={colours} />
          <p className="m-0 max-w-[46ch]">{t.noWebgl}</p>
        </div>
      )}
      {webgl && (
        <div role="group" aria-label={t.cube} className="absolute right-2 top-2 flex gap-0.5 rounded-xl bg-white/90 p-1 shadow-sm ring-1 ring-slate-200 backdrop-blur">
          <ViewButton icon="left" label={t.view.left} onClick={() => view.current?.turn(-20, 0)} />
          <ViewButton icon="right" label={t.view.right} onClick={() => view.current?.turn(20, 0)} />
          <ViewButton icon="flip" label={back ? t.view.front : t.view.back} onClick={flip} pressed={back} />
        </div>
      )}
    </div>
  );
};

export const usePrefersReducedMotion = () => {
  const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const listener = () => setReduced(query.matches);
    query.addEventListener?.("change", listener);
    return () => query.removeEventListener?.("change", listener);
  }, []);
  return reduced;
};
