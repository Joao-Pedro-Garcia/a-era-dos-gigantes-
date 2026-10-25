# Modelos externos de dinossauros: busca e integração (v0.5)

## Como foi feita a busca

- **Fonte:** API do Sketchfab, apenas modelos baixáveis com licença **CC0** ou **CC BY**.
- **Primeira busca:** de 24 a 48 resultados por espécie, para as 26 espécies.
- **Busca complementar:** com filtro "animado" e por autor.
- **Triagem:** cada candidato teve a descrição lida, para saber de onde o modelo vinha.
- **Teste dos aprovados:** cada um foi baixado e renderizado quadro a quadro no Three.js (a mesma biblioteca do jogo), para conferir:
  - aparência;
  - orientação;
  - escala;
  - se as animações são ciclos de locomoção de verdade.
- **Medição da locomoção:** a velocidade de cada clipe de andar e correr foi medida pelo movimento dos dedos do pé durante o apoio.

## Integrados (3 de 26 espécies)

| Espécie | Modelo | Por que foi escolhido |
|---|---|---|
| Tiranossauro | LasquetiSpice: "Animated Tyrannosaurus Rex Dinosaur Running Loop" | Anatomia boa e pele escamosa (compatível com a evidência atual para adultos). Clipes de correr, morder, rugir e parado. Estúdio de animação que publica o próprio trabalho. |
| Estegossauro | Ferocious Industries: "PBR Stegasaurus (Animated)" | Pacote de jogo completo (13 clipes): andar, correr, comer, beber, golpe de cauda e morte. Estúdio publicando o próprio modelo. |
| Paquicefalossauro | Ferocious Industries: "PBR Pachycephalasaurus (Animated)" | Pacote de jogo completo (21 clipes): andar, correr, comer, beber, dormir e cabeçada. |

Capturas antes e depois, com o mesmo enquadramento, estão em [`visual/modelos/`](visual/modelos/), e o resumo está em `compare.jpg`.

## Integrados depois, a pedido (18/10/2026)

| Espécie | Modelo | Observação |
|---|---|---|
| Velocirraptor | absol_cg: "Velociraptor" (CC BY 4.0; esculpido no ZBrush, pintado no Substance e animado no Blender pelo próprio autor) | Clipes de andar, correr, comer e rugir. **Não tem penas**: contraria a evidência atual (dromeossaurídeos eram emplumados). Entrou porque você pediu os modelos mais bonitos; para voltar ao raptor com penas, basta tirar a entrada `velociraptor` de `public/models/manifest.json`. Parado, ele usa o clipe de "comer" (farejando o chão), porque o arquivo não tem clipe de repouso. Na corrida máxima (10 m/s), o clipe toca cerca de 8× mais rápido que o original, para os pés não escorregarem; a cadência fica muito rápida. |
| Arqueoptérix | khata: "Archaeopteryx" (CC BY 4.0; estudo de penas do próprio autor) | Penas de verdade (cartões de pena) e clipe de bater as asas, usado no voo. **Não tem clipe de andar**: no chão, ele usa o de inclinar a cabeça e desliza ao se mover. São 70 mil triângulos, um modelo pesado para um animal de 50 cm. |

### Espinossauro: pele do artista animada pelo esqueleto do jogo

O espinossauro de **seirogan** ("Spinosaurus_animation", CC BY 4.0) é realista, mas tem uma única animação. Em vez de descartá-lo, a pele dele foi **religada ao esqueleto do jogo**:
- cada um dos 78 ossos do artista foi ligado a um osso do jogo (campo `rig` do manifesto), e os pesos de pele do artista foram somados nesses ossos;
- as juntas do esqueleto do jogo foram colocadas nas posições das juntas do artista (`src/animals/rigFits.ts`);
- o jogo anima esse esqueleto como faz com os modelos feitos por código: passos ajustados ao terreno, cabeça, mandíbula, respiração, viradas e morte. A pele realista acompanha.

Limites: o modelo tem pernas longas, no estilo das reconstruções anteriores a 2014, e a cauda não tem a forma de remo. A pose de encaixe veio com a boca aberta, e o jogo a fecha com um ângulo fixo. Os filhotes continuam com o modelo feito por código. Captura: [`visual/modelos/espinossauro-realista.jpg`](visual/modelos/espinossauro-realista.jpg).

