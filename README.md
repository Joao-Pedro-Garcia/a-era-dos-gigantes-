# Era dos Gigantes

Jogo 3D de sobrevivência pré-histórica em mundo aberto, feito para navegador (computador, Android, iPhone e tablets), com Three.js + TypeScript + Vite.

> **Estado atual: fundação jogável (v0.1).** O núcleo de mundo, ecossistema, IA animal, sobrevivência, inventário, fabricação, construção e salvamento funciona e tem testes automatizados. Vários sistemas da visão completa ainda não foram implementados. A tabela [Situação dos sistemas](#situação-dos-sistemas) diz exatamente o que está pronto, o que está parcial e o que falta.

## Como rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento (abre na rede local: dá para testar no celular)
npm run build      # checagem de tipos + build de produção em dist/
npm run preview    # serve o build de produção
npm test           # testes automatizados (Vitest)
```

Requer Node 18+ e um navegador com WebGL. O build de produção registra um Service Worker: após a primeira visita, o jogo abre sem internet.

Páginas de desenvolvimento:

- `?showcase` mostra as 25 espécies lado a lado andando.
- `?showcase&side&ground&species=triceratops` mostra uma espécie de perfil.
- `F3` dentro do jogo exibe FPS, chamadas de desenho e quantidade de animais ativos/simulados.

## Controles

| Ação | Teclado/mouse | Toque | Gamepad |
|---|---|---|---|
| Mover | WASD / setas | joystick esquerdo | analógico esquerdo |
| Olhar | mouse (clique para capturar) | arrastar na metade direita | analógico direito |
| Correr | Shift | botão Correr (alterna) | L3 |
| Pular / agachar | Espaço / C | Pular / Agachar | A / B |
| Interagir (coletar, beber, porta, cama…) | E | Usar | X |
| Atacar / coletar / colocar peça | clique | Ação | RT |
| Usar item da mão (comer, curativo, cantil) | F | Comer | — |
| Atalhos | 1–6, roda do mouse | toque na barra | — |
| Inventário / fabricação / diário | Tab ou I | Itens | Y |
| Construção | B (Q/R girar, G encaixe, X demolir) | Construir | LT |
| Câmera 1ª/3ª pessoa | V | Câmera | Select |
| Mapa / Pausa | M / Esc | 🗺 / ❚❚ | — |

As teclas podem ser reconfiguradas em **Controles**. A interface de toque só aparece quando o jogador está usando toque.

## Arquitetura

```
src/
  core/         ciclo do jogo (game.ts), configuração, RNG determinístico, ruído, eventos
  world/        terreno e biomas, setores com LOD, vegetação, colisão, clima/eventos, visual do ambiente
  animals/      catálogo de espécies, estado do animal, ecossistema, modelos procedurais
  ai/           cérebro (percepção, decisão, locomoção) e memória episódica
  player/       controle do personagem, câmera, modelo do jogador
  survival/     fome, sede, energia, fôlego, temperatura, sangramento, fratura, doença
  inventory/    itens, inventário transacional, equipamento
  crafting/     receitas e fila de fabricação
  building/     peças, validação, encaixe, malhas
  input/        teclado/mouse, toque, gamepad
  ui/           HUD, painéis, menus, controles de toque (DOM)
  save/         modelo de salvamento, migrações, IndexedDB, importar/exportar
  audio/        áudio procedural (Web Audio API), sem arquivos externos
  performance/  monitor de FPS e qualidade adaptativa
  localization/ português (padrão) e inglês
  dev/          vitrine de espécies
tests/          testes automatizados
```

Decisões principais:

- **Mundo determinístico + estado persistido mínimo.** O terreno, a vegetação e as ruínas são recalculados a partir da semente. Só o que muda é salvo: recursos coletados, construções, animais, clima e itens. Por isso recarregar setores não duplica nada.
- **Mundo híbrido.** Regiões planejadas (vulcão a leste, cordilheira e terras nevadas ao norte, pântano a sudeste, selva a sudoeste, nove locais de ruínas e cavernas) são preenchidas por ruído procedural controlado. Os rios descem até o nível do mar nas terras baixas, e os locais planejados são aplainados para nunca caírem na água ou num penhasco.
- **Setores de 128 m** carregados em anéis ao redor do jogador. Perto: terreno de alta resolução, vegetação instanciada, colisores e recursos coletáveis. Longe: terreno simplificado. Saias de terreno escondem emendas entre níveis de detalhe.
- **Ecossistema em dois níveis.** Animais perto do jogador (até 230 m, com limite por qualidade gráfica) rodam a IA completa a cada quadro. O resto do continente roda uma simulação abstrata barata a cada 2 s: necessidades, pastejo, predação, migração, reprodução, doenças e morte. Cada animal tem um id único num registro só, e nada é criado de novo quando um setor recarrega.
- **Transações atômicas.** Inventário, fabricação, construção, depósitos e recuperação de itens validam antes de consumir, e o que não cabe vira uma sacola no chão; nunca some nem duplica.

## Situação dos sistemas

✅ implementado e testado · 🟡 parcial / simplificado · ⬜ ainda não implementado

| Sistema | Situação | Detalhes |
|---|---|---|
| Continente e biomas | ✅ | ~10 km de diâmetro; selva, planícies, montanhas, pântano, litoral, neve, vulcânico e ruínas, cada um com cores, vegetação, recursos, fauna, deslocamento e riscos próprios |
| Rios e água | 🟡 | Rios de planície e lagos chegam ao nível do mar; não há rios de altitude com cachoeiras. A água doce é diferente da salgada para beber |
| Cavernas | 🟡 | As entradas existem e são descobertas, mas o interior ainda não é explorável |
| Setores, LOD e memória | ✅ | Carregamento incremental com orçamento de tempo por quadro e liberação de geometrias |
| Espécies | ✅ | 25 espécies com dados próprios (ecologia, sentidos, temperamento, reprodução, locomoção, áudio, aparência e período geológico) |
| Modelos e animações dos animais | 🟡 | Modelos procedurais por plano corporal, com pernas sincronizadas ao deslocamento real (sem deslizar), postura de descanso, pescoço para pastar e asas batendo. São reconhecíveis, mas **não** têm qualidade cinematográfica; isso exige modelos 3D artísticos (glTF), ainda não incluídos |
| IA animal | ✅ | Percepção por visão (campo de visão, noite, neblina) e audição (ruído do jogador); fuga, alerta, curiosidade, defesa, avanço, ataque em grupo, caça com perseguição limitada pelo fôlego, carniça, pastejo, busca de água, descanso conforme o ciclo de atividade, abrigo em tempestades, fuga de incêndios e erupções |
| Memória e personalidade | ✅ | Memória episódica limitada (12 entradas, decaimento, fusão espacial) que altera decisões: distância de fuga, locais evitados, desistência de presas difíceis, cautela com o jogador. Habituação e confiança mudam com a convivência pacífica. Testemunhas só aprendem o que perceberam |
| Grupos e territórios | 🟡 | Líder, filhotes seguem os pais, alarme propagado com atraso individual, defesa de filhotes e território. Ainda não há hierarquia de dominância nem disputas territoriais entre indivíduos |
| Ecossistema | ✅ | Vegetação consumida e regenerada (chuva acelera, seca reduz), predação, migração por comida/água/presas/perigo, ninhos, ovos, filhotes, crescimento, morte por idade, fome, sede e doença |
| Clima e eventos | ✅ | Dia/noite, estações, temperatura, chuva, tempestade com raios, neblina, vento, seca, enchentes (nível da água sobe), incêndios por raios em vegetação seca (se espalham com o vento e se apagam com a chuva), erupções vulcânicas, surtos de doença |
| Sobrevivência | ✅ | Fome, sede, energia, fôlego, temperatura corporal (roupas, fogo, abrigo, água), sangramento, fratura, intoxicação alimentar, queda; dificuldade ajustável |
| Morte e recuperação | ✅ | Reaparece na cama (ou na área inicial); os itens ficam numa sacola marcada no mapa, e a recuperação não duplica (testado) |
| Movimento e câmera | ✅ | Aceleração, pulo, agachar, nado, limite de inclinação, colisão com árvores, rochas, ruínas, construções e animais grandes; 3ª pessoa com anticolisão e 1ª pessoa |
| Controles | ✅ | Teclado/mouse (reconfigurável), toque e gamepad (mapeamento padrão, sem tela de reconfiguração) |
| Inventário | ✅ | Grade de 30 espaços, pilhas, peso e capacidade (mochila), equipamento, atalhos, filtros, organização automática, descarte, depósitos |
| Fabricação | ✅ | 20 receitas em 9 categorias; estações (mãos, fogueira, bancada); desbloqueios por exploração; fila com cancelamento e reembolso exato |
| Construção | ✅ | 14 peças: fundação, piso, parede, porta, telhado, cerca, paliçada, plataforma, fogueira, bancada, depósito, cama, coletor de água e horta. Encaixe automático ou posição livre, validação (água, inclinação, obstáculos, apoio, sobreposição, distância) e demolição com reembolso de metade |
| Salvamento | ✅ | IndexedDB com transação única, cópia de segurança, migrações versionadas, reparo de dados corrompidos, autosave e salvamento ao minimizar o app, importar/exportar JSON |
| Desempenho | 🟡 | Qualidade adaptativa (resolução, sombras, raio de visão, densidade de vegetação, animais ativos). Não foi medido em aparelhos reais; o ambiente de testes usa renderização por software |
| Áudio | 🟡 | Vento, chuva, trovões com atraso pela distância e vocalizações sintetizadas em 3D por espécie. Ainda sem música dinâmica nem passos |
| Português/inglês | ✅ | Todas as chaves traduzidas (testado) |
| Offline | 🟡 | Service Worker com cache; ainda não foi testado como app instalado no iPhone |
| Diário de campo e mapa | 🟡 | O diário registra as espécies observadas; o mapa mostra biomas, locais descobertos, cama e sacolas. Ainda não há rastros nem pegadas |
| Domesticação | ⬜ | Os dados por espécie (possível, dificuldade, comida preferida) e a confiança no jogador já existem; a mecânica não |
| Progressão (XP, habilidades) | ⬜ | Não implementada |
| Mistérios e instalações | 🟡 | Seis instalações e três cavernas são descobertas, desbloqueiam receitas e têm saque; ainda não há documentos nem investigação |
| Agricultura | 🟡 | A horta cresce e é colhida; ainda não há sementes nem tipos de cultivo |

### Licença criativa paleontológica

O continente é uma **síntese ficcional** do Mesozoico: espécies do Jurássico Inferior (*Dilophosaurus*) ao fim do Cretáceo (*Tyrannosaurus*) convivem de propósito, e o período real de cada uma aparece no diário. Mesmo assim, procuramos manter a anatomia e o comportamento plausíveis:

- dromeossauros com penas (*Velociraptor* tem ~1,8 m e ~18 kg, não o tamanho do cinema);
- *Dilophosaurus* sem folho no pescoço e sem veneno;
- pterossauros (*Pteranodon*, *Quetzalcoatlus*) classificados como répteis voadores, **não** dinossauros;
- *Sarcosuchus* classificado como crocodiliforme;
- *Archaeopteryx* como avialano;
- *Pachyrhinosaurus* e *Troodon* nas terras frias, de acordo com os registros árticos.

Caçar em matilha e comportamentos sociais pouco documentados são **hipóteses de jogo**.

## Testes

`npm test` roda 53 testes que cobrem:

- RNG e ruído determinísticos;
- colisão;
- geração do terreno e locais planejados (com várias sementes);
- clima, incêndios e erupções;
- inventário, que nunca duplica nem perde itens;
- fabricação atômica, estações, desbloqueios e excedentes;
- sobrevivência;
- memória animal;
- fuga, habituação e testemunhas;
- caça e consumo de carcaça;
- semeadura idempotente;
- uma semana de simulação do ecossistema;
- validação de construção;
- migração, saneamento e ida e volta pelo IndexedDB;
- traduções.

Além disso, o jogo foi exercitado num Chromium headless:

- novo jogo e visita a todos os biomas;
- animais observados de perto;
- noite, tempestade e neblina;
- construção de uma casa;
- fabricação;
- salvar, recarregar e continuar;
- morte e recuperação da sacola;
- layout em celular com toque.
