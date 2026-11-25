// The pure logic of the PCI, without imports (npm test runs it in node): the cube as 54 stickers, face turns,
// scrambles from a seed, the guide that follows the candidate through a scramble, the attempt (scramble, inspection,
// solve) and the messages of a GiiKER smart cube.

export type Face = "U" | "R" | "F" | "D" | "L" | "B";
export const FACES: Face[] = ["U", "R", "F", "D", "L", "B"];

/** A face turn: the number of clockwise quarter turns, as seen from outside the face (3 is one counterclockwise). */
export type Move = { face: Face; amount: 1 | 2 | 3 };

/**
 * The stickers, 9 per face in the order U R F D L B, each face row by row as seen from outside: U with B at the top,
 * D with F at the top, the side faces with U at the top (the order of Kociemba and cubejs). A sticker holds the face
 * its colour belongs to, with the cube held the way the candidate holds it: "U" is the colour on top (white, or yellow
 * with Top "yellow"; the view picks the colours, coloursFor in scene3d.ts).
 */
export type Facelets = string;
export const SOLVED: Facelets = FACES.map((f) => f.repeat(9)).join("");

// ---- geometry: every sticker has a place (x right, y up, z to the front, -1…1) and a normal --------------------------

type V3 = [number, number, number];
export const NORMAL: Record<Face, V3> = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

const stickerPosition = (face: Face, r: number, c: number): V3 => {
  switch (face) {
    case "U": return [c - 1, 1, r - 1];
    case "D": return [c - 1, -1, 1 - r];
    case "F": return [c - 1, 1 - r, 1];
    case "B": return [1 - c, 1 - r, -1];
    case "R": return [1, 1 - r, 1 - c];
    case "L": return [-1, 1 - r, c - 1];
  }
};

export type Sticker = { face: Face; position: V3; normal: V3 };
export const STICKERS: Sticker[] = FACES.flatMap((face) =>
  Array.from({ length: 9 }, (_, i) => ({ face, position: stickerPosition(face, Math.floor(i / 3), i % 3), normal: NORMAL[face] }))
);

const keyOf = (p: V3, n: V3) => `${p.join(",")}|${n.join(",")}`;
const STICKER_INDEX = new Map(STICKERS.map((s, i) => [keyOf(s.position, s.normal), i]));
/** The sticker of the cubie at a place, on a face; -1 when there is none. */
export const stickerAt = (position: V3, face: Face): number => STICKER_INDEX.get(keyOf(position, NORMAL[face])) ?? -1;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A clockwise quarter turn about axis a, seen from its tip (−90°): v′ = a(a·v) − a × v. */
const quarter = (a: V3, v: V3): V3 => {
  const d = dot(a, v);
  return [
    a[0] * d - (a[1] * v[2] - a[2] * v[1]),
    a[1] * d - (a[2] * v[0] - a[0] * v[2]),
    a[2] * d - (a[0] * v[1] - a[1] * v[0]),
  ].map((x) => x + 0) as V3; // + 0: no −0 in the keys
};

/** Per face, for a clockwise quarter turn: SOURCE[face][i] is the sticker that ends up at i. */
const SOURCE: Record<Face, number[]> = Object.fromEntries(
  FACES.map((face) => {
    const axis = NORMAL[face];
    const source = STICKERS.map((_, i) => i);
    STICKERS.forEach((s, i) => {
      if (dot(s.position, axis) !== 1) return;
      source[STICKER_INDEX.get(keyOf(quarter(axis, s.position), quarter(axis, s.normal)))!] = i;
    });
    return [face, source];
  })
) as Record<Face, number[]>;

/** The cubies a turn of a face moves: their places. */
export const layerOf = (face: Face): V3[] => {
  const places: V3[] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if ((x || y || z) && dot([x, y, z], NORMAL[face]) === 1) places.push([x, y, z]);
  }
  return places;
};

export const applyMove = (facelets: Facelets, move: Move): Facelets => {
  let cells = facelets.split("");
  for (let q = 0; q < move.amount; q++) {
    const source = SOURCE[move.face];
    cells = source.map((from) => cells[from]);
  }
  return cells.join("");
};

export const applyMoves = (facelets: Facelets, moves: Move[]): Facelets => moves.reduce(applyMove, facelets);