A mesma técnica serve para outros modelos realistas **com esqueleto** e poucas animações.

Ficaram de fora, mesmo com boa aparência:
- **Quetzalcoatlo de seirogan:** um único clipe de voo e 200 mil triângulos (candidato à mesma técnica do espinossauro).
- **Pteranodonte de oscar.lopez.riviello:** tem animações completas, mas a conta publica modelos extraídos de jogos e filmes e não informa a origem deste. Risco de direito autoral.

## Estilo dos filmes (decisão de 19/10/2026)

A pedido, o visual dos dinossauros passa a priorizar o **estilo dos filmes Jurassic Park/World**, mesmo onde isso contradiz a ciência. Nenhum modelo copiado dos filmes ou dos jogos oficiais é usado (direito autoral). O jogo usa só modelos livres e geração própria, no estilo dos filmes:
- **Tiranossauro:** textura do modelo de LasquetiSpice recolorida (pele azul e listras vermelhas → marrom-oliva); boca, olhos, dentes e ventre mantidos. A cor original do artista (azul com listras vermelhas) continua no jogo como **variação rara**: cerca de 12% dos tiranossauros (campo `variants` do manifesto; cada indivíduo tem sempre a mesma cor).
- **Velocirraptor:** tamanho dos filmes (3,6 m, quadril a 1 m, 70 kg) e sem penas, também no modelo visto de longe.
- **Dilofossauro:** pequeno e esguio como no filme (3,2 m, quadril a 0,9 m, 60 kg; o real tinha ~7 m e ~400 kg), com gola de leque amarela e vermelha no pescoço (invenção do filme; sem evidência fóssil).
- **Compsognato e galimimo:** sem penas.
- **Espinossauro:** o modelo de seirogan já tem o visual do JP3 (pernas longas, cauda fina).



**Extraídos de jogos ou filmes** (licença CC BY declarada pelo uploader, mas o modelo não é dele):
- Jurassic World Evolution, Jurassic Park 3 e "JW";
- Prehistoric Kingdom (toda a série "Accurate …");
- ARK;
- GMod, incluindo o "Tyrannosaurus Rex Rig" de 30 animações;
- Dino Hunter: Deadly Shores;
- Dinosaur Hunter Dino City;
- Mesozoic Mix-Up;
- Magical Truck Adventure;
- "from unity";
- "cred HATOGAME";
- "Dinoraul's …";
- "DracoWarrior's …";
- Frontier/Universal.

Também foram descartadas as versões "rebuilt" de kenchoo baseadas nesses modelos (tricerátopo, espinossauro, anquilossauro, parassaurolofo, carnotauro, barionix e protocerátopo). Exceção: o estegossauro de kenchoo, baseado num modelo de CGreature em CC BY, teria origem legítima. Mesmo assim ficou de fora, porque o único clipe dele é parado.

**Sem ciclo de locomoção utilizável** (o animal deslizaria ao andar):

| Modelo | Problema |
|---|---|
| Espinossauro de seirogan | O único clipe é uma "atuação": olha em volta e dá um passo. |
| Arqueoptérix de khata | Só tem clipes de inclinar a cabeça e bater as asas. Visual excelente. |
| Quetzalcoatlo de seirogan | Só tem um clipe de voo; além disso, tem 200 mil triângulos. |
| Carnotauro de olahamieh | Um clipe quase parado; o arquivo traz objetos extras. |

**Contra a premissa científica do jogo:**
- Velociraptores sem penas: absol_cg e Ferocious Industries. O jogo segue a evidência atual de dromeossaurídeos emplumados, e o modelo procedural com penas foi mantido.

**Arquivos quebrados ou fora de escala:** três modelos de victory_ (tricerátopo, terizinossauro e deinosuco) trazem objetos espalhados e escalas de milhares de unidades.

**Origem duvidosa do uploader:** o pteranodonte de oscar.lopez.riviello é animado e razoável, mas a mesma conta publica extrações (Godzilla NECA, Sonic). Ficou de fora por precaução.

