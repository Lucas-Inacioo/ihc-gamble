(() => {
  "use strict";

  const app = document.querySelector("#app");
  const pageTitle = document.querySelector("#page-title");
  const balanceNode = document.querySelector("#wallet-balance");
  const flashNode = document.querySelector("#flash-message");
  const sessionStorageKey = "probabilidade-em-jogo-session";

  let sessionId = localStorage.getItem(sessionStorageKey) || "";
  let state = null;
  let selectedDoubleColor = "red";
  let busy = false;
  let flashTimeout = null;

  const validViews = ["inicio", "double", "mines", "crash", "conceitos"];
  let currentView = validViews.includes(window.location.hash.slice(1))
    ? window.location.hash.slice(1)
    : "inicio";

  const pageNames = {
    inicio: "Probabilidade em Jogo",
    double: "Double",
    mines: "Mines",
    crash: "Crash",
    conceitos: "Conceitos básicos",
  };

  const colorNames = { red: "vermelho", black: "preto", green: "verde" };
  const money = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const percent = new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

  init().catch((error) => {
    showFlash(error.message || "Não foi possível carregar os dados.", true);
  });

  async function init() {
    await refreshState(true);

    setInterval(async () => {
      if (!state || busy) return;
      const crashRunning = ["waiting", "active"].includes(state.games.crash?.status);
      const doubleRunning = state.games.double?.status === "spinning";
      if (!crashRunning && !doubleRunning) return;

      try {
        await refreshState(false);
      } catch {
        // Uma falha temporária não interrompe a rodada que já está em andamento.
      }
    }, 320);
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (sessionId) headers["x-study-session"] = sessionId;

    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("O servidor retornou uma resposta inválida.");
    }

    if (payload.sessionId) {
      sessionId = payload.sessionId;
      localStorage.setItem(sessionStorageKey, sessionId);
    }

    if (!response.ok) throw new Error(payload.error || "A ação não pôde ser concluída.");
    return payload;
  }

  async function refreshState(firstLoad) {
    const payload = firstLoad
      ? await api("/api/session", { method: "POST", body: { sessionId } })
      : await api("/api/state");
    state = payload;
    render();
  }

  function render() {
    if (!state) return;

    balanceNode.textContent = formatCredits(state.wallet.balance);
    pageTitle.textContent = pageNames[currentView];
    document.querySelectorAll("[data-nav]").forEach((node) => {
      node.classList.toggle("active", node.dataset.nav === currentView);
    });

    const view = {
      inicio: renderHome,
      double: renderDouble,
      mines: renderMines,
      crash: renderCrash,
      conceitos: renderConcepts,
    }[currentView];

    app.innerHTML = view();
  }

  function renderHome() {
    const history = state.history || [];
    const used = history.reduce((total, entry) => total + Number(entry.amount || 0), 0);
    const returned = history.reduce((total, entry) => total + Number(entry.payout || 0), 0);
    const observedReturn = used > 0 ? returned / used : null;

    return `
      <section class="hero">
        <span class="pill">Créditos fictícios</span>
        <h2>Explore regras, probabilidades e resultados.</h2>
        <p>Escolha qualquer jogo no menu. Em cada um, você pode usar créditos fictícios, observar o resultado e consultar explicações sobre as regras.</p>
        <div class="pill-row">
          <span class="pill">Sem dinheiro real</span>
          <span class="pill">Saldo temporário</span>
          <span class="pill">Resultados aleatórios</span>
        </div>
      </section>

      <section class="grid three" style="margin-top:18px">
        ${statCard(formatCredits(state.wallet.balance), "Créditos disponíveis", `Saldo inicial: ${formatCredits(state.wallet.initialCredits)}`)}
        ${statCard(String(history.length), "Rodadas concluídas", history.length ? "Os resultados aparecem abaixo." : "Ainda não há resultados.")}
        ${statCard(observedReturn === null ? "—" : percent.format(observedReturn), "Retorno observado", "Pode variar bastante em poucas rodadas.")}
      </section>

      <section class="grid three" style="margin-top:18px">
        ${homeCard("Double", "Escolha vermelho, preto ou verde e observe a distribuição dos resultados.", "double", "Abrir Double")}
        ${homeCard("Mines", "Abra casas em um tabuleiro e veja como a chance muda durante a rodada.", "mines", "Abrir Mines")}
        ${homeCard("Crash", "Escolha uma quantia e decida quando encerrar antes do ponto de parada.", "crash", "Abrir Crash")}
      </section>

      <section class="grid two" style="margin-top:18px">
        <article class="card">
          <p class="eyebrow">COMO LER OS RESULTADOS</p>
          <h2>Uma rodada é só uma rodada</h2>
          <p>Um resultado positivo ou negativo não muda as regras do próximo giro. Para entender uma escolha, compare a chance de acerto, o retorno possível e o que acontece quando a mesma regra é repetida.</p>
          <button type="button" class="secondary-button" data-nav="conceitos">Ver conceitos</button>
        </article>
        <article class="card">
          <p class="eyebrow">ANOTAÇÃO</p>
          <h2>O que observar</h2>
          <ul class="list">
            <li>Qual era a chance do evento?</li>
            <li>Qual foi o multiplicador anunciado?</li>
            <li>O que aconteceu com o saldo após a rodada?</li>
            <li>O resultado confirma ou apenas mostra uma ocorrência?</li>
          </ul>
        </article>
      </section>

      <section class="card" style="margin-top:18px">
        <div class="card-head">
          <div><p class="eyebrow">HISTÓRICO DA SESSÃO</p><h2>Resultados recentes</h2></div>
          <span class="pill">Em memória</span>
        </div>
        ${renderHistory(history)}
      </section>
    `;
  }

  function renderDouble() {
    const game = state.games.double;
    const spinning = game?.status === "spinning";
    const finished = game?.status === "finished";
    const activeNumber = spinning ? animatedNumber() : (game?.resultNumber ?? 0);

    return `
      <section class="grid two">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">REGRAS</p><h2>Double</h2></div><span class="pill">15 posições</span></div>
          <p>O giro escolhe uma posição entre 7 vermelhas, 7 pretas e 1 verde. Escolha uma cor e aguarde o número revelado.</p>
          <div class="callout warning"><strong>Multiplicadores</strong>Vermelho e preto retornam 2,00x quando acertam. Verde retorna 14,00x quando acerta.</div>
          <p class="helper">O resultado de um giro não muda a distribuição do próximo giro.</p>
        </article>
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">ESCOLHA</p><h2>Selecionar cor</h2></div></div>
          <form id="double-form">
            <div class="form-row">
              <label for="double-amount">Créditos fictícios</label>
              <input id="double-amount" type="number" min="1" step="1" value="25" ${spinning ? "disabled" : ""} />
            </div>
            <div class="action-row" role="group" aria-label="Escolha uma cor">
              ${doubleChoice("red", "Vermelho", "2,00x", spinning)}
              ${doubleChoice("black", "Preto", "2,00x", spinning)}
              ${doubleChoice("green", "Verde", "14,00x", spinning)}
            </div>
            <div class="action-row">
              <button class="primary-button" type="submit" ${spinning ? "disabled" : ""}>Girar</button>
            </div>
          </form>
        </article>
      </section>

      <section class="grid two" style="margin-top:18px">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">RESULTADO</p><h2>${spinning ? "Giro em andamento" : finished ? "Resultado revelado" : "Aguardando giro"}</h2></div></div>
          <div class="game-status ${finished && game.won ? "won" : finished && !game.won ? "crashed" : ""}">
            <div>
              <p class="eyebrow">${spinning ? "GIRANDO" : finished ? colorNames[game.resultColor].toUpperCase() : "DOUBLE"}</p>
              <p class="big">${spinning ? "…" : finished ? game.resultNumber : "?"}</p>
              <p class="status-caption">${spinning ? "O número aparece quando o giro termina." : finished ? game.won ? `Retorno: ${formatCredits(game.payout)}.` : "Os créditos usados não retornaram." : "Escolha uma cor para fazer um giro."}</p>
            </div>
          </div>
          <div class="double-track" aria-label="Pista de 15 resultados">
            ${Array.from({ length: 15 }, (_, number) => {
              const color = number === 0 ? "green" : number <= 7 ? "red" : "black";
              const active = number === activeNumber ? "active" : "";
              return `<span class="double-slot ${color} ${active}">${number}</span>`;
            }).join("")}
          </div>
        </article>
        <article class="card">
          <p class="eyebrow">FÓRMULA</p>
          <h2>Retorno esperado</h2>
          <span class="formula">E[retorno] = P(acerto) × multiplicador</span>
          <p style="margin-top:14px">Para vermelho ou preto: 7/15 × 2,00. Para verde: 1/15 × 14,00.</p>
          <p class="helper">A fórmula compara a chance e o multiplicador. O resultado de uma rodada pode ficar acima ou abaixo da média calculada.</p>
          ${finished ? `<p class="proof">Registro: ${game.serverSeedCommitment}<br/>Semente revelada: ${game.serverSeed}</p>` : ""}
        </article>
      </section>
    `;
  }

  function renderMines() {
    const game = state.games.mines;
    const active = game?.status === "active";
    const terminal = game && game.status !== "active";

    const board = game
      ? Array.from({ length: game.boardSize }, (_, index) => {
          const revealed = game.revealedTiles.includes(index);
          const mine = terminal && game.minePositions.includes(index);
          const classes = ["tile", revealed ? "safe" : "", mine ? "mine" : ""].filter(Boolean).join(" ");
          const glyph = mine ? "✹" : revealed ? "✓" : "?";
          return `<button class="${classes}" type="button" data-action="mines-reveal" data-tile="${index}" ${active && !revealed ? "" : "disabled"} aria-label="Casa ${index + 1}">${glyph}</button>`;
        }).join("")
      : Array.from({ length: 25 }, (_, index) => `<button class="tile" type="button" disabled aria-label="Casa ${index + 1}">?</button>`).join("");

    const readout = active
      ? `<p>Com ${game.minesCount} minas e ${game.revealedTiles.length} casa(s) segura(s) aberta(s), a chance da próxima casa ser segura é <strong>${percent.format(game.safeProbabilityNext)}</strong>.</p><div class="meter"><span style="width:${Math.max(0, Math.min(100, game.safeProbabilityNext * 100))}%"></span></div>`
      : game
        ? `<p>A rodada foi encerrada com retorno de <strong>${formatCredits(game.payout)}</strong>. As minas são exibidas no tabuleiro.</p>`
        : `<p>Crie um tabuleiro para ver a probabilidade da próxima casa.</p>`;

    return `
      <section class="grid two">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">REGRAS</p><h2>Mines</h2></div><span class="pill">25 casas</span></div>
          <p>Escolha quantas minas ficam escondidas. Cada casa segura aumenta o multiplicador da rodada; abrir uma mina encerra a rodada sem retorno.</p>
          <div class="callout warning"><strong>Escolhas sem reposição</strong>Depois de uma casa segura, o tabuleiro passa a ter menos casas disponíveis e menos casas seguras. Por isso, a chance muda ao longo da rodada.</div>
        </article>
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Criar tabuleiro</h2></div></div>
          <form id="mines-form">
            <div class="form-grid">
              <div class="form-row">
                <label for="mines-amount">Créditos fictícios</label>
                <input id="mines-amount" type="number" min="1" step="1" value="25" ${active ? "disabled" : ""} />
              </div>
              <div class="form-row">
                <label for="mines-count">Minas ocultas</label>
                <select id="mines-count" ${active ? "disabled" : ""}>
                  ${Array.from({ length: 12 }, (_, index) => index + 1).map((count) => `<option value="${count}" ${game?.minesCount === count || (!game && count === 5) ? "selected" : ""}>${count}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="action-row">
              <button class="primary-button" type="submit" ${active ? "disabled" : ""}>Criar tabuleiro</button>
              <button class="secondary-button" type="button" data-action="mines-cashout" ${active && game.revealedTiles.length > 0 ? "" : "disabled"}>Encerrar</button>
            </div>
          </form>
          ${game ? `<div class="grid two" style="margin-top:17px"><div><span class="stat-label">Casas seguras abertas</span><p class="stat-value">${game.revealedTiles.length}</p></div><div><span class="stat-label">Multiplicador atual</span><p class="stat-value">${formatMultiplier(game.payoutMultiplier)}</p></div></div>` : ""}
        </article>
      </section>

      <section class="grid two" style="margin-top:18px">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">TABULEIRO</p><h2>${game ? game.status === "lost" ? "Uma mina foi revelada" : game.status === "cashed_out" ? "Rodada encerrada" : "Escolha uma casa" : "Aguardando configuração"}</h2></div><span class="pill">${game ? `${game.minesCount} minas` : "25 casas"}</span></div>
          <div class="board">${board}</div>
        </article>
        <article class="card">
          <p class="eyebrow">LEITURA DA RODADA</p>
          <h2>Probabilidade condicional</h2>
          <span class="formula">P(próxima segura) = casas seguras restantes / casas restantes</span>
          <div class="reading-panel">${readout}</div>
        </article>
      </section>
    `;
  }

  function renderCrash() {
    const game = state.games.crash;
    const running = game && ["waiting", "active"].includes(game.status);
    const terminal = game && ["crashed", "cashed_out"].includes(game.status);

    const status = !game
      ? `<div class="game-status"><div><p class="eyebrow">AGUARDANDO</p><p class="big">1,00x</p><p class="status-caption">Crie uma rodada para ver o multiplicador.</p></div></div>`
      : game.status === "waiting"
        ? `<div class="game-status"><div><p class="eyebrow">PREPARANDO</p><p class="big">1,00x</p><p class="status-caption">A rodada começa em instantes.</p></div></div>`
        : game.status === "active"
          ? `<div class="game-status"><div><p class="eyebrow">MULTIPLICADOR ATUAL</p><p class="big">${formatMultiplier(game.currentMultiplier)}</p><p class="status-caption">Encerrar agora devolve créditos de acordo com o multiplicador atual.</p></div></div>`
          : game.status === "cashed_out"
            ? `<div class="game-status won"><div><p class="eyebrow">ENCERRADO</p><p class="big">${formatMultiplier(game.payoutMultiplier)}</p><p class="status-caption">Retorno: ${formatCredits(game.payout)}.</p></div></div>`
            : `<div class="game-status crashed"><div><p class="eyebrow">PONTO DE PARADA</p><p class="big">${formatMultiplier(game.crashPoint)}</p><p class="status-caption">Os créditos usados não retornaram.</p></div></div>`;

    return `
      <section class="grid two">
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">REGRAS</p><h2>Crash</h2></div><span class="pill">Multiplicador em movimento</span></div>
          <p>O multiplicador cresce depois do início da rodada e para em um ponto oculto. Quem encerra antes recebe créditos de acordo com o valor exibido; quem espera até depois do ponto de parada não recebe retorno.</p>
          <div class="callout warning"><strong>Alvo maior</strong>Um multiplicador maior pode gerar retorno maior em uma rodada, mas também é mais difícil de alcançar.</div>
        </article>
        <article class="card">
          <div class="card-head"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Iniciar rodada</h2></div></div>
          <form id="crash-form">
            <div class="form-grid">
              <div class="form-row">
                <label for="crash-amount">Créditos fictícios</label>
                <input id="crash-amount" type="number" min="1" step="1" value="25" ${running ? "disabled" : ""} />
              </div>
              <div class="form-row">
                <label for="crash-auto">Encerramento automático (opcional)</label>
                <input id="crash-auto" type="number" min="1.01" max="100" step="0.01" placeholder="Ex.: 2,00" ${running ? "disabled" : ""} />
              </div>
            </div>
            <div class="action-row">
              <button class="primary-button" type="submit" ${running ? "disabled" : ""}>Criar rodada</button>
              <button class="danger-button" type="button" data-action="crash-cashout" ${game?.status === "active" ? "" : "disabled"}>Encerrar agora</button>
            </div>
          </form>
          ${game?.autoCashOut ? `<p class="helper" style="margin-top:14px">Alvo automático configurado: ${formatMultiplier(game.autoCashOut)}. Chance aproximada de alcançar esse alvo: <strong>${percent.format(game.chanceToReachAutoCashOut)}</strong>.</p>` : ""}
        </article>
      </section>

      <section class="grid two" style="margin-top:18px">
        <article class="card">${status}</article>
        <article class="card">
          <p class="eyebrow">FÓRMULA</p>
          <h2>Chance aproximada</h2>
          <span class="formula">P(chegar a m) ≈ (1 − vantagem) / m</span>
          <p style="margin-top:14px">Quando o alvo aumenta, o denominador também aumenta. Por isso, a chance de alcançar o valor diminui.</p>
          ${terminal ? `<p class="proof">Registro: ${game.serverSeedCommitment}<br/>Semente revelada: ${game.serverSeed}</p>` : ""}
        </article>
      </section>
    `;
  }

  function renderConcepts() {
    return `
      <section class="card">
        <p class="eyebrow">REFERÊNCIAS RÁPIDAS</p>
        <h2>Conceitos básicos</h2>
        <p class="subtle">Estas ideias ajudam a comparar resultados observados com a regra matemática de cada jogo.</p>
      </section>

      <section class="concepts" style="margin-top:18px">
        ${concept("P", "Probabilidade", "Uma medida de quão provável é um evento. Em um modelo simples, pode ser calculada por casos favoráveis divididos por casos possíveis.")}
        ${concept("f", "Frequência observada", "A proporção medida depois de algumas tentativas. Em uma sequência curta, ela pode ficar longe da probabilidade teórica.")}
        ${concept("E", "Valor esperado", "A média ponderada dos resultados possíveis. Um retorno esperado menor que 1 indica que, em média, volta menos crédito do que foi usado.")}
        ${concept("σ", "Variabilidade", "Resultados diferentes podem aparecer mesmo quando a regra permanece igual. Isso dificulta tirar conclusões apenas olhando poucas rodadas.")}
        ${concept("⊥", "Independência", "Quando eventos são independentes, o resultado anterior não altera a chance da próxima tentativa.")}
        ${concept("→", "Probabilidade condicional", "A chance pode mudar quando novas informações alteram as quantidades restantes, como no tabuleiro de Mines.")}
        ${concept("LLN", "Lei dos grandes números", "Ao repetir uma regra muitas vezes, a frequência observada tende a se aproximar do comportamento previsto pelo modelo.")}
        ${concept("−", "Vantagem da casa", "Quando o retorno oferecido fica abaixo do retorno justo, o valor esperado é reduzido em muitas repetições.")}
      </section>

      <section class="grid two" style="margin-top:18px">
        <article class="card">
          <p class="eyebrow">CALCULADORA</p>
          <h2>Valor esperado simples</h2>
          <p class="helper">Informe a chance de acerto e o multiplicador que inclui o valor inicialmente usado.</p>
          <form id="ev-form">
            <div class="form-grid">
              <div class="form-row"><label for="ev-probability">Chance de acerto (%)</label><input id="ev-probability" type="number" min="0" max="100" step="0.01" value="46.67" /></div>
              <div class="form-row"><label for="ev-multiplier">Multiplicador recebido</label><input id="ev-multiplier" type="number" min="0" step="0.01" value="2" /></div>
            </div>
            <div class="action-row"><button class="primary-button" type="submit">Calcular</button></div>
          </form>
          <div id="ev-result" class="calculator-result"><span class="stat-label">Retorno esperado</span><strong>Preencha ou recalcule os valores.</strong></div>
        </article>
        <article class="card">
          <p class="eyebrow">PERGUNTAS</p>
          <h2>Para comparar resultados</h2>
          <ul class="list">
            <li>Qual é a probabilidade teórica do evento?</li>
            <li>O multiplicador compensa a chance de acerto?</li>
            <li>Uma sequência curta basta para entender a regra?</li>
            <li>O resultado passado altera uma nova rodada?</li>
          </ul>
        </article>
      </section>
    `;
  }

  function homeCard(title, text, view, action) {
    return `<article class="card home-card"><p class="eyebrow">JOGO</p><h2>${title}</h2><p>${text}</p><button type="button" class="secondary-button" data-nav="${view}">${action}</button></article>`;
  }

  function statCard(value, label, note) {
    return `<article class="card tight"><p class="stat-value">${value}</p><p class="stat-label">${label}</p><p class="stat-note">${note}</p></article>`;
  }

  function doubleChoice(color, label, payout, disabled) {
    const selected = selectedDoubleColor === color ? "selected" : "";
    return `<button class="choice-button ${color} ${selected}" type="button" data-action="select-double" data-color="${color}" ${disabled ? "disabled" : ""}>${label}<br /><small>${payout}</small></button>`;
  }

  function concept(symbol, title, text) {
    return `<article class="concept-card"><div class="symbol">${symbol}</div><h3>${title}</h3><p class="subtle">${text}</p></article>`;
  }

  function renderHistory(history) {
    if (!history.length) {
      return `<div class="empty">Nenhuma rodada foi concluída nesta sessão.</div>`;
    }

    return `<div class="history-list">${history.map((entry) => {
      const delta = Number(entry.delta || 0);
      return `<div class="history-item"><div><strong>${entry.game}</strong><small>${formatDate(entry.at)}</small></div><div><span>${entry.outcome}</span><small>${entry.detail}</small></div><div class="delta ${delta >= 0 ? "positive" : "negative"}">${delta >= 0 ? "+" : ""}${formatCredits(delta)}</div></div>`;
    }).join("")}</div>`;
  }

  document.addEventListener("click", async (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      currentView = nav.dataset.nav;
      history.replaceState(null, "", `#${currentView}`);
      render();
      return;
    }

    const actionNode = event.target.closest("[data-action]");
    if (!actionNode || actionNode.disabled) return;

    const action = actionNode.dataset.action;
    if (action === "select-double") {
      selectedDoubleColor = actionNode.dataset.color;
      render();
      return;
    }

    try {
      busy = true;
      let payload;
      if (action === "reset-wallet") {
        if (!confirm("Reiniciar o saldo e o histórico desta sessão?")) return;
        payload = await api("/api/wallet/reset", { method: "POST", body: {} });
      }
      if (action === "crash-cashout") {
        payload = await api("/api/crash/cashout", { method: "POST", body: {} });
      }
      if (action === "mines-cashout") {
        payload = await api("/api/mines/cashout", { method: "POST", body: {} });
      }
      if (action === "mines-reveal") {
        payload = await api("/api/mines/reveal", { method: "POST", body: { tileIndex: Number(actionNode.dataset.tile) } });
      }

      if (payload) {
        state = payload;
        showFlash(payload.message);
        render();
      }
    } catch (error) {
      showFlash(error.message || "A ação falhou.", true);
    } finally {
      busy = false;
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.matches("#double-form, #mines-form, #crash-form, #ev-form")) return;
    event.preventDefault();

    if (form.matches("#ev-form")) {
      const chance = Number(document.querySelector("#ev-probability").value) / 100;
      const multiplier = Number(document.querySelector("#ev-multiplier").value);
      const result = document.querySelector("#ev-result");
      if (!Number.isFinite(chance) || !Number.isFinite(multiplier) || chance < 0 || chance > 1 || multiplier < 0) {
        result.innerHTML = `<span class="stat-label">Retorno esperado</span><strong>Informe valores válidos.</strong>`;
        return;
      }

      const expected = chance * multiplier;
      result.innerHTML = `<span class="stat-label">Retorno esperado</span><strong>${percent.format(expected)} do crédito usado</strong><p class="helper" style="margin:5px 0 0">${percent.format(chance)} × ${multiplier.toFixed(2).replace(".", ",")} = ${expected.toFixed(4).replace(".", ",")}</p>`;
      return;
    }

    try {
      busy = true;
      let payload;
      if (form.matches("#double-form")) {
        payload = await api("/api/double/start", {
          method: "POST",
          body: {
            amount: Number(document.querySelector("#double-amount").value),
            selectedColor: selectedDoubleColor,
          },
        });
      }
      if (form.matches("#mines-form")) {
        payload = await api("/api/mines/start", {
          method: "POST",
          body: {
            amount: Number(document.querySelector("#mines-amount").value),
            minesCount: Number(document.querySelector("#mines-count").value),
          },
        });
      }
      if (form.matches("#crash-form")) {
        const rawAuto = document.querySelector("#crash-auto").value.trim();
        payload = await api("/api/crash/start", {
          method: "POST",
          body: {
            amount: Number(document.querySelector("#crash-amount").value),
            autoCashOut: rawAuto ? Number(rawAuto.replace(",", ".")) : null,
          },
        });
      }

      state = payload;
      showFlash(payload.message);
      render();
    } catch (error) {
      showFlash(error.message || "A ação falhou.", true);
    } finally {
      busy = false;
    }
  });

  function formatCredits(value) {
    return `C$ ${money.format(Number(value || 0))}`;
  }

  function formatMultiplier(value) {
    return `${Number(value || 0).toFixed(2).replace(".", ",")}x`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  }

  function animatedNumber() {
    return Math.floor(Date.now() / 90) % 15;
  }

  function showFlash(message, isError = false) {
    flashNode.hidden = false;
    flashNode.textContent = message;
    flashNode.classList.toggle("error", isError);
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
      flashNode.hidden = true;
    }, 5000);
  }
})();
