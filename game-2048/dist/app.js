(function () {
  "use strict";

  const STORAGE_KEY = "yige-2048-v1";
  const BEST_KEY = "yige-2048-best";
  const SLIDE_DURATION = 210;
  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const layer = $("tile-layer");
  const effects = $("effects-layer");
  const grid = $("board-grid");
  const overlay = $("game-overlay");
  const dialog = $("restart-dialog");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let storageAvailable = true;
  let saved = null;
  let best = 0;
  let busy = false;
  let animationTimer = null;
  let animationFrame = null;
  let scoreTimer = null;
  let effectsTimer = null;
  let pointerStart = null;
  let multiplePointers = false;
  const activePointers = new Set();

  layer.style.setProperty("--slide-duration", `${SLIDE_DURATION}ms`);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { saved = JSON.parse(raw); } catch { /* A malformed save starts a fresh game. */ }
    }
    const storedBest = Number(localStorage.getItem(BEST_KEY));
    if (Number.isSafeInteger(storedBest) && storedBest >= 0) best = storedBest;
  } catch { storageAvailable = false; }

  const game = new Game2048.Game({ saved });
  best = Math.max(best, game.score);
  const cells = [];

  for (let row = 0; row < 4; row++) {
    const rowElement = document.createElement("div");
    rowElement.className = "grid-row";
    rowElement.setAttribute("role", "row");
    for (let col = 0; col < 4; col++) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(col + 1));
      rowElement.append(cell);
      cells.push(cell);
    }
    grid.append(rowElement);
  }

  function announce(text) { $("announcement").textContent = text; }

  function persist() {
    best = Math.max(best, game.score);
    if (storageAvailable) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(game.serialize()));
        localStorage.setItem(BEST_KEY, String(best));
      } catch { storageAvailable = false; }
    }
    const status = $("save-status");
    status.classList.toggle("unavailable", !storageAvailable);
    status.replaceChildren();
    if (storageAvailable) status.append(document.createElement("span"));
    status.append(document.createTextNode(storageAvailable ? "进度自动保存" : "本次进度仅保留至页面关闭"));
  }

  function makeTile(value, index, className = "") {
    const tile = document.createElement("div");
    tile.className = `tile ${className}${value > 2048 ? " tile-large" : ""}${value > 32768 ? " tile-huge" : ""}`;
    tile.dataset.value = value;
    tile.style.setProperty("--fx-hue", effectHue(value));
    positionTile(tile, index);
    const number = document.createElement("div");
    number.className = "tile-number";
    number.textContent = value;
    tile.append(number);
    return tile;
  }

  function positionTile(tile, index) {
    tile.dataset.index = index;
    tile.style.setProperty("--x", index % 4);
    tile.style.setProperty("--y", Math.floor(index / 4));
  }

  function effectHue(value) { return (150 + Math.log2(value) * 37) % 360; }

  function clearEffects() {
    clearTimeout(effectsTimer);
    effectsTimer = null;
    effects.replaceChildren();
    board.classList.remove("impact");
  }

  function showMergeEffects(indices) {
    clearEffects();
    if (reducedMotion.matches || !indices.length) return;

    indices.forEach((index) => {
      const burst = document.createElement("div");
      burst.className = "merge-burst";
      positionTile(burst, index);
      burst.style.setProperty("--fx-hue", effectHue(game.board[index]));

      for (let particle = 0; particle < 8; particle++) {
        const spark = document.createElement("i");
        const angle = particle * Math.PI / 4 + index * .17;
        spark.className = "merge-particle";
        spark.style.setProperty("--dx", Math.cos(angle).toFixed(3));
        spark.style.setProperty("--dy", Math.sin(angle).toFixed(3));
        spark.style.setProperty("--spin", `${particle * 65}deg`);
        spark.style.setProperty("--hue-shift", particle * 12);
        burst.append(spark);
      }
      effects.append(burst);
    });

    board.style.setProperty("--impact", indices.length > 1 ? "3px" : "1.8px");
    // Restart the impact even when merges happen in consecutive moves.
    void board.offsetWidth;
    board.classList.add("impact");
    effectsTimer = setTimeout(clearEffects, 650);
  }

  function render({ spawnIndex = null, mergedIndices = [] } = {}) {
    layer.replaceChildren();
    game.board.forEach((value, index) => {
      if (value) layer.append(makeTile(value, index, index === spawnIndex ? "spawn" : mergedIndices.includes(index) ? "merged" : ""));
      cells[index].setAttribute("aria-label", value ? String(value) : "空");
    });
    $("score").textContent = game.score.toLocaleString("zh-CN");
    $("best").textContent = best.toLocaleString("zh-CN");
    $("move-count").textContent = `第 ${game.moves} 步`;
    $("undo").disabled = !game.previous;
    renderOverlay();
  }

  function renderOverlay() {
    const wasVisible = !overlay.hidden;
    const focusWasInOverlay = overlay.contains(document.activeElement);
    const won = game.paused;
    overlay.hidden = !won && !game.over;
    if (overlay.hidden) {
      if (focusWasInOverlay) board.focus({ preventScroll: true });
      return;
    }
    $("overlay-badge").textContent = won ? "✳" : "↗";
    $("overlay-title").textContent = won ? "你做到了！" : "这一局，很精彩。";
    $("overlay-description").textContent = won ? "2048，只是新的开始。" : `收获 ${game.score.toLocaleString("zh-CN")} 分，换个思路再试试。`;
    $("overlay-primary").replaceChildren(document.createTextNode(won ? "继续挑战" : "再玩一局"));
    $("overlay-secondary").textContent = won ? "再玩一局" : "撤销最后一步";
    $("overlay-secondary").hidden = !won && !game.previous;
    if (!wasVisible) {
      announce(won ? "恭喜合成 2048！可以继续挑战或开始新的一局。" : `游戏结束，得分 ${game.score}。`);
      $("overlay-primary").focus({ preventScroll: true });
    }
  }

  function showGain(score) {
    if (!score) return;
    const element = $("score-gain");
    clearTimeout(scoreTimer);
    element.classList.remove("active");
    element.textContent = `+${score}`;
    void element.offsetWidth;
    element.classList.add("active");
    scoreTimer = setTimeout(() => { element.textContent = ""; element.classList.remove("active"); }, 660);
  }

  function finishAnimation(result) {
    if (!busy) return;
    clearTimeout(animationTimer);
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    animationTimer = null;
    busy = false;
    render(result);
    showMergeEffects(result.mergedIndices);
    showGain(result.score);
    if (!game.over && !game.paused) announce(`第 ${game.moves} 步，得分 ${game.score}。`);
  }

  function move(direction) {
    if (busy || dialog.open) return;
    const result = game.move(direction);
    if (!result.moved) return;
    persist();
    busy = true;
    $("undo").disabled = true;
    if (reducedMotion.matches) { finishAnimation(result); return; }

    // Keep the visible tiles so their movement starts exactly where they are.
    const tilesByIndex = new Map(Array.from(layer.children, (tile) => [Number(tile.dataset.index), tile]));
    const movingTiles = result.movements.map(({ from, to }) => {
      const tile = tilesByIndex.get(from);
      tile.classList.remove("spawn");
      tile.classList.remove("merged");
      const travelX = from % 4 - to % 4;
      const travelY = Math.floor(from / 4) - Math.floor(to / 4);
      const dx = Math.sign(travelX);
      const dy = Math.sign(travelY);
      const trailLength = 14 + Math.min(3, Math.abs(travelX) + Math.abs(travelY)) * 6;
      tile.style.setProperty("--trail-x", `${dx * trailLength}px`);
      tile.style.setProperty("--trail-y", `${dy * trailLength}px`);
      tile.style.setProperty("--stretch-x", dx ? "1.12" : ".92");
      tile.style.setProperty("--stretch-y", dy ? "1.12" : ".92");
      tile.style.setProperty("--tilt", `${(dx || -dy) * 3}deg`);
      return { tile, to, moving: from !== to };
    });

    const firstMovingTile = movingTiles.find(({ moving }) => moving).tile;
    firstMovingTile.addEventListener("transitionend", (event) => {
      if (event.target === firstMovingTile && event.propertyName === "transform") finishAnimation(result);
    }, { once: true });

    // Commit the initial positions before transitioning to their destinations.
    void layer.offsetWidth;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      movingTiles.forEach(({ tile, to, moving }) => {
        if (moving) tile.classList.add("sliding");
        positionTile(tile, to);
      });
      // Also release input when a browser suppresses transition events.
      animationTimer = setTimeout(() => finishAnimation(result), SLIDE_DURATION + 80);
    });
  }

  function undo() {
    if (busy || dialog.open || !game.undo()) return;
    clearEffects();
    clearTimeout(scoreTimer);
    $("score-gain").textContent = "";
    persist();
    render();
    announce("已撤销一步。");
  }

  function restart() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    clearTimeout(animationTimer);
    clearTimeout(scoreTimer);
    clearEffects();
    busy = false;
    animationFrame = null;
    animationTimer = null;
    $("score-gain").textContent = "";
    game.restart();
    persist();
    render();
    board.focus({ preventScroll: true });
    announce("新的一局开始了。");
  }

  function requestRestart() {
    if (dialog.open || busy) return;
    if (game.moves === 0 || game.over) { restart(); return; }
    dialog.returnValue = "cancel";
    dialog.showModal();
  }

  $("undo").addEventListener("click", undo);
  $("restart").addEventListener("click", requestRestart);
  dialog.addEventListener("close", () => { if (dialog.returnValue === "restart") restart(); });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close("cancel");
  } });
  $("overlay-primary").addEventListener("click", () => {
    if (game.paused) { game.keepPlaying(); persist(); render(); announce("继续挑战，向更大的数字前进！"); }
    else restart();
  });
  $("overlay-secondary").addEventListener("click", () => { if (game.paused) restart(); else undo(); });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || dialog.open) return;
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) return;
    const key = event.key.toLowerCase();
    const directions = { arrowleft: "left", a: "left", arrowright: "right", d: "right", arrowup: "up", w: "up", arrowdown: "down", s: "down" };
    if (directions[key]) { event.preventDefault(); move(directions[key]); }
    else if (key === "z") { event.preventDefault(); undo(); }
    else if (key === "r" && !event.repeat) { event.preventDefault(); requestRestart(); }
  });

  board.addEventListener("pointerdown", (event) => {
    if (!overlay.hidden || (event.pointerType === "mouse" && event.button !== 0)) return;
    activePointers.add(event.pointerId);
    if (activePointers.size > 1) { multiplePointers = true; pointerStart = null; return; }
    multiplePointers = false;
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    board.setPointerCapture(event.pointerId);
    board.focus({ preventScroll: true });
  });
  board.addEventListener("pointerup", (event) => {
    activePointers.delete(event.pointerId);
    if (multiplePointers || !pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
    move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  board.addEventListener("pointercancel", () => { pointerStart = null; activePointers.clear(); multiplePointers = false; });
  window.addEventListener("blur", () => { pointerStart = null; activePointers.clear(); multiplePointers = false; });

  persist();
  render();
})();
