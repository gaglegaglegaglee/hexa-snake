(function (root) {
  "use strict";

  const DIRECTIONS = Object.freeze([
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ]);

  const keyOf = ({ q, r }) => `${q},${r}`;
  const addHex = (a, b) => ({ q: a.q + b.q, r: a.r + b.r });
  const hexDistance = ({ q, r }) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
  const isInsideBoard = (hex, radius) => hexDistance(hex) <= radius;
  const getNeighbor = (hex, direction) => addHex(hex, DIRECTIONS[((direction % 6) + 6) % 6]);

  function createBoard(radius) {
    const cells = [];
    for (let q = -radius; q <= radius; q += 1) {
      const rMin = Math.max(-radius, -q - radius);
      const rMax = Math.min(radius, -q + radius);
      for (let r = rMin; r <= rMax; r += 1) cells.push({ q, r });
    }
    return cells;
  }

  function pixelToAxial(x, y, size) {
    const fractionalQ = (Math.sqrt(3) / 3 * x - y / 3) / size;
    const fractionalR = (2 / 3 * y) / size;
    let cubeX = fractionalQ;
    let cubeZ = fractionalR;
    let cubeY = -cubeX - cubeZ;
    let q = Math.round(cubeX);
    let yRounded = Math.round(cubeY);
    let r = Math.round(cubeZ);
    const qDiff = Math.abs(q - cubeX);
    const yDiff = Math.abs(yRounded - cubeY);
    const rDiff = Math.abs(r - cubeZ);
    if (qDiff > yDiff && qDiff > rDiff) q = -yRounded - r;
    else if (yDiff > rDiff) yRounded = -q - r;
    else r = -q - yRounded;
    return { q, r };
  }

  function turnDirection(direction, turn) {
    return (direction + (turn === "right" ? -1 : 1) + 6) % 6;
  }

  function enqueueTurn(queue, turn, max = 2) {
    return queue.length >= max ? queue.slice() : [...queue, turn];
  }

  function advanceSnake(snake, direction) {
    const nextHead = getNeighbor(snake[0], direction);
    return [nextHead, ...snake.slice(0, -1)];
  }

  const BOARD_RADIUS = 6;
  const START_INTERVAL = 450;
  const SPEED_STEP = 12;
  const MIN_INTERVAL = 295;
  const FAST_MULTIPLIER = 0.75;
  const SLOW_MULTIPLIER = 1.3;
  const MAX_EFFECT_INTERVAL = 720;
  const ITEM_TYPES = Object.freeze(["speed", "slow", "cut", "wall", "armor"]);
  const ITEM_MIN_DELAY = 3500;
  const ITEM_MAX_DELAY = 8000;
  const ITEM_LIFETIME = 5000;

  function getMoveInterval(foodCount) {
    return Math.max(MIN_INTERVAL, START_INTERVAL - foodCount * SPEED_STEP);
  }

  function getSpeedLevel(foodCount) {
    return Math.floor((START_INTERVAL - getMoveInterval(foodCount)) / SPEED_STEP) + 1;
  }

  function chooseItemType(randomValue) {
    const value = Math.max(0, Math.min(0.999999999, randomValue));
    if (value < 0.25) return "speed";
    if (value < 0.35) return "slow";
    if (value < 0.45) return "cut";
    if (value < 0.72) return "wall";
    return "armor";
  }

  function getEffectiveMoveInterval(foodCount, speedEffect) {
    const base = getMoveInterval(foodCount);
    if (!speedEffect) return base;
    if (speedEffect.type === "speed") return Math.max(MIN_INTERVAL, Math.round(base * FAST_MULTIPLIER));
    if (speedEffect.type === "slow") return Math.min(MAX_EFFECT_INTERVAL, Math.round(base * SLOW_MULTIPLIER));
    return base;
  }

  function spawnFood(board, snake, random = Math.random, maxRandomAttempts = 8, blocked = []) {
    const occupied = new Set([...snake, ...blocked].filter(Boolean).map(keyOf));
    const empty = board.filter((cell) => !occupied.has(keyOf(cell)));
    if (!empty.length) return null;
    for (let attempt = 0; attempt < maxRandomAttempts; attempt += 1) {
      const index = Math.min(board.length - 1, Math.floor(random() * board.length));
      const candidate = board[index];
      if (!occupied.has(keyOf(candidate))) return { ...candidate };
    }
    return { ...empty[0] };
  }

  function spawnItem(board, snake, apple, random = Math.random, maxRandomAttempts = 8) {
    const type = chooseItemType(random());
    const target = spawnFood(board, snake, random, maxRandomAttempts, apple ? [apple] : []);
    return target ? { ...target, type } : null;
  }

  function nextItemDelay(random = Math.random) {
    return ITEM_MIN_DELAY + Math.floor(Math.max(0, Math.min(0.999999, random())) * (ITEM_MAX_DELAY - ITEM_MIN_DELAY));
  }

  function wallKey(a, b) {
    const keys = [keyOf(a), keyOf(b)].sort();
    return `${keys[0]}|${keys[1]}`;
  }

  function wallCells(key) {
    return key.split("|").map((value) => {
      const [q, r] = value.split(",").map(Number);
      return { q, r };
    });
  }

  function areNeighbors(a, b) {
    return hexDistance({ q: a.q - b.q, r: a.r - b.r }) === 1;
  }

  function isBoardConnected(board, walls) {
    if (!board.length) return true;
    const wallSet = new Set(walls);
    const boardSet = new Set(board.map(keyOf));
    const visited = new Set([keyOf(board[0])]);
    const queue = [board[0]];
    while (queue.length) {
      const cell = queue.shift();
      DIRECTIONS.forEach((_, direction) => {
        const neighbor = getNeighbor(cell, direction);
        const neighborKey = keyOf(neighbor);
        if (!boardSet.has(neighborKey) || visited.has(neighborKey) || wallSet.has(wallKey(cell, neighbor))) return;
        visited.add(neighborKey);
        queue.push(neighbor);
      });
    }
    return visited.size === board.length;
  }

  function createWallCandidates(board, snake, target, walls, radius) {
    if (walls.length >= 5) return [];
    const blockedCells = new Set();
    [...snake, ...(target ? [target] : [])].forEach((cell) => {
      blockedCells.add(keyOf(cell));
      DIRECTIONS.forEach((_, direction) => blockedCells.add(keyOf(getNeighbor(cell, direction))));
    });
    const existing = new Set(walls);
    const boardSet = new Set(board.map(keyOf));
    const centralRadius = Math.max(1, radius - 2);
    const candidates = [];
    board.forEach((cell) => {
      if (hexDistance(cell) > centralRadius || blockedCells.has(keyOf(cell))) return;
      DIRECTIONS.forEach((_, direction) => {
        const neighbor = getNeighbor(cell, direction);
        const key = wallKey(cell, neighbor);
        if (!boardSet.has(keyOf(neighbor)) || hexDistance(neighbor) > centralRadius || blockedCells.has(keyOf(neighbor)) || existing.has(key)) return;
        if (!candidates.includes(key) && isBoardConnected(board, [...walls, key])) candidates.push(key);
      });
    });
    return candidates;
  }

  function addSafeWall(board, snake, target, walls, radius, random = Math.random) {
    const candidates = createWallCandidates(board, snake, target, walls, radius);
    if (!candidates.length) return walls.slice();
    const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    return [...walls, candidates[index]];
  }

  function moveGame(state, board, radius, random = Math.random) {
    if (state.phase !== "playing") return state;
    const nextHead = getNeighbor(state.snake[0], state.direction);
    if (!isInsideBoard(nextHead, radius)) return { ...state, phase: "ended", endReason: "boundary" };
    const apple = state.apple || (state.food && (!state.food.type || state.food.type === "normal") ? state.food : null);
    const item = state.item || (state.food?.type && state.food.type !== "normal" ? state.food : null);
    const ateApple = apple && keyOf(nextHead) === keyOf(apple);
    const ateItem = item && keyOf(nextHead) === keyOf(item);
    const targetType = ateItem ? item.type : "normal";
    const grows = ateApple;
    const collisionBody = grows ? state.snake : state.snake.slice(0, -1);
    if (collisionBody.some((cell) => keyOf(cell) === keyOf(nextHead))) {
      return { ...state, phase: "ended", endReason: "self" };
    }
    let nextWalls = (state.walls || []).slice();
    let nextArmorCharge = state.armorCharge || 0;
    const crossedWall = wallKey(state.snake[0], nextHead);
    const wallIndex = nextWalls.indexOf(crossedWall);
    if (wallIndex !== -1) {
      if (!nextArmorCharge) return { ...state, phase: "ended", endReason: "barrier" };
      nextWalls.splice(wallIndex, 1);
      nextArmorCharge = 0;
    }
    let nextSnake = grows
      ? [nextHead, ...state.snake]
      : [nextHead, ...state.snake.slice(0, -1)];
    if (!ateApple && !ateItem) return { ...state, snake: nextSnake, apple, item, walls: nextWalls, armorCharge: nextArmorCharge };

    let nextScore = state.score;
    let nextFoodCount = state.foodCount;
    let nextEffect = state.speedEffect || null;
    let nextItemCount = state.itemCount || 0;
    if (ateApple) {
      nextScore += 100;
      nextFoodCount += 1;
      if (nextEffect) {
        const remaining = nextEffect.remaining - 1;
        nextEffect = remaining > 0 ? { ...nextEffect, remaining } : null;
      }
    } else {
      nextScore += 50;
      nextItemCount += 1;
      if (targetType === "speed" || targetType === "slow") nextEffect = { type: targetType, remaining: 3 };
      if (targetType === "cut") nextSnake = nextSnake.slice(0, Math.max(3, nextSnake.length - 3));
      if (targetType === "wall") nextWalls = addSafeWall(board, nextSnake, item, nextWalls, radius, random);
      if (targetType === "armor") nextArmorCharge = 1;
    }
    const nextApple = ateApple ? spawnFood(board, nextSnake, random, 8, ateItem ? [] : [item]) : apple;
    const nextItem = ateItem ? null : item;
    return {
      ...state,
      snake: nextSnake,
      apple: nextApple,
      item: nextItem,
      food: nextApple,
      score: nextScore,
      foodCount: nextFoodCount,
      itemCount: nextItemCount,
      speedEffect: nextEffect,
      walls: nextWalls,
      armorCharge: nextArmorCharge,
      phase: nextApple ? "playing" : "ended",
      endReason: nextApple ? null : "win"
    };
  }

  function loadPreferences(storage) {
    try {
      const rawBest = Number(storage.getItem("hexSnake.bestScore"));
      return {
        bestScore: Number.isFinite(rawBest) && rawBest >= 0 ? Math.floor(rawBest) : 0,
        muted: storage.getItem("hexSnake.muted") === "1",
        available: true
      };
    } catch {
      return { bestScore: 0, muted: false, available: false };
    }
  }

  function savePreference(storage, key, value) {
    try {
      storage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }

  function updateBestScore(currentBest, scoreValue) {
    return Math.max(Number.isFinite(currentBest) ? currentBest : 0, Number.isFinite(scoreValue) ? scoreValue : 0);
  }

  function createInitialGameState(board, random = Math.random) {
    const snake = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }];
    return {
      snake,
      direction: 0,
      turnQueue: [],
      score: 0,
      foodCount: 0,
      itemCount: 0,
      speedEffect: null,
      walls: [],
      armorCharge: 0,
      apple: spawnFood(board, snake, random),
      item: null,
      phase: "countdown",
      endReason: null
    };
  }

  function advanceFrameClock(accumulatedTime, elapsedTime, moveInterval) {
    const next = accumulatedTime + Math.min(Math.max(0, elapsedTime), moveInterval);
    return { shouldMove: next >= moveInterval, remainder: next >= moveInterval ? next - moveInterval : next };
  }

  const api = { DIRECTIONS, BOARD_RADIUS, START_INTERVAL, SPEED_STEP, MIN_INTERVAL, FAST_MULTIPLIER, SLOW_MULTIPLIER, ITEM_TYPES, ITEM_MIN_DELAY, ITEM_MAX_DELAY, ITEM_LIFETIME, keyOf, addHex, hexDistance, isInsideBoard, getNeighbor, createBoard, pixelToAxial, turnDirection, enqueueTurn, advanceSnake, getMoveInterval, getSpeedLevel, chooseItemType, getEffectiveMoveInterval, spawnFood, spawnItem, nextItemDelay, wallKey, wallCells, areNeighbors, isBoardConnected, createWallCandidates, addSafeWall, moveGame, loadPreferences, savePreference, updateBestScore, createInitialGameState, advanceFrameClock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const wrap = document.querySelector(".board-wrap");
  const startPanel = document.querySelector("#startPanel");
  const startButton = document.querySelector("#startButton");
  const countdown = document.querySelector("#countdown");
  const endPanel = document.querySelector("#endPanel");
  const endReason = document.querySelector("#endReason");
  const resultScore = document.querySelector("#resultScore");
  const resultFood = document.querySelector("#resultFood");
  const resultItems = document.querySelector("#resultItems");
  const resultBest = document.querySelector("#resultBest");
  const retryButton = document.querySelector("#retryButton");
  const pausePanel = document.querySelector("#pausePanel");
  const resumeButton = document.querySelector("#resumeButton");
  const muteButton = document.querySelector("#muteButton");
  const turnLeftButton = document.querySelector("#turnLeft");
  const turnRightButton = document.querySelector("#turnRight");
  const status = document.querySelector("#status");
  const scoreElement = document.querySelector("#score");
  const foodCountElement = document.querySelector("#foodCount");
  const speedLevelElement = document.querySelector("#speedLevel");
  const speedEffectElement = document.querySelector("#speedEffect");
  const defenseStatusElement = document.querySelector("#defenseStatus");
  const bestScoreElement = document.querySelector("#bestScore");
  const radius = BOARD_RADIUS;
  const board = createBoard(radius);
  const boardKeys = new Set(board.map(keyOf));
  let layout = null;
  let snake = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }];
  let direction = 0;
  let turnQueue = [];
  let phase = "ready";
  let lastFrame = 0;
  let accumulated = 0;
  let frameId = 0;
  let apple = spawnFood(board, snake);
  let item = null;
  let itemSpawnAt = 0;
  let itemExpiresAt = 0;
  let score = 0;
  let foodCount = 0;
  let itemCount = 0;
  let speedEffect = null;
  let walls = [];
  let armorCharge = 0;
  let storage = null;
  try { storage = window.localStorage; } catch {}
  const preferences = loadPreferences(storage);
  let bestScore = preferences.bestScore;
  let muted = preferences.muted;
  let audioContext = null;
  let countdownRunId = 0;
  let pausedFrom = null;
  let pausedAt = 0;

  function updateMuteButton() {
    muteButton.textContent = muted ? "🔇 소리 꺼짐" : "🔊 소리 켜짐";
    muteButton.setAttribute("aria-pressed", String(muted));
    muteButton.setAttribute("aria-label", muted ? "효과음 켜기" : "효과음 끄기");
  }

  function setTurnControls(enabled) {
    turnLeftButton.disabled = !enabled;
    turnRightButton.disabled = !enabled;
  }

  function unlockAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioContext) audioContext = new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    } catch {}
  }

  function sensoryFeedback(kind) {
    const patterns = { turn: 10, collect: [18, 12, 28], break: [25, 16, 45], collision: [45, 30, 90] };
    try { if (navigator.vibrate) navigator.vibrate(patterns[kind] || 12); } catch {}
    if (muted) return;
    try {
      unlockAudio();
      if (!audioContext) return;
      const frequencies = { turn: 320, collect: 660, break: 190, collision: 105 };
      const durations = { turn: .045, collect: .11, break: .16, collision: .24 };
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      oscillator.type = kind === "collision" ? "sawtooth" : "square";
      oscillator.frequency.setValueAtTime(frequencies[kind] || 400, now);
      gain.gain.setValueAtTime(.055, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + durations[kind]);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(now); oscillator.stop(now + durations[kind]);
    } catch {}
  }

  function updateHud() {
    scoreElement.textContent = score;
    foodCountElement.textContent = foodCount;
    speedLevelElement.textContent = `${getSpeedLevel(foodCount)}단계`;
    const names = { speed: "질주", slow: "느림" };
    speedEffectElement.textContent = speedEffect ? `${names[speedEffect.type]} · 사과 ${speedEffect.remaining}개` : "없음";
    defenseStatusElement.textContent = `${armorCharge ? "헬멧 1회" : "헬멧 없음"} · 벽 ${walls.length}/5`;
    bestScoreElement.textContent = `${bestScore}점`;
  }

  function axialToPixel(hex) {
    return {
      x: layout.cx + layout.size * Math.sqrt(3) * (hex.q + hex.r / 2),
      y: layout.cy + layout.size * 1.5 * hex.r
    };
  }

  function hexPath(x, y, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.PI / 180 * (60 * i - 30);
      const px = x + size * Math.cos(angle);
      const py = y + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function draw() {
    if (!layout) return;
    ctx.clearRect(0, 0, layout.width, layout.height);
    const background = ctx.createRadialGradient(layout.cx, layout.cy, 10, layout.cx, layout.cy, layout.width * .55);
    background.addColorStop(0, "#173d50");
    background.addColorStop(1, "#091928");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, layout.width, layout.height);

    board.forEach((cell) => {
      const p = axialToPixel(cell);
      hexPath(p.x, p.y, layout.size * .94);
      ctx.fillStyle = (cell.q + cell.r) % 2 === 0 ? "#174b55" : "#1a5660";
      ctx.fill();
      ctx.strokeStyle = "rgba(120, 239, 209, .22)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    drawWalls();

    if (apple) drawTarget({ ...apple, type: "normal" });
    if (item) drawTarget(item);

    snake.slice().reverse().forEach((cell, reverseIndex) => {
      const index = snake.length - 1 - reverseIndex;
      const p = axialToPixel(cell);
      if (index === 0) {
        hexPath(p.x, p.y, layout.size * .72);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, layout.size * .62, 0, Math.PI * 2);
      }
      ctx.fillStyle = index === 0 ? "#ffe267" : "#72edaa";
      ctx.fill();
      ctx.strokeStyle = index === 0 ? "#d65f45" : "#15836c";
      ctx.lineWidth = Math.max(2, layout.size * .09);
      ctx.stroke();
      if (index === 0) {
        ctx.fillStyle = "#10243a";
        const d = DIRECTIONS[direction];
        const side = { x: -d.r, y: d.q + d.r / 2 };
        [-1, 1].forEach((sign) => {
          ctx.beginPath();
          ctx.arc(p.x + d.q * layout.size * .22 + side.x * sign * layout.size * .18,
            p.y + d.r * layout.size * .22 + side.y * sign * layout.size * .18,
            Math.max(2, layout.size * .075), 0, Math.PI * 2);
          ctx.fill();
        });
        if (armorCharge) drawHelmet(p.x, p.y);
      }
    });
  }

  function drawWalls() {
    walls.forEach((key) => {
      const [a, b] = wallCells(key);
      const pa = axialToPixel(a);
      const pb = axialToPixel(b);
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const length = Math.hypot(dx, dy);
      const px = -dy / length;
      const py = dx / length;
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "#341b23";
      ctx.lineWidth = Math.max(5, layout.size * .3);
      ctx.beginPath(); ctx.moveTo(mx - px * layout.size * .52, my - py * layout.size * .52); ctx.lineTo(mx + px * layout.size * .52, my + py * layout.size * .52); ctx.stroke();
      ctx.strokeStyle = "#ff9e58";
      ctx.lineWidth = Math.max(3, layout.size * .17);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawHelmet(x, y) {
    const s = layout.size;
    ctx.save();
    ctx.fillStyle = "#ae8cff";
    ctx.strokeStyle = "#452d75";
    ctx.lineWidth = Math.max(2, s * .08);
    ctx.beginPath();
    ctx.arc(x, y - s * .25, s * .52, Math.PI, 0);
    ctx.lineTo(x + s * .52, y - s * .05);
    ctx.lineTo(x - s * .52, y - s * .05);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffe267";
    ctx.beginPath(); ctx.arc(x, y - s * .43, s * .13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - s * .62, y - s * .05); ctx.lineTo(x + s * .68, y - s * .05); ctx.stroke();
    ctx.restore();
  }

  function drawTarget(target) {
    const { x, y } = axialToPixel(target);
    const s = layout.size * .45;
    const type = target.type || "normal";
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, layout.size * .09);
    ctx.strokeStyle = "#10243a";
    if (type === "normal") {
      ctx.fillStyle = "#ff596e";
      ctx.beginPath(); ctx.arc(0, s * .12, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#83ed74";
      ctx.beginPath(); ctx.ellipse(s * .38, -s * .72, s * .35, s * .18, -.55, 0, Math.PI * 2); ctx.fill();
    } else if (type === "speed") {
      ctx.fillStyle = "#ffe267";
      ctx.beginPath(); ctx.moveTo(s * .2, -s * 1.15); ctx.lineTo(-s * .7, s * .05); ctx.lineTo(-s * .08, s * .05); ctx.lineTo(-s * .35, s * 1.15); ctx.lineTo(s * .75, -s * .22); ctx.lineTo(s * .1, -s * .22); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (type === "slow") {
      ctx.fillStyle = "#7fdcff";
      ctx.beginPath(); ctx.moveTo(-s * .72, -s); ctx.lineTo(s * .72, -s); ctx.lineTo(s * .4, -.15 * s); ctx.lineTo(-s * .4, -.15 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s * .4, .15 * s); ctx.lineTo(s * .4, .15 * s); ctx.lineTo(s * .72, s); ctx.lineTo(-s * .72, s); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (type === "cut") {
      ctx.strokeStyle = "#ff8ab4"; ctx.lineWidth = s * .32;
      ctx.beginPath(); ctx.moveTo(-s * .72, -s * .85); ctx.lineTo(s * .6, s * .85); ctx.moveTo(s * .72, -s * .85); ctx.lineTo(-s * .6, s * .85); ctx.stroke();
      ctx.fillStyle = "#f5f7ff"; ctx.beginPath(); ctx.arc(-s * .63, -s * .7, s * .28, 0, Math.PI * 2); ctx.arc(s * .63, -s * .7, s * .28, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#10243a"; ctx.lineWidth = Math.max(2, s * .14); ctx.stroke();
    } else if (type === "wall") {
      ctx.fillStyle = "#ff9e58"; ctx.fillRect(-s, -s * .72, s * 2, s * 1.44); ctx.strokeRect(-s, -s * .72, s * 2, s * 1.44);
      ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.moveTo(0, -s * .72); ctx.lineTo(0, 0); ctx.moveTo(-s * .5, 0); ctx.lineTo(-s * .5, s * .72); ctx.moveTo(s * .5, 0); ctx.lineTo(s * .5, s * .72); ctx.stroke();
    } else {
      ctx.fillStyle = "#ae8cff";
      ctx.beginPath(); ctx.moveTo(0, -s * 1.05); ctx.lineTo(s, -s * .58); ctx.lineTo(s * .72, s * .58); ctx.lineTo(0, s * 1.05); ctx.lineTo(-s * .72, s * .58); ctx.lineTo(-s, -s * .58); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `900 ${s}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("A", 0, 0);
    }
    ctx.restore();
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = Math.min(cssWidth / (Math.sqrt(3) * (radius * 2 + 1.15)), cssHeight / (3 * radius + 2));
    layout = { width: cssWidth, height: cssHeight, cx: cssWidth / 2, cy: cssHeight / 2, size };
    draw();
  }

  function tick() {
    if (turnQueue.length) direction = turnDirection(direction, turnQueue.shift());
    const nextHead = getNeighbor(snake[0], direction);
    const reachedApple = apple && keyOf(nextHead) === keyOf(apple);
    const reachedItem = item && keyOf(nextHead) === keyOf(item) ? item.type : null;
    const previousWallCount = walls.length;
    const previousArmor = armorCharge;
    const nextState = moveGame({ snake, direction, apple, item, score, foodCount, itemCount, speedEffect, walls, armorCharge, phase }, board, radius);
    snake = nextState.snake;
    apple = nextState.apple;
    item = nextState.item;
    score = nextState.score;
    foodCount = nextState.foodCount;
    itemCount = nextState.itemCount;
    speedEffect = nextState.speedEffect;
    walls = nextState.walls;
    armorCharge = nextState.armorCharge;
    phase = nextState.phase;
    updateHud();
    if (phase === "playing" && previousArmor && !armorCharge && walls.length < previousWallCount) {
      status.textContent = "쾅! 헬멧으로 벽을 부쉈어요";
      sensoryFeedback("break");
    } else if (phase === "playing" && reachedItem === "wall") {
      status.textContent = walls.length > previousWallCount ? "칸 사이에 새 벽이 생겼어요" : "안전한 자리가 없어 벽 생성을 건너뛰었어요";
      sensoryFeedback("collect");
    } else if (phase === "playing" && reachedItem) {
      status.textContent = reachedItem === "armor" ? "헬멧 충전 완료 · 벽을 한 번 부술 수 있어요" : "아이템 획득!";
      sensoryFeedback("collect");
      itemSpawnAt = performance.now() + nextItemDelay();
      itemExpiresAt = 0;
    } else if (phase === "playing" && reachedApple) {
      status.textContent = "사과 획득! 새 사과가 나타났어요";
      sensoryFeedback("collect");
    }
    if (phase === "ended") finishGame(nextState.endReason);
    draw();
  }

  function finishGame(reason) {
    cancelAnimationFrame(frameId);
    turnQueue = [];
    const messages = {
      boundary: "경기장 밖으로 나갔어요!",
      self: "자기 몸에 부딪혔어요!",
      barrier: "벽에 부딪혔어요!",
      win: "모든 칸을 채웠어요!"
    };
    bestScore = updateBestScore(bestScore, score);
    savePreference(storage, "hexSnake.bestScore", bestScore);
    endReason.textContent = messages[reason] || "게임이 끝났어요!";
    resultScore.textContent = score;
    resultFood.textContent = foodCount;
    resultItems.textContent = itemCount;
    resultBest.textContent = bestScore;
    endPanel.hidden = false;
    canvas.setAttribute("aria-hidden", "true");
    setTurnControls(false);
    status.textContent = `${endReason.textContent} 최종 ${score}점`;
    updateHud();
    sensoryFeedback(reason === "win" ? "collect" : "collision");
    retryButton.focus();
  }

  function loop(now) {
    if (phase !== "playing") return;
    if (item && now >= itemExpiresAt) {
      item = null;
      itemExpiresAt = 0;
      itemSpawnAt = now + nextItemDelay();
      status.textContent = "아이템이 사라졌어요";
      draw();
    } else if (!item && now >= itemSpawnAt) {
      item = spawnItem(board, snake, apple);
      itemSpawnAt = item ? 0 : now + nextItemDelay();
      itemExpiresAt = item ? now + ITEM_LIFETIME : 0;
      if (item) {
        status.textContent = "반짝! 랜덤 아이템이 나타났어요";
        draw();
      }
    }
    if (!lastFrame) lastFrame = now;
    const moveInterval = getEffectiveMoveInterval(foodCount, speedEffect);
    const clock = advanceFrameClock(accumulated, now - lastFrame, moveInterval);
    accumulated = clock.remainder;
    lastFrame = now;
    if (clock.shouldMove) tick();
    if (phase === "playing") frameId = requestAnimationFrame(loop);
  }

  function requestTurn(turn) {
    if (phase !== "playing") return;
    const nextQueue = enqueueTurn(turnQueue, turn);
    if (nextQueue.length === turnQueue.length) return;
    turnQueue = nextQueue;
    status.textContent = `입력 대기 ${turnQueue.length}/2`;
    sensoryFeedback("turn");
  }

  async function runCountdown() {
    const runId = ++countdownRunId;
    phase = "countdown";
    pausePanel.hidden = true;
    canvas.removeAttribute("aria-hidden");
    countdown.hidden = false;
    for (let n = 3; n >= 1; n -= 1) {
      if (phase !== "countdown" || runId !== countdownRunId) return;
      countdown.textContent = n;
      status.textContent = `${n}초 뒤 출발`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (phase !== "countdown" || runId !== countdownRunId) return;
    countdown.textContent = "출발!";
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (phase !== "countdown" || runId !== countdownRunId) return;
    countdown.hidden = true;
    phase = "playing";
    lastFrame = 0;
    itemSpawnAt = performance.now() + nextItemDelay();
    setTurnControls(true);
    status.textContent = "달리는 중 · 좌우로 회전하세요";
    frameId = requestAnimationFrame(loop);
  }

  function startGame() {
    cancelAnimationFrame(frameId);
    countdownRunId += 1;
    const initial = createInitialGameState(board);
    snake = initial.snake;
    direction = initial.direction;
    turnQueue = initial.turnQueue;
    score = initial.score;
    foodCount = initial.foodCount;
    itemCount = initial.itemCount;
    speedEffect = initial.speedEffect;
    walls = initial.walls;
    armorCharge = initial.armorCharge;
    apple = initial.apple;
    item = initial.item;
    itemSpawnAt = 0;
    itemExpiresAt = 0;
    accumulated = 0;
    lastFrame = 0;
    pausedFrom = null;
    startPanel.hidden = true;
    endPanel.hidden = true;
    pausePanel.hidden = true;
    updateHud();
    setTurnControls(false);
    draw();
    runCountdown();
  }

  function pauseGame() {
    if (phase !== "playing" && phase !== "countdown") return;
    pausedFrom = phase;
    pausedAt = performance.now();
    phase = "paused";
    countdownRunId += 1;
    cancelAnimationFrame(frameId);
    countdown.hidden = true;
    pausePanel.hidden = false;
    canvas.setAttribute("aria-hidden", "true");
    setTurnControls(false);
    status.textContent = "자동 일시정지됨";
    resumeButton.focus();
  }

  function resumeGame() {
    if (phase !== "paused") return;
    unlockAudio();
    if (pausedFrom === "countdown") {
      runCountdown();
      return;
    }
    phase = "playing";
    pausePanel.hidden = true;
    canvas.removeAttribute("aria-hidden");
    setTurnControls(true);
    lastFrame = 0;
    const pausedFor = Math.max(0, performance.now() - pausedAt);
    if (itemSpawnAt) itemSpawnAt += pausedFor;
    if (itemExpiresAt) itemExpiresAt += pausedFor;
    pausedAt = 0;
    status.textContent = "다시 출발!";
    frameId = requestAnimationFrame(loop);
  }

  function canvasTurn(event) {
    if (phase !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const touchedCell = pixelToAxial(x - layout.cx, y - layout.cy, layout.size);
    if (!boardKeys.has(keyOf(touchedCell))) return;
    requestTurn(x < layout.cx ? "left" : "right");
  }

  canvas.addEventListener("pointerdown", canvasTurn);
  turnLeftButton.addEventListener("click", () => requestTurn("left"));
  turnRightButton.addEventListener("click", () => requestTurn("right"));
  startButton.addEventListener("click", () => { unlockAudio(); startGame(); });
  retryButton.addEventListener("click", () => { unlockAudio(); startGame(); });
  resumeButton.addEventListener("click", resumeGame);
  muteButton.addEventListener("click", () => {
    unlockAudio();
    muted = !muted;
    savePreference(storage, "hexSnake.muted", muted ? "1" : "0");
    updateMuteButton();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    requestTurn(event.key === "ArrowLeft" ? "left" : "right");
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });
  window.addEventListener("blur", pauseGame);
  new ResizeObserver(resize).observe(wrap);
  updateMuteButton();
  updateHud();
  if (!preferences.available) status.textContent = "기록 저장 없이 게임을 시작할 수 있어요";
  resize();
})(typeof globalThis !== "undefined" ? globalThis : this);
