# Era dos Gigantes

Jogo 3D de sobrevivência pré-histórica em mundo aberto, feito para navegador (computador, Android, iPhone e tablets), com Three.js, TypeScript e Vite.

> **Estado: v0.5, jogável e integrado: combate animado, dinossauros reconstruídos e os primeiros modelos de artista.**
> - **v0.5:** tiranossauro, estegossauro e paquicefalossauro agora usam modelos 3D feitos por artistas (Sketchfab, CC BY 4.0, autores creditados no jogo), com texturas pintadas e animações de andar, correr, comer, beber, atacar e morrer. As outras 23 espécies continuam procedurais. Detalhes, critérios e o que foi descartado: [`docs/modelos-externos.md`](docs/modelos-externos.md).
> - Todos os sistemas pedidos têm implementação real, conectada ao inventário, ao mundo e ao salvamento.
> - A v0.3 substituiu os modelos de primitivas por geometria e texturas PBR geradas pelo código.
> - A v0.4 trouxe:
>   - **combate e uso de ferramentas com animação real em 1ª e 3ª pessoa**: braços em primeira pessoa, golpes com fases, acerto no quadro de impacto, arco com tensão da corda, efeitos e sons por material e reação dos alvos;
>   - **reconstrução da geometria dos animais**: crânio fechado com boca, dentes, olhos com pálpebras, penas, golas e placas sólidas, asas de pterossauro com dedo alar e membrana, filhotes com proporções próprias e 3 níveis de detalhe;
>   - **um animal novo, o mosassauro**, que vive no mar.
> - Tudo é coberto por 149 testes automatizados, 39 verificações gerais e 21 verificações de combate num navegador real.
> - O visual **não é fotorrealista**: fora as 3 espécies com modelo de artista, ele continua procedural.
> - O que depende de recursos externos e as limitações conhecidas estão no fim deste documento, sem rodeios.

## Instalação e execução

```bash
npm install          # dependências (Node 18+; testado com Node 22 / npm 10)
npm run dev          # servidor de desenvolvimento (também acessível pela rede local, para testar no celular)
npm run build        # checagem de tipos + build de produção em dist/ (gera também o Service Worker)
npm run preview      # serve o build de produção em http://localhost:4173
npm test             # 148 testes automatizados (Vitest)
npm run test:e2e     # 39 verificações num navegador real (ver "Testes")
npm run test:combat  # 21 verificações de combate num navegador real (15 cenários)
```

A única dependência de execução é `three` (0.170.0). Não há servidores, chaves de API nem serviços externos.

Páginas de diagnóstico:

- `?showcase` mostra as 26 espécies lado a lado.
- `?showcase&sheet&species=tyrannosaurus` mostra uma folha de revisão com 6 vistas: lateral, frente, trás, cabeça em 3/4, longe (nível de detalhe distante) e sombra com postura de ameaça ou em voo. Acrescente `&juvenile` para ver o filhote e `&air` para ver voadores no ar.
- `?showcase&combat&phase=windup|impact|ready|draw` mostra cada arma congelada numa fase do golpe em 3ª pessoa (`&close=<n>` aproxima). Com `&fp&item=<id>`, mostra a mesma fase em 1ª pessoa; `&anim` mostra os golpes em sequência.
- `?showcase&side&ground&species=triceratops` mostra uma espécie de perfil; acrescente `&close` para um close da cabeça.
- `?showcase&human` mostra o personagem parado, andando, trotando, correndo e agachado (`&side`, `&close`, `&tool`).
- `npm run shots` gera capturas de cenas fixas do jogo (início, floresta, dinossauro, entardecer, chuva, 1ª pessoa, noite, água, celular e espécies), para comparar antes e depois (ver *Testes*).
- `F3` dentro do jogo exibe FPS, chamadas de desenho, geometrias e texturas na GPU e animais ativos/totais.

## Controles

| Ação | Teclado/mouse | Toque | Gamepad |
|---|---|---|---|
| Mover / olhar | WASD / mouse (clique para capturar) | joystick / arrastar à direita | analógicos |
| Correr / pular / agachar | Shift / Espaço / C | Correr (alterna) / Pular / Agachar | L3 / A / B |
| Interagir (coletar, beber, ler, alimentar, portas, cavernas, montar/desmontar) | E | Usar | X |
| Atacar / coletar / usar ferramenta (luneta, sinalizador) / colocar peça; segurar repete o golpe e tensiona o arco (soltar dispara) | clique (segurar) | Ação (segurar) | RT |
| Usar item da mão (comer, curar, cantil, sinalizador) | F | Comer | — |
| Atalhos | 1–6, roda | toque na barra | — |
| Inventário, Fabricação, Habilidades, Animais, Diário, Mapa | Tab / I, M | Itens, 🗺 | Y |
| Tela de construção: escolher peça no catálogo; mover U/J/H/K (frente/trás/esquerda/direita); subir/descer PgUp/PgDn (ou O/L); girar Q/R ou roda; Z orientação original; N precisão; G encaixe; clique confirma; Esc cancela a peça; X demolir | B | Construir (botões na tela, segurar repete) | LT |
| Câmera 1ª/3ª pessoa / pausa | V / Esc | Câmera / ❚❚ | Select / Start |

As teclas podem ser reconfiguradas em **Controles**. A interface de toque só aparece quando o jogador está usando toque. Também há opção de "correr alterna" para quem não pode segurar a tecla.

## Como os sistemas funcionam

### Mundo, setores e ecossistema

- **Continente:** cerca de 10 km, híbrido. Regiões planejadas (vulcão, cordilheira e terras nevadas, pântano, selva, 6 instalações e 3 cavernas) são preenchidas por ruído procedural determinístico. Os locais planejados são aplainados automaticamente para nunca caírem em rios ou penhascos.
- **Setores de 128 m** carregados por distância, com níveis de detalhe:
  - vegetação instanciada (uma chamada de desenho por tipo e por setor);
  - colisores só por perto;
  - liberação de geometrias e colisores ao descarregar, verificada por teste.
- **Persistência mínima:** o mundo se regenera a partir da semente. Só se salva o que muda (recursos coletados, construções, animais, clima, portas abertas, cavernas desobstruídas). Recursos voltam a crescer depois de alguns dias; ruínas saqueadas e fósseis não.
- **Ecossistema:**
  - **IA completa** para os animais próximos, com taxa de atualização reduzida a 1/2 além de 100 m e a 1/4 além de 170 m.
  - **Simulação abstrata** a cada 2 s para o resto do continente: fome, sede, pastejo, predação, migração, ninhos, crescimento, doenças e morte.

### Dinossauros e IA (26 espécies)

O inventário completo das espécies, com o que foi reconstruído na v0.4 e o que ainda falta, está em [`docs/dinosaurs.md`](docs/dinosaurs.md).

**Modelos de artista (v0.5):** três espécies usam arquivos GLB animados listados em [`public/models/manifest.json`](public/models/manifest.json): tiranossauro (LasquetiSpice), estegossauro e paquicefalossauro (Ferocious Industries), todos em CC BY 4.0.
- O clipe é escolhido pelo estado do animal: parado, andar, correr, comer, beber, dormir, atacar, alerta (rugido) e morte.
- A velocidade dos clipes de locomoção é ajustada à velocidade real, medida nos pés do próprio modelo, para os pés não deslizarem.
- De longe, o jogo volta ao modelo procedural leve.
- Créditos: menu principal → **Créditos**.
- Antes e depois: [`docs/visual/modelos/compare.jpg`](docs/visual/modelos/compare.jpg).

