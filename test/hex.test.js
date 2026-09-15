"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DIRECTIONS, BOARD_RADIUS, START_INTERVAL, keyOf, hexDistance, isInsideBoard, getNeighbor,
  createBoard, pixelToAxial, turnDirection, enqueueTurn, advanceSnake
} = require("../app.js");

test("six unique axial directions are adjacent", () => {
  assert.equal(DIRECTIONS.length, 6);
  assert.equal(new Set(DIRECTIONS.map(keyOf)).size, 6);
  DIRECTIONS.forEach((direction) => assert.equal(hexDistance(direction), 1));
});

test("radius creates a regular hex board", () => {
  for (const radius of [0, 1, 2, 5]) {
    const board = createBoard(radius);
    assert.equal(board.length, 1 + 3 * radius * (radius + 1));
    assert.ok(board.every((cell) => isInsideBoard(cell, radius)));
    assert.equal(new Set(board.map(keyOf)).size, board.length);
  }
});

test("each center neighbor is exactly one step away", () => {
  const center = { q: 0, r: 0 };
  DIRECTIONS.forEach((_, direction) => {
    assert.equal(hexDistance(getNeighbor(center, direction)), 1);
  });
});

test("pixel coordinates round back to axial cells", () => {
  const size = 20;
  const cell = { q: 2, r: -1 };
  const x = size * Math.sqrt(3) * (cell.q + cell.r / 2);
  const y = size * 1.5 * cell.r;
  assert.deepEqual(pixelToAxial(x, y, size), cell);
});

test("outside classification follows all three cube axes", () => {
  assert.equal(isInsideBoard({ q: 2, r: -1 }, 2), true);
  assert.equal(isInsideBoard({ q: 2, r: 1 }, 2), false);
  assert.equal(isInsideBoard({ q: -3, r: 1 }, 2), false);
});

test("left and right turns wrap in 60 degree steps", () => {
  assert.equal(turnDirection(0, "left"), 1);
  assert.equal(turnDirection(0, "right"), 5);
  assert.equal(turnDirection(2, "right"), 1);
});

test("live board and starting pace use the enlarged, quicker defaults", () => {
  assert.equal(BOARD_RADIUS, 6);
  assert.equal(createBoard(BOARD_RADIUS).length, 127);
  assert.equal(START_INTERVAL, 450);
});

test("turn queue has a hard limit and does not mutate input", () => {
  const original = ["left"];
  const two = enqueueTurn(original, "right");
  const capped = enqueueTurn(two, "left");
  assert.deepEqual(original, ["left"]);
  assert.deepEqual(two, ["left", "right"]);
  assert.deepEqual(capped, ["left", "right"]);
});

test("snake advances one adjacent cell and remains three cells", () => {
  const snake = [{ q: 0, r: 0 }, { q: -1, r: 0 }, { q: -2, r: 0 }];
  const moved = advanceSnake(snake, 0);
  assert.deepEqual(moved, [{ q: 1, r: 0 }, { q: 0, r: 0 }, { q: -1, r: 0 }]);
  assert.equal(moved.length, 3);
  assert.deepEqual(snake[0], { q: 0, r: 0 });
});