// ---- holding the cube with yellow on top ----------------------------------------------------------------------------

/** The colour the candidate holds on top: white (green in front), or yellow (green in front: the cube turned over, z2). */
export type Top = "white" | "yellow";
export const TOPS: Top[] = ["white", "yellow"];
export const topOf = (v: unknown): Top => (String(v ?? "").toLowerCase() === "yellow" ? "yellow" : "white");

/** z2, a half turn about the F axis: U and D swap, R and L swap, F and B stay. */
const Z2_FACE: Record<Face, Face> = { U: "D", D: "U", R: "L", L: "R", F: "F", B: "B" };
const z2 = (v: V3): V3 => [0 - v[0], 0 - v[1], v[2]];
/** Z2_TARGET[i]: where sticker i goes when the cube is turned over. */
const Z2_TARGET = STICKERS.map((s) => STICKER_INDEX.get(keyOf(z2(s.position), z2(s.normal)))!);

/**
 * A cube as seen with white on top (a GiiKER cube always reports it so) as seen with this top, and a turn of it. z2 is
 * its own inverse, so the same functions turn it back.
 */
export const heldAs = (facelets: Facelets, top: Top): Facelets => {
  if (top === "white") return facelets;
  const cells: string[] = new Array(54);
  facelets.split("").forEach((c, i) => (cells[Z2_TARGET[i]] = Z2_FACE[c as Face] ?? c));
  return cells.join("");
};
export const moveHeldAs = (move: Move, top: Top): Move => (top === "white" ? move : { face: Z2_FACE[move.face], amount: move.amount });

// ---- notation -------------------------------------------------------------------------------------------------------

export const formatMove = (m: Move): string => m.face + (m.amount === 2 ? "2" : m.amount === 3 ? "'" : "");
export const formatMoves = (moves: Move[]): string => moves.map(formatMove).join(" ");

