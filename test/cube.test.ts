// npm test: the cube, scrambles, the guide and the attempt (src/cube.ts) in node, without a build.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SOLVED, applyMove, applyMoves, attemptAfter, attemptFor, attemptStart, attemptTick, attemptSeed, clockOf, formatMoves,
  formatTime, guideAfter, guideFor, hintOf, inverseOf, layerOf, moveBetween, newSeed, parseMove, parseMoves, pushMove,
  randomFrom, sameAxis, scrambleFor, type Facelets, type Guide, type Move,
} from "../src/cube.ts";

const m = (text: string) => parseMove(text)!;
const ms = (text: string) => parseMoves(text)!;

test("a turn of R: the right column of U gets F, F gets D, D gets B, B gets U", () => {
  assert.equal(
    applyMove(SOLVED, m("R")),
    "UUFUUFUUF" + "RRRRRRRRR" + "FFDFFDFFD" + "DDBDDBDDB" + "LLLLLLLLL" + "UBBUBBUBB"
  );
});

test("a turn of U: the front row of F gets R (seen from above, clockwise)", () => {
  const f = applyMove(SOLVED, m("U"));
  assert.equal(f.slice(18, 21), "RRR"); // F's top row
  assert.equal(f.slice(36, 39), "FFF"); // L's top row
  assert.equal(f.slice(45, 48), "LLL"); // B's top row
  assert.equal(f.slice(9, 12), "BBB"); // R's top row
});

test("turns undo: four quarter turns, a turn and its inverse, the sexy move six times", () => {
  for (const face of "URFDLB") {
    assert.equal(applyMoves(SOLVED, ms(`${face} ${face} ${face} ${face}`)), SOLVED);
    assert.equal(applyMoves(SOLVED, ms(`${face} ${face}'`)), SOLVED);
    assert.equal(applyMoves(SOLVED, ms(`${face}2 ${face}2`)), SOLVED);
  }
  const sexy = ms("R U R' U'");
  assert.equal(applyMoves(SOLVED, [...sexy, ...sexy, ...sexy, ...sexy, ...sexy, ...sexy]), SOLVED);
  assert.notEqual(applyMoves(SOLVED, sexy), SOLVED);
  const scramble = scrambleFor("inverse", 25);
  assert.equal(applyMoves(applyMoves(SOLVED, scramble), inverseOf(scramble)), SOLVED);
});

test("the superflip: every edge flipped, corners and centres solved", () => {
  const f = applyMoves(SOLVED, ms("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"));
  // the edge stickers of U show the other face, the corners still U
  assert.equal(f.slice(0, 9), "UBULURUFU");
  for (let face = 0; face < 6; face++) {
    const stickers = f.slice(face * 9, face * 9 + 9);
    assert.equal(stickers[4], "URFDLB"[face]);
    for (const corner of [0, 2, 6, 8]) assert.equal(stickers[corner], "URFDLB"[face]);
    for (const edge of [1, 3, 5, 7]) assert.notEqual(stickers[edge], "URFDLB"[face]);
  }
});

test("every face has 9 stickers of each colour after any scramble", () => {
  const f = applyMoves(SOLVED, scrambleFor("count", 40));
  for (const c of "URFDLB") assert.equal(f.split("").filter((x) => x === c).length, 9);
});

test("the layer of a face: 8 cubies around its centre, plus the centre", () => {
  assert.equal(layerOf("R").length, 9);
  assert.ok(layerOf("R").every(([x]) => x === 1));
  assert.ok(layerOf("D").every(([, y]) => y === -1));
});

test("notation: parse and format, primes and half turns", () => {
  assert.deepEqual(parseMove("R"), { face: "R", amount: 1 });
  assert.deepEqual(parseMove("R'"), { face: "R", amount: 3 });
  assert.deepEqual(parseMove("R’"), { face: "R", amount: 3 });
  assert.deepEqual(parseMove("U2"), { face: "U", amount: 2 });
  assert.deepEqual(parseMove("U2'"), { face: "U", amount: 2 });
  assert.equal(parseMove("x"), null);
  assert.equal(parseMove("Rw"), null);
  assert.equal(parseMoves("R U x"), null);
  assert.deepEqual(parseMoves("  "), []);
  assert.equal(formatMoves(ms("R U' F2 D L' B")), "R U' F2 D L' B");
  assert.equal(formatMoves(inverseOf(ms("R U' F2"))), "F2 U R'");
});