## Limitações reais

- **Só 6 das 26 espécies têm modelo de artista** (tiranossauro, estegossauro, paquicefalossauro, velocirraptor, arqueoptérix e espinossauro). As outras 20 continuam procedurais. Para elas, não foi encontrado um modelo animado, de origem limpa e anatomicamente aceitável.
- **O tiranossauro não tem clipe de andar.** Em velocidade de caminhada, ele usa o clipe de corrida em câmera lenta (cerca de 0,2×). Os pés não deslizam, mas o gesto é de corrida.
- **Cores do tiranossauro:** são as do autor (azulado com listras vermelhas), não as cores da espécie no jogo.
- **Paquicefalossauro em fuga:** a 8 m/s, o clipe de corrida (animado para cerca de 3,6 m/s) toca a 2,2×. Os pés acompanham o chão, mas a cadência fica bem rápida.
- **Distância:** além de 1,2× a distância de detalhe, entra o modelo procedural leve, e a troca de aparência é visível se observada.
- **Filhotes:** usam o mesmo modelo do adulto, em escala menor; as proporções juvenis dos procedurais não se aplicam.
- **Mãos e mandíbula:** não são controladas pelo jogo (o modelo externo não recebe a IK de olhar e de mandíbula dos procedurais).
- **Reação a golpes:** a resposta corporal procedural não se aplica aos modelos externos; o animal reage pelo clipe de estado.
- **Desempenho:** veja a medição no README. Com 16 modelos externos na tela, os triângulos subiram cerca de 30–60% e o FPS no renderizador por software caiu. Não foi medido em GPU real.

## Carnotauro (modelo de artista com esqueleto do jogo)
- **Modelo:** "Rigid Carnotaurus-Sastrei", de olahamieholahamieholahamieh, licença CC BY 4.0: https://sketchfab.com/3d-models/rigid-carnotaurus-sastrei-232b60653c1740fa8570b6c90b377871
- **Preparação:**
  - removida uma malha de dentes defeituosa (`Cone.025`, espalhada por mais de 100 m);
  - simplificado de 209 mil para 63 mil triângulos (3,3 MB);
  - texturas reduzidas a 1024 px.
- **Cor no estilo do filme:** a textura foi recolorida de marrom-escuro e barriga rosada para **marrom-avermelhado com manchas pretas e barriga castanho-clara**. Olhos e boca foram mantidos.
- **Animação:** como no espinossauro, a pele do artista foi religada ao esqueleto do jogo (campo `rig` com 43 ossos e `RIG_FITS.carnotaurus`). Por isso ele usa todas as animações e golpes do jogo: andar, correr, mordida, cabeçada e rabada.
- **Junção das partes:** o jogo agora junta todas as malhas com esqueleto de um arquivo (corpo em duas partes, olhos e dentes) numa só, com um material por parte.

## Terizinossauro, dodô e deinosuco (modelos de artista no esqueleto do jogo)
| Espécie | Modelo (CC BY 4.0) | Preparação |
|---|---|---|
| Terizinossauro | victory_, "Therizinosaurus dinosaur" | Removidas as peças soltas (cubos e esfera a dezenas de milhares de unidades). O arquivo está modelado com a cabeça para −x: girado com `rigRotY` e apoiado no chão com `rigFloor`. A cor original (cinza-escuro) já combina com a referência. |
| Dodô | BlueMesh, "Dodo [ Extinct Bird ]" | Removida uma esfera solta. **Escurecido a pedido**: cinza-amarronzado, com bico e patas na cor original. As pernas são um osso só no arquivo, então se movem inteiras. |
| Deinosuco | victory_, "deinosuchus" | Removidas as peças soltas. A linha do corpo está deslocada no arquivo (`rigShiftX`). |

Os três usam o mesmo processo do carnotauro (`rig` no manifesto e `RIG_FITS`).

**Megatério de AneesAnimates:** ficou de fora por enquanto. O modelo está de pé, sobre as patas traseiras, e no jogo o megatério anda de quatro: os braços não alcançariam o chão.

**Descartado:** o dilofossauro de LilCick. A conta publica personagens de jogos e filmes, e o modelo não informa a origem.

