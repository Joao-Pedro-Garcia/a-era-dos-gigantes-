# Desempenho: diagnóstico e otimizações (v0.5.1)

## Onde foi medido (importante)

- **Máquina:** Intel Xeon de 4 núcleos, **sem GPU**, compartilhada.
- **Navegador:** Chromium headless com **renderização por software (SwiftShader)**: a CPU faz o papel da GPU.
- **Consequência:** um quadro leva de 250 a 400 ms no perfil Baixo, e o tempo varia muito de uma rodada para outra.
- **O que esses números servem para comparar:**
  - custo de CPU (JavaScript);
  - travadas causadas por compilação de shaders.
- **O que eles não representam:** o FPS de um celular ou de um PC com GPU.
- **Nada foi medido em aparelhos reais.**

## Ferramentas criadas

### Painel de diagnóstico (F3, dentro do jogo)

Fica desligado por padrão e não aparece para o jogador. Quando ligado, mostra:

- FPS e perfil gráfico em uso;
- tempo de quadro (média, 1 % pior e máximo), dos últimos ~2 s;
- tempo de CPU por sistema:
  - entrada, clima/mundo, jogador e sobrevivência;
  - ações/combate, IA e domesticação;
  - base/fabricação e setores (carregamento);
  - poses dos animais e ambiente;
  - personagem, efeitos, áudio, interface e render (CPU);
- **tempo de GPU** da renderização principal, medido com `EXT_disjoint_timer_query_webgl2`:
  - funciona no Chrome/Edge de desktop;
  - aparece como `n/d` quando o navegador não oferece a extensão (Safari e a maioria dos celulares);
- memória JS (`n/d` fora do Chrome);
- chamadas de desenho, triângulos, geometrias, texturas e animais ativos/total.

Código: `src/performance/profiler.ts`, instrumentado em `src/core/game.ts`.

### Benchmark reproduzível: `npm run test:perf`

Arquivo `tests/perf/bench.mjs`. Roda três cenários, cada um num mundo novo e durante 8 s:

- **parado:** o jogador fica no início;
- **manada:** 12 grupos de animais surgem perto do jogador;
- **viagem:** o jogador atravessa setores novos.

Para cada cenário, registra:

- tempos de quadro;
- CPU por sistema e GPU;
- tempo total de compilação de shaders e de coleta de lixo;
- as funções que mais consomem CPU, com quem as chamou (perfil de CPU do Chrome).

## O que o diagnóstico mostrou

| Suspeita | Medição | Conclusão |
|---|---|---|
| Lógica do jogo (IA, sobrevivência, animais) | 3–5 ms por quadro somando todos os sistemas | **Não é o gargalo** |
| Grafo de cena | 1.500–1.800 objetos; `updateMatrixWorld` completo 0,5–0,6 ms | Barato; a vegetação já usa instâncias (651–1.649 instâncias em 37–39 malhas) |
| **Compilação de shaders durante o jogo** | `getProgramInfoLog`/`getShaderInfoLog`: **2,4 s** de CPU em 8 s com dinossauros novos; quadro máximo 2,6 s | **Causa real de travadas**: cada material novo (o primeiro dinossauro de perto, cada modelo de artista) compilava no meio do jogo |
| **Esfera envolvente de malhas com esqueleto** | `computeBoundingSphere → applyBoneTransform` na CPU, em cada animal novo | **Pico a cada animal que surge**: o three.js deformava todos os vértices na CPU só para ordenar por profundidade |
| **Profundidade da água ao se mover** | 900 avaliações do ruído do terreno por quadro, sempre que a água se recentraliza (a cada 24 m); medido 2,17 µs cada = **~2 ms por quadro** neste Xeon (num celular, várias vezes mais) | Custo fixo, independente do aparelho |
| Coleta de lixo | 3–155 ms a cada 8 s (varia muito) | Pequeno; foi corrigida uma alocação por quadro na pose dos animais |
| Mapa de ambiente do céu (PMREM) | Desligado no perfil Baixo; não houve regeneração em 20 s | Fica para medir em GPU real nos perfis Médio e Alto |
| Atribuição de custo de GPU por grupo de objetos | Escondendo cada grupo, as diferenças ficaram dentro do ruído do SwiftShader | **Inconclusivo neste ambiente.** Nenhuma redução de shader foi feita "no escuro" |

## Otimizações feitas (nenhuma reduz a qualidade visual)

1. **Pré-aquecimento de shaders na tela de carregamento** (`Game.warmupStep`).
   - Durante o carregamento, e escondidos atrás da tela de carregamento, são desenhados:
     - uma instância de cada modelo de artista;
     - um dinossauro procedural com penas e um com escamas, nos três níveis de detalhe e com sombras.
   - Todos os seus programas, incluindo as variantes de sombra, ficam compilados antes do jogo começar.
   - Se os modelos externos não chegarem em 8 s, o jogo não espera por eles.