test("pushMove: turns of one face join, opposite faces commute", () => {
  assert.equal(formatMoves(pushMove(ms("R"), m("R"))), "R2");
  assert.equal(formatMoves(pushMove(ms("R"), m("R'"))), "");
  assert.equal(formatMoves(pushMove(ms("R2"), m("R"))), "R'");
  assert.equal(formatMoves(pushMove(ms("R L"), m("R'"))), "L");
  assert.equal(formatMoves(pushMove(ms("R U"), m("R'"))), "R U R'");
  assert.ok(sameAxis("U", "D") && !sameAxis("U", "R"));
});

test("scrambles: the same seed gives the same scramble, of the asked length, without silly turns", () => {
  assert.deepEqual(scrambleFor("abc"), scrambleFor("abc"));
  assert.notDeepEqual(scrambleFor("abc"), scrambleFor("abd"));
  assert.equal(scrambleFor("abc").length, 20);
  assert.equal(scrambleFor("abc", 25).length, 25);
  for (const seed of ["a", "b", "c", "d", "e", "f", "g"]) {
    const s = scrambleFor(seed, 30);
    for (let i = 1; i < s.length; i++) {
      assert.notEqual(s[i].face, s[i - 1].face);
      if (i > 1 && sameAxis(s[i].face, s[i - 1].face)) assert.notEqual(s[i].face, s[i - 2].face);
    }
  }
  // a pinned example: changing the generator changes every item's scramble
  assert.equal(formatMoves(scrambleFor("cito", 12)), formatMoves(scrambleFor("cito", 20).slice(0, 12)));
  assert.equal(attemptSeed("abc", 0), "abc");
  assert.equal(attemptSeed("abc", 2), "abc-3");
  assert.match(newSeed(randomFrom("x")), /^[a-z2-9]{6}$/);
});

/** Follows turns with the guide, from a cube the guide starts with. */
const follow = (scramble: Move[], start: Facelets, turns: string): { guide: Guide; facelets: Facelets } => {
  let facelets = start;
  let guide = guideFor(scramble, facelets);
  for (const t of ms(turns)) {
    facelets = applyMove(facelets, t);
    guide = guideAfter(scramble, guide, t, facelets);
  }
  return { guide, facelets };
};

test("the guide: follows the scramble, a half turn either way", () => {
  const scramble = ms("R U2 F'");
  assert.deepEqual(hintOf(scramble, guideFor(scramble, SOLVED)), { undo: false, moves: ms("R") });
  let r = follow(scramble, SOLVED, "R");
  assert.equal(r.guide.done, 1);
  r = follow(scramble, SOLVED, "R U");
  assert.deepEqual(r.guide, { done: 1, partial: 1, extra: [], lost: false });
  assert.equal(formatMoves(hintOf(scramble, r.guide)!.moves), "U");
  r = follow(scramble, SOLVED, "R U' U'");
  assert.equal(r.guide.done, 2);
  r = follow(scramble, SOLVED, "R U U F'");
  assert.equal(r.guide.done, 3);
  assert.equal(r.facelets, applyMoves(SOLVED, scramble));
  assert.equal(hintOf(scramble, r.guide), null);
});

test("the guide: a wrong turn has to be undone; then the scramble goes on", () => {
  const scramble = ms("R U2 F'");
  let r = follow(scramble, SOLVED, "R L");
  assert.deepEqual(hintOf(scramble, r.guide), { undo: true, moves: ms("L'") });
  r = follow(scramble, SOLVED, "R L D2");
  assert.equal(formatMoves(hintOf(scramble, r.guide)!.moves), "D2 L'");
  r = follow(scramble, SOLVED, "R L D2 D2 L'");
  assert.deepEqual(r.guide, { done: 1, partial: 0, extra: [], lost: false });
  // half of U2, then F: undo both
  r = follow(scramble, SOLVED, "R U F");
  assert.equal(formatMoves(hintOf(scramble, r.guide)!.moves), "F' U'");
  r = follow(scramble, SOLVED, "R U F F' U");
  assert.equal(r.guide.done, 2);
});