## Modelos sem esqueleto: sarcosuco e barionix (esqueleto automático)
Alguns modelos bons vêm **sem esqueleto**. Para eles o jogo calcula os pesos da pele sozinho (`autoSkin` no manifesto):
- o esqueleto do jogo é encaixado nas partes do modelo (`RIG_FITS`), medidas por fatias ao longo do corpo;
- cada vértice fica preso aos 2 ou 3 ossos mais próximos, com peso que cai com a 4ª potência da distância;
- ossos muito mais distantes que o mais próximo são ignorados, para a perna não puxar a barriga.

| Espécie | Modelo (CC BY 4.0) | Preparação |
|---|---|---|
| Sarcosuco | pjmedranog, "sarcosuchus" | O modelo está de boca aberta. A mandíbula de cima é fechada na própria malha (`closeMouth`, 0,45 rad); com mais que isso os dentes atravessavam a mandíbula. |
| Barionix | add4d, "Baryonix- Walkeri" | É uma estátua: a base de pedra (cerca de 230 mil vértices) foi cortada abaixo da altura dos pés. O corpo, posado na diagonal, foi alinhado (`rigRotY`, `rigShiftX/Z`) e simplificado para 49 mil triângulos. |

## O que ainda não entrou
| Espécie | Motivo |
|---|---|
| Quetzalcoatlo (seirogan) e pteranodonte (victory_) | O esqueleto de asas precisa de um mapeamento próprio. |
| Megatério (AneesAnimates) | O modelo está de pé e no jogo ele anda de quatro. |
| Mosassauro (tilossauro de FreddyFoxFreddy) | O modelo está curvado em S (pose de nado); com esqueleto reto ficaria torto. |
| Tricerátops (aumakua) | É o escaneamento de uma miniatura de plástico: o desenho é do fabricante do brinquedo. |
| Braquiossauro, anquilossauro, parassaurolofo, dilofossauro, compsognato, microraptor, galimimo, iguanodonte, alossauro, protocerátops, paquirrinossauro, troodonte, smilodonte, sucuri e pteranodonte | Nenhum modelo gratuito de origem limpa e boa qualidade. Os bons do AneesAnimates são pagos. |

## Rodada de busca (outubro): pterossauros e megatério
Integrados (CC BY 4.0, com crédito no jogo), usando as animações do próprio arquivo:
- **Pteranodonte**: "pteranodon dinosaur" de *victory_* (voo, pousado, grito). Escala 0,042.
- **Quetzalcoatlo**: "Pterosaur_Quetzalcoatlus" de *seirogan* (batida de asas); girado 180°,
  simplificado para ~140 mil triângulos (o mais pesado; longe ele troca para o procedural).
- **Megatério**: "Animated Megatherium (Free)" de *AneesAnimates* (caminhada em pé). ~3,7 m.

Limitações: os pterossauros só têm animação de voo/pouso — no chão o quetzalcoatlo
fica com as asas abertas; o megatério anda sempre em pé (sem caminhada em 4 patas).

Recusados nesta busca (direitos): tricerátops/anquilossauro "Amazing Dinoworld" (tirados
do site da NHK), parassaurolofo/anquilossauro do kenchoo (derivados de Jurassic World
Dominion / "ANKY-ANKY 2001"), reenvios do usuário slang107123456789 (mosassauro,
compsógnato, alossauro) de origem não comprovada. Sem modelo livre aceitável: alossauro,
braquiossauro, iguanodonte, galimimo, dilofossauro, paquirrinossauro, protocerátops,
troodonte, microraptor, smilodon, sucuri.

## Parassaurolofo e anquilossauro de artista
Pedido do usuário com fotos de referência. Busca ampla (12 termos, Sketchfab) e verificação
de origem; integrados com pele automática (`autoSkin`) e esqueleto encaixado (`RIG_FITS`):
- **Parassaurolofo**: "Parasaurolophus" de *htqj* (CC BY 4.0), modelo próprio do autor.
  O arquivo vem deitado e com ossos de nomes corrompidos: `tools/model-flatten.mjs` assa as
  transformações em pé (−90° em X) e remove o esqueleto; olhos e garras soltos (presos a
  ossos fora do lugar) foram retirados; textura clareada (`tools/brighten-texture.mjs`).