- **Comportamento:** percepção por visão, audição e **olfato a favor do vento**. A cobertura da selva reduz a visibilidade do jogador.
- **Memória e personalidade:** memória episódica limitada e personalidade individual. A habituação e a confiança mudam com a convivência.
- **Ferimentos:** um animal ferido cambaleia. Os valentes retaliam; os muito feridos fogem, a menos que estejam protegendo filhotes.
- **Grupos:** alarme com atraso individual e defesa de território e de filhotes.

#### Machos Alfa (raros)

- **Raridade:** cada macho adulto criado num grupo tem 3% de chance de ser Alfa, só em espécies terrestres de 150 kg ou mais. Limites: no máximo 6 Alfas vivos no mundo e 1 por espécie num raio de 600 m. Os números estão em `src/animals/alpha.ts` (`ALPHA`).
- **Atributos** (aplicados na leitura, nunca somados ao valor salvo, então carregar o jogo não os aplica de novo): vida ×1,8, dano ×1,45, dano recebido ×0,8, velocidade ×1,06, tamanho ×1,12. A coragem e a agressividade sobem uma única vez, quando o animal é criado.
- **Aparência:** couro mais escuro e avermelhado, mais um enxame de brasas vermelhas animado só na placa de vídeo, sem luzes extras. A aura fica mais forte quando o Alfa está em alerta, defendendo ou caçando.
- **Comportamento:**
  - ruge mais grave sempre que encara algo;
  - machos adultos rivais da mesma espécie (de outros grupos) recuam;
  - dois Alfas se exibem um para o outro por alguns segundos e o mais fraco se retira. Não há luta até a morte.
- **Identificação:** ao observar o animal aparece "Tiranossauro Alfa — … · macho dominante".
- **Persistência:** o estado de Alfa é salvo. Saves antigos carregam todos os animais como comuns.

### Sobrevivência

Fome, sede, energia, fôlego, temperatura corporal (roupas, fogo, abrigo, caverna, água), sangramento, fratura (tratada com tala), intoxicação (tratada com antídoto) e quedas. A dificuldade é ajustável.

Ao morrer, o jogador reaparece na cama, e os itens ficam numa sacola recuperável, marcada no mapa, sem duplicação.

### Fabricação

- **35 receitas** em 12 categorias.
- **Receitas simples** (à mão) e **receitas com estação**: fogueira, bancada ou forja.
- **Ferramentas exigidas sem serem consumidas:** a faca é necessária para couro, arco e flechas.
- **Desbloqueios:** por exploração (obsidiana, cristais, estações de pesquisa, neve) e por habilidade (Metalurgia).
- **Atomicidade:** os materiais são validados antes de consumir, e o cancelamento reembolsa exatamente o que foi gasto. O que não couber no inventário vira sacola no chão.
- **Interface:** mostra a quantidade disponível de cada material, a estação ou ferramenta exigida e o motivo do bloqueio.

### Construção (28 peças)

- **Estruturas:**
  - madeira: fundação, piso, parede, porta, telhado, plataforma, escada (rampa caminhável);
  - pedra, com a habilidade Pedreiro: fundação e parede.
- **Animais:** portão, cocho (abastece os animais domesticados) e ninho de incubação.
- **Defesa:** cerca, paliçada, armadilha de estacas, armadilha de laço e cerca elétrica.
- **Instalações:** fogueira, bancada, forja, depósito, cama (ponto de retorno), coletor de água, poço, horta (plantio com sementes e rega), poste com tocha.
- **Energia:** um gerador eólico alimenta lâmpadas e cercas elétricas num raio de 40 m. A potência depende do vento.
- **Tela de construção (B):**
  - catálogo em 8 categorias, com miniaturas 3D renderizadas dos próprios modelos do jogo e o custo de cada peça no formato tem/precisa;
  - a peça escolhida aparece como pré-visualização verde/vermelha, com o motivo quando a posição é inválida;
  - ajuste fino: frente/trás/esquerda/direita em relação à câmera, subir/descer, girar e voltar à orientação original;
  - precisão fino (0,1 m / 5°), normal (0,5 m / 15°) ou rápido (2 m / 45°); com o encaixe ligado, fundações andam de célula em célula;
  - segurar um botão ou tecla repete o ajuste;
  - no PC o mouse fica livre para apontar o local, o botão direito segurado gira a câmera e o clique confirma; no celular há botões grandes;
  - confirmar cobra os materiais uma única vez (clique duplo não constrói duas peças), e cancelar não cobra nada.
- **Validação:** recusa água, inclinação, obstáculos, falta de apoio, sobreposição (considerando a altura), distância, falta de materiais, peças bloqueadas e, ao subir ou descer, peças flutuando ou enterradas. Fundações podem ser erguidas enquanto a saia ainda toca o chão.
- **Demolição** com reembolso de metade do custo.
- Tudo, inclusive o conteúdo dos depósitos, ovos incubando, plantações e o estado das armadilhas, é salvo.

### Domesticação, treino e criação

Cada espécie tem método e utilidade próprios (`src/taming/profiles.ts`).

- **Métodos:**
  - **Alimentação** (tricerátops, parassaurolofo, iguanodonte…): aproximar-se com calma, agachado, e oferecer a comida certa. A ração vegetal é a melhor para herbívoros. Um animal assustado, saciado ou alimentado há pouco recusa.
  - **Convivência paciente** (galimimo, troodonte, arqueoptérix…): ficar por perto, quieto e sem hostilidade.
  - **Impressão** (velocirraptor, dilofossauro, pterossauros): só filhotes chocados pelo jogador. É preciso pegar um ovo de um ninho selvagem (os pais percebem e podem atacar) e incubá-lo num ninho aquecido.
  - **Nenhum:** tiranossauro, espinossauro, braquiossauro, alossauro, carnotauro, sarcosuco.
- **Animais domesticados não são máquinas:**
  - mantêm fome, sede, medo e personalidade;
  - obedecem com uma probabilidade que cresce com o treino e o vínculo, e cai com fome e medo;
  - vão embora se forem negligenciados ou maltratados.
- **Ordens:** seguir, ficar, vagar perto e guardar área.
- **Utilidades:**
  - companheiros que defendem o jogador;
  - guardas que expulsam predadores;
  - montarias (só adultos treinados);
  - animais de carga (+40 kg);
  - coletores, que abastecem depósitos;
  - batedores voadores, que revelam o mapa.
- **Reprodução:** pares domesticados põem ovos no ninho de incubação dentro da estação, ou em qualquer época com a habilidade Criador. Os filhotes já nascem ligados ao jogador.

### Combate e interação

**Animações de ataque e uso (v0.4).** Uma única máquina de estados (`src/combat/actions.ts`) controla todas as ações, para teclado, mouse, toque e gamepad.

- **Fases das ações:** cada ação tem preparação, golpe (com o **quadro de impacto** dentro dele), recuperação e retorno.
- **Acerto no quadro de impacto:** o dano, a coleta e os efeitos acontecem **só no quadro de impacto**, nunca ao apertar o botão.
- **Alvo de cada golpe:**
  - cada arma tem alcance e arco próprios;
  - o alvo mais próximo dentro deles é atingido, desde que não haja parede, rocha, tronco ou relevo no caminho;
  - cada golpe atinge um único alvo;
  - um golpe no vazio só corta o ar (ou espirra água, se terminar nela).
- **Animações por item**, usando as mesmas poses-chave em 1ª pessoa (braços próprios) e em 3ª pessoa (esqueleto do corpo, com IK de dois ossos e giro do tronco). O ataque continua enquanto o personagem anda ou corre:

