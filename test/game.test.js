"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  START_INTERVAL, MIN_INTERVAL, FAST_MULTIPLIER, SLOW_MULTIPLIER,
  ITEM_MIN_DELAY, ITEM_MAX_DELAY, keyOf, createBoard, chooseItemType, spawnFood, spawnItem, nextItemDelay,
  getMoveInterval, getSpeedLevel, getEffectiveMoveInterval,
  wallKey, wallCells, areNeighbors, isBoardConnected, createWallCandidates, addSafeWall, moveGame,
  loadPreferences, savePreference, updateBestScore, createInitialGameState, advanceFrameClock
} = require("../app.js");

const baseState = (overrides = {}) => ({
  snake: [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }],
  direction: 0,
  apple: { q: 2, r: 0 },
  item: null,
  score: 0,
  foodCount: 0,
  itemCount: 0,
  speedEffect: null,
  walls: [],
  armorCharge: 0,
  phase: "playing",
  endReason: null,
  ...overrides
});

test("food spawns on a valid unoccupied board cell", () => {
  const board = createBoard(2);
  const snake = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  const food = spawnFood(board, snake, () => 0.5);
  assert.ok(board.some((cell) => keyOf(cell) === keyOf(food)));
  assert.ok(!snake.some((cell) => keyOf(cell) === keyOf(food)));
});

test("food spawn falls back deterministically after repeated occupied rolls", () => {
  const board = createBoard(1);
  const snake = [{ ...board[0] }];
  const food = spawnFood(board, snake, () => 0, 3);
  assert.deepEqual(food, board[1]);
});

test("food spawn returns null when no empty cell exists", () => {
  const board = createBoard(1);
  assert.equal(spawnFood(board, board, () => 0), null);
});

test("eating food adds 100 points, one food and one body cell", () => {
  const board = createBoard(3);
  const state = baseState({ apple: { q: 1, r: 0 } });
  const moved = moveGame(state, board, 3, () => 0);
  assert.equal(moved.score, 100);
  assert.equal(moved.foodCount, 1);
  assert.equal(moved.snake.length, 4);
  assert.notEqual(keyOf(moved.apple), "1,0");
});

test("moving without food preserves score and length", () => {
  const moved = moveGame(baseState(), createBoard(3), 3, () => 0);
  assert.equal(moved.score, 0);
  assert.equal(moved.foodCount, 0);
  assert.equal(moved.snake.length, 3);
});

test("speed increases with every food and stops at minimum interval", () => {
  assert.equal(getMoveInterval(0), START_INTERVAL);
  assert.equal(getMoveInterval(1), START_INTERVAL - 12);
  assert.equal(getMoveInterval(2), START_INTERVAL - 24);
  assert.equal(getSpeedLevel(0), 1);
  assert.equal(getSpeedLevel(1), 2);
  assert.equal(getMoveInterval(10_000), MIN_INTERVAL);
  assert.equal(getMoveInterval(10_005), MIN_INTERVAL);
});

test("outside movement ends once without changing the snake", () => {
  const state = baseState({ snake: [{ q: 1, r: 0 }, { q: 0, r: 0 }, { q: -1, r: 0 }] });
  const ended = moveGame(state, createBoard(1), 1);
  assert.equal(ended.phase, "ended");
  assert.equal(ended.endReason, "boundary");
  assert.deepEqual(ended.snake, state.snake);
  assert.strictEqual(moveGame(ended, createBoard(1), 1), ended);
});

