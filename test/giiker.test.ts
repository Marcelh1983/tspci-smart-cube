// npm test: the GiiKER messages (src/cube.ts). There is no cube in the test, so the messages are made from the 3x3x3
// definition of cubing.js and its mapping between GiiKER and Reid order (src/cubing/bluetooth/smart-puzzle/giiker.ts
// and src/cubing/puzzles/implementations/dynamic/3x3x3/3x3x3.kpuzzle.json.ts, MPL-2.0 OR GPL-3.0-or-later; data for
// the test only, not in the PCI). Our decoder follows hakatashi/giiker instead: two independent sources that must
// agree on every sticker, and our own turns must agree with the turns of cubing.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLVED, applyMove, giikerDecode, giikerDecrypt, parseMove, parseMoves, scrambleFor, type Move } from "../src/cube.ts";

type Orbit = { pieces: number[]; orientation: number[] };
type Pattern = { EDGES: Orbit; CORNERS: Orbit };
type Transformation = Record<keyof Pattern, { permutation: number[]; orientationDelta: number[] }>;

// the face turns of cubing.js's 3x3x3 KPuzzle (Reid order: edges UF UR UB UL DF DR DB DL FR FL BR BL)
const KPUZZLE: Record<string, Transformation> = {
  U: {
    EDGES: { permutation: [1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    CORNERS: { permutation: [1, 2, 3, 0, 4, 5, 6, 7], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0] },
  },
  L: {
    EDGES: { permutation: [0, 1, 2, 11, 4, 5, 6, 9, 8, 3, 10, 7], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    CORNERS: { permutation: [0, 1, 6, 2, 4, 3, 5, 7], orientationDelta: [0, 0, 2, 1, 0, 2, 1, 0] },
  },
  F: {
    EDGES: { permutation: [9, 1, 2, 3, 8, 5, 6, 7, 0, 4, 10, 11], orientationDelta: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0] },
    CORNERS: { permutation: [3, 1, 2, 5, 0, 4, 6, 7], orientationDelta: [1, 0, 0, 2, 2, 1, 0, 0] },
  },
  R: {
    EDGES: { permutation: [0, 8, 2, 3, 4, 10, 6, 7, 5, 9, 1, 11], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    CORNERS: { permutation: [4, 0, 2, 3, 7, 5, 6, 1], orientationDelta: [2, 1, 0, 0, 1, 0, 0, 2] },
  },
  B: {
    EDGES: { permutation: [0, 1, 10, 3, 4, 5, 11, 7, 8, 9, 6, 2], orientationDelta: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1] },
    CORNERS: { permutation: [0, 7, 1, 3, 4, 5, 2, 6], orientationDelta: [0, 2, 1, 0, 0, 0, 2, 1] },
  },
  D: {
    EDGES: { permutation: [0, 1, 2, 3, 7, 4, 5, 6, 8, 9, 10, 11], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    CORNERS: { permutation: [0, 1, 2, 3, 5, 6, 7, 4], orientationDelta: [0, 0, 0, 0, 0, 0, 0, 0] },
  },
};

const solvedPattern = (): Pattern => ({
  EDGES: { pieces: [...Array(12).keys()], orientation: Array(12).fill(0) },
  CORNERS: { pieces: [...Array(8).keys()], orientation: Array(8).fill(0) },
});

const kpuzzleApply = (p: Pattern, t: Transformation): Pattern => {
  const orbit = (o: Orbit, d: Transformation["EDGES"], mod: number): Orbit => ({
    pieces: d.permutation.map((from) => o.pieces[from]),
    orientation: d.permutation.map((from, i) => (o.orientation[from] + d.orientationDelta[i]) % mod),
  });
  return { EDGES: orbit(p.EDGES, t.EDGES, 2), CORNERS: orbit(p.CORNERS, t.CORNERS, 3) };
};

const kpuzzleMove = (p: Pattern, m: Move): Pattern => {
  for (let q = 0; q < m.amount; q++) p = kpuzzleApply(p, KPUZZLE[m.face]);
  return p;
};

// cubing.js's mapping between GiiKER and Reid order, run backwards: a pattern into a GiiKER message
const epReid333toGiiKER = [2, 5, 10, 6, 0, 4, 8, 7, 1, 3, 9, 11];
const cpReid333toGiiKER = [1, 5, 6, 2, 0, 3, 7, 4];
const preEO = [1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0];
const postEO = [1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0];
const preCO = [1, 2, 1, 2, 2, 1, 2, 1];
const postCO = [2, 1, 2, 1, 1, 2, 1, 2];
const coFlip = [-1, 1, -1, 1, 1, -1, 1, -1];
const mod3 = (x: number) => ((x % 3) + 3) % 3;
const GIIKER_FACE = { B: 1, D: 2, L: 3, U: 4, R: 5, F: 6 };

const giikerMessage = (p: Pattern, last?: Move): Uint8Array => {
  const n = Array(40).fill(0);
  const eo = Array(16).fill(0);
  for (let i = 0; i < 12; i++) {
    const gi = epReid333toGiiKER[i];
    const piece = p.EDGES.pieces[i];
    n[gi + 16] = epReid333toGiiKER[piece] + 1;
    eo[gi] = p.EDGES.orientation[i] ^ preEO[piece] ^ postEO[i];
  }
  for (let i = 0; i < 8; i++) {
    const gi = cpReid333toGiiKER[i];
    const piece = p.CORNERS.pieces[i];
    n[gi] = cpReid333toGiiKER[piece] + 1;
    n[gi + 8] = [1, 2, 3].find((v) => mod3(v * coFlip[gi] + preCO[piece] + postCO[i]) === p.CORNERS.orientation[i]);
  }
  if (last) {
    n[32] = GIIKER_FACE[last.face];
    n[33] = last.amount;
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = (n[2 * i] << 4) | n[2 * i + 1];
  bytes[14] = eo.slice(0, 8).reduce((b, bit) => (b << 1) | bit, 0);
  bytes[15] = eo.slice(8, 16).reduce((b, bit) => (b << 1) | bit, 0);
  return bytes;
};

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

test("the solved cube: corners 1–8 with orientation 3, edges 1–12, no flips", () => {
  const message = giikerMessage(solvedPattern());
  assert.equal(hex(message).slice(0, 32), "1234567833333333123456789abc0000");
  assert.deepEqual(giikerDecode(message), { facelets: SOLVED, move: null });
});

test("every face turn: the decoded stickers are our own turn of the solved cube", () => {
  for (const face of "URFDLB") {
    for (const suffix of ["", "2", "'"]) {
      const move = parseMove(face + suffix)!;
      const decoded = giikerDecode(giikerMessage(kpuzzleMove(solvedPattern(), move), move))!;
      assert.equal(decoded.facelets, applyMove(SOLVED, move), `${face}${suffix}`);
      assert.deepEqual(decoded.move, move);
    }
  }
});

test("long scrambles: cubing.js and our turns agree after every turn", () => {
  for (const seed of ["one", "two", "three", "four", "five"]) {
    let pattern = solvedPattern();
    let facelets = SOLVED;
    for (const move of scrambleFor(seed, 40)) {
      pattern = kpuzzleMove(pattern, move);
      facelets = applyMove(facelets, move);
      assert.equal(giikerDecode(giikerMessage(pattern, move))!.facelets, facelets);
    }
  }
});

test("an encrypted message (newer cubes, byte 18 is 0xa7) decodes like the plain one", () => {
  const moves = parseMoves("R U R' F2 D' L B2")!;
  let pattern = solvedPattern();
  for (const m of moves) pattern = kpuzzleMove(pattern, m);
  const plain = giikerMessage(pattern, moves[moves.length - 1]);
  // encrypt for a few keys: decrypting zeros gives what a key adds to each byte
  for (const key of [0x00, 0x3a, 0xf1, 0x7c]) {
    const encrypted = new Uint8Array(20);
    const zero = giikerDecrypt(Object.assign(new Uint8Array(20), { 18: 0xa7, 19: key }));
    for (let i = 0; i < 18; i++) encrypted[i] = plain[i] - zero[i];
    encrypted[18] = 0xa7;
    encrypted[19] = key;
    const decoded = giikerDecode(encrypted)!;
    assert.ok(decoded, `key ${key}`);
    assert.equal(decoded.facelets, applyMoves(moves));
    assert.deepEqual(decoded.move, moves[moves.length - 1]);
  }
});

test("the last turn: 1 clockwise, 2 half, 3 counterclockwise, 9 half the other way; faces B D L U R F", () => {
  const message = giikerMessage(solvedPattern());
  const withMove = (face: number, amount: number) => {
    const m = message.slice();
    m[16] = (face << 4) | amount;
    return giikerDecode(m)!.move;
  };
  assert.deepEqual(withMove(1, 1), parseMove("B"));
  assert.deepEqual(withMove(4, 3), parseMove("U'"));
  assert.deepEqual(withMove(6, 2), parseMove("F2"));
  assert.deepEqual(withMove(5, 9), parseMove("R2"));
  assert.equal(withMove(0, 1), null);
  assert.equal(withMove(5, 7), null);
});

test("not a cube: too short, a corner twice, an orientation out of range", () => {
  assert.equal(giikerDecode(new Uint8Array(10)), null);
  const twice = giikerMessage(solvedPattern());
  twice[0] = 0x11;
  assert.equal(giikerDecode(twice), null);
  const twisted = giikerMessage(solvedPattern());
  twisted[4] = 0x03;
  assert.equal(giikerDecode(twisted), null);
});

function applyMoves(moves: Move[]) {
  return moves.reduce(applyMove, SOLVED);
}