| Item | Ação |
|---|---|
| Mãos nuas | soco com guarda, alternando direita e esquerda em sequência |
| Machado | golpe diagonal de cima para baixo |
| Picareta | golpe de cima com as duas mãos |
| Lança | estocada com as duas mãos |
| Faca | corte lateral |
| Porrete (novo) e tocha | golpe de cima |
| Arco | encaixar a flecha, puxar a corda enquanto o botão estiver pressionado (com tremor do braço após segurar muito tempo) e soltar |
| Luneta, sinalizador e outras ferramentas | levar à frente ou ao olho |

- **Arco:**
  - a flecha sai da posição real da corda do arco (o da 1ª pessoa ou o do corpo) e é mirada para o ponto sob a mira;
  - a velocidade e o dano crescem com a tensão;
  - um toque rápido ainda dispara depois de uma tensão mínima;
  - as flechas fincam no chão ou em paredes.
- **Equipar, guardar e trocar:**
  - o item sai de vista, é trocado e sobe de novo;
  - o ataque sempre usa o item que está na mão: trocar no meio do golpe cancela o golpe antigo;
  - trocas repetidas terminam no último item escolhido, com um único modelo na mão.
- **Entrada duplicada:** toque e clique sintético no mesmo quadro, ou duas entradas seguidas em menos de 60 ms, viram uma ação só.
- **Primeira pessoa:**
  - mesmos braços, mangas e mãos do corpo, com as mãos fechadas segurando o item;
  - desenhados numa passada própria, sem atravessar paredes nem árvores, com campo de visão fixo;
  - balançam ao andar e atrasam em giros rápidos;
  - recuam no impacto, com um pequeno tranco da câmera.
- **Reação dos alvos:**
  - o animal recua para longe do golpe, sacode a cabeça, abre a boca, chicoteia a cauda e solta um grito;
  - a IA interrompe o pastar, beber ou descansar;
  - a intensidade depende do tamanho: um animal pequeno é empurrado e quase para, um gigante só estremece;
  - árvores e arbustos atingidos balançam.
- **Efeitos de impacto leves** (2 chamadas de desenho, quantidade reduzida no perfil Baixo):
  - lascas de madeira;
  - fragmentos e poeira de pedra;
  - folhas;
  - torrões de terra;
  - respingos de água;
  - faíscas de metal;
  - cristais;
  - um leve borrifo escuro em animais (sem violência gráfica).
- **Sons sincronizados:** golpe leve ou pesado no ar, impacto por material (madeira, pedra, planta, carne, terra, metal, cristal, água), rangido da corda, disparo, equipar e guardar.
- **Armas de fogo:** não existem no jogo, então não há animação para elas.

**Regras de dano e arsenal:**

- **Dano:** cada espécie tem armadura própria (anquilossauro 60%, sarcosuco 45%…) e o tipo de dano importa. A lança perfura, a faca e o machado cortam, as flechas perfuram parcialmente e o choque ignora a armadura.
- **Arsenal:** arco e flechas balísticas, armadilhas, sinalizador (afugenta a maioria dos animais), cerca elétrica e tocha (intimida predadores).
- **Evitar confrontos** é possível: agachar, ficar contra o vento, usar a cobertura da selva e de construções, ou buscar terreno íngreme. Animais grandes não sobem encostas fortes.
- **Visual:** sem violência gráfica; carcaças apenas tombam.

### Exploração e mapa

- **Névoa no mapa:** o mapa começa escuro e revela áreas de 64 m conforme o jogador anda. Em terreno alto, o alcance é maior, e a luneta revela um cone de 500 m.
- **Trilha percorrida, marcadores** (toque no mapa para pôr ou tirar) e **pontos de referência**, como o vulcão.
- **Orientação:** sem bússola, a direção só aparece de dia e com céu limpo ("☀ ~N"). Com bússola, é exata.
- **Fósseis** em sítios raros. Identificam espécies no diário antes mesmo de vê-las.
- **Registros:** % explorada, áreas por bioma, locais e dias sobrevividos.
- **Recompensas:**
  - recursos raros (cristais, obsidiana, enxofre, minério, sucata);
  - equipamentos (cache com bateria e sinalizadores);
  - informação sobre espécies;
  - acesso a novas áreas: cavernas bloqueadas por escombros (exigem picareta) e o bunker trancado.

### Mistérios e final secreto (opcional)

- **O que há para encontrar:**
  - 6 instalações com bilhetes, terminais de pesquisa (exigem bateria), um rádio que marca as estações no mapa, esconderijos visíveis só com o scanner de pesquisa, o cartão de acesso e o núcleo de calibração;
  - 3 cavernas exploráveis, com pinturas rupestres, cristais e paredes de fósseis.
- **Ferramentas:** o receptor de rádio aponta para estações ainda não visitadas.
- **Final secreto:** ler os 5 registros, ver as 3 pinturas, pegar o núcleo no bunker e alimentar o farol do observatório com 2 baterias permite ativá-lo. Há duas escolhas: atravessar ou ficar. O jogo continua depois de qualquer uma delas.
- **Sem respostas fechadas:** algumas perguntas ficam em aberto de propósito, como quem pintou as cavernas e para onde foi a equipe.
- **Nada disso é obrigatório** para sobreviver ou explorar.

### Progressão

Há 8 disciplinas que evoluem com a prática: sobrevivência, exploração, fabricação, construção, combate, observação e rastreamento, domesticação e conhecimento do ambiente.

- Cada nível dá 1 ponto na própria árvore, e cada árvore tem 3 habilidades: 24 no total.
- Todas as habilidades têm efeito verificável no código, testado em `tests/progression.test.ts`. Exemplos:
  - −15% de fome e sede;
  - +60% de revelação do mapa;
  - pegadas visíveis (Rastreador);
  - forja e metal (Metalurgia);
  - pedra e poço (Pedreiro);
  - energia (Engenheiro);
  - reprodução fora de época (Criador);
  - previsão do tempo;
  - imunidade à comida crua.

### Interface e acessibilidade

- **HUD:** indicadores de vida, fome, sede, energia, fôlego, temperatura e ferimentos.
- **Painéis:** inventário (filtros, organização, equipamento), fabricação, habilidades, animais, diário (espécies, documentos, descobertas) e mapa.
- **Ações por contexto,** legendas sonoras, XP recebido e previsão do tempo.
- **Configurações** em quatro abas: Geral, Gráficos, Áudio e Acessibilidade (tamanho da interface, alto contraste, redução de movimento e clarões, legendas, correr alternado).
- **Layout testado** em 360×640, 844×390, 768×1024 e 1920×1080: sem rolagem horizontal, painéis dentro da tela e alvos de toque com pelo menos 40 px.

### Áudio

Todo o som é sintetizado pela Web Audio API; não há arquivos de áudio.

- **Barramentos separados** (efeitos, ambiente, música) com volume próprio.
- **Reverberação** conforme o lugar: aberto, abrigo ou caverna.
- **Som 3D:** atenuação por distância, direção (HRTF) e **oclusão pelo relevo e por construções**.
- **Ambiente por bioma:** insetos na selva e no pântano, pássaros de dia, grilos à noite, água corrente perto de rios, gotejamento em cavernas, vento, chuva e trovões com atraso pela distância.
- **Animais:** vocalizações por espécie, passos pesados dos animais grandes e sons de alimentação.
- **Ações:** passos do jogador conforme a superfície, e sons de ferramentas, construção e combate.
- **Música generativa:** calma, noite, tensão (quando algo caça o jogador) e caverna.
- **Contra a repetição:** tom, intervalos e esperas variam de forma aleatória.

### Idiomas

Português (padrão) e inglês, com seletor nas configurações. A escolha fica salva no navegador. Os textos ficam em `src/localization/` (`pt-BR.ts`, `en.ts`, `extra.ts`, `lore.ts`). Um teste garante que toda chave, inclusive as geradas dinamicamente (habilidades, peças, itens, comandos…), existe nos dois idiomas.