- **Anquilossauro**: "Dino - Ankylosaurus" de *pikabobalex* (CC BY 4.0), esculpido pelo autor
  em ZBrush; material spec/gloss convertido; textura clareada para verde-oliva.
Recusados na mesma busca: modelos tirados de Jurassic World Evolution/Dominion, ARK,
Prehistoric Kingdom, LEGO, Turok, Carnivores, Dino Crisis, Dinosaur Hunting, "Amazing Dinoworld"
(NHK) e reenvios de origem duvidosa.

## Rodada de 23/10/2026: tricerátops, braquiossauro, dilofossauro e compsógnato
Pedido do usuário com fotos de referência. Busca no Sketchfab (24 termos, com e sem animação),
em contas de artistas já verificados e em outros sites (Free3D, CGTrader, TurboSquid, RenderHub,
Fab, 3D CAD Browser). Fora do Sketchfab, tudo era pago ou de uso restrito ("Editorial Only").

**Integrados** (CC BY 4.0, crédito no jogo; pele automática `autoSkin` e esqueleto em `RIG_FITS`):
- **Braquiossauro**: "Animated Argentinosaurus (Free)" de *AneesAnimates*. É um titanossauro, não
  um braquiossaurídeo, mas tem a mesma silhueta da foto (pescoço erguido, cabeça a ~12 m).
  O nome do material (`tripo_mat`) indica que foi gerado com a ferramenta Tripo, não esculpido à
  mão como diz a descrição; a licença continua sendo CC BY. Preparação: deitado no arquivo
  (girado +90° em X), material spec/gloss convertido, mapa de oclusão retirado (escurecia
  pela metade), textura recolorida de verde-acinzentado para **bronze-acinzentado**
  (`tools/grey-texture.mjs`, ganho 1,7), simplificado para 56 mil triângulos (2,3 MB).
  Diferença real: as patas da frente não são mais altas que as de trás, como no braquiossauro.
- **Tricerátops**: "triceratops" de *victory_*. Três esferas soltas a milhares de unidades
  foram retiradas; a pele foi assada na pose de repouso pelo próprio esqueleto
  (`tools/skin-bake.mjs`), porque as partes ficavam espalhadas fora dele. Recolorido de
  verde-azulado e laranja para **cinza-amarronzado** (`grey-texture.mjs ... all`), chifres em
  marfim. O desenho do modelo é um pouco estilizado (olho e proporções de desenho animado).

**Sem modelo livre de origem limpa: melhorados no procedural**
- **Dilofossauro**: as cristas apareciam pretas. Cada crista era desenhada dos dois lados com
  os mesmos vértices, e as normais opostas se anulavam. Agora cada face tem os seus vértices;
  cristas na cor da pele da cabeça.
- **Compsógnato**: pescoço longo em S, quase vertical, com a cabeça a ~2× a altura do quadril
  (traço `sNeck`), corpo e cabeça mais finos, pernas mais longas (quadril 0,32 m), verde mais
  claro e garganta avermelhada.

**Recusados por origem** (contas que publicam personagens de jogos e filmes):
- *CGreature*: Grievous, Skyrim, Saurian, Primal Carnage, King Kong.
- *nobilishornet2*: Jurassic World Alive/Evolution, Prehistoric Kingdom.
- *LilCick*: Monster Hunter, Godzilla, Indominus.
- *SammyTheCitipati* e reenvios de *slang107123456789*: sem fonte.
- *ericksalinasr07*: montagem de modelos de outros autores.
- Também recusados: "Dino Stalker", "Dino Hunter", "Dinosaur Hunting", "from unity".

## Rodada de 23/10/2026 (2): troodonte, galimimo e mosassauro
Busca no Sketchfab para nove espécies, com verificação da origem de cada conta.

**Integrados** (CC BY 4.0, crédito no jogo; pele automática `autoSkin` e esqueleto em `RIG_FITS`):

