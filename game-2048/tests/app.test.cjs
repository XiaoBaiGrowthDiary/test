"use strict";

// Exercise the real browser controller with a small DOM/storage fixture.
// This checks event wiring and saved state without requiring a browser install.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scripts = ["engine.js", "app.js"].map((name) => fs.readFileSync(path.join(__dirname, "../dist", name), "utf8"));

function fixture({ tiles = [2, 2, 4], score = 0, moves = 0, continued = false, storageFails = false, corruptSave = false, reducedMotion = true } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const frames = new Map();
  const elements = new Map();
  let sequence = 0;
  const data = new Map([
    ["yige-2048-v1", corruptSave ? "{invalid" : JSON.stringify({ version: 1, state: { board: [...tiles, ...Array(16 - tiles.length).fill(0)], score, moves, continued }, previous: null })],
    ["yige-2048-best", "100"],
  ]);

  class Element {
    constructor(tagName = "DIV") {
      this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = {}; this.events = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.open = false;
      this.styles = {}; this.style = { setProperty: (key, value) => { this.styles[key] = value; } };
      this.classes = new Set();
      this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name), toggle: (name, enabled) => { if (enabled) this.classes.add(name); else this.classes.delete(name); } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ""; this.children = children; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return (this._text || "") + this.children.map((child) => child.textContent).join(""); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
    fire(name, event = {}) { for (const callback of this.events[name] || []) callback({ target: this, ...event }); }
    contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
    focus() { document.activeElement = this; }
    setPointerCapture() {}
    showModal() { this.open = true; }
    close(value) { this.open = false; this.returnValue = value; this.fire("close"); }
  }

  const document = {
    activeElement: null,
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => { const node = new Element(); node.textContent = text; return node; },
    addEventListener: (name, callback) => { listeners.set(name, callback); },
  };
  const get = (id) => document.getElementById(id);
  get("game-overlay").hidden = true;
  get("game-overlay").append(get("overlay-primary"), get("overlay-secondary"));
  const context = {
    document, HTMLElement: Element,
    localStorage: {
      getItem: (key) => { if (storageFails) throw Error("Storage blocked"); return data.get(key) ?? null; },
      setItem: (key, value) => { if (storageFails) throw Error("Storage blocked"); data.set(key, value); },
    },
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener() {},
    setTimeout: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  context.window = context;
  vm.createContext(context);
  scripts.forEach((source) => vm.runInContext(source, context));
  const flushFrames = () => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback(); }
  };
  return {
    get, data, document, flushFrames,
    state: () => JSON.parse(data.get("yige-2048-v1")),
    key(key, extra = {}) { let prevented = false; listeners.get("keydown")({ key, target: new Element(), preventDefault() { prevented = true; }, ...extra }); return prevented; },
    flushAnimation() {
      flushFrames();
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    },
  };
}

test("controller renders restored score and accessible grid", () => {
  const app = fixture({ score: 12, moves: 3 });
  assert.equal(app.get("score").textContent, "12");
  assert.equal(app.get("best").textContent, "100");
  assert.equal(app.get("move-count").textContent, "第 3 步");
  assert.equal(app.get("board-grid").children.length, 4);
  assert.equal(app.get("board-grid").children[0].children[0].attributes["aria-label"], "2");
});

test("keyboard movement updates score, storage and undo; Z restores them", () => {
  const app = fixture();
  assert.equal(app.key("ArrowLeft"), true);
  assert.equal(app.state().state.score, 4);
  assert.equal(app.get("score").textContent, "4");
  assert.equal(app.get("undo").disabled, false);
  assert.equal(app.get("effects-layer").children.length, 0);
  app.key("z");
  assert.equal(app.state().state.score, 0);
  assert.deepEqual(app.state().state.board.slice(0, 3), [2, 2, 4]);
  assert.equal(app.get("undo").disabled, true);
});

test("invalid movements leave the stored state untouched", () => {
  const app = fixture({ tiles: [2, 4, 8, 16] });
  const before = app.state();
  app.key("a");
  assert.deepEqual(app.state(), before);
  assert.equal(app.get("undo").disabled, true);
});

test("restart dialog cancels safely and accepts a new game", () => {
  const app = fixture({ score: 24, moves: 6 });
  app.key("r");
  assert.equal(app.get("restart-dialog").open, true);
  app.key("ArrowLeft");
  assert.equal(app.state().state.moves, 6);
  app.get("restart-dialog").close("cancel");
  assert.equal(app.state().state.score, 24);
  app.get("restart").fire("click");
  app.get("restart-dialog").close("restart");
  assert.equal(app.state().state.moves, 0);
  assert.equal(app.state().state.score, 0);
  assert.equal(app.state().state.board.filter(Boolean).length, 2);
  assert.equal(app.data.get("yige-2048-best"), "100");
});

test("winning overlay supports continued play and remembers that choice", () => {
  const app = fixture({ tiles: [2048, 2], score: 2048, moves: 100 });
  assert.equal(app.get("game-overlay").hidden, false);
  assert.equal(app.get("overlay-title").textContent, "你做到了！");
  app.get("overlay-primary").fire("click");
  assert.equal(app.get("game-overlay").hidden, true);
  assert.equal(app.state().state.continued, true);
});