### Gráficos (v0.3: transformação visual)

Não há arquivos de arte no projeto: **toda a geometria e todas as texturas são geradas pelo código**, a partir de regras e de ruído, no próprio jogo. Nada é baixado da internet (o ambiente de desenvolvimento não tinha acesso a bibliotecas de texturas CC0). Isso tem limites claros, descritos em *Recursos externos* e *Limitações*.

- **Texturas PBR procedurais** (`src/graphics/texgen.ts`):
  - cor, mapa normal e rugosidade, sem emendas;
  - camadas de solo: grama, terra com pedriscos, rocha estratificada com líquen, areia com ondulações, neve, serrapilheira (folhas e gravetos) e lama úmida;
  - materiais: casca sulcada e anelada, atlas de folhas, escamas, penas, pele humana, tecido com costura, couro, cabelo, tábuas e concreto.
- **Carregamento progressivo das texturas:**
  - versões de 64 px ficam prontas na hora;
  - a resolução do perfil (256 a 1024 px) é gerada num Web Worker e trocada sem travar;
  - o resultado fica em cache no IndexedDB, então as visitas seguintes não geram de novo.
- **Terreno:**
  - microrrelevo, montículos e trilhas de animais levemente afundadas;
  - mistura de até 7 materiais por altura (pedras atravessam a grama, lama preenche depressões);
  - rocha nas encostas com projeção biplanar;
  - duas escalas de amostragem contra repetição, e convergência para a cor média à distância;
  - oclusão por concavidade;
  - poças, solo molhado e ondinhas de chuva;
  - malha calculada num Web Worker, sem travadas ao entrar em setores novos;
  - um **terreno de horizonte** com o continente inteiro (~13 km), para que montanhas, costa e vulcão apareçam até o horizonte.
- **Vegetação:**
  - árvores "crescidas" por regras, com tronco curvo, raízes, galhos recursivos e cachos de folhas texturizadas com normais de copa;
  - flora mesozoica com 3 variantes cada: araucárias, angiospermas, palmeiras, cicas, samambaias, samambaias arborescentes e cavalinhas;
  - camada densa perto do jogador: tufos de grama, samambaias pequenas, pedriscos e troncos caídos, que respeitam o solo e as trilhas;
  - árvores de baixo detalhe nos setores distantes;
  - vento com rajadas e tremor de folhas, também nas sombras;
  - pools de instâncias globais: algumas dezenas de chamadas de desenho para toda a vegetação.
- **Personagem:**
  - malha contínua com esqueleto de 20 ossos e pesos suavizados nas articulações;
  - rosto modelado (nariz, maxilar, olhos com pálpebras), mãos com dedos e cabelo;
  - roupas com materiais próprios: túnica com saia e mangas, calça, cinto com bolsa, polainas e calçados de couro;
  - animação procedural com transferência de peso, quadril oscilando, tronco em rotação contrária e braços em oposição;
  - trote e corrida com fase de voo;
  - **IK nas pernas sobre o terreno real**: o pé apoiado não desliza, porque o ciclo é ditado pela distância percorrida;
  - poses de agachar, nadar, montar e golpear.
- **Dinossauros:**
  - corpo contínuo com esqueleto, loftado ao longo de uma coluna, com perfis por plano corporal;
  - crânio por família com mandíbula articulada, dentes, olhos e narinas;
  - patas digitígradas com garras;
  - características de cada espécie: chifres, folho, placas, vela, clava, cristas, cúpula, osteodermos, penas e membranas;
  - padrões de cor por vértice, com variação de tamanho e tom por indivíduo;
  - IK das patas no terreno, inclinação do corpo em rampas, cauda ondulando;
  - pescoço que desce para pastar, mandíbula que mastiga e ruge, deitar dobrando as patas, voo;
  - malha leve à distância.
- **Iluminação e céu:**
  - céu físico (Preetham) com nuvens iluminadas pelo sol, cobertura ligada ao clima, estrelas e lua;
  - cor do sol calculada pela atmosfera: branca ao meio-dia, alaranjada no fim da tarde;
  - luz ambiente gerada do próprio céu (PMREM) mais luz rebatida do chão;
  - neblina atmosférica com altura e brilho na direção do sol, aplicada antes do *tone mapping* com a mesma fórmula do céu, para o horizonte não ganhar faixa;
  - sombras estabilizadas (sem tremido) com alcance e resolução por perfil;
  - adaptação de exposição (entardecer, tempestade, noite);
  - oclusão ambiental GTAO e antisserrilhado MSAA nos perfis Alto e Ultra;
  - sombra de contato sob personagens e animais.
- **Água:**
  - superfície que acompanha o jogador, com profundidade por vértice;
  - transparência na margem, espuma, cor rasa ou profunda;
  - ondas pelo vento, reflexo do céu (Fresnel), brilho do sol e ondinhas de chuva.
- **Chuva e neve:** partículas animadas na GPU, inclinadas pelo vento e com distância de desvanecimento.
- **Construções e ruínas:** madeira em tábuas, casca, pedra, concreto e couro com texturas PBR.
- **Câmera:** campo de visão 58° em 3ª pessoa e 72° em 1ª, enquadramento sobre o ombro, colisão com terreno e objetos, transições suaves.
- **Modelos externos (opcional):**
  - `public/models/manifest.json` permite trocar qualquer espécie, ou o personagem, por um GLB/glTF com animações (ver `public/models/README.md`);
  - o jogo escolhe o clipe pelo estado e ajusta a velocidade do passo à velocidade real;
  - o manifesto vem vazio: **não há modelos artísticos incluídos**.

Comparação com capturas reais das mesmas cenas, antes e depois, no perfil Médio e com renderização por software: `docs/visual/antes-depois-1.jpg` e `antes-depois-2.jpg`. Close dos dinossauros: `docs/visual/dinossauros-close.jpg`. Ciclo de animação do personagem: `docs/visual/personagem-animacao.jpg`.

#### Perfis gráficos

| | Baixo | Médio | Alto | Ultra |
|---|---|---|---|---|
| Resolução do terreno (vértices por setor de 128 m) | 48 | 64 | 96 | 128 |
| Texturas procedurais | 256 px | 512 px | 512 px | 1024 px |
| Mapas normais (terreno, plantas) | não | sim | sim | sim |
| Sombras | não (sombra de contato) | 1024, 55 m | 2048, 70 m | 4096, 90 m |
| Grama densa perto do jogador | raio 28 m | 35 m | 46 m | 57 m |
| Árvores distantes / luz do céu (PMREM) | não / não | sim / sim | sim / sim | sim / sim |
| Oclusão ambiental (GTAO) + MSAA | não | não | sim | sim |
| Distância de setores detalhados | 3 | 4 | 5 | 6 |

- **Durante a partida:** o botão **⚙** no canto superior direito (ou **F2** no PC) abre Gráficos − / + e Automática sem pausar o jogo; a mudança vale na hora.
- **Atalho rápido:** o menu principal e o menu de pausa têm o controle **Gráficos − / +**, que sobe ou desce um perfil (Baixa → Média → Alta → Ultra), e o botão **Automática**. É a mesma opção de Configurações → Qualidade gráfica.
- **Ajustes individuais** sobrepõem o perfil:
  - resolução (40–100%), sombras e distância de visão;
  - densidade da vegetação, **grama e detalhes do chão** e qualidade das texturas;
  - partículas e efeitos;
  - **oclusão ambiental**.
