"use strict";

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const {
  BOARD_SIZE,
  DOUBLE_TOTAL_SLOTS,
  roundCredits,
  parseCredits,
  calculateCrashPoint,
  crashSurvivalProbability,
  calculateMinesMultiplier,
  calculateNextSafeProbability,
  buildMinesBoard,
  doubleColorForNumber,
  doubleProbability,
  doubleExpectedReturn,
} = require("./lib/game-engine");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const INITIAL_CREDITS = positiveNumber(process.env.INITIAL_CREDITS, 1000);
const CRASH_HOUSE_EDGE = boundedNumber(process.env.CRASH_HOUSE_EDGE, 0.04, 0, 0.25);
const MINES_HOUSE_EDGE = boundedNumber(process.env.MINES_HOUSE_EDGE, 0.03, 0, 0.25);
const DOUBLE_PAYOUT_COLOR = positiveNumber(process.env.DOUBLE_PAYOUT_COLOR, 2);
const DOUBLE_PAYOUT_GREEN = positiveNumber(process.env.DOUBLE_PAYOUT_GREEN, 14);
const CRASH_GROWTH_PER_MS = 0.00019;
const CRASH_COUNTDOWN_MS = 1500;
const DOUBLE_SPIN_MS = 1600;
const sessions = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "probabilidade-em-jogo",
    storage: "memória temporária",
    now: new Date().toISOString(),
  });
});

app.post("/api/session", (req, res) => {
  const { session, sessionId } = getSession(req);
  res.json(buildState(session, sessionId));
});

app.get("/api/state", (req, res) => {
  const { session, sessionId } = getSession(req);
  res.json(buildState(session, sessionId));
});

app.post("/api/wallet/reset", (req, res) => {
  const { session, sessionId } = getSession(req);
  refreshAllGames(session);

  if (hasActiveGame(session)) {
    return sendError(res, 409, "Finalize a simulação em andamento antes de reiniciar os créditos.");
  }

  session.balance = INITIAL_CREDITS;
  session.history = [];
  session.crash = null;
  session.mines = null;
  session.double = null;
  return res.json({
    message: `Créditos didáticos reiniciados para C$ ${formatCredits(INITIAL_CREDITS)}.`,
    ...buildState(session, sessionId),
  });
});

app.post("/api/crash/start", (req, res) => {
  const { session, sessionId } = getSession(req);
  refreshAllGames(session);

  if (hasActiveGame(session)) {
    return sendError(res, 409, "Finalize a simulação em andamento antes de iniciar outra.");
  }

  const amountResult = parseCredits(req.body?.amount);
  if (!amountResult.ok) return sendError(res, 400, amountResult.message);

  const autoResult = parseAutoCashout(req.body?.autoCashOut);
  if (!autoResult.ok) return sendError(res, 400, autoResult.message);

  if (!canAfford(session, amountResult.value)) {
    return sendError(res, 400, "Você não possui créditos didáticos suficientes para essa simulação.");
  }

  debit(session, amountResult.value);
  session.crash = createCrashRound(amountResult.value, autoResult.value);

  return res.status(201).json({
    message: "Rodada criada. O ponto de parada permanece oculto até a conclusão.",
    ...buildState(session, sessionId),
  });
});

app.post("/api/crash/cashout", (req, res) => {
  const { session, sessionId } = getSession(req);
  refreshCrashRound(session);

  if (!session.crash || session.crash.status !== "active") {
    return sendError(res, 409, "Não há uma rodada de Crash ativa para encerrar agora.");
  }

  settleCrashCashout(session, session.crash, currentCrashMultiplier(session.crash), "manual");
  return res.json({
    message: "Simulação encerrada antes do ponto de parada.",
    ...buildState(session, sessionId),
  });
});

app.post("/api/mines/start", (req, res) => {
  const { session, sessionId } = getSession(req);
  refreshAllGames(session);

  if (hasActiveGame(session)) {
    return sendError(res, 409, "Finalize a simulação em andamento antes de iniciar outra.");
  }

  const amountResult = parseCredits(req.body?.amount);
  if (!amountResult.ok) return sendError(res, 400, amountResult.message);

  const minesCount = Number(req.body?.minesCount);
  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount > 24) {
    return sendError(res, 400, "Escolha entre 1 e 24 minas no tabuleiro.");
  }

  if (!canAfford(session, amountResult.value)) {
    return sendError(res, 400, "Você não possui créditos didáticos suficientes para essa simulação.");
  }

  debit(session, amountResult.value);
  session.mines = {
    id: crypto.randomUUID(),
    status: "active",
    amount: amountResult.value,
    minesCount,
    minePositions: buildMinesBoard(minesCount, crypto.randomInt),
    revealedTiles: new Set(),
    payoutMultiplier: 1,
    payout: 0,
    createdAt: Date.now(),
    settledAt: null,
  };

  return res.status(201).json({
    message: "Tabuleiro criado. Cada casa segura altera a probabilidade da próxima escolha.",
    ...buildState(session, sessionId),
  });
});

