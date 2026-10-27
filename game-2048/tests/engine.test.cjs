"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Game, slide, addRandomTile, canMove, hasWon, isSnapshot } = require("../dist/engine.js");

const board = (...rows) => [...rows.flat(), ...Array(16 - rows.flat().length).fill(0)];
const savedGame = (tiles, extra = {}) => ({ version: 1, state: { board: tiles, score: 0, moves: 0, continued: false, ...extra }, previous: null });

test("a new game contains exactly two tiles and zero score", () => {
  const game = new Game({ random: () => 0 });
  assert.equal(game.board.filter(Boolean).length, 2);
  assert.equal(game.score, 0);
  assert.equal(game.moves, 0);
  assert.equal(game.previous, null);
});

test("equal tiles merge once per move: 2,2,2,2 becomes 4,4", () => {
  const result = slide(board([2, 2, 2, 2]), "left");
  assert.deepEqual(result.board.slice(0, 4), [4, 4, 0, 0]);
  assert.equal(result.score, 8);
  assert.deepEqual(result.mergedIndices, [0, 1]);
});

test("newly merged tiles never merge again during the same move", () => {
  assert.deepEqual(slide(board([2, 2, 4, 0]), "left").board.slice(0, 4), [4, 4, 0, 0]);
});

test("zeros are compressed before matching tiles", () => {
  const source = board([2, 0, 2, 4]);
  assert.deepEqual(slide(source, "left").board.slice(0, 4), [4, 4, 0, 0]);
  assert.deepEqual(source.slice(0, 4), [2, 0, 2, 4]);
});

test("right merges toward the right edge", () => {
  const result = slide(board([4, 4, 4, 0]), "right");
  assert.deepEqual(result.board.slice(0, 4), [0, 0, 4, 8]);
  assert.equal(result.score, 8);
});

test("up merges vertically without mixing columns", () => {
  const result = slide(board([2, 4, 0, 0], [0, 4, 0, 0], [2, 8, 0, 0], [4, 8, 0, 0]), "up");
  assert.deepEqual(result.board, board([4, 8, 0, 0], [4, 16, 0, 0]));
  assert.equal(result.score, 28);
});

test("down merges vertically toward the bottom edge", () => {
  const result = slide(board([2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]), "down");
  assert.deepEqual(result.board, board([0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0], [8, 0, 0, 0]));
  assert.equal(result.score, 12);
});

test("an invalid direction is rejected", () => {
  assert.throws(() => slide(board([2]), "diagonal"), RangeError);
});

test("invalid moves add no tile, no score, no history, and use no randomness", () => {
  let draws = 0;
  const game = new Game({ saved: savedGame(board([2, 4, 0, 0])), random: () => { draws++; return 0; } });
  const before = game.serialize();
  assert.equal(game.move("left").moved, false);
  assert.deepEqual(game.serialize(), before);
  assert.equal(draws, 0);
});

test("valid moves spawn exactly one tile and score merged values", () => {
  const game = new Game({ saved: savedGame(board([2, 2])), random: () => 0 });
  const result = game.move("left");
  assert.equal(result.moved, true);
  assert.equal(game.score, 4);
  assert.equal(game.moves, 1);
  assert.equal(game.board.filter(Boolean).length, 2);
  assert.equal(game.board.reduce((sum, value) => sum + value, 0), 6);
});

test("invalid moves preserve the previous valid undo snapshot", () => {
  const game = new Game({ saved: savedGame(board([2, 2])), random: () => 0 });
  game.move("left");
  const before = game.serialize();
  assert.equal(game.move("left").moved, false);
  assert.deepEqual(game.serialize(), before);
});

test("undo restores board, score, move count and continue state exactly once", () => {
  const game = new Game({ saved: savedGame(board([2, 2])), random: () => 0 });
  const before = game.snapshot();
  game.move("left");
  assert.equal(game.undo(), true);
  assert.deepEqual(game.snapshot(), before);
  assert.equal(game.undo(), false);
});