- **O Automático** mede o tempo real de quadro e troca de perfil.
- **Técnicas usadas:**
  - instâncias globais por modelo;
  - nível de detalhe do terreno, das árvores e dos animais;
  - Web Workers para terreno e texturas;
  - descarte antecipado do terreno do horizonte sob a área detalhada;
  - céu desenhado por último;
  - liberação de recursos da GPU ao descarregar setores, trocar animais e trocar de mundo.

### Salvamento, importação e exportação

- **Onde fica:** o mundo vai para o **IndexedDB**, numa transação única, com uma cópia de segurança do salvamento anterior. O **localStorage** guarda só configurações e teclas.
- **Quando salva:** automaticamente a cada 2 minutos, ao minimizar ou fechar a aba, ao morrer e ao reaparecer.
- **Exportar e importar** em JSON, pelo menu de pausa ou pelo menu principal.
- **Validação ao carregar:**
  - estrutura;
  - versão (migração v0→v1→v2; arquivos de versão futura são recusados);
  - **soma de verificação** (detecta arquivo truncado ou corrompido);
  - valores fora de faixa são limitados, e itens, peças e espécies desconhecidos são removidos;
  - animais duplicados são eliminados;
  - habilidades que o XP salvo não paga são descartadas.
- **Se o salvamento principal estiver corrompido,** a cópia de segurança é carregada automaticamente e o jogador é avisado.
- **Também é possível** restaurar a cópia de segurança ou apagar o salvamento pelo menu.
- **Limite honesto:** a soma de verificação detecta corrupção, **não impede** que o próprio jogador edite o arquivo. Isso é proposital num jogo local.
- **Não existe sincronização entre dispositivos.** Para levar o progresso a outro aparelho, use exportar/importar.

### Modo offline

- O build gera um `sw.js` com a lista exata de arquivos produzidos: HTML, JS, CSS, manifesto e ícone.
- Na primeira visita, o Service Worker baixa **todos** de uma vez (`cache.addAll`, tudo-ou-nada). Uma versão incompleta nunca fica ativa.
- O menu mostra "Pronto para jogar sem internet ✓" quando tudo está armazenado, e avisa quando não há conexão.
- Os arquivos com hash são servidos do cache. A página tenta a rede primeiro, para receber atualizações, e cai no cache se estiver sem internet.
- **Nada no jogo usa recursos externos:**
  - sem fontes de CDN;
  - sem modelos, texturas ou sons baixados;
  - sem APIs.
- O teste ponta a ponta confirma isso (zero requisições externas).
- **Testado de verdade:** página carregada, cache completo, rede desligada no navegador, página recarregada, mundo novo gerado, jogado e salvo — tudo sem rede.
- O modo offline só funciona no **build de produção** (`npm run build` + servidor estático com HTTPS ou localhost). No `npm run dev` o menu avisa isso.

## Testes executados e resultados

### Testes automatizados (`npm test`): **172 de 172 passando**

| Arquivo | Cobre |
|---|---|
| `core.test.ts` | RNG e ruído determinísticos, colisão (círculos, caixas, portas, superfícies) |
| `world.test.ts` | terreno, regiões e locais planejados (4 sementes), clima, incêndios, erupções |
| `sectors.test.ts` | carga/descarga de setores sem vazar colisores, recursos coletados não reaparecem e voltam a crescer, objetos dos mistérios, interiores de cavernas, porta aberta persistente |
| `inventory.test.ts` | inventário (pilhas, cheio, atomicidade, ovos por espécie, valores inválidos, saneamento), fabricação (atomicidade, estações, ferramentas, desbloqueios, excedentes, habilidades) |
| `survival.test.ts` | necessidades, frio e fogo, morte por sede, dificuldade, sangramento |
| `ai.test.ts` | catálogo de espécies, memória, fuga, testemunhas, habituação, caça e carcaça, crescimento, semeadura idempotente, uma semana de ecossistema |
| `combat.test.ts` | armadura e tipos de dano, retaliação, fuga quando ferido, laço |
| `taming.test.ts` | métodos de domesticação, recusas, progresso, treino, abandono, montaria, seguir/ficar, cocho, reprodução e incubação até o nascimento, animais de carga, manada em pânico não espanta o indivíduo que já confia |
| `building.test.ts` / `building2.test.ts` | encaixe e validações, escada, energia eólica, horta com rega, incubação, descontos |
| `progression.test.ts` | níveis por disciplina, pontos, pré-requisitos, efeito de todas as habilidades, saneamento |
| `exploration.test.ts` | névoa, cone da luneta, serialização, marcadores, trilha limitada, dados corrompidos, fósseis |
| `mysteries.test.ts` | textos nos 2 idiomas, baterias, requisitos do final, coleta única, saneamento, rádio |
| `save.test.ts` / `save2.test.ts` | migrações v0→v2, soma de verificação, arquivos inválidos, valores impossíveis, fallback para backup, IndexedDB |
| `i18n.test.ts` / `settings.test.ts` | chaves completas (inclusive dinâmicas), troca de idioma, perfis gráficos e saneamento das configurações |
| `graphics.test.ts` | texturas sem emenda e determinísticas, plantas (todas as variantes e níveis de detalhe, vento), pools de instâncias, pesos de solo e trilhas, esqueleto humano (pesos normalizados, altura), as 26 espécies (dados finitos, pesos e ossos válidos, tamanho), perfis gráficos e manifesto de modelos externos (rejeita URLs inseguras; v0.5: velocidades medidas dos clipes, créditos válidos, beber/alerta/morte, taxa de reprodução limitada) |
| `actions.test.ts` (v0.4) | ações por item, fases e quadro de impacto, alternância esquerda/direita, equipar/trocar sem golpear com o item antigo, trocas repetidas, filtro de entrada duplicada, repetição ao segurar, arco (puxar, soltar, toque rápido, sem flechas), tarefa no impacto (coleta), IK do braço alcança cada pose-chave (erro < 2 cm) |
| `buildMode.test.ts` | tela de construção: a pré-visualização segue a mira até o primeiro ajuste e depois fica parada, movimento relativo à câmera nas 4 direções e nas 3 precisões, subir/descer com limites, rotação com e sem encaixe, cancelar, repetição ao segurar, peças flutuando/enterradas, peça colocada igual à pré-visualização com materiais cobrados uma vez, catálogo cobre as 28 peças |
| `alpha.test.ts` | machos Alfa: só machos adultos de espécies grandes, raridade, limites mundial e por região, grupos gerados nunca passam do limite, vida/dano recebido/personalidade aplicados uma vez, salvamento e saneamento, dois Alfas se exibem e só o mais fraco recua sem ninguém se ferir, rival comum recua, fêmeas e machos do mesmo grupo não são afetados |
| `dinos.test.ts` (v0.4) | as 26 espécies geram 3 níveis de detalhe com a mesma silhueta (dados finitos, pesos de osso normalizados), filhotes com proporções próprias, dedo da asa dos pterossauros, reação a golpes proporcional ao tamanho, mosassauro classificado como escamado e sempre em mar profundo ao nadar e caçar |

### Teste no navegador (`npm run test:e2e`): **42 de 42 passando**

Feito no Chromium headless, sobre o build de produção. As ações usam teclado e cliques reais sempre que possível.

- **Jogo básico:**
  - inicialização;
  - movimento com W;
  - colisão contra árvore;
  - coleta com E;
  - fabricação pelo botão da interface;
  - todas as abas;
  - tela de construção: cancelar não cobra, confirmar (mesmo com clique duplo) cria uma peça e cobra uma vez, demolição.
- **Sistemas novos:**
  - domesticação com E e comando pelo painel;
  - caverna: desobstruir, entrar, ler a pintura e sair;
  - bunker com o cartão;
  - farol até o final secreto, com o jogo continuando depois.