2. **Esferas envolventes pré-calculadas.**
   - Os animais procedurais e os modelos de artista usam a esfera da geometria em pose de repouso, ampliada em 30 % para cobrir a animação.
   - Ela é calculada uma vez por espécie, e não mais vértice a vértice a cada animal novo.
3. **Profundidade da água por orçamento de tempo:** no máximo 1 ms por quadro, com um mínimo de 100 pontos, em vez de 900 pontos fixos.
   - Uma recentralização completa (5.329 pontos) leva cerca de 12 quadros num processador como este.
4. **Menos lixo por quadro:** `aimBone` passou a reutilizar vetores e quatérnios em vez de criar novos a cada chamada.

## Resultados antes e depois

### Compilação de shaders

Sessão igual nas duas versões: semente 777, 10 espécies surgindo perto do jogador, depois 15 s atravessando o mapa. O gancho fica em `getProgramInfoLog`/`getShaderInfoLog` desde o primeiro quadro.

| | Durante o jogo | Durante o carregamento |
|---|---|---|
| Antes (commit 088c787), rodada 1 | **5.208 ms** (9 programas) | 411 ms |
| Antes, rodada 2 | **2.487 ms** (9 programas) | 335 ms |
| Depois, rodada 1 | **0 ms** (0 programas) | 975 ms |
| Depois, rodada 2 | **0 ms** (0 programas) | 1.823 ms |

As travadas de compilação saíram do jogo e foram para a tela de carregamento (+0,6 a 1,5 s neste renderizador por software).

**Exceção observada:** numa das seis rodadas do benchmark de viagem, ainda apareceram 569 ms de compilação. A origem não foi identificada: não se repetiu em duas rodadas dirigidas. Pode ser um efeito raro, como fogo ou um evento do mundo, ainda não pré-aquecido.

### Tempo médio de quadro (perfil Baixo, 2 rodadas por versão, versões alternadas)

| Cenário | Antes | Depois |
|---|---|---|
| Parado | 302 / 295 ms | 274 / 305 ms |
| Manada | 411 / 465 ms | 419 / 368 ms |
| Viagem | 356 / 327 ms | 313 / 353 ms |

- As médias ficam **dentro do ruído** do renderizador por software. Não houve ganho de FPS mensurável aqui, e nenhum é afirmado.
- As otimizações atacam travadas pontuais e custo de CPU (compilação, esferas, água). Num aparelho real, esse custo de CPU é uma fração bem maior do quadro do que aqui, onde a rasterização por software domina.

### Qualidade visual

| Comparação | Diferença média | Pixels com diferença > 40 |
|---|---|---|
| Mesma semente no jogo | 4,2/255 | 1,7 % (grama ao vento; o relógio marca 09:36 contra 09:37) |
| Vitrine do tricerátopo de perto | 0,33/255 | 0,02 % (ruído de compressão) |

Imagem lado a lado: [`visual/desempenho/antes-depois.jpg`](visual/desempenho/antes-depois.jpg).

## Testes

- `npm test`: 149 de 149.
- Navegador: 39 de 39.
- Combate: 21 de 21.
  - Numa rodada, a verificação "12 arco" falhou e passou na seguinte. Ela amostra a flecha a cada 400 ms, e com quadros de ~400 ms as amostras às vezes caem no mesmo quadro.
  - Em rodadas anteriores, as verificações "domesticação: comando" e "recuperação: aviso" também falharam por tempo **na versão antiga** e na nova. A do aviso de backup foi corrigida de verdade: o aviso agora aparece quando o mundo está na tela, e não durante o carregamento, quando sumia.

## O que falta (por prioridade)

1. **Medir em aparelhos reais** com o painel F3: celulares Android de entrada e intermediários, iPhone, e PC com GPU. Sem isso não há como dizer se a meta de 30–60 FPS é atingida, nem onde está o gargalo de GPU.
2. Se o gargalo de GPU for a taxa de preenchimento (provável em celulares), avaliar com medição:
   - ordenar a vegetação da frente para trás;
   - reduzir o "overdraw" da grama;
   - limitar a resolução interna em telas de alta densidade, como opção do jogador e nunca automaticamente sem aviso.
3. Pré-aquecer também os efeitos raros (fogo, erupção, flechas) e investigar os 569 ms observados uma vez.
4. Se o painel apontar custo do terreno, levar o cálculo da profundidade da água para o worker do terreno.
5. ~~Avisar quando o perfil Automático muda a qualidade.~~ **Feito:** o jogador recebe um aviso com o novo perfil e a dica de fixar um perfil em Configurações. O Automático só age se o jogador escolher "Automático"; os perfis fixos nunca mudam sozinhos.
