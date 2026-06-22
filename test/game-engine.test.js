"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOARD_SIZE,
  DOUBLE_TOTAL_SLOTS,
  DOUBLE_RED_SLOTS,
  DOUBLE_BLACK_SLOTS,
  DOUBLE_GREEN_SLOTS,
  calculateCrashPoint,
  crashSurvivalProbability,
  calculateMinesSurvivalProbability,
  calculateMinesMultiplier,
  calculateNextSafeProbability,
  buildMinesBoard,
  doubleColorForNumber,
  doubleProbability,
  doubleExpectedReturn,
} = require("../lib/game-engine");

test("Crash usa ponto mínimo 1x e aplica a vantagem configurada", () => {
  assert.equal(calculateCrashPoint(0.999999, 0.04), 1);
  assert.equal(calculateCrashPoint(0.48, 0.04), 2);
  assert.equal(crashSurvivalProbability(2, 0.04), 0.48);
});

test("Mines calcula sobrevivência sem reposição", () => {
  assert.equal(calculateMinesSurvivalProbability(25, 5, 1), 20 / 25);
  assert.equal(calculateMinesSurvivalProbability(25, 5, 2), (20 / 25) * (19 / 24));
  assert.equal(calculateNextSafeProbability(25, 5, 2), 18 / 23);
  assert.ok(calculateMinesMultiplier(25, 5, 1, 0.03) > 1);
});

test("Mines posiciona a quantidade correta de minas", () => {
  const board = buildMinesBoard(7, (min) => min);
  assert.equal(board.size, 7);
  assert.deepEqual([...board].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(BOARD_SIZE, 25);
});

test("Double usa a distribuição 7 vermelho, 7 preto e 1 verde", () => {
  assert.equal(DOUBLE_TOTAL_SLOTS, 15);
  assert.equal(DOUBLE_RED_SLOTS, 7);
  assert.equal(DOUBLE_BLACK_SLOTS, 7);
  assert.equal(DOUBLE_GREEN_SLOTS, 1);
  assert.equal(doubleColorForNumber(0), "green");
  assert.equal(doubleColorForNumber(1), "red");
  assert.equal(doubleColorForNumber(7), "red");
  assert.equal(doubleColorForNumber(8), "black");
  assert.equal(doubleColorForNumber(14), "black");
  assert.equal(doubleProbability("red"), 7 / 15);
  assert.equal(doubleProbability("black"), 7 / 15);
  assert.equal(doubleProbability("green"), 1 / 15);
  assert.equal(doubleExpectedReturn("red", 2), 14 / 15);
  assert.equal(doubleExpectedReturn("green", 14), 14 / 15);
});