- **Salvamento:**
  - exportar (arquivo baixado e verificado);
  - importar arquivo inválido (recusado com mensagem);
  - importar arquivo válido;
  - salvamento corrompido carrega a cópia de segurança, com aviso ao jogador.
- **Idioma:** troca e persistência.
- **Memória e carga:**
  - memória da GPU estável ao revisitar lugares (geometrias: máximo 107 / 114 / 114 em três voltas);
  - apenas os setores próximos carregados;
  - jogo estável com cerca de 1.600 animais simulados.
- **Layout** em 4 tamanhos de tela.
- **Offline real.**
- **Zero requisições externas e zero erros não tratados.**

### Medições reais de desempenho (sem números inventados)

Todas as medições abaixo foram feitas neste ambiente: Intel Xeon 2,8 GHz, 4 núcleos, **sem GPU**. O navegador é o Chromium headless com **renderização por software (SwiftShader)**, ou seja, a CPU emula a GPU. Esses FPS **não representam celulares nem PCs com GPU**. Eles servem para comparar versões e perfis entre si.

**Renderização, 1280×720, cena inicial, média de 20 s:**

| Perfil | v0.2 (antes) | v0.3 (agora) | Triângulos | Chamadas de desenho |
|---|---|---|---|---|
| Baixo | 6,2 FPS | 2,2 FPS | 195 mil (antes 60 mil) | 82 (antes 44) |
| Médio | — | 0,3 FPS | 602 mil | 233 |
| Alto | 1,6 FPS | 0,1 FPS | — (pós-processamento) | — |
| Ultra | — | 0,15 FPS | — | — |

**Carregamento e texturas:**

| Medição | Resultado |
|---|---|
| Tempo até jogar (mundo novo) | Baixo 1,4–2,5 s; Médio 6 s; Alto e Ultra ~12 s (antes: 1,0–1,2 s) |
| Texturas de partida (64 px, na thread principal) | 90–175 ms |
| Texturas na resolução do perfil (Web Worker, sem travar) | 256 px: 1,1–2,0 s; 512 px: 4,2 s; 1024 px: 24 s. Ficam em cache no IndexedDB para as próximas visitas |
| Malha de um setor detalhado (Web Worker) | 26 ms (64 vértices/lado), 41 ms (96), 64 ms (128) |
| Terreno do horizonte (Web Worker separado) | 1,1 s com 240×240; 1,8 s com 320×320 |
| IA e ecossistema por quadro | 0,40 ms (16 ativos) a 0,91 ms (64), medido em Node 22 |
| Tamanho do jogo | 1,07 MB de JS (306 KB gzip) + workers de texturas (12 KB) e terreno (10 KB) + carregador glTF (45 KB, só executado se houver modelos no manifesto; entra no cache offline); CSS 12 KB |

**v0.4 (combate e dinossauros), mesmo método e mesma máquina.** Medições em sequência, v0.3 e v0.4 servidas lado a lado:

| Medição | v0.3 | v0.4 |
|---|---|---|
| Baixo: FPS (média de 20 s) | 2,2 / 1,95 FPS | 2,4 / 2,25 / 2,35 FPS |
| Baixo: tempo até jogar | 1,0–2,1 s | 1,2–1,9 s |
| Baixo: memória JS | 43–45 MB | 51–61 MB |
| Médio: FPS | 0,4 / 0,5 FPS | 0,45 FPS |
| Médio: tempo até jogar | 6,0–6,4 s | 4,2 s |
| Médio: memória JS | 104 MB | 111 MB |
| Braços em 1ª pessoa: passada extra | — | 10,3 ms por quadro (o mundo leva 407 ms no renderizador por software, ~2,5%); CPU 0,05 ms |
| Partículas de impacto: atualização | — | 0,27 ms com 135 partículas ativas (limite 128 sólidas + 64 de poeira; 2 chamadas de desenho) |
| Dinossauro de perto (triângulos) | 6,6–9,7 mil | 9,3–14,9 mil (penas e dentes) |
| Dinossauro a média distância (nível novo) | — | 3,0–4,1 mil |
| Dinossauro longe | 1,5–2,5 mil | 1,4–2,8 mil |

- Com a diferença de FPS dentro do ruído do renderizador por software, **não houve perda de desempenho mensurável**.
- A memória cresceu de 7 a 16 MB, por causa dos modelos de nível médio, dos filhotes e dos braços em 1ª pessoa.
- Primeiro build da v0.4: o carregamento no Médio subiu para 11–20 s, porque os modelos de filhote de todas as espécies eram pré-gerados na tela de carregamento.
  - Correção: agora só são pré-gerados os filhotes próximos ao início. Os outros são gerados na primeira vez em que aparecem, o que pode causar uma pequena pausa única por espécie (20–120 ms, medido em Node).
- Nada disso foi medido em celulares nem em PCs com GPU.

**Interpretação honesta:**
- A v0.3 é bem mais pesada que a v0.2. São mais geometria e shaders por pixel muito mais elaborados (mistura de 7 materiais, céu com nuvens, neblina atmosférica, água com ondas).
- No renderizador por software, o perfil Baixo ficou cerca de 2,8× mais lento que antes.
- Numa GPU real o custo relativo é outro, mas **não pude medir em celulares nem em PCs com GPU**.
- O perfil Automático reduz a qualidade se o tempo real de quadro passar do limite. O Baixo foi enxugado:
  - um caminho rápido do shader do terreno (duas camadas por pixel);
  - água opaca;
  - grama e dinossauros distantes em versão leve;
  - malha do horizonte menor;
  - sem sombras dinâmicas, mapas normais nem pós-processamento.
- **A meta de desempenho em aparelhos reais continua pendente de verificação.**

**v0.5 (modelos de artista), mesmo método:** perfil Baixo, escala de resolução 0,5, 9 grupos (tiranossauros, estegossauros e paquicefalossauros) gerados perto do jogador, média de 8 s. Cada linha é uma rodada; o renderizador por software varia bastante de uma rodada para outra.

| Medição | Só procedurais (manifesto vazio) | Com os 3 modelos externos |
|---|---|---|
| FPS | 2,75 / 2,88 / 2,25 | 1,63 / 1,88 / 1,88 |
| Triângulos por quadro | 190–210 mil | 270–300 mil (antes da redução de malha: 485–500 mil) |
| Chamadas de desenho | 94–111 | 99–111 |
| Tempo de `renderer.render` na thread principal | 6,1 ms/quadro | 10,9 ms/quadro |
| Memória JS | 61–78 MB | 90–98 MB |
| Download extra | — | 6,2 MB (1,6 + 1,3 + 3,4 MB), uma vez; depois fica no cache offline |
| Tempo de download dos 3 GLB (servidor local) | — | 40–143 ms cada |

- **Na renderização por software, o jogo ficou mais lento nessa cena de estresse** (cerca de 20–40% menos FPS) e usa uns 20–30 MB a mais de memória JS.
- **Medidas tomadas para reduzir o custo:**
  - redução de malha (tiranossauro 75%, estegossauro 50%, paquicefalossauro 45% dos triângulos originais);
  - sombras só de perto;
  - retorno ao procedural leve além de 1,2× a distância de detalhe, sem atualizar a animação.
- **Não foi medido em GPU real.**

**v0.5.1 (desempenho):** diagnóstico completo, otimizações e comparação antes e depois em [`docs/desempenho.md`](docs/desempenho.md).
- **Causa real de travadas encontrada:** shaders compilados no meio do jogo, na primeira vez que um dinossauro aparecia (2,5–5,2 s de CPU por sessão de teste). Agora são pré-compilados na tela de carregamento: **0 ms durante o jogo** nas mesmas sessões.
- **Picos removidos:**
  - cálculo da esfera envolvente vértice a vértice em cada animal novo;
  - recálculo da profundidade da água com custo fixo de cerca de 2 ms por quadro.