app.post("/api/mines/reveal", (req, res) => {
  const { session, sessionId } = getSession(req);
  const game = session.mines;
  const tileIndex = Number(req.body?.tileIndex);

  if (!game || game.status !== "active") {
    return sendError(res, 409, "Inicie uma partida de Mines antes de abrir uma casa.");
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= BOARD_SIZE) {
    return sendError(res, 400, "Casa inválida.");
  }
  if (game.revealedTiles.has(tileIndex)) {
    return sendError(res, 400, "Essa casa já foi aberta.");
  }

  if (game.minePositions.has(tileIndex)) {
    game.status = "lost";
    game.payout = 0;
    game.settledAt = Date.now();
    addHistory(session, {
      game: "Mines",
      outcome: "Perdeu ao abrir uma mina",
      amount: game.amount,
      payout: 0,
      delta: -game.amount,
      detail: `${game.minesCount} minas; ${game.revealedTiles.size} casas seguras abertas.`,
    });
    return res.json({
      message: "Você abriu uma mina. Nesta simulação, todos os créditos usados nesta rodada foram perdidos.",
      ...buildState(session, sessionId),
    });
  }

  game.revealedTiles.add(tileIndex);
  game.payoutMultiplier = calculateMinesMultiplier(
    BOARD_SIZE,
    game.minesCount,
    game.revealedTiles.size,
    MINES_HOUSE_EDGE
  );

  const safeTiles = BOARD_SIZE - game.minesCount;
  if (game.revealedTiles.size === safeTiles) {
    settleMinesCashout(session, game, "tabuleiro completo");
    return res.json({
      message: "Todas as casas seguras foram abertas. O retorno foi calculado automaticamente.",
      ...buildState(session, sessionId),
    });
  }

  return res.json({
    message: "Casa segura. Você pode continuar ou encerrar a simulação com o multiplicador atual.",
    ...buildState(session, sessionId),
  });
});

app.post("/api/mines/cashout", (req, res) => {
  const { session, sessionId } = getSession(req);
  const game = session.mines;

  if (!game || game.status !== "active") {
    return sendError(res, 409, "Não há uma partida de Mines ativa para encerrar.");
  }
  if (game.revealedTiles.size === 0) {
    return sendError(res, 400, "Abra ao menos uma casa segura antes de encerrar a simulação.");
  }

  settleMinesCashout(session, game, "encerramento manual");
  return res.json({
    message: "Simulação de Mines encerrada com o multiplicador atual.",
    ...buildState(session, sessionId),
  });
});

app.post("/api/double/start", (req, res) => {
  const { session, sessionId } = getSession(req);
  refreshAllGames(session);

  if (hasActiveGame(session)) {
    return sendError(res, 409, "Finalize a simulação em andamento antes de iniciar outra.");
  }

  const amountResult = parseCredits(req.body?.amount);
  if (!amountResult.ok) return sendError(res, 400, amountResult.message);

  const selectedColor = String(req.body?.selectedColor || "").toLowerCase();
  if (!["red", "black", "green"].includes(selectedColor)) {
    return sendError(res, 400, "Escolha vermelho, preto ou verde.");
  }

  if (!canAfford(session, amountResult.value)) {
    return sendError(res, 400, "Você não possui créditos didáticos suficientes para essa simulação.");
  }

  debit(session, amountResult.value);
  const resultNumber = crypto.randomInt(0, DOUBLE_TOTAL_SLOTS);
  const resultColor = doubleColorForNumber(resultNumber);
  const payoutMultiplier = selectedColor === "green" ? DOUBLE_PAYOUT_GREEN : DOUBLE_PAYOUT_COLOR;
  const serverSeed = crypto.randomBytes(32).toString("hex");

  session.double = {
    id: crypto.randomUUID(),
    status: "spinning",
    amount: amountResult.value,
    selectedColor,
    resultNumber,
    resultColor,
    payoutMultiplier,
    won: null,
    payout: 0,
    startedAt: Date.now(),
    resolvesAt: Date.now() + DOUBLE_SPIN_MS,
    serverSeed,
    serverSeedCommitment: sha256(serverSeed),
    settledAt: null,
  };

  return res.status(201).json({
    message: "Giro iniciado. O resultado só será exibido ao final da animação didática.",
    ...buildState(session, sessionId),
  });
});

app.use("/api", (_req, res) => {
  sendError(res, 404, "Rota da API não encontrada.");
});

