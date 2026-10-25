# Relatório de validação final (25/10/2026)

Validação feita sobre o build de produção do branch `ccr-608f1db2-cqo9at`, num contêiner Linux de
4 núcleos **sem GPU**: o Chromium renderiza por software (SwiftShader). Por isso os testes de
navegador são lentos, e os números de quadros por segundo daqui **não** representam um celular
ou PC com placa de vídeo.

## Resultados

| Suíte | Comando | Resultado |
|---|---|---|
| Unitários e integração (Vitest) | `npm test` | **257/257** |
| Tipos (jogo, configs e servidor) | `npm run typecheck` | sem erros |
| Ponta a ponta: jogo | `node tests/e2e/run.mjs` | **42/42** |
| Ponta a ponta: combate e ferramentas | `node tests/e2e/combat.mjs` | **21/21** |
| Ponta a ponta: multijogador (2 navegadores) | `node tests/e2e/coop.mjs` | **14/14**, em três rodadas seguidas |
| Servidor com sockets reais | `npx vitest run tests/net-server.test.ts` | 10/10 (incluído nos 257) |
| Carga do servidor | `npm run test:load` | veja abaixo |
| Desempenho no navegador | `node tests/perf/bench.mjs` | veja abaixo |

A suíte `run.mjs` falhava em 3 itens (domesticação, dados preservados na importação e aviso da
cópia de segurança). A mesma falha aparecia na versão anterior a esta rodada (`798b5c4`),
então não era regressão. A causa estava no teste:
- **Domesticação:** o primeiro protocerátops do mundo gera modelo, texturas e shaders na hora,
  e por software esse quadro levou cerca de 27 s, mais que os 20 s de espera do teste.
- **Importação:** a checagem do animal domesticado falhava em cadeia, por depender da
  domesticação.
- **Cópia de segurança:** o teste lia as notificações uma única vez, antes de o aviso
  aparecer.

As esperas foram ajustadas e a suíte passa inteira.

### Carga do servidor multijogador (medido)
Condições:
- clientes e servidor no mesmo contêiner;
- 8 jogadores por sala, posição a 10 Hz;
- quem hospeda manda 120 animais a 5 Hz;
- 30 s por rodada.

| Jogadores | Mensagens/s | Latência p50 / p95 / p99 | CPU do servidor | Memória máx. | Erros |
|---|---|---|---|---|---|
| 200 | 3065 | 0 / 2 / 4 ms | 13% de um núcleo | 104 MB | 0 |
| 400 | 6118 | 0 / 4 / 9 ms | 20% de um núcleo | 118 MB | 0 |

### Desempenho no navegador
Cenários: parado, manada perto e travessia de setores, no perfil "baixo".
- Com renderização por software, cada quadro levou de 3,5 a 5 s, quase todo em `render`.
- A compilação de shaders da manada levou 3,3 s.
- A CPU do jogo (IA, animais, interface) ficou em poucos milissegundos por quadro.

Esses números só servem para comparar versões entre si. **O FPS em aparelhos reais continua
sem medição**: precisa de um celular ou PC com GPU (o painel F3 do jogo mostra os mesmos dados).

## O que foi feito nesta rodada
- **Caminhada:**
  - as pernas dobravam demais (modelos de artista e quadrúpedes);
  - a passada passou a respeitar o alcance da perna desenhada, com o pé no chão em cerca de 55%
    do ciclo;
  - a descida do corpo passou a ser medida a partir da extensão de repouso de cada perna.
- **Espécies sem modelo livre:**
  - smilodonte com proporção e crânio de felino;
  - sucuri verde com manchas pretas, em S;
  - paquirrinossauro mais baixo e marrom;
  - iguanodonte com pescoço curto e focinho de cavalo;
  - microraptor com tom azulado.
- **Multijogador cooperativo completo:**
  - servidor Node com salas, convite, reconexão, migração de quem hospeda, proteções, saúde e
    Docker;
  - no jogo: jogadores visíveis, animais compartilhados, combate nos dois sentidos, construção,
    chat, relógio e clima;
  - guia em [multiplayer.md](multiplayer.md).
- **Modelos de artista novos** (rodadas anteriores desta sessão): tricerátops, braquiossauro,
  troodonte, galimimo e mosassauro.
- **Correção do artifact:** o humano novo e os dinossauros de artista não carregavam no
  celular, porque a página bloqueava a leitura de dados embutidos.

## Limitações conhecidas e pendências
- **FPS em aparelho real:** não medido (sem GPU aqui).
- **Engasgada na primeira aparição de uma espécie:** o modelo é gerado na hora (27 s por
  software; num aparelho com GPU deve ser bem menos, mas não foi medido). Uma melhoria possível
  é gerar os modelos de outras espécies em segundo plano.
- **Multijogador:**
  - não funciona dentro do artifact do claude.ai, que bloqueia conexões externas: é preciso
    hospedar (veja o guia);
  - baús, plantações, armadilhas, animais domesticados e eventos raros ainda não são
    sincronizados.
- **Sem modelo de artista de origem limpa:** sucuri, smilodonte, protocerátops,
  paquirrinossauro, microraptor, iguanodonte, dilofossauro e compsógnato. Continuam com os
  modelos gerados pelo jogo, que foram melhorados.
- **Texturas fotográficas do chão:**
  - terra, rocha, areia e lama usam fotos CC0 do Poly Haven;
  - a grama, as folhas secas e a neve continuam procedurais, porque as fotos ficaram piores na comparação no jogo (veja `modelos-externos.md`);
  - modelos 3D do mundo vindos dessas bibliotecas ainda não entraram.
