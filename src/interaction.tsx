import { useEffect, useRef, useState } from "preact/hooks";
import { IStore, useStore } from "@citolab/preact-store";
import {
  Attempt, FACES, Facelets, Move, SOLVED, applyMove, applyMoves, attemptAfter, attemptFor, attemptSeed, attemptStart, attemptTick,
  clockOf, formatMove, formatMoves, formatTime, hintOf, scrambleFor,
} from "./cube";
import { GiikerCube, bluetoothProblem } from "./bluetooth";
import { Settings } from "./settings";
import { Actions, Result, StateModel } from "./store";
import { Texts, localTime } from "./texts";
import { Net, Viewport, usePrefersReducedMotion } from "./viewport";

// The candidate's view: the cube (a GiiKER over Bluetooth, or the on-screen cube), and next to it what to do now:
// follow the scramble, start, inspect, solve. Below, the results of the attempts.

type Device = { kind: "giiker"; cube: GiikerCube } | { kind: "virtual" };

const button = "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed disabled:opacity-50";
const primary = `${button} bg-sky-700 text-white hover:bg-sky-800`;
const secondary = `${button} bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50`;

/** What the instance offers tests and the stories: the cube and the attempt, and the on-screen cube's turns. */
export type Controls = {
  turn: (move: Move) => void;
  attempt: () => Attempt | null;
  facelets: () => Facelets;
};