test("a game-over board exposes the restart action", () => {
  const app = fixture({ tiles: [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2], moves: 42 });
  assert.equal(app.get("game-overlay").hidden, false);
  assert.equal(app.get("overlay-primary").textContent, "再玩一局");
  app.get("overlay-primary").fire("click");
  assert.equal(app.get("game-overlay").hidden, true);
  assert.equal(app.state().state.moves, 0);
});

test("storage failures degrade to a visible session-only notice", () => {
  const app = fixture({ storageFails: true });
  assert.equal(app.get("save-status").textContent, "本次进度仅保留至页面关闭");
  assert.doesNotThrow(() => app.key("ArrowRight"));
});

test("malformed JSON starts a fresh game and replaces the damaged save", () => {
  const app = fixture({ corruptSave: true });
  assert.equal(app.state().state.moves, 0);
  assert.equal(app.state().state.board.filter(Boolean).length, 2);
});

test("pointer swipes move once and short taps do not move", () => {
  const app = fixture();
  const board = app.get("board");
  board.fire("pointerdown", { clientX: 200, clientY: 100, pointerId: 1, pointerType: "touch" });
  board.fire("pointerup", { clientX: 90, clientY: 100, pointerId: 1, pointerType: "touch" });
  assert.equal(app.state().state.moves, 1);
  board.fire("pointerdown", { clientX: 100, clientY: 100, pointerId: 2, pointerType: "touch" });
  board.fire("pointerup", { clientX: 105, clientY: 100, pointerId: 2, pointerType: "touch" });
  assert.equal(app.state().state.moves, 1);
});

test("modifier shortcuts and editable targets do not move the board", () => {
  const app = fixture();
  const input = app.get("test-input");
  input.tagName = "INPUT";
  app.key("a", { ctrlKey: true });
  app.key("s", { target: input });
  assert.equal(app.state().state.moves, 0);
});

test("animation blocks overlapping input and completes with the updated board", () => {
  const app = fixture({ reducedMotion: false });
  app.key("ArrowLeft");
  assert.equal(app.state().state.moves, 1);
  assert.equal(app.get("undo").disabled, true);
  app.key("ArrowRight");
  assert.equal(app.state().state.moves, 1);
  app.flushAnimation();
  assert.equal(app.get("undo").disabled, false);
  assert.equal(app.get("score").textContent, "4");
  app.key("z");
  assert.equal(app.state().state.moves, 0);
});

test("tiles stay visible while sliding and merge only after arriving", () => {
  const app = fixture({ reducedMotion: false });
  const layer = app.get("tile-layer");
  const originalTiles = [...layer.children];
  app.key("ArrowLeft");
  originalTiles.forEach((tile, index) => assert.equal(layer.children[index], tile));
  assert.equal(originalTiles[1].dataset.index, 1);
  assert.equal(app.get("score").textContent, "0");

  app.flushFrames();
  assert.equal(originalTiles[1].dataset.index, 0);
  assert.equal(originalTiles[1].classes.has("sliding"), true);
  assert.equal(layer.children[0].textContent, "2");
  assert.equal(app.get("undo").disabled, true);

  originalTiles[1].fire("transitionend", { propertyName: "transform" });
  assert.equal(layer.children[0].textContent, "4");
  assert.match(layer.children[0].className, /\bmerged\b/);
  assert.equal(app.get("score").textContent, "4");
  assert.equal(app.get("undo").disabled, false);
  app.key("ArrowRight");
  assert.equal(app.state().state.moves, 2);
});

test("slides reach the correct cell with a trail behind each direction", () => {
  for (const [key, destination, trailX, trailY] of [
    ["ArrowLeft", 4, "20px", "0px"],
    ["ArrowRight", 7, "-26px", "0px"],
    ["ArrowUp", 1, "0px", "20px"],
    ["ArrowDown", 13, "0px", "-26px"],
  ]) {
    const app = fixture({ tiles: [0, 0, 0, 0, 0, 2], reducedMotion: false });
    const tile = app.get("tile-layer").children[0];
    app.key(key);
    app.flushFrames();
    assert.equal(tile.dataset.index, destination, key);
    assert.equal(tile.styles["--trail-x"], trailX, key);
    assert.equal(tile.styles["--trail-y"], trailY, key);
    tile.fire("transitionend", { propertyName: "transform" });
    assert.equal(app.get("undo").disabled, false, key);
    assert.equal(app.state().state.board[destination], 2, key);
  }
});

test("merge particles clear on undo and expire without changing saved progress", () => {
  const app = fixture({ reducedMotion: false });
  const finishMerge = () => {
    const movingTile = app.get("tile-layer").children[1];
    app.key("ArrowLeft");
    app.flushFrames();
    movingTile.fire("transitionend", { propertyName: "transform" });
  };

  finishMerge();
  assert.equal(app.get("effects-layer").children.length, 1);
  assert.equal(app.get("effects-layer").children[0].children.length, 8);
  assert.equal(app.get("board").classes.has("impact"), true);
  app.key("z");
  assert.equal(app.state().state.moves, 0);
  assert.equal(app.get("effects-layer").children.length, 0);
  assert.equal(app.get("board").classes.has("impact"), false);

  finishMerge();
  const saved = app.state();
  app.flushAnimation();
  assert.equal(app.get("effects-layer").children.length, 0);
  assert.equal(app.get("board").classes.has("impact"), false);
  assert.deepEqual(app.state(), saved);
});