app.use((error, _req, res, _next) => {
  console.error("Erro não tratado:", error);
  sendError(res, 500, "Ocorreu um erro inesperado na simulação.");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Laboratório de Probabilidade disponível na porta ${PORT}.`);
  console.log("Créditos são fictícios e mantidos apenas em memória.");
});

function positiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) return fallback;
  return numeric;
}

function getSession(req) {
  const inputId = req.get("x-study-session") || req.body?.sessionId;
  const sessionId = typeof inputId === "string" && inputId.length <= 120 && inputId.trim()
    ? inputId.trim()
    : crypto.randomUUID();

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSession());
  }

  return { session: sessions.get(sessionId), sessionId };
}

function createSession() {
  return {
    balance: INITIAL_CREDITS,
    createdAt: Date.now(),
    crash: null,
    mines: null,
    double: null,
    history: [],
  };
}

function buildState(session, sessionId) {
  refreshAllGames(session);
  return {
    sessionId,
    wallet: {
      balance: roundCredits(session.balance),
      initialCredits: INITIAL_CREDITS,
      currency: "C$",
      label: "créditos didáticos fictícios",
    },
    games: {
      crash: publicCrashState(session.crash),
      mines: publicMinesState(session.mines),
      double: publicDoubleState(session.double),
    },
    history: session.history.slice(0, 16),
    concepts: {
      crashHouseEdge: CRASH_HOUSE_EDGE,
      minesHouseEdge: MINES_HOUSE_EDGE,
      double: {
        redBlackProbability: doubleProbability("red"),
        greenProbability: doubleProbability("green"),
        redBlackPayout: DOUBLE_PAYOUT_COLOR,
        greenPayout: DOUBLE_PAYOUT_GREEN,
        redBlackExpectedReturn: doubleExpectedReturn("red", DOUBLE_PAYOUT_COLOR),
        greenExpectedReturn: doubleExpectedReturn("green", DOUBLE_PAYOUT_GREEN),
      },
    },
  };
}

function refreshAllGames(session) {
  refreshCrashRound(session);
  refreshDoubleRound(session);
}

function hasActiveGame(session) {
  return isCrashActive(session.crash) || session.mines?.status === "active" || session.double?.status === "spinning";
}

function isCrashActive(round) {
  return round && (round.status === "waiting" || round.status === "active");
}

function canAfford(session, amount) {
  return session.balance >= amount;
}

function debit(session, amount) {
  session.balance = roundCredits(session.balance - amount);
}

function credit(session, amount) {
  session.balance = roundCredits(session.balance + amount);
}

function createCrashRound(amount, autoCashOut) {
  const serverSeed = crypto.randomBytes(32).toString("hex");
  const publicSeed = crypto.randomUUID();
  const startsAt = Date.now() + CRASH_COUNTDOWN_MS;
  const crashPoint = calculateCrashPoint(randomUnit(), CRASH_HOUSE_EDGE);

  return {
    id: crypto.randomUUID(),
    status: "waiting",
    amount,
    autoCashOut,
    startsAt,
    crashPoint,
    crashAt: startsAt + Math.log(Math.max(1, crashPoint)) / CRASH_GROWTH_PER_MS,
    currentMultiplier: 1,
    payoutMultiplier: 0,
    payout: 0,
    source: null,
    serverSeed,
    publicSeed,
    serverSeedCommitment: sha256(serverSeed),
    settledAt: null,
  };
}

function refreshCrashRound(session) {
  const round = session.crash;
  if (!round || !isCrashActive(round)) return;

  const now = Date.now();
  if (round.status === "waiting" && now >= round.startsAt) {
    round.status = "active";
  }

  if (round.status !== "active") return;

  const multiplier = currentCrashMultiplier(round);
  round.currentMultiplier = multiplier;

  if (round.autoCashOut && round.autoCashOut < round.crashPoint && multiplier >= round.autoCashOut) {
    settleCrashCashout(session, round, round.autoCashOut, "automático");
    return;
  }

  if (now >= round.crashAt || multiplier >= round.crashPoint) {
    round.status = "crashed";
    round.currentMultiplier = round.crashPoint;
    round.payoutMultiplier = 0;
    round.payout = 0;
    round.settledAt = now;
    addHistory(session, {
      game: "Crash",
      outcome: `Parou em ${formatMultiplier(round.crashPoint)}x`,
      amount: round.amount,
      payout: 0,
      delta: -round.amount,
      detail: "O encerramento não ocorreu antes do ponto de parada.",
    });
  }
}

function currentCrashMultiplier(round) {
  if (Date.now() < round.startsAt) return 1;
  return Math.max(1, roundCredits(Math.exp((Date.now() - round.startsAt) * CRASH_GROWTH_PER_MS)));
}

function settleCrashCashout(session, round, multiplier, source) {
  const settledMultiplier = roundCredits(Math.min(multiplier, round.crashPoint));
  const payout = roundCredits(round.amount * settledMultiplier);
  credit(session, payout);

  round.status = "cashed_out";
  round.currentMultiplier = settledMultiplier;
  round.payoutMultiplier = settledMultiplier;
  round.payout = payout;
  round.source = source;
  round.settledAt = Date.now();

  addHistory(session, {
    game: "Crash",
    outcome: `Encerrado em ${formatMultiplier(settledMultiplier)}x`,
    amount: round.amount,
    payout,
    delta: roundCredits(payout - round.amount),
    detail: `Encerramento ${source}.`,
  });
}

function publicCrashState(round) {
  if (!round) return null;
  const active = isCrashActive(round);
  const target = round.autoCashOut || 2;

  return {
    id: round.id,
    status: round.status,
    amount: round.amount,
    autoCashOut: round.autoCashOut,
    startsAt: round.startsAt,
    currentMultiplier: active ? currentCrashMultiplier(round) : round.currentMultiplier,
    payoutMultiplier: round.payoutMultiplier,
    payout: round.payout,
    source: round.source,
    serverSeedCommitment: round.serverSeedCommitment,
    chanceToReachAutoCashOut: round.autoCashOut
      ? crashSurvivalProbability(round.autoCashOut, CRASH_HOUSE_EDGE)
      : null,
    crashPoint: active ? null : round.crashPoint,
    serverSeed: active ? null : round.serverSeed,
    publicSeed: active ? null : round.publicSeed,
  };
}

function settleMinesCashout(session, game, source) {
  const payout = roundCredits(game.amount * game.payoutMultiplier);
  credit(session, payout);
  game.status = "cashed_out";
  game.payout = payout;
  game.settledAt = Date.now();

  addHistory(session, {
    game: "Mines",
    outcome: `Encerrado em ${formatMultiplier(game.payoutMultiplier)}x`,
    amount: game.amount,
    payout,
    delta: roundCredits(payout - game.amount),
    detail: `${game.revealedTiles.size} casas seguras; ${source}.`,
  });
}

function publicMinesState(game) {
  if (!game) return null;
  const terminal = game.status !== "active";
  const revealedCount = game.revealedTiles.size;
  const safeProbabilityNext = game.status === "active"
    ? calculateNextSafeProbability(BOARD_SIZE, game.minesCount, revealedCount)
    : null;

  return {
    id: game.id,
    status: game.status,
    amount: game.amount,
    minesCount: game.minesCount,
    boardSize: BOARD_SIZE,
    revealedTiles: Array.from(game.revealedTiles),
    minePositions: terminal ? Array.from(game.minePositions) : [],
    payoutMultiplier: game.payoutMultiplier,
    payout: game.payout,
    safeProbabilityNext,
    source: terminal && game.status === "cashed_out" ? "encerrada" : null,
  };
}

function refreshDoubleRound(session) {
  const round = session.double;
  if (!round || round.status !== "spinning" || Date.now() < round.resolvesAt) return;

  round.won = round.selectedColor === round.resultColor;
  round.payout = round.won ? roundCredits(round.amount * round.payoutMultiplier) : 0;
  round.status = "finished";
  round.settledAt = Date.now();

  if (round.won) credit(session, round.payout);

  addHistory(session, {
    game: "Double",
    outcome: round.won ? `Acertou ${translateColor(round.resultColor)}` : `Resultado: ${translateColor(round.resultColor)}`,
    amount: round.amount,
    payout: round.payout,
    delta: roundCredits(round.payout - round.amount),
    detail: `Número ${round.resultNumber}; escolha: ${translateColor(round.selectedColor)}.`,
  });
}

function publicDoubleState(round) {
  if (!round) return null;
  const spinning = round.status === "spinning";
  return {
    id: round.id,
    status: round.status,
    amount: round.amount,
    selectedColor: round.selectedColor,
    resultNumber: spinning ? null : round.resultNumber,
    resultColor: spinning ? null : round.resultColor,
    payoutMultiplier: round.payoutMultiplier,
    payout: round.payout,
    won: spinning ? null : round.won,
    serverSeedCommitment: round.serverSeedCommitment,
    serverSeed: spinning ? null : round.serverSeed,
    resolvesAt: round.resolvesAt,
  };
}

function parseAutoCashout(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1.01 || numeric > 100) {
    return { ok: false, message: "O encerramento automático deve estar entre 1,01x e 100,00x." };
  }
  return { ok: true, value: roundCredits(numeric) };
}

function addHistory(session, entry) {
  session.history.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...entry,
  });
  session.history = session.history.slice(0, 30);
}

function randomUnit() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatMultiplier(value) {
  return Number(value).toFixed(2);
}

function formatCredits(value) {
  return Number(value).toFixed(2).replace(".", ",");
}

function translateColor(color) {
  return ({ red: "vermelho", black: "preto", green: "verde" })[color] || color;
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}
