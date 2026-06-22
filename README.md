# Probabilidade em Jogo

Aplicação web com três jogos de créditos fictícios: Double, Mines e Crash. Ela funciona como uma única aplicação Node.js/Express e pode ser executada localmente ou publicada como Web Service no Render.

Todos os valores usam `C$` como créditos fictícios. Não há pagamentos, depósitos, saques, prêmios nem conversão em dinheiro real.

## Executar localmente

Pré-requisito: Node.js 20.19 ou superior.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador.

Para desenvolvimento:

```bash
npm run dev
```

Para executar os testes das fórmulas:

```bash
npm test
```

## Publicar no Render

O arquivo `render.yaml` já está incluído. Também é possível criar um Web Service manualmente com:

```text
Build Command: npm ci
Start Command: npm start
Health Check Path: /api/health
```

## Regras usadas

- **Double:** 7 posições vermelhas, 7 pretas e 1 verde. Vermelho/preto pagam 2,00x e verde paga 14,00x.
- **Mines:** tabuleiro com 25 casas. Uma mina encerra a rodada; casas seguras aumentam o multiplicador.
- **Crash:** multiplicador cresce até um ponto de parada oculto; o encerramento precisa ocorrer antes desse ponto.

O saldo e o histórico existem apenas na memória do servidor e são apagados quando o processo é reiniciado.