const Interaction = ({ prompt, settings: s, store, texts: t, readOnly, seed, controls }: {
  prompt: string;
  settings: Settings;
  store: IStore<StateModel, Actions>;
  texts: Texts;
  readOnly: boolean;
  seed: string;
  controls: (c: Controls | null) => void;
}) => {
  const state = useStore(store);
  const reducedMotion = usePrefersReducedMotion();
  // without a smart cube, the on-screen cube (when the item allows it)
  const fallback = (): Device | null => (s.allowVirtual && !readOnly ? { kind: "virtual" } : null);
  const [device, setDevice] = useState<Device | null>(fallback);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);
  const attemptRef = useRef<Attempt | null>(null);
  const faceletsRef = useRef<Facelets>(SOLVED);
  const lastMove = useRef<{ move: Move | null; id: number }>({ move: null, id: 0 });
  const deviceRef = useRef<Device | null>(null);
  deviceRef.current = device;
  const inspectionMs = s.inspection * 1000;

  const results = state.results;
  const remaining = s.attempts - results.length;

  /** A new attempt for the cube as it is, when there are attempts left. */
  const newAttempt = (facelets: Facelets) => {
    const index = store.getState().results.length;
    if (index >= s.attempts) {
      attemptRef.current = null;
      return;
    }
    attemptRef.current = attemptFor(scrambleFor(attemptSeed(seed, index), s.scrambleLength), facelets);
  };

  const record = (a: Attempt, solved: boolean) => {
    const index = store.getState().results.length;
    const result: Result = {
      seed: attemptSeed(seed, index),
      scramble: formatMoves(a.scramble),
      time: solved && a.solveStart !== null && a.solveEnd !== null ? Math.round(a.solveEnd - a.solveStart) : null,
      moves: a.solution.length,
      inspection: a.inspectionStart !== null && a.solveStart !== null ? Math.round(a.solveStart - a.inspectionStart) : 0,
      solution: formatMoves(a.solution),
      device: deviceRef.current?.kind ?? "virtual",
    };
    store.dispatch({ type: "RESULT", payload: { result } });
    setAnnouncement(solved ? t.announce.solved(localTime(formatTime(result.time ?? 0), s.language), result.moves) : t.announce.dnf);
  };

  /** The cube changed: the view, and the attempt. */
  const onCube = (move: Move | null, facelets: Facelets, now = performance.now()) => {
    faceletsRef.current = facelets;
    lastMove.current = { move, id: lastMove.current.id + 1 };
    const before = attemptRef.current;
    if (before) {
      const after = attemptAfter(before, move, facelets, now);
      attemptRef.current = after;
      if (after.phase !== before.phase) {
        if (after.phase === "ready") setAnnouncement(t.announce.ready);
        if (after.phase === "solving") setAnnouncement(t.announce.solving);
        if (after.phase === "solved") record(after, true);
      }
    }
    rerender();
  };
  // the on-screen cube starts with an attempt straight away
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    if (device) newAttempt(SOLVED);
  }
  const attempt = attemptRef.current;

  const onCubeRef = useRef(onCube);
  onCubeRef.current = onCube;

  const connected = (d: Device, facelets: Facelets, name: string) => {
    setDevice(d);
    setMessage("");
    setAnnouncement(t.announce.connected(name));
    if (attemptRef.current) onCube(null, facelets);
    else {
      newAttempt(facelets);
      onCube(null, facelets);
    }
  };

  const connect = () => {
    const problem = bluetoothProblem();
    if (problem) {
      setMessage(t[problem]);
      return;
    }
    setConnecting(true);
    setMessage("");
    // requestDevice runs here, in the click: the browser asks the candidate which cube
    GiikerCube.connect(
      (change) => onCubeRef.current(change.move, change.facelets, change.time),
      () => {
        if (deviceRef.current?.kind !== "giiker") return;
        setDevice(fallback());
        setMessage(t.disconnected);
      }
    )
      .then(({ cube, facelets }) => connected({ kind: "giiker", cube }, facelets, cube.name))
      .catch((error: Error) => {
        if (error?.message === "cancelled") return;
        setMessage(error?.name === "SecurityError" ? t.blocked : t.failed(error?.message || String(error)));
      })
      .finally(() => setConnecting(false));
  };

  /** Back to the on-screen cube, as the smart cube left it. */
  const disconnect = () => {
    const d = deviceRef.current;
    setDevice(fallback());
    if (d?.kind === "giiker") d.cube.disconnect();
  };
  useEffect(() => () => {
    const d = deviceRef.current;
    if (d?.kind === "giiker") d.cube.disconnect();
  }, []);

  const turn = (move: Move) => {
    if (deviceRef.current?.kind !== "virtual" || readOnly) return;
    onCube(move, applyMove(faceletsRef.current, move));
  };

  useEffect(() => {
    controls({ turn, attempt: () => attemptRef.current, facelets: () => faceletsRef.current });
    return () => controls(null);
  });

  const start = () => {
    const a = attemptRef.current;
    if (!a || a.phase !== "ready") return;
    attemptRef.current = attemptStart(a, performance.now(), inspectionMs);
    setAnnouncement(inspectionMs > 0 ? t.announce.inspection(s.inspection) : t.announce.solving);
    rerender();
  };

  const giveUp = () => {
    const a = attemptRef.current;
    if (!a || (a.phase !== "inspection" && a.phase !== "solving")) return;
    record(a, false);
    attemptRef.current = null;
    rerender();
  };

  const next = () => {
    newAttempt(faceletsRef.current);
    rerender();
  };

  // the clock: a frame at a time while it runs
  const running = attempt?.phase === "inspection" || attempt?.phase === "solving";
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const a = attemptRef.current;
      if (!a) return;
      const after = attemptTick(a, performance.now(), inspectionMs);
      if (after !== a) {
        attemptRef.current = after;
        setAnnouncement(t.announce.solving);
      }
      rerender();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === " " && attemptRef.current?.phase === "ready" && target?.tagName !== "BUTTON") {
      e.preventDefault();
      start();
      return;
    }
    if (deviceRef.current?.kind !== "virtual" || e.ctrlKey || e.metaKey || e.altKey) return;
    const face = e.key.toUpperCase();
    if (!(FACES as string[]).includes(face)) return;
    e.preventDefault();
    turn({ face: face as Move["face"], amount: e.shiftKey ? 3 : 1 });
  };

  const scrambleForMe = () => {
    const a = attemptRef.current;
    if (!a || a.phase !== "scramble" || a.guide.lost) return;
    let f = faceletsRef.current;
    for (const m of [...(hintOf(a.scramble, a.guide)?.moves ?? []), ...a.scramble.slice(a.guide.extra.length ? a.guide.done : a.guide.done + 1)]) {
      f = applyMove(f, m);
      onCube(m, f);
    }
  };

  const now = performance.now();
  const clock = attempt ? clockOf(attempt, now, inspectionMs) : null;
  const solved = results.filter((r) => r.time !== null);
  const best = solved.length ? Math.min(...solved.map((r) => r.time!)) : null;
  const time = (ms: number) => localTime(formatTime(ms), s.language);

  return (
    <div className="flex flex-col gap-4 font-sans text-slate-900" role="region" aria-label={t.region} onKeyDown={onKeyDown}>
      {prompt && <p className="m-0 text-base leading-relaxed">{prompt}</p>}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {device?.kind === "giiker" ? (
            <>
              <span data-testid="device" className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 ring-1 ring-emerald-200">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                {t.connected(device.cube.name)}
              </span>
              <button type="button" className={secondary} onClick={disconnect}>{t.disconnect}</button>
            </>
          ) : (
            <>
              <button type="button" className={primary} onClick={connect} disabled={connecting}>
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M7 7l10 10-5 5V2l5 5L7 17" />
                </svg>
                {connecting ? t.connecting : t.connect}
              </button>
              <span className="text-sm text-slate-600">{t.supported}</span>
              {device && (
                <span data-testid="device" className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-slate-200">
                  {t.virtualConnected}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {message && <p data-testid="message" role="alert" className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200">{message}</p>}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Viewport facelets={faceletsRef.current} move={lastMove.current} height={s.height} texts={t} reducedMotion={reducedMotion}
          onTurn={device?.kind === "virtual" && !readOnly ? turn : null} />

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="panel">
          {attempt && !readOnly ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-600">{t.attempt(results.length + (attempt.phase === "solved" ? 0 : 1), s.attempts)}</h3>
                <span className="text-xs text-slate-500" data-testid="seed">{t.seed(attemptSeed(seed, results.length - (attempt.phase === "solved" ? 1 : 0)))}</span>
              </div>

              {(attempt.phase === "scramble" || attempt.phase === "ready") && (
                <ScramblePanel attempt={attempt} texts={t} virtual={device?.kind === "virtual"} onReset={() => onCube(null, SOLVED)} onScramble={scrambleForMe} />
              )}
              {attempt.phase === "ready" && (
                <div className="flex flex-col gap-2">
                  <p className="m-0 text-sm font-medium text-emerald-800">{t.ready}</p>
                  <button type="button" className={`${primary} h-12 text-base`} onClick={start}>{t.start}</button>
                </div>
              )}
              {(attempt.phase === "inspection" || attempt.phase === "solving" || attempt.phase === "solved") && clock && (
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {attempt.phase === "inspection" ? t.inspection : attempt.phase === "solving" ? t.solving : t.solved}
                  </span>
                  <span data-testid="clock"
                    className={`font-mono text-5xl font-bold tabular-nums ${attempt.phase === "inspection" ? (clock.ms <= 3000 ? "text-orange-600" : "text-sky-800") : attempt.phase === "solved" ? "text-emerald-700" : "text-slate-900"}`}>
                    {clock.kind === "inspection" ? Math.ceil(clock.ms / 1000) : time(clock.ms)}
                  </span>
                  {attempt.phase === "inspection" && <p className="m-0 text-sm text-slate-600">{t.inspectionHelp}</p>}
                  {attempt.phase !== "inspection" && (
                    <span className="text-sm text-slate-700" data-testid="moves">
                      {attempt.solution.length} {t.moves}
                      {attempt.phase === "solved" && clock.ms > 0 && ` · ${localTime((attempt.solution.length / (clock.ms / 1000)).toFixed(2), s.language)} ${t.tps}`}
                    </span>
                  )}
                  {attempt.phase !== "solved" && <button type="button" className={secondary} onClick={giveUp}>{t.giveUp}</button>}
                  {attempt.phase === "solved" && remaining > 0 && <button type="button" className={primary} onClick={next}>{t.nextScramble}</button>}
                  {attempt.phase === "solved" && remaining <= 0 && <p className="m-0 text-sm font-medium text-slate-700">{t.done}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              {!readOnly && device && remaining > 0 && (
                <button type="button" className={primary} onClick={next}>{t.nextScramble}</button>
              )}
              {(readOnly || remaining <= 0) && results.length > 0 && <p className="m-0 text-sm font-medium text-slate-700">{t.done}</p>}
              {!device && !readOnly && remaining > 0 && (() => {
                const upcoming = scrambleFor(attemptSeed(seed, results.length), s.scrambleLength);
                return (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-slate-600">{t.attempt(results.length + 1, s.attempts)}</h3>
                      <span className="text-xs text-slate-500">{t.seed(attemptSeed(seed, results.length))}</span>
                    </div>
                    <p className="m-0 text-sm text-slate-600">{t.scramble}: <span className="font-mono font-semibold text-slate-800">{formatMoves(upcoming)}</span></p>
                    <div className="flex justify-center">
                      <Net facelets={applyMoves(SOLVED, upcoming)} cell={14} label={t.target} />
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          {best !== null && (
            <p className="m-0 mt-auto border-t border-slate-100 pt-3 text-sm text-slate-700" data-testid="best">
              {t.best}: <strong className="font-mono tabular-nums">{time(best)}</strong>
              {s.targetTime > 0 && <span className="text-slate-500"> · {t.targetTime(localTime(String(s.targetTime), s.language))}</span>}
            </p>
          )}
        </div>
      </div>

      {device?.kind === "virtual" && !readOnly && <VirtualControls texts={t} onTurn={turn} />}

      <ResultsTable results={results} texts={t} time={time} />

      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
};

/** The scramble as chips (done, now, to come), what to turn next, and the cube as it should become. */
const ScramblePanel = ({ attempt: a, texts: t, virtual, onReset, onScramble }: {
  attempt: Attempt;
  texts: Texts;
  virtual: boolean;
  onReset: () => void;
  onScramble: () => void;
}) => {
  const hint = hintOf(a.scramble, a.guide);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.scramble}</h4>
        <ol data-testid="scramble" className="m-0 flex list-none flex-wrap gap-1 p-0 font-mono text-sm" aria-label={t.scramble}>
          {a.scramble.map((m, i) => {
            const done = i < a.guide.done;
            const now = !a.guide.lost && i === a.guide.done;
            return (
              <li key={i} aria-current={now ? "step" : undefined}
                className={`min-w-9 rounded-md px-1.5 py-1 text-center font-semibold ${done ? "bg-slate-100 text-slate-400 line-through" : now ? (a.guide.extra.length ? "bg-white text-slate-900 ring-2 ring-red-300" : "bg-sky-700 text-white") : "bg-white text-slate-800 ring-1 ring-slate-300"}`}>
                {formatMove(m)}
              </li>
            );
          })}
        </ol>
      </div>
      {a.guide.lost ? (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200" data-testid="lost">
          <p className="m-0">{t.lost}</p>
          {virtual && <button type="button" className={secondary} onClick={onReset}>{t.resetVirtual}</button>}
        </div>
      ) : hint ? (
        <p data-testid="hint" className={`m-0 rounded-lg px-3 py-2 text-sm ${hint.undo ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-sky-50 text-sky-950 ring-1 ring-sky-200"}`}>
          {hint.undo ? t.undo : t.next} <strong className="font-mono text-base">{formatMoves(hint.moves)}</strong>
        </p>
      ) : null}
      {a.phase === "scramble" && virtual && !a.guide.lost && <button type="button" className={secondary} onClick={onScramble}>{t.scrambleForMe}</button>}
      <div className="flex justify-center">
        <Net facelets={applyMoves(SOLVED, a.scramble)} cell={14} label={t.target} testId="target" />
      </div>
    </div>
  );
};

const VirtualControls = ({ texts: t, onTurn }: { texts: Texts; onTurn: (m: Move) => void }) => (
  <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3" role="group" aria-label={t.virtualMoves}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="m-0 text-sm font-semibold text-slate-800">{t.virtualMoves}</h3>
      <span className="text-xs text-slate-500">{t.virtualHelp}</span>
    </div>
    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 lg:grid-cols-18">
      {FACES.flatMap((face) => ([1, 3, 2] as const).map((amount) => {
        const m: Move = { face, amount };
        return (
          <button key={formatMove(m)} type="button" onClick={() => onTurn(m)} aria-label={t.turnName(face, amount)} title={t.turnName(face, amount)}
            className="h-9 cursor-pointer rounded-md bg-slate-100 font-mono text-sm font-semibold text-slate-800 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-sky-700">
            {formatMove(m)}
          </button>
        );
      }))}
    </div>
  </div>
);

const ResultsTable = ({ results, texts: t, time }: { results: Result[]; texts: Texts; time: (ms: number) => string }) => (
  <div className="rounded-xl border border-slate-200 bg-white">
    <h3 className="m-0 border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">{t.results}</h3>
    {results.length ? (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm" data-testid="results">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th scope="col" className="px-4 py-2 font-semibold">{t.colAttempt}</th>
              <th scope="col" className="px-4 py-2 font-semibold">{t.colTime}</th>
              <th scope="col" className="px-4 py-2 font-semibold">{t.colMoves}</th>
              <th scope="col" className="px-4 py-2 font-semibold">{t.colScramble}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-4 py-2 tabular-nums">{i + 1}</td>
                <td className="px-4 py-2 font-mono font-semibold tabular-nums">{r.time === null ? t.dnf : time(r.time)}</td>
                <td className="px-4 py-2 tabular-nums">{r.moves}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.scramble}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="m-0 px-4 py-3 text-sm text-slate-500">{t.noResults}</p>
    )}
  </div>
);

export default Interaction;