test("the guide: a cube that was not solved is lost, until it is on the way again", () => {
  const scramble = ms("R U2 F'");
  const start = applyMove(SOLVED, m("B"));
  let r = follow(scramble, start, "");
  assert.equal(r.guide.lost, true);
  assert.equal(hintOf(scramble, r.guide), null);
  r = follow(scramble, start, "R");
  assert.equal(r.guide.lost, true);
  r = follow(scramble, start, "R R' B'"); // back to solved
  assert.deepEqual(r.guide, { done: 0, partial: 0, extra: [], lost: false });
  // a cube that reaches a state of the scramble some other way is there
  r = follow(scramble, SOLVED, "L R L'");
  assert.equal(r.guide.done, 1);
});

test("an attempt: scramble, start, inspection, the first turn starts the clock, solved stops it", () => {
  const scramble = ms("R U");
  let a = attemptFor(scramble, SOLVED);
  assert.equal(a.phase, "scramble");
  assert.equal(attemptStart(a, 0, 15000), a); // not scrambled yet
  let f = SOLVED;
  for (const t of scramble) a = attemptAfter(a, t, (f = applyMove(f, t)), 100);
  assert.equal(a.phase, "ready");
  a = attemptStart(a, 1000, 15000);
  assert.equal(a.phase, "inspection");
  assert.deepEqual(clockOf(a, 4000, 15000), { kind: "inspection", ms: 12000 });
  a = attemptTick(a, 5000, 15000);
  assert.equal(a.phase, "inspection");
  a = attemptAfter(a, m("U'"), (f = applyMove(f, m("U'"))), 6000);
  assert.equal(a.phase, "solving");
  assert.equal(a.solveStart, 6000);
  assert.deepEqual(clockOf(a, 7500, 15000), { kind: "solve", ms: 1500 });
  a = attemptAfter(a, m("R'"), (f = applyMove(f, m("R'"))), 9250);
  assert.equal(a.phase, "solved");
  assert.equal(formatMoves(a.solution), "U' R'");
  assert.deepEqual(clockOf(a, 20000, 15000), { kind: "solve", ms: 3250 });
});

test("an attempt: undoing the scramble before the start goes back to scrambling; the inspection runs out", () => {
  const scramble = ms("R");
  let a = attemptFor(scramble, applyMove(SOLVED, m("R")));
  assert.equal(a.phase, "ready");
  a = attemptAfter(a, m("R'"), SOLVED, 0);
  assert.equal(a.phase, "scramble");
  a = attemptAfter(a, m("R"), applyMove(SOLVED, m("R")), 0);
  a = attemptStart(a, 1000, 15000);
  a = attemptTick(a, 16500, 15000);
  assert.equal(a.phase, "solving");
  assert.equal(a.solveStart, 16000);
  // without inspection, the start starts the clock
  const b = attemptStart(attemptFor(scramble, applyMove(SOLVED, m("R"))), 500, 0);
  assert.equal(b.phase, "solving");
  assert.equal(b.solveStart, 500);
});

test("formatTime: seconds with hundredths, minutes when needed", () => {
  assert.equal(formatTime(0), "0.00");
  assert.equal(formatTime(12345), "12.34");
  assert.equal(formatTime(62509), "1:02.50");
});

test("moveBetween: the one turn between two cubes", () => {
  const f = applyMoves(SOLVED, scrambleFor("between"));
  assert.deepEqual(moveBetween(f, applyMove(f, m("F2"))), m("F2"));
  assert.deepEqual(moveBetween(f, applyMove(f, m("L'"))), m("L'"));
  assert.equal(moveBetween(f, applyMoves(f, ms("R U"))), null);
});
