/* Pure game rules, shared by the browser and Node's built-in test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Game2048 = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const SIZE = 4;
  const DIRECTIONS = ["left", "right", "up", "down"];
  const copy = (snapshot) => ({ ...snapshot, board: [...snapshot.board] });

  function lineIndices(line, direction) {
    return Array.from({ length: SIZE }, (_, offset) => {
      if (direction === "left") return line * SIZE + offset;
      if (direction === "right") return line * SIZE + SIZE - 1 - offset;
      if (direction === "up") return offset * SIZE + line;
      return (SIZE - 1 - offset) * SIZE + line;
    });
  }

  function slide(board, direction) {
    if (!DIRECTIONS.includes(direction)) throw new RangeError("Unknown direction");
    const next = Array(SIZE * SIZE).fill(0);
    const movements = [];
    const mergedIndices = [];
    let score = 0;

    for (let line = 0; line < SIZE; line++) {
      const indices = lineIndices(line, direction);
      const occupied = indices.filter((index) => board[index] !== 0);
      let target = 0;
      for (let i = 0; i < occupied.length; i++) {
        const from = occupied[i];
        const to = indices[target++];
        const value = board[from];
        movements.push({ from, to, value });
        if (i + 1 < occupied.length && value === board[occupied[i + 1]]) {
          movements.push({ from: occupied[++i], to, value });
          next[to] = value * 2;
          score += value * 2;
          mergedIndices.push(to);
        } else {
          next[to] = value;
        }
      }
    }

    return {
      board: next,
      moved: next.some((value, index) => value !== board[index]),
      score,
      movements,
      mergedIndices,
    };
  }

  function addRandomTile(board, random = Math.random) {
    const empty = board.flatMap((value, index) => value === 0 ? [index] : []);
    if (!empty.length) return { board: [...board], index: null };
    const index = empty[Math.floor(random() * empty.length)];
    const next = [...board];
    next[index] = random() < 0.9 ? 2 : 4;
    return { board: next, index };
  }

  function canMove(board) {
    if (board.includes(0)) return true;
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const index = row * SIZE + col;
        if (col < SIZE - 1 && board[index] === board[index + 1]) return true;
        if (row < SIZE - 1 && board[index] === board[index + SIZE]) return true;
      }
    }
    return false;
  }

  function hasWon(board) { return board.some((value) => value >= 2048); }

  function isSnapshot(value) {
    return value !== null && typeof value === "object" &&
      Array.isArray(value.board) && value.board.length === SIZE * SIZE &&
      Array.from(value.board).every((tile) => Number.isSafeInteger(tile) &&
        (tile === 0 || (tile >= 2 && Number.isInteger(Math.log2(tile))))) &&
      value.board.some((tile) => tile !== 0) &&
      Number.isSafeInteger(value.score) && value.score >= 0 &&
      Number.isSafeInteger(value.moves) && value.moves >= 0 &&
      typeof value.continued === "boolean";
  }

  class Game {
    constructor({ random = Math.random, saved = null } = {}) {
      this.random = random;
      if (saved && saved.version === 1 && isSnapshot(saved.state)) {
        this.restore(saved.state);
        this.previous = isSnapshot(saved.previous) ? copy(saved.previous) : null;
      } else this.restart();
    }

    get won() { return hasWon(this.board); }
    get over() { return !canMove(this.board); }
    get paused() { return this.won && !this.continued; }

    snapshot() {
      return { board: [...this.board], score: this.score, moves: this.moves, continued: this.continued };
    }

    restore(snapshot) {
      this.board = [...snapshot.board];
      this.score = snapshot.score;
      this.moves = snapshot.moves;
      this.continued = snapshot.continued;
    }

    restart() {
      let board = Array(SIZE * SIZE).fill(0);
      board = addRandomTile(board, this.random).board;
      this.board = addRandomTile(board, this.random).board;
      this.score = 0;
      this.moves = 0;
      this.continued = false;
      this.previous = null;
    }

    move(direction) {
      if (this.over || this.paused) return { moved: false };
      const result = slide(this.board, direction);
      if (!result.moved) return result;
      this.previous = this.snapshot();
      const spawn = addRandomTile(result.board, this.random);
      this.board = spawn.board;
      this.score += result.score;
      this.moves++;
      return { ...result, spawnIndex: spawn.index };
    }

    undo() {
      if (!this.previous) return false;
      this.restore(this.previous);
      this.previous = null;
      return true;
    }

    keepPlaying() { if (this.won) this.continued = true; }
    serialize() { return { version: 1, state: this.snapshot(), previous: this.previous ? copy(this.previous) : null }; }
  }

  return { SIZE, DIRECTIONS, slide, addRandomTile, canMove, hasWon, isSnapshot, Game };
});