test("moving into the body ends while moving into a vacated tail is allowed", () => {
  const board = createBoard(3);
  const selfHit = baseState({
    snake: [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
    direction: 0,
    apple: { q: -2, r: 0 }
  });
  assert.equal(moveGame(selfHit, board, 3).endReason, "self");
  const tailMove = baseState({
    snake: [{ q: 0, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 1, r: 0 }],
    direction: 0,
    apple: { q: -2, r: 0 }
  });
  assert.equal(moveGame(tailMove, board, 3).phase, "playing");
});

test("filling the final free cell ends with a win", () => {
  const board = createBoard(1);
  const apple = { q: 1, r: 0 };
  const snake = board.filter((cell) => keyOf(cell) !== keyOf(apple));
  snake.unshift(...snake.splice(snake.findIndex((cell) => keyOf(cell) === "0,0"), 1));
  const won = moveGame(baseState({ snake, apple }), board, 1, () => 0);
  assert.equal(won.phase, "ended");
  assert.equal(won.endReason, "win");
  assert.equal(won.apple, null);
});

test("ended state ignores future movement", () => {
  const state = baseState({ phase: "ended", endReason: "self" });
  assert.strictEqual(moveGame(state, createBoard(3), 3), state);
});

test("item type boundaries never produce apples and keep slow and cut rarer", () => {
  assert.equal(chooseItemType(0), "speed");
  assert.equal(chooseItemType(0.249999), "speed");
  assert.equal(chooseItemType(0.25), "slow");
  assert.equal(chooseItemType(0.349999), "slow");
  assert.equal(chooseItemType(0.35), "cut");
  assert.equal(chooseItemType(0.449999), "cut");
  assert.equal(chooseItemType(0.45), "wall");
  assert.equal(chooseItemType(0.72), "armor");
  assert.equal(chooseItemType(1), "armor");
});

test("spawned special target uses a valid empty cell", () => {
  let callCount = 0;
  const snake = [{ q: 0, r: 0 }];
  const board = createBoard(2);
  const target = spawnItem(board, snake, { q: 1, r: 0 }, () => callCount++ === 0 ? 0.4 : 0.5);
  assert.equal(target.type, "cut");
  assert.ok(board.some((cell) => keyOf(cell) === keyOf(target)));
  assert.notEqual(keyOf(target), "0,0");
  assert.notEqual(keyOf(target), "1,0");
});

test("random items use an independent bounded appearance delay", () => {
  assert.equal(nextItemDelay(() => 0), ITEM_MIN_DELAY);
  assert.ok(nextItemDelay(() => 0.999999) < ITEM_MAX_DELAY);
});

test("special targets score 50 without growth or normal food count", () => {
  for (const type of ["speed", "slow", "cut", "wall", "armor"]) {
    const moved = moveGame(baseState({ item: { q: 1, r: 0, type } }), createBoard(3), 3, () => 0);
    assert.equal(moved.score, 50, type);
    assert.equal(moved.foodCount, 0, type);
    assert.equal(moved.itemCount, 1, type);
    assert.equal(moved.snake.length, 3, type);
  }
});

test("speed and slow use explicit bounded multipliers", () => {
  assert.equal(getEffectiveMoveInterval(0, { type: "speed", remaining: 3 }), Math.max(MIN_INTERVAL, Math.round(START_INTERVAL * FAST_MULTIPLIER)));
  assert.equal(getEffectiveMoveInterval(0, { type: "slow", remaining: 3 }), Math.round(START_INTERVAL * SLOW_MULTIPLIER));
  assert.equal(getEffectiveMoveInterval(0, null), START_INTERVAL);
});

test("opposite speed item replaces effect and normal foods consume three charges", () => {
  const board = createBoard(5);
  let state = moveGame(baseState({ apple: { q: 0, r: 3 }, item: { q: 1, r: 0, type: "speed" } }), board, 5, () => 0);
  assert.deepEqual(state.speedEffect, { type: "speed", remaining: 3 });
  state = moveGame({ ...state, direction: 0, item: { q: 2, r: 0, type: "slow" } }, board, 5, () => 0);
  assert.deepEqual(state.speedEffect, { type: "slow", remaining: 3 });
  for (let remaining = 2; remaining >= 0; remaining -= 1) {
    const next = { q: state.snake[0].q + 1, r: state.snake[0].r };
    state = moveGame({ ...state, direction: 0, apple: next, item: null }, board, 5, () => 0);
    assert.deepEqual(state.speedEffect, remaining ? { type: "slow", remaining } : null);
  }
});

test("cut removes up to three tail cells but preserves minimum length three", () => {
  const longSnake = [
    { q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 },
    { q: -2, r: 1 }, { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 }
  ];
  const cutLong = moveGame(baseState({ snake: longSnake, item: { q: 1, r: 0, type: "cut" } }), createBoard(5), 5, () => 0);
  assert.equal(cutLong.snake.length, 4);
  const cutShort = moveGame(baseState({ item: { q: 1, r: 0, type: "cut" } }), createBoard(5), 5, () => 0);
  assert.equal(cutShort.snake.length, 3);
});

test("wall key is unordered and decodes to neighboring cells", () => {
  const a = { q: 0, r: 0 };
  const b = { q: 1, r: -1 };
  assert.equal(wallKey(a, b), wallKey(b, a));
  const [first, second] = wallCells(wallKey(a, b));
  assert.equal(areNeighbors(first, second), true);
});

test("safe wall candidates avoid snake, target, outer ring and duplicates", () => {
  const board = createBoard(5);
  const snake = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }];
  const target = { q: 2, r: 0, type: "wall" };
  const candidates = createWallCandidates(board, snake, target, [], 5);
  assert.ok(candidates.length > 0);
  for (const key of candidates) {
    const cells = wallCells(key);
    assert.equal(areNeighbors(...cells), true);
    assert.ok(cells.every((cell) => Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(-cell.q - cell.r)) <= 3));
    assert.ok(isBoardConnected(board, [key]));
  }
  assert.deepEqual(createWallCandidates(board, snake, target, candidates.slice(0, 5), 5), []);
});