- **Ferramentas:** painel F3 com CPU por sistema, GPU (onde o navegador permite), pior quadro e memória; `npm run test:perf` para benchmark reproduzível.
- **Qualidade visual:** igual. A diferença média de pixels é 0,33/255 na vitrine.
- **FPS médio:** sem ganho mensurável no renderizador por software, onde a rasterização domina. Não foi medido em GPU real.

### Problemas encontrados e corrigidos na v0.4

- **Arco disparava como golpe corpo a corpo.** Um teste unitário mostrou que, depois de encaixar a flecha, o arco entrava na fase de golpe e gerava um impacto. Corrigido: ele passa direto para "puxar a corda".
- **Ataque apertado durante a troca de item se perdia.** Corrigido: o pedido agora espera o item novo ficar pronto.
- **Toque duplicado passava em quadros lentos.** O filtro contava só o tempo do jogo. Agora também usa o tempo real.
- **Braços em 1ª pessoa:**
  - na lança, a mão esquerda ficava fora do alcance do braço; as poses-chave foram refeitas dentro do alcance;
  - o punho aparecia aberto como um "copo"; agora a palma é fechada e há uma almofada no punho cerrado;
  - a mão de puxar a corda tapava a tela; a puxada visual em 1ª pessoa ficou mais curta, e a flecha continua saindo da corda.
- **Dinossauros:**
  - colarinho aberto entre o pescoço e a cabeça;
  - boca oca ao abrir a mandíbula;
  - mancha clara na coxa;
  - Triceratops com o focinho caído até o chão;
  - Carnotaurus com o crânio igual ao do Alossauro.
- **Pterossauros:**
  - o dedo da asa seguia o IK da caminhada e apontava para a frente;
  - a membrana dobrada formava um lençol enorme;
  - correção: o dedo agora é orientado explicitamente, e a membrana é modelada aberta e se recolhe ao dobrar.
- **Carregamento no perfil Médio dobrou** com a pré-geração de filhotes de todas as espécies (ver medições). Corrigido.
- **Teste de coleta no navegador:** a madeira agora chega no quadro de impacto, não no aperto da tecla. O teste passou a esperar o impacto, com o mesmo critério.
- **Erro meu durante a edição:** um script de edição chegou a esvaziar o README. Ele foi restaurado do git antes de reaplicar as mudanças.

### Problemas encontrados e corrigidos na v0.3

- O monitor de desempenho usava o passo limitado do jogo em vez do tempo real, superestimava o FPS e não reduzia a qualidade em aparelhos lentos.
- Locais planejados podiam cair em rios ou penhascos; agora o terreno ao redor é aplainado.
- Animais ariscos fugiam antes de o jogador conseguir alimentá-los, mesmo quase domesticados; agora a confiança e a aproximação agachada reduzem a distância de fuga.
- O pânico da manada provocado pelo jogador fazia fugir também o animal que já estava quase domesticado, e um animal confiante que passava a 1 m do jogador se assustava; agora quem já confia só fica alerta.
- Uma linha pontilhada aparecia nas emendas entre setores (z-fighting das "saias" do terreno).
- A demolição não mirava na peça olhada.
- No celular em retrato, os botões do topo ficavam sobre as barras de status.
- A regeneração de vida acontecia com a vida em zero.
- Os itens novos não iam para a barra de atalhos.
- As dependências de desenvolvimento foram atualizadas (Vite 6.4.4, Vitest 3.2.7), eliminando o alerta do esbuild no servidor de dev.

**Na transformação visual (v0.3), encontrados nas capturas e corrigidos:**
- **Pele dos dinossauros desconectada:** patas, dedos e mandíbula flutuavam. As matrizes de ligação dos ossos eram calculadas antes de atualizar o grupo.
- **Proporções:** os crânios saíam esféricos, com o dobro da altura real, e as coxas com até 2 m de diâmetro.
- **Chuva invisível em alguns drivers:** uma conta de orientação (produto vetorial com o raio de visão) gerava NaN.
- **`smoothstep` com limites invertidos** (comportamento indefinido no GLSL) na chuva, no céu, nas poças e na água.
- **Padrões de repetição:**
  - losangos de textura nas montanhas distantes, por repetição do ladrilho;
  - quadriculado na água, por interferência de ondas regulares.
- **Troncos pretos e casca em "favo":** tintas de vértice escuras multiplicadas pela textura.
- **Passada do personagem** exagerada como investida: a 3,3 m/s o passo é de trote. O ciclo agora tem fase de apoio e de voo.
- **Rosto:** nariz triangular e queixo pontudo.
- **Luz e exposição:**
  - entardecer quase preto;
  - sombras negras;
  - imagem leitosa por excesso de luz ambiente;
  - neblina mais clara que as nuvens de tempestade.
- **Travadas:**
  - a malha do horizonte levava 1,1 s na thread principal e passou para um worker;
  - os setores também passaram para worker;
  - os modelos de plantas e animais agora são pré-gerados na tela de carregamento.

### Combate no navegador (`npm run test:combat`): **21 de 21 passando**

O teste roda os 15 cenários pedidos no jogo real (build de produção, Chromium, renderização por software):

1. Soco: fases preparação → golpe → recuperação, um impacto.
2. Socos alternam direita/esquerda (`LRL`).
3. Equipar o machado: aparece nas duas vistas, sem modelo duplicado.
4. Cada arma executa sua ação (machado, picareta, lança, faca, porrete, tocha).
5. Golpe no vazio: o quadro de impacto acontece, sem coleta nem efeitos.
6. Acerto: a lança tira vida de um protoceratops no quadro de impacto (34,6 → 11,3), com partículas.
7. Fora do alcance (7 m): nenhum dano.
8. Ataque correndo a 4–6 m/s.
9. Troca no meio do golpe: o item antigo nunca acerta, o novo é usado.
10. Trocas repetidas: termina no último item, um modelo por vista.
11. Machado na árvore dá madeira; picareta na rocha dá pedra.
12. Arco: gasta uma flecha, que sai a 0,39 m do olho, a 44,9 m/s, e cai pela gravidade.
13. Reação do alvo: recuo animado e a IA interrompe o pastar (o protoceratops foge).
14. Trocar para 3ª pessoa no meio do golpe: o golpe termina uma vez, e os braços de 1ª pessoa somem.
15. Celular (toque): toque + clique no mesmo quadro = um ataque; dois pedidos seguidos = um ataque (o segundo é filtrado); segurar o botão repete.

Também verifica que nenhum erro aparece na página. Capturas reais em `docs/visual/combate/`.

## Recursos externos ainda necessários

- **Modelos 3D artísticos com animações (GLB/glTF):**
  - faltam 23 espécies (só tiranossauro, estegossauro e paquicefalossauro têm), o personagem, e os braços e armas em 1ª pessoa com animações de ataque feitas por animador ou capturadas;
  - na busca no Sketchfab não apareceram modelos animados, de origem limpa e anatomicamente aceitáveis para as outras espécies. A maioria dos "gratuitos" é extraída de jogos ([`docs/modelos-externos.md`](docs/modelos-externos.md));
  - o caminho mais realista é encomendar ou comprar modelos com licença clara.
  - Para chegar a um visual realmente cinematográfico, seriam necessários:
    - esculturas com anatomia detalhada (músculos, pele com dobras, rosto humano realista);
    - texturas pintadas ou escaneadas;
    - animações capturadas ou feitas à mão.
