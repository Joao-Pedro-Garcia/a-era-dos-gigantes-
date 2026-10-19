# Reforma do humano 3D

## O que mudou
- **Modelo**: o sobrevivente procedural (malha gerada por código) foi substituído pelo
  modelo de artista **"Just man"** de *vrimen* (Sketchfab, **CC BY 4.0**, crédito no jogo),
  com rosto esculpido, olhos com íris, dentes/língua, mãos com dedos, jaqueta de couro,
  camiseta, calça e tênis, texturas PBR (cor, normal, rugosidade) em 1024 px.
  Arquivo: `public/models/survivor.glb` (3,9 MB). O corpo procedural continua como
  reserva se o arquivo não carregar.
- **Mesmo esqueleto, mesmas animações**: a pele do artista é religada aos 20 ossos do
  jogo (`manifest.json → player.rig`), então toda a animação procedural existente
  (marcha com IK no terreno, ações/golpes, mira, nado, montaria, esquiva, reação a golpes)
  dirige o modelo novo sem perder nada. As posições de articulação do jogo
  (`JOINTS` em `src/player/humanModel.ts`) foram ajustadas às proporções do modelo.
- **Re-pose offline** (`tools/human-bake.mjs`, precisa de `@gltf-transform/core`):
  o arquivo vem em pose "A"; a ferramenta reposiciona braços (pendurados, polegar à frente),
  pernas retas, pés paralelos; fecha as mãos em pegada falange por falange; reposiciona
  os olhos (as matrizes de ligação dos olhos no arquivo estão quebradas) e abre um pouco
  a pálpebra superior.
- **Pegada de ferramentas/armas**: uma única constante `HAND_GRIP` (centro do furo do
  punho) é usada pelo IK dos braços e pelo encaixe dos itens; o cabo passa entre a palma
  e os dedos fechados (`docs/visual/humano-pegada.jpg`).
- **Primeira pessoa**: os braços vistos em 1ª pessoa são as mangas e mãos do próprio
  modelo (triângulos do corpo presos aos ossos dos braços), não mais cilindros.

## Animação (`src/player/playerView.ts`)
- **Giro no lugar sem pés deslizando**: os pés ficam plantados; quadril acompanha os pés e o
  tronco acompanha o corpo; passado ~30° o personagem dá dois passos rápidos (pé do lado
  do giro primeiro).
- **Cabeça e peito antecipam o giro**; ao correr em curva o corpo inclina para dentro.
- **Inércia**: inclina para frente ao acelerar e para trás ao frear, com os joelhos
  absorvendo (quadril baixa).
- **Salto**: pernas recolhem no ar; **aterrissagem** com flexão de joelhos/quadril e
  braços abrindo, proporcional à velocidade da queda.
- **Cabeça segue a mira** (inclinação da câmera).
- **Socos e golpes começam no quadril**: a pelve gira com o golpe (pernas plantadas), depois
  coluna e peito; o ombro do braço que golpeia avança. O impacto continua sincronizado pelo
  `impactAt` de cada ação.
- Agachar: câmera (1,05 m) e colisão (1,1 m) já eram ajustadas; mantidas.

## Testes antes/depois (feitos)
- Modo `?showcase&seq=turn|stop|jump|punch` avança a simulação quadro a quadro (60 Hz,
  determinístico). O "antes" foi gerado rodando a mesma sequência sobre o commit anterior.
  Tiras: `docs/visual/humano-seq-*.jpg` (em cima ANTES, embaixo DEPOIS).
- Rosto e corpo: `docs/visual/humano-rosto-antes-depois.jpg`, `humano-corpo-antes-depois.jpg`.
- Testes automáticos: `tests/human.test.ts` (simetria/ordem das articulações, pegada,
  mapeamento completo dos ossos no manifesto, licença) e o teste de IK dos braços
  (`tests/actions.test.ts`) agora usa as articulações e a pegada reais.

## Limitações conhecidas (honestas)
- O rosto não tem expressões/piscar (o arquivo não traz blendshapes utilizáveis).
- O polegar no soco fica um pouco à frente dos dedos em vez de cruzar por cima.
- Não há ossos de clavícula no esqueleto do jogo: o avanço do ombro é feito deslocando a
  articulação do braço; em levantamentos extremos o ombro da jaqueta deforma um pouco.
- Não medi FPS em aparelho real com o modelo novo (44,7 mil triângulos, 1 malha com
  8 materiais); precisa ser testado no seu celular.