| Espécie | Modelo | Preparação |
|---|---|---|
| Troodonte | "Troodon", de *budiastuti1271* | Material spec/gloss convertido; simplificado para 40 mil triângulos. A cabeça está virada um pouco para o lado no arquivo; o encaixe segue essa posição. O "troodon" de *ShinGoji729* é cópia do mesmo arquivo (tem o mesmo número de vértices e foi publicado depois). |
| Galimimo | "Blender \| Gallimimus", de *SkinnyDoesModels* | O arquivo está no meio de uma corrida: em nenhum quadro os dois pés tocam o chão, e na pose de repouso a pata esquerda fica levantada. A pele foi assada no quadro em que a pata direita está apoiada embaixo do corpo (0,78 s), e a direita foi espelhada na esquerda. O esqueleto do arquivo é simétrico (as matrizes de ligação conferem a 0,0000). Ferramenta: `tools/skin-bake.mjs src dst 0 0.78 r`. |
| Mosassauro | "mosasaur", de *victory_* | Modelado ao longo de −x (`rigRotY` = π/2) e com a boca aberta (`closeMouth` 0,4). Não tinha textura de cor, só mapa de relevo. Foi gerada uma textura pelas UVs do próprio modelo: dorso azul-acinzentado escuro, barriga creme, manchas de ruído. Olho com material escuro, dentes em marfim. Simplificado para 68 mil triângulos. |

**Sem modelo aceitável** (continuam procedurais):
- **Sucuri:** o modelo de *ayoubbenz* é bom, mas a conta publica skins tiradas do PUBG. Os outros resultados são revólveres "Anaconda" ou modelos sem textura.
- **Smilodonte:** só crânios fósseis, modelos de blocos ou de desenho animado. O "Sabre" é reenvio do slang107123456789, e o "Diego" é do filme Ice Age.
- **Protocerátops e paquirrinossauro:** só modelos sem textura, de blocos, de Daz Studio ou reenvios.
- **Microraptor:** o de *ShinGoji729* foi feito no Monster Mash (asas como placas infladas), e o de *Allosaurus28YT* vem de uma conta que edita modelos de outros autores.
- **Iguanodonte:**
  - *neopops* escaneia estátuas e bonecos de terceiros (Mickey, Hulk);
  - *gutaro* não informa a origem;
  - os demais vêm de Dinosaur Hunting, Jurassic World Dominion, do filme "Dinosaur" (Aladar) ou da conta Jurrassicgamer.

## Melhorias no procedural das seis espécies sem modelo livre (25/10/2026)
- **Sucuri:** cores da sucuri-verde real (oliva, manchas pretas ovais, barriga amarelada); deitada em curvas em S quando parada.
- **Smilodonte:** proporção de felino:
  - ombros acima do quadril, peito fundo e cintura recolhida;
  - pernas longas e musculosas (antes eram tubos grossos);
  - crânio com testa abaulada e focinho curto (antes parecia de capivara).
- **Paquirrinossauro:** quadril de 2,0 para 1,75 m; marrom-acinzentado com faixas (antes azul-acinzentado).
- **Iguanodonte:** pescoço curto e grosso, erguido para a frente (deixou de usar o pescoço em S dos hadrossauros); focinho de cavalo com bico em vez do bico de pato; verde-acinzentado com faixas.
- **Microraptor:** penas pretas com tom de destaque azulado (iridescência), em vez de avermelhado.
- **Protocerátops:** já tinha proporções corretas; sem mudança.

Imagem: `docs/visual/seis-especies-procedurais.jpg`.

## Caminhada (25/10/2026)
As pernas dobravam demais ao andar, sobretudo nos modelos de artista e nos quadrúpedes. Duas causas:
- **Passada da espécie maior que o alcance da perna:** o pé passava até 80% do ciclo no ar.
- **Pelve descendo cedo demais:** o corpo baixava assim que a perna passava de 97% de extensão, mesmo em pernas que ficam quase retas no repouso.

Correções:
- Na caminhada, a passada é a que a perna desenhada alcança com o pé no chão cerca de 55% do ciclo; na corrida, vale a passada da espécie.
- A descida da pelve é medida a partir da extensão de repouso de cada perna, e parte dela é absorvida esticando a perna.