test("adding walls avoids duplicates, caps five and safely skips no candidate", () => {
  const board = createBoard(5);
  const snake = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }];
  let walls = [];
  for (let index = 0; index < 8; index += 1) walls = addSafeWall(board, snake, { q: 2, r: 0 }, walls, 5, () => 0);
  assert.equal(walls.length, 5);
  assert.equal(new Set(walls).size, walls.length);
  const impossible = addSafeWall(createBoard(1), createBoard(1), null, [], 1, () => 0);
  assert.deepEqual(impossible, []);
});

test("wall item adds one safe wall and armor item stores one charge", () => {
  const board = createBoard(5);
  const wallResult = moveGame(baseState({ item: { q: 1, r: 0, type: "wall" } }), board, 5, () => 0);
  assert.equal(wallResult.walls.length, 1);
  assert.equal(wallResult.armorCharge, 0);
  const armorResult = moveGame(baseState({ armorCharge: 1, item: { q: 1, r: 0, type: "armor" } }), board, 5, () => 0);
  assert.equal(armorResult.armorCharge, 1);
});

test("crossing a wall ends without armor from either direction", () => {
  const wall = wallKey({ q: 0, r: 0 }, { q: 1, r: 0 });
  const forward = moveGame(baseState({ walls: [wall] }), createBoard(3), 3);
  assert.equal(forward.endReason, "barrier");
  const reverse = moveGame(baseState({ snake: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: -1 }], direction: 3, walls: [wall] }), createBoard(3), 3);
  assert.equal(reverse.endReason, "barrier");
});

test("armor removes only crossed wall, moves and consumes charge", () => {
  const crossed = wallKey({ q: 0, r: 0 }, { q: 1, r: 0 });
  const other = wallKey({ q: -2, r: 0 }, { q: -2, r: 1 });
  const result = moveGame(baseState({ walls: [crossed, other], armorCharge: 1 }), createBoard(3), 3);
  assert.equal(result.phase, "playing");
  assert.deepEqual(result.snake[0], { q: 1, r: 0 });
  assert.deepEqual(result.walls, [other]);
  assert.equal(result.armorCharge, 0);
});

test("armor cannot prevent boundary or self collision and is not consumed", () => {
  const boundary = moveGame(baseState({ snake: [{ q: 1, r: 0 }, { q: 0, r: 0 }, { q: -1, r: 0 }], armorCharge: 1 }), createBoard(1), 1);
  assert.equal(boundary.endReason, "boundary");
  assert.equal(boundary.armorCharge, 1);
  const self = moveGame(baseState({
    snake: [{ q: 0, r: 0 }, { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
    walls: [wallKey({ q: 0, r: 0 }, { q: 1, r: 0 })], armorCharge: 1
  }), createBoard(3), 3);
  assert.equal(self.endReason, "self");
  assert.equal(self.armorCharge, 1);
});

test("preferences load valid values and safely fall back on blocked storage", () => {
  const values = new Map([["hexSnake.bestScore", "450"], ["hexSnake.muted", "1"]]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.deepEqual(loadPreferences(storage), { bestScore: 450, muted: true, available: true });
  assert.deepEqual(loadPreferences({ getItem: () => { throw new Error("blocked"); } }), { bestScore: 0, muted: false, available: false });
  assert.deepEqual(loadPreferences({ getItem: () => "broken" }), { bestScore: 0, muted: false, available: true });
});

test("preference saving and best score update are failure safe", () => {
  const saved = new Map();
  assert.equal(savePreference({ setItem: (key, value) => saved.set(key, value) }, "key", 10), true);
  assert.equal(saved.get("key"), "10");
  assert.equal(savePreference({ setItem: () => { throw new Error("blocked"); } }, "key", 10), false);
  assert.equal(updateBestScore(500, 400), 500);
  assert.equal(updateBestScore(500, 600), 600);
});

test("new game state resets every per-game value", () => {
  const state = createInitialGameState(createBoard(5), () => 0);
  assert.deepEqual(state.snake, [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }]);
  assert.equal(state.score, 0);
  assert.equal(state.foodCount, 0);
  assert.equal(state.itemCount, 0);
  assert.equal(state.speedEffect, null);
  assert.deepEqual(state.walls, []);
  assert.equal(state.armorCharge, 0);
  assert.equal(state.phase, "countdown");
  assert.ok(state.apple);
  assert.equal(state.item, null);
});

test("frame clock permits at most one move after a long hidden delay", () => {
  assert.deepEqual(advanceFrameClock(0, 10_000, 500), { shouldMove: true, remainder: 0 });
  assert.deepEqual(advanceFrameClock(200, 100, 500), { shouldMove: false, remainder: 300 });
});
