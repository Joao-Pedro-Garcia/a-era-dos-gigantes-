# Era dos Gigantes

Jogo 3D de sobrevivência pré-histórica em mundo aberto, feito para navegador (computador, Android, iPhone e tablets), com Three.js, TypeScript e Vite.

> **Estado: v0.3, jogável e integrado, com transformação visual.**
> - Todos os sistemas pedidos têm implementação real, conectada ao inventário, ao mundo e ao salvamento.
> - A v0.3 substituiu os modelos de primitivas por geometria e texturas PBR geradas pelo código: personagem e dinossauros com esqueleto, árvores ramificadas, terreno com materiais misturados, céu físico com nuvens, água, chuva e iluminação baseada no céu.
> - Tudo é coberto por 128 testes automatizados e por 39 verificações num navegador real.
> - O visual **não é fotorrealista**: sem modelos e texturas artísticos, ele continua procedural.
> - O que depende de recursos externos e as limitações conhecidas estão no fim deste documento, sem rodeios.

## Instalação e execução

```bash
npm install          # dependências (Node 18+; testado com Node 22 / npm 10)
npm run dev          # servidor de desenvolvimento (também acessível pela rede local, para testar no celular)
npm run build        # checagem de tipos + build de produção em dist/ (gera também o Service Worker)
npm run preview      # serve o build de produção em http://localhost:4173
npm test             # 128 testes automatizados (Vitest)
npm run test:e2e     # 39 verificações num navegador real (ver "Testes")
```

A única dependência de execução é `three` (0.170.0). Não há servidores, chaves de API nem serviços externos.

Páginas de diagnóstico:

- `?showcase` mostra as 25 espécies lado a lado.
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
| Atacar / coletar / usar ferramenta (luneta, sinalizador) / colocar peça | clique | Ação | RT |
| Usar item da mão (comer, curar, cantil, sinalizador) | F | Comer | — |
| Atalhos | 1–6, roda | toque na barra | — |
| Inventário, Fabricação, Habilidades, Animais, Diário, Mapa | Tab / I, M | Itens, 🗺 | Y |
| Construção (Q/R girar, G encaixe, X demolir o que está olhando) | B | Construir | LT |
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

### Dinossauros e IA (25 espécies)

- **Comportamento:** percepção por visão, audição e **olfato a favor do vento**. A cobertura da selva reduz a visibilidade do jogador.
- **Memória e personalidade:** memória episódica limitada e personalidade individual. A habituação e a confiança mudam com a convivência.
- **Ferimentos:** um animal ferido cambaleia. Os valentes retaliam; os muito feridos fogem, a menos que estejam protegendo filhotes.
- **Grupos:** alarme com atraso individual e defesa de território e de filhotes.

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
- **Colocação:** encaixe automático ou posição livre, com pré-visualização verde/vermelha. A validação recusa água, inclinação, obstáculos, falta de apoio, sobreposição, distância, falta de materiais e peças bloqueadas.
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

### Testes automatizados (`npm test`): **128 de 128 passando**

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
| `graphics.test.ts` | texturas sem emenda e determinísticas, plantas (todas as variantes e níveis de detalhe, vento), pools de instâncias, pesos de solo e trilhas, esqueleto humano (pesos normalizados, altura), os 25 dinossauros (dados finitos, pesos e ossos válidos, tamanho), perfis gráficos e manifesto de modelos externos (rejeita URLs inseguras) |

### Teste no navegador (`npm run test:e2e`): **39 de 39 passando**

Feito no Chromium headless, sobre o build de produção. As ações usam teclado e cliques reais sempre que possível.

- **Jogo básico:**
  - inicialização;
  - movimento com W;
  - colisão contra árvore;
  - coleta com E;
  - fabricação pelo botão da interface;
  - todas as abas;
  - construção e demolição.
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

### Problemas encontrados e corrigidos nesta fase

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

## Recursos externos ainda necessários

- **Modelos 3D artísticos com animações (GLB/glTF):**
  - um por espécie (25) e um para o personagem;
  - o jogo já sabe usá-los pelo `public/models/manifest.json`, escolhendo o clipe pelo estado e sincronizando o passo;
  - não há arquivos incluídos, e os modelos atuais são procedurais.
  - Para chegar a um visual realmente cinematográfico, seriam necessários:
    - esculturas com anatomia detalhada (músculos, pele com dobras, rosto humano realista);
    - texturas pintadas ou escaneadas;
    - animações capturadas ou feitas à mão.
- **Texturas fotográficas ou escaneadas** (PBR com cor, normal, rugosidade e AO) de solo, rochas, casca e folhas. Hoje elas são geradas proceduralmente: convincentes de média distância, mas sem a riqueza de uma foto.
- **Vegetação feita por artista** (folhas recortadas de fotos, *impostors* para longe), para substituir os cartões de folha gerados.
- **Possível uso de bibliotecas CC0** (Poly Haven, ambientCG): o ambiente de desenvolvimento não tinha acesso a esses sites, por isso não foram usadas.
- **Sons gravados** (opcional). Todo o áudio atual é sintetizado; vocalizações gravadas ou desenhadas por um sound designer soariam mais naturais.
- **Testes em aparelhos reais:** Android, iPhone (incluindo instalação como app pela tela inicial), tablets e PCs com GPU.

## Limitações conhecidas

- **Visual (sem fotorrealismo):**
  - o personagem e os dinossauros são procedurais, com esqueleto e pele contínua;
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
                 precipitation, wind, postfx (GTAO), contactShadow, externalModels (GLB/glTF opcionais)
  animals/       espécies, estado do animal, ecossistema, dinoModel (dinossauros com esqueleto), animalView (pose e IK)
  ai/            cérebro (percepção, decisão, domesticados, montaria) e memória
  taming/        perfis por espécie, regras de confiança/treino, controlador (cochos, coletores, reprodução)
  combat/        armadura, tipos de dano, armadilhas
  progression/   disciplinas, XP, habilidades e seus efeitos
  exploration/   névoa do mapa, trilha, marcadores, fósseis
  mysteries/     documentos, estado da investigação, requisitos do final
  player/        controle, câmera, humanModel (personagem com esqueleto), playerView (animação e IK)
  survival/  inventory/  crafting/  building/  input/  ui/  audio/  performance/  save/  localization/  dev/
tests/           testes unitários e de integração (Vitest) + tests/e2e/run.mjs (navegador)
```

Para adicionar uma espécie: inclua uma entrada em `src/animals/species.ts`, outra em `src/taming/profiles.ts` (e, se for blindada, em `src/combat/combat.ts`) e coloque-a na tabela de fauna de um bioma em `src/world/biomes.ts`. Os testes verificam se faltou algo, inclusive as traduções.

### Licença criativa paleontológica

O continente é uma síntese ficcional do Mesozoico: espécies de épocas diferentes convivem de propósito, e o período real de cada uma aparece no diário. Mesmo assim, a anatomia segue as evidências atuais:

- dromeossauros com penas;
- *Velociraptor* com cerca de 1,8 m;
- *Dilophosaurus* sem folho e sem veneno;
- pterossauros e *Sarcosuchus* classificados como não dinossauros.

Caça em matilha e outros comportamentos sociais pouco documentados são hipóteses de jogo. A história do "Fenômeno" é ficção.
