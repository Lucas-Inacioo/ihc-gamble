"use strict";

const BOARD_SIZE = 25;
const DOUBLE_TOTAL_SLOTS = 15;
const DOUBLE_RED_SLOTS = 7;
const DOUBLE_BLACK_SLOTS = 7;
const DOUBLE_GREEN_SLOTS = 1;

function roundCredits(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseCredits(value, { min = 1, max = 10000 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { ok: false, message: "Informe uma quantidade numérica de créditos." };
  }

  const rounded = roundCredits(numeric);
  if (rounded < min || rounded > max) {
    return { ok: false, message: `Use uma quantidade entre ${min} e ${max} créditos.` };
  }

  return { ok: true, value: rounded };
}

function calculateCrashPoint(randomUnit, houseEdge) {
  const random = Math.min(Math.max(Number(randomUnit), Number.EPSILON), 1 - Number.EPSILON);
  const edge = Number(houseEdge);

  if (!Number.isFinite(edge) || edge < 0 || edge >= 1) {
    throw new Error("A vantagem da casa do Crash deve estar entre 0 e 1.");
  }

  return Math.max(1, roundCredits((1 - edge) / random));
}

function crashSurvivalProbability(targetMultiplier, houseEdge) {
  const target = Number(targetMultiplier);
  const edge = Number(houseEdge);
  if (!Number.isFinite(target) || target < 1 || !Number.isFinite(edge)) return null;
  return Math.min(1, Math.max(0, (1 - edge) / target));
}

function calculateMinesSurvivalProbability(boardSize, minesCount, safeReveals) {
  let probability = 1;
  const safeTiles = boardSize - minesCount;

  for (let step = 0; step < safeReveals; step += 1) {
    probability *= (safeTiles - step) / (boardSize - step);
  }

  return probability;
}

function calculateMinesMultiplier(boardSize, minesCount, safeReveals, houseEdge) {
  if (safeReveals <= 0) return 1;
  const survival = calculateMinesSurvivalProbability(boardSize, minesCount, safeReveals);
  if (survival <= 0) return 0;
  return roundCredits((1 - Number(houseEdge)) / survival);
}

function calculateNextSafeProbability(boardSize, minesCount, revealedSafeTiles) {
  const remainingTiles = boardSize - revealedSafeTiles;
  const safeRemaining = boardSize - minesCount - revealedSafeTiles;
  if (remainingTiles <= 0 || safeRemaining < 0) return 0;
  return safeRemaining / remainingTiles;
}

function buildMinesBoard(minesCount, randomInt) {
  const positions = Array.from({ length: BOARD_SIZE }, (_, index) => index);
  for (let current = positions.length - 1; current > 0; current -= 1) {
    const swapWith = randomInt(0, current + 1);
    [positions[current], positions[swapWith]] = [positions[swapWith], positions[current]];
  }
  return new Set(positions.slice(0, minesCount));
}

function doubleColorForNumber(number) {
  if (number === 0) return "green";
  if (number >= 1 && number <= DOUBLE_RED_SLOTS) return "red";
  return "black";
}

function doubleProbability(color) {
  if (color === "red") return DOUBLE_RED_SLOTS / DOUBLE_TOTAL_SLOTS;
  if (color === "black") return DOUBLE_BLACK_SLOTS / DOUBLE_TOTAL_SLOTS;
  if (color === "green") return DOUBLE_GREEN_SLOTS / DOUBLE_TOTAL_SLOTS;
  return 0;
}

function doubleExpectedReturn(color, payoutMultiplier) {
  return doubleProbability(color) * Number(payoutMultiplier);
}

module.exports = {
  BOARD_SIZE,
  DOUBLE_TOTAL_SLOTS,
  DOUBLE_RED_SLOTS,
  DOUBLE_BLACK_SLOTS,
  DOUBLE_GREEN_SLOTS,
  roundCredits,
  parseCredits,
  calculateCrashPoint,
  crashSurvivalProbability,
  calculateMinesSurvivalProbability,
  calculateMinesMultiplier,
  calculateNextSafeProbability,
  buildMinesBoard,
  doubleColorForNumber,
  doubleProbability,
  doubleExpectedReturn,
};
