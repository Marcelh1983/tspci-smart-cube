// npm test: holding the cube with yellow on top (heldAs in src/cube.ts), as a GiiKER cube's stickers are read then.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOLVED, applyMove, applyMoves, heldAs, moveHeldAs, parseMove, parseMoves, scrambleFor, topOf } from "../src/cube.ts";

const m = (text: string) => parseMove(text)!;

test("white on top changes nothing", () => {
  const f = applyMoves(SOLVED, scrambleFor("white"));
  assert.equal(heldAs(f, "white"), f);
  assert.deepEqual(moveHeldAs(m("R'"), "white"), m("R'"));
});

test("a solved cube is solved either way up, and turning over twice is the cube again", () => {
  assert.equal(heldAs(SOLVED, "yellow"), SOLVED);
  const f = applyMoves(SOLVED, scrambleFor("twice"));
  assert.notEqual(heldAs(f, "yellow"), f);
  assert.equal(heldAs(heldAs(f, "yellow"), "yellow"), f);
});

test("with yellow on top, the white face is turned as D, red/orange swap, F and B stay", () => {
  assert.deepEqual(moveHeldAs(m("U"), "yellow"), m("D"));
  assert.deepEqual(moveHeldAs(m("R'"), "yellow"), m("L'"));
  assert.deepEqual(moveHeldAs(m("F2"), "yellow"), m("F2"));
  assert.deepEqual(moveHeldAs(m("B"), "yellow"), m("B"));
});

test("every turn of the cube is the matching turn of the cube held with yellow on top", () => {
  const start = applyMoves(SOLVED, scrambleFor("held"));
  for (const text of ["U", "U'", "U2", "R", "R'", "F", "F2", "D", "D'", "L", "L2", "B", "B'"]) {
    const move = m(text);
    assert.equal(heldAs(applyMove(start, move), "yellow"), applyMove(heldAs(start, "yellow"), moveHeldAs(move, "yellow")), text);
  }
  // a whole solve, turn by turn
  const moves = parseMoves("R U R' U' F2 D L' B2")!;
  assert.equal(
    heldAs(applyMoves(start, moves), "yellow"),
    applyMoves(heldAs(start, "yellow"), moves.map((x) => moveHeldAs(x, "yellow")))
  );
});

test("the setting: yellow, or white for anything else", () => {
  assert.equal(topOf("yellow"), "yellow");
  assert.equal(topOf("Yellow"), "yellow");
  assert.equal(topOf("white"), "white");
  assert.equal(topOf(""), "white");
  assert.equal(topOf(undefined), "white");
});