/** "R", "R'", "R2", "R2'" (and ’ or ′ for the prime); null for anything else. */
export const parseMove = (text: string): Move | null => {
  const match = /^([URFDLB])(2?)(['’′]?)$/.exec(text.trim());
  if (!match) return null;
  const amount = match[2] ? 2 : match[3] ? 3 : 1;
  return { face: match[1] as Face, amount };
};

/** Moves separated by spaces; null when one of them is not a move. */
export const parseMoves = (text: string): Move[] | null => {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const moves = words.map(parseMove);
  return moves.every(Boolean) ? (moves as Move[]) : null;
};

export const inverse = (m: Move): Move => ({ face: m.face, amount: (4 - m.amount) as Move["amount"] });
export const inverseOf = (moves: Move[]): Move[] => moves.map(inverse).reverse();

const AXIS: Record<Face, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
export const sameAxis = (a: Face, b: Face) => AXIS[a] === AXIS[b];

/**
 * Adds a move to a list and simplifies: R then R gives R2, R then R′ gives nothing. Turns of opposite faces commute,
 * so R L R′ gives L as well.
 */
export const pushMove = (moves: Move[], m: Move): Move[] => {
  const list = [...moves];
  for (let i = list.length - 1; i >= 0 && sameAxis(list[i].face, m.face); i--) {
    if (list[i].face !== m.face) continue;
    const amount = (list[i].amount + m.amount) % 4;
    if (amount === 0) list.splice(i, 1);
    else list[i] = { face: m.face, amount: amount as Move["amount"] };
    return list;
  }
  return [...list, m];
};

// ---- scrambles from a seed ------------------------------------------------------------------------------------------

/** A number generator from a text: the same seed, the same numbers (FNV-1a hash, then mulberry32). */
export const randomFrom = (seed: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A random-move scramble: never the same face twice in a row, and not R L R (the third turn would join the first).
 * The same seed and length always give the same scramble.
 */
export const scrambleFor = (seed: string, length = 20): Move[] => {
  const random = randomFrom(seed);
  const moves: Move[] = [];
  while (moves.length < length) {
    const face = FACES[Math.floor(random() * 6)];
    const amount = ([1, 2, 3] as const)[Math.floor(random() * 3)];
    const prev = moves[moves.length - 1];
    const prev2 = moves[moves.length - 2];
    if (prev && prev.face === face) continue;
    if (prev && prev2 && sameAxis(prev.face, face) && prev2.face === face) continue;
    moves.push({ face, amount });
  }
  return moves;
};

/** The seed of an attempt: the seed itself for the first, then "seed-2", "seed-3" … */
export const attemptSeed = (seed: string, index: number) => (index === 0 ? seed : `${seed}-${index + 1}`);

/** A short seed for a candidate when the item has none: 6 letters and digits. */
export const newSeed = (random = Math.random) =>
  Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(random() * 31)]).join("");

// ---- the guide through a scramble -----------------------------------------------------------------------------------

/**
 * Where the candidate is in the scramble: the moves done, the quarter turns already made of the next one (R2 is two
 * quarter turns, made either way), and the turns off the scramble that have to be undone first. "lost": the cube is
 * not on the way to the scramble at all (it was not solved at the start): solve it first.
 */
export type Guide = { done: number; partial: number; extra: Move[]; lost: boolean };

/** The stickers after each number of scramble moves: states[0] is solved, states[n] the scrambled cube. */
export const statesOf = (scramble: Move[]): Facelets[] => {
  const states = [SOLVED];
  for (const m of scramble) states.push(applyMove(states[states.length - 1], m));
  return states;
};

/** The cube the guide expects. */
const expectedBy = (scramble: Move[], states: Facelets[], g: Guide): Facelets => {
  let f = states[g.done];
  if (g.partial) f = applyMove(f, { face: scramble[g.done].face, amount: g.partial as Move["amount"] });
  return applyMoves(f, g.extra);
};

/** The guide for a cube that may be anywhere: on the scramble when its stickers are, otherwise lost. */
export const guideFor = (scramble: Move[], facelets: Facelets): Guide => {
  const states = statesOf(scramble);
  for (let k = states.length - 1; k >= 0; k--) if (states[k] === facelets) return { done: k, partial: 0, extra: [], lost: false };
  return { done: 0, partial: 0, extra: [], lost: true };
};

/**
 * The guide after a turn. The stickers the cube reports are what counts: a cube on one of the scramble's states is
 * there, whatever the turns; one that differs from what the guide expects is lost.
 */
export const guideAfter = (scramble: Move[], g: Guide, move: Move | null, facelets: Facelets): Guide => {
  const states = statesOf(scramble);
  for (let k = states.length - 1; k >= 0; k--) if (states[k] === facelets) return { done: k, partial: 0, extra: [], lost: false };
  if (g.lost || !move) return { ...guideFor(scramble, facelets), lost: true };
  let next: Guide;
  const target = scramble[g.done];
  if (!g.extra.length && target && move.face === target.face) {
    const partial = (g.partial + move.amount) % 4;
    next = partial === target.amount ? { done: g.done + 1, partial: 0, extra: [], lost: false } : { ...g, partial };
  } else if (!g.extra.length && g.partial && target) {
    // part of the next move, then another face: undo both
    next = { done: g.done, partial: 0, extra: pushMove([{ face: target.face, amount: g.partial as Move["amount"] }], move), lost: false };
  } else {
    next = { ...g, extra: pushMove(g.extra, move) };
  }
  return expectedBy(scramble, states, next) === facelets ? next : { ...next, lost: true };
};

/** What to turn next: the turns to undo, or the rest of the next scramble move; null when scrambled or lost. */
export const hintOf = (scramble: Move[], g: Guide): { undo: boolean; moves: Move[] } | null => {
  if (g.lost) return null;
  if (g.extra.length) return { undo: true, moves: inverseOf(g.extra) };
  const target = scramble[g.done];
  if (!target) return null;
  const rest = ((target.amount - g.partial + 4) % 4) as Move["amount"];
  return { undo: false, moves: [{ face: target.face, amount: rest }] };
};

// ---- an attempt: scramble, inspection, solve -------------------------------------------------------------------------

export type Phase = "scramble" | "ready" | "inspection" | "solving" | "solved";

export type Attempt = {
  phase: Phase;
  scramble: Move[];
  target: Facelets;
  facelets: Facelets;
  guide: Guide;
  /** performance.now() of the start of the inspection, of the solve and of its end. */
  inspectionStart: number | null;
  solveStart: number | null;
  solveEnd: number | null;
  /** The turns of the solve, as the cube made them. */
  solution: Move[];
};

export const attemptFor = (scramble: Move[], facelets: Facelets): Attempt => {
  const target = applyMoves(SOLVED, scramble);
  return {
    phase: facelets === target ? "ready" : "scramble",
    scramble,
    target,
    facelets,
    guide: guideFor(scramble, facelets),
    inspectionStart: null,
    solveStart: null,
    solveEnd: null,
    solution: [],
  };
};

/**
 * The attempt after the cube changed (a turn, or only new stickers when the cube did not say which turn). While
 * scrambling the guide follows; the first turn after the start ends the inspection and starts the clock; the solved
 * cube stops it.
 */
export const attemptAfter = (a: Attempt, move: Move | null, facelets: Facelets, now: number): Attempt => {
  if (facelets === a.facelets && move === null) return a;
  switch (a.phase) {
    case "scramble":
    case "ready": {
      const guide = guideAfter(a.scramble, a.guide, move, facelets);
      return { ...a, facelets, guide, phase: facelets === a.target ? "ready" : "scramble" };
    }
    case "inspection": {
      const solved = facelets === SOLVED;
      return {
        ...a, facelets, phase: solved ? "solved" : "solving", solveStart: now, solveEnd: solved ? now : null, solution: move ? [move] : [],
      };
    }
    case "solving": {
      const solved = facelets === SOLVED;
      return { ...a, facelets, phase: solved ? "solved" : "solving", solveEnd: solved ? now : null, solution: move ? [...a.solution, move] : a.solution };
    }
    case "solved":
      return { ...a, facelets };
  }
};

/** Start (the button): the inspection, or with no inspection straight to the clock. Only on the scrambled cube. */
export const attemptStart = (a: Attempt, now: number, inspectionMs: number): Attempt => {
  if (a.phase !== "ready") return a;
  return inspectionMs > 0 ? { ...a, phase: "inspection", inspectionStart: now } : { ...a, phase: "solving", inspectionStart: now, solveStart: now };
};

/** Time goes by: when the inspection is over the clock starts by itself, at the end of the inspection. */
export const attemptTick = (a: Attempt, now: number, inspectionMs: number): Attempt => {
  if (a.phase !== "inspection" || a.inspectionStart === null || now - a.inspectionStart < inspectionMs) return a;
  return { ...a, phase: "solving", solveStart: a.inspectionStart + inspectionMs };
};

/** The time on the clock in ms: the inspection left, or the solve so far. */
export const clockOf = (a: Attempt, now: number, inspectionMs: number): { kind: "inspection" | "solve"; ms: number } => {
  if (a.phase === "inspection" && a.inspectionStart !== null) return { kind: "inspection", ms: Math.max(0, inspectionMs - (now - a.inspectionStart)) };
  if (a.solveStart === null) return { kind: "solve", ms: 0 };
  return { kind: "solve", ms: Math.max(0, (a.solveEnd ?? now) - a.solveStart) };
};

/** 12.34, 1:02.50: seconds with hundredths, minutes when needed. */
export const formatTime = (ms: number): string => {
  const cs = Math.floor(ms / 10);
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const hundredths = cs % 100;
  const two = (n: number) => String(n).padStart(2, "0");
  return minutes ? `${minutes}:${two(seconds)}.${two(hundredths)}` : `${seconds}.${two(hundredths)}`;
};

// ---- GiiKER ---------------------------------------------------------------------------------------------------------
//
// A GiiKER cube (GiC…, GiS…, Mi Smart Magic Cube) sends 20 bytes on every turn: 40 nibbles with the place of each
// corner (1–8) and edge (1–12), their orientation, and the last four turns. The layout is that of hakatashi/giiker
// (MIT); newer cubes encrypt the message (byte 18 is 0xa7) with the table of cubing.js. See the README.

export const GIIKER = {
  service: "0000aadb-0000-1000-8000-00805f9b34fb",
  characteristic: "0000aadc-0000-1000-8000-00805f9b34fb",
  systemService: "0000aaaa-0000-1000-8000-00805f9b34fb",
};

const GIIKER_FACES: Face[] = ["B", "D", "L", "U", "R", "F"];
/** The corner places of the cube, by the faces they touch; corner piece i belongs at place i, with these colours. */
const GIIKER_CORNERS: Face[][] = [
  ["D", "R", "F"], ["R", "U", "F"], ["U", "L", "F"], ["L", "D", "F"],
  ["R", "D", "B"], ["U", "R", "B"], ["L", "U", "B"], ["D", "L", "B"],
];
const GIIKER_EDGES: Face[][] = [
  ["F", "D"], ["F", "R"], ["F", "U"], ["F", "L"], ["D", "R"], ["U", "R"],
  ["U", "L"], ["D", "L"], ["B", "D"], ["B", "R"], ["B", "U"], ["B", "L"],
];
const DECRYPTION = [
  176, 81, 104, 224, 86, 137, 237, 119, 38, 26, 193, 161, 210, 126, 150, 81, 93, 13, 236, 249, 89, 235, 88, 24, 113,
  81, 214, 131, 130, 199, 2, 169, 39, 165, 171, 41,
];

/** The message as the cube meant it: decrypted when it is encrypted. */
export const giikerDecrypt = (data: Uint8Array): Uint8Array => {
  if (data.length < 20 || data[18] !== 0xa7) return data;
  const k1 = data[19] >> 4;
  const k2 = data[19] & 15;
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = data[i] + DECRYPTION[k1 + i] + DECRYPTION[k2 + i];
  return out;
};

const placeOf = (faces: Face[]): V3 => faces.reduce<V3>((p, f) => [p[0] + NORMAL[f][0], p[1] + NORMAL[f][1], p[2] + NORMAL[f][2]], [0, 0, 0]);
const isPermutation = (values: number[], n: number) => values.length === n && new Set(values).size === n && values.every((v) => v >= 1 && v <= n);

/**
 * The stickers and the last turn in a GiiKER message (encrypted or not); null when it is not a valid cube. The cube
 * keeps its centres in place, so the stickers are always as seen with white on top and green in front.
 */
export const giikerDecode = (raw: Uint8Array): { facelets: Facelets; move: Move | null } | null => {
  const data = giikerDecrypt(raw);
  if (data.length < 20) return null;
  const n: number[] = [];
  for (let i = 0; i < 20; i++) n.push(data[i] >> 4, data[i] & 15);
  const cp = n.slice(0, 8);
  const co = n.slice(8, 16);
  const ep = n.slice(16, 28);
  const eo: boolean[] = [];
  for (const byte of [data[14], data[15]]) for (let bit = 7; bit >= 0; bit--) eo.push(((byte >> bit) & 1) === 1);
  if (!isPermutation(cp, 8) || !isPermutation(ep, 12) || co.some((o) => o < 1 || o > 3)) return null;

  const cells = SOLVED.split("");
  cp.forEach((piece, place) => {
    const colours = GIIKER_CORNERS[piece - 1];
    let o = co[place];
    if (o !== 3 && [0, 2, 5, 7].includes(place)) o = 3 - o;
    const turned = o === 1 ? [colours[1], colours[2], colours[0]] : o === 2 ? [colours[2], colours[0], colours[1]] : colours;
    const at = placeOf(GIIKER_CORNERS[place]);
    GIIKER_CORNERS[place].forEach((face, k) => (cells[stickerAt(at, face)] = turned[k]));
  });
  ep.forEach((piece, place) => {
    const colours = eo[place] ? [...GIIKER_EDGES[piece - 1]].reverse() : GIIKER_EDGES[piece - 1];
    const at = placeOf(GIIKER_EDGES[place]);
    GIIKER_EDGES[place].forEach((face, k) => (cells[stickerAt(at, face)] = colours[k]));
  });

  const face = GIIKER_FACES[n[32] - 1];
  const amount = ({ 1: 1, 2: 2, 3: 3, 9: 2 } as Record<number, Move["amount"]>)[n[33]];
  return { facelets: cells.join(""), move: face && amount ? { face, amount } : null };
};

/** The turn between two cubes, when one turn makes the difference; null otherwise. */
export const moveBetween = (from: Facelets, to: Facelets): Move | null => {
  for (const face of FACES) for (const amount of [1, 2, 3] as const) if (applyMove(from, { face, amount }) === to) return { face, amount };
  return null;
};