test("spawns use 90 percent 2, 10 percent 4, and never replace occupied cells", () => {
  const source = board([8, 16]);
  const two = addRandomTile(source, () => 0);
  const four = addRandomTile(source, () => 0.95);
  assert.equal(two.board[two.index], 2);
  assert.equal(four.board[four.index], 4);
  assert.deepEqual(two.board.slice(0, 2), [8, 16]);
  assert.deepEqual(four.board.slice(0, 2), [8, 16]);
  const full = Array(16).fill(2);
  assert.deepEqual(addRandomTile(full), { board: full, index: null });
});

test("a full alternating board ends the game", () => {
  const full = board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]);
  assert.equal(canMove(full), false);
  const game = new Game({ saved: savedGame(full) });
  assert.equal(game.over, true);
  assert.equal(game.move("left").moved, false);
});

test("full boards with a horizontal or vertical pair remain playable", () => {
  const full = board([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]);
  const horizontal = [...full]; horizontal[1] = 2;
  const vertical = [...full]; vertical[4] = 2;
  assert.equal(canMove(horizontal), true);
  assert.equal(canMove(vertical), true);
  assert.equal(canMove(board([2])), true);
});

test("2048 pauses for victory; continuing permits larger merges", () => {
  const game = new Game({ saved: savedGame(board([1024, 1024])), random: () => 0 });
  game.move("left");
  assert.equal(game.won, true);
  assert.equal(game.paused, true);
  assert.equal(game.move("right").moved, false);
  game.keepPlaying();
  assert.equal(game.paused, false);
  assert.equal(game.move("right").moved, true);
  assert.equal(hasWon(board([4096])), true);
});

test("victory can be undone, restoring the pre-win state", () => {
  const game = new Game({ saved: savedGame(board([1024, 1024])), random: () => 0 });
  game.move("left");
  assert.equal(game.paused, true);
  game.undo();
  assert.equal(game.won, false);
  assert.equal(game.score, 0);
});

test("saved games restore board, score, continued mode and undo history", () => {
  const game = new Game({ saved: savedGame(board([2, 2])), random: () => 0 });
  game.move("left");
  const restored = new Game({ saved: JSON.parse(JSON.stringify(game.serialize())) });
  assert.deepEqual(restored.serialize(), game.serialize());
  assert.equal(restored.undo(), true);
  assert.deepEqual(restored.board, board([2, 2]));
});

test("corrupted saves, sparse boards and invalid tile values are rejected", () => {
  const valid = savedGame(board([2])).state;
  for (const invalid of [null, {}, { ...valid, board: [2] }, { ...valid, board: Array(16) }, { ...valid, board: board([3]) }, { ...valid, score: -1 }, { ...valid, moves: 1.5 }, { ...valid, continued: "yes" }]) {
    assert.equal(isSnapshot(invalid), false);
  }
  const fresh = new Game({ saved: { version: 99, state: valid }, random: () => 0 });
  assert.equal(fresh.board.filter(Boolean).length, 2);
});

test("serialization owns independent board copies", () => {
  const game = new Game({ saved: savedGame(board([2, 2])), random: () => 0 });
  game.move("left");
  const serialized = game.serialize();
  serialized.state.board[0] = 999;
  serialized.previous.board[0] = 999;
  assert.equal(game.board[0], 4);
  assert.equal(game.previous.board[0], 2);
});

test("restart resets the game and clears undo history", () => {
  const game = new Game({ saved: savedGame(board([2048]), { score: 500, moves: 20, continued: true }), random: () => 0 });
  game.restart();
  assert.equal(game.won, false);
  assert.equal(game.continued, false);
  assert.equal(game.score, 0);
  assert.equal(game.moves, 0);
  assert.equal(game.previous, null);
  assert.equal(game.board.filter(Boolean).length, 2);
});

test("all directions preserve tile sum before spawning across varied boards", () => {
  let seed = 2048;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let attempt = 0; attempt < 120; attempt++) {
    const source = Array.from({ length: 16 }, () => random() < 0.25 ? 0 : 2 ** (1 + Math.floor(random() * 8)));
    for (const direction of ["left", "right", "up", "down"]) {
      const result = slide(source, direction);
      assert.equal(result.board.reduce((sum, value) => sum + value, 0), source.reduce((sum, value) => sum + value, 0));
      assert.equal(result.movements.length, source.filter(Boolean).length);
      assert.equal(result.score, result.mergedIndices.reduce((sum, index) => sum + result.board[index], 0));
    }
  }
});