- **Texturas fotográficas ou escaneadas** (PBR com cor, normal, rugosidade e AO) de solo, rochas, casca e folhas. Hoje elas são geradas proceduralmente: convincentes de média distância, mas sem a riqueza de uma foto.
- **Vegetação feita por artista** (folhas recortadas de fotos, *impostors* para longe), para substituir os cartões de folha gerados.
- **Bibliotecas CC0** (Poly Haven, ambientCG): o acesso foi liberado na v0.5, mas as texturas e os modelos do mundo ainda não foram integrados.
- **Sons gravados** (opcional). Todo o áudio atual é sintetizado; vocalizações gravadas ou desenhadas por um sound designer soariam mais naturais.
- **Testes em aparelhos reais:** Android, iPhone (incluindo instalação como app pela tela inicial), tablets e PCs com GPU.

## Limitações conhecidas

- **Combate (v0.4):**
  - as animações de ataque são procedurais (poses-chave + IK), não clipes de animador nem captura de movimento;
  - as mãos não têm dedos articulados, só punhos fechados modelados, e de perto aparecem facetadas;
  - não há rastro de movimento (motion trail) nas armas;
  - não há bloqueio, esquiva, ataque carregado nem combos além da alternância de socos;
  - o acerto em animais usa uma esfera aproximada, não o corpo real;
  - não existem armas de fogo.
- **Modelos de artista (v0.5):** limitações específicas em [`docs/modelos-externos.md`](docs/modelos-externos.md):
  - o tiranossauro não tem clipe de andar (usa a corrida em câmera lenta);
  - filhotes usam o modelo do adulto em escala menor;
  - sem IK de olhar e mandíbula nem reação corporal procedural a golpes nesses três;
  - a troca para o modelo procedural ao longe é visível se observada.
- **Visual (sem fotorrealismo):**
  - o personagem e 23 das 26 espécies são procedurais, com esqueleto e pele contínua (detalhes da v0.4 e o que ainda falta em [`docs/dinosaurs.md`](docs/dinosaurs.md));
  - o rosto humano é simples, sem expressões nem dedos articulados;
  - os dinossauros não têm músculos, dobras de pele nem rugas esculpidas, e a anatomia é aproximada por seções;
  - as animações são procedurais, não capturadas;
  - as árvores usam cartões de folha;
  - não há reflexos em tempo real (a água reflete só o céu), dispersão subsuperficial na pele nem nuvens volumétricas de verdade (a camada de nuvens é 2D com iluminação aproximada).
- **Desempenho em dispositivos reais** não medido (ver acima). A v0.3 custa bem mais que a v0.2 por quadro; o perfil Automático deve compensar, mas isso não foi verificado em aparelhos.
- **Luzes:** a oclusão ambiental (GTAO) não considera o balanço do vento nas folhas, só a pose de repouso.
- **Horizonte:** o terreno distante é uma malha única de 40 a 100 m por vértice, então montanhas muito longe ficam facetadas. Ao teleportar, o chão próximo leva um instante para chegar do worker.
- **Simplificações de jogabilidade:**
  - cavernas são câmaras únicas, alcançadas por transição, e não túneis contínuos no terreno;
  - construções não têm durabilidade e não são destruídas por animais;
  - grupos não têm hierarquia de dominância nem disputas territoriais individuais;
  - montaria só no chão: pterossauros não carregam o jogador.
- **Persistência:**
  - o progresso parcial de um recurso que está sendo coletado (golpes dados) não é salvo, só o esgotamento;
  - animais muito distantes seguem uma simulação simplificada (não há caça ou fuga detalhada fora da área próxima).
- **Gamepad:** mapeamento fixo, sem tela de reconfiguração.
- **Testes:**
  - os testes no navegador usam Chromium; Safari/iOS e Firefox não foram testados;
  - os testes ponta a ponta exigem o Playwright, que não é dependência do projeto (`PLAYWRIGHT=/caminho/node_modules/playwright npm run test:e2e`, com `npm run preview` rodando).
- **Dependências de desenvolvimento:** o `npm audit` aponta 3 alertas no **Vitest 3** (`@vitest/mocker` e `tinypool`), que só afetam quem roda os testes. A correção exige o Vitest 4, que o npm 10.9.4 deste ambiente não conseguiu instalar por um erro interno (`Cannot read properties of null (reading 'edgesOut')`). **O jogo publicado não contém dependências vulneráveis** (`npm audit --omit=dev`: 0).

## Arquitetura

```
src/
  core/          game.ts (orquestração, ciclo, salvamento), interactions.ts (tudo que o jogador faz no mundo), config, RNG, ruído
  world/         terreno, biomas, setores e LOD, cavernas, colisão, clima, visual do ambiente;
                 plants (modelos de plantas), groundShading (materiais do solo), groundCover (grama densa),
                 vegetationPools (instâncias globais), terrainMesh/terrainWorker e farTerrain (horizonte)
  graphics/      texgen (texturas PBR procedurais), textureLibrary (carregamento progressivo e cache),
                 terrainMaterial, vegetationMaterial, sky, atmosphere (neblina física), water,
                 precipitation, wind, postfx (GTAO), contactShadow, externalModels (GLB/glTF de artistas, créditos),
                 impactFx (lascas, poeira, respingos)
  animals/       espécies, estado do animal, ecossistema, dinoModel (dinossauros com esqueleto, 3 LODs, filhotes),
                 animalView (pose, IK, comportamentos, reação a golpes), aquatic (animais marinhos)
  ai/            cérebro (percepção, decisão, domesticados, montaria) e memória
  taming/        perfis por espécie, regras de confiança/treino, controlador (cochos, coletores, reprodução)
  combat/        armadura, tipos de dano, armadilhas; actions (máquina de estados das ações: fases, impacto, equipar, arco)
  progression/   disciplinas, XP, habilidades e seus efeitos
  exploration/   névoa do mapa, trilha, marcadores, fósseis
  mysteries/     documentos, estado da investigação, requisitos do final
  player/        controle, câmera, humanModel (personagem com esqueleto), playerView (animação e IK),
                 armPose (poses-chave dos golpes + IK dos braços, 1ª e 3ª pessoa), viewmodel (braços em 1ª pessoa),
                 itemModels (ferramentas e armas na mão)
  survival/  inventory/  crafting/  building/  input/  ui/  audio/  performance/  save/  localization/  dev/
tests/           testes unitários e de integração (Vitest) + tests/e2e/run.mjs e combat.mjs (navegador)
docs/            dinosaurs.md (inventário das espécies), modelos-externos.md (busca e integração) e visual/ (capturas antes e depois)
public/models/   GLBs de artistas + manifest.json (créditos e clipes)
tools/           optimize-model.mjs (normaliza e otimiza um GLB baixado)
```

Para adicionar uma espécie: inclua uma entrada em `src/animals/species.ts`, outra em `src/taming/profiles.ts` (e, se for blindada, em `src/combat/combat.ts`) e coloque-a na tabela de fauna de um bioma em `src/world/biomes.ts`. Os testes verificam se faltou algo, inclusive as traduções.

### Licença criativa paleontológica

O continente é uma síntese ficcional do Mesozoico: espécies de épocas diferentes convivem de propósito, e o período real de cada uma aparece no diário. Mesmo assim, a anatomia segue as evidências atuais:

- dromeossauros com penas;
- *Velociraptor* com cerca de 1,8 m;
- *Dilophosaurus* sem folho e sem veneno;
- pterossauros e *Sarcosuchus* classificados como não dinossauros.

Caça em matilha e outros comportamentos sociais pouco documentados são hipóteses de jogo. A história do "Fenômeno" é ficção.
