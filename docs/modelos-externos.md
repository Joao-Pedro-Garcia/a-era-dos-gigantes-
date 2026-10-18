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

Ficaram de fora, mesmo com boa aparência:
- **Espinossauro e quetzalcoatlo de seirogan:** cada um tem um único clipe (olhar em volta ou voo) e nenhum de andar, então deslizariam no chão.
- **Pteranodonte de oscar.lopez.riviello:** tem animações completas, mas a conta publica modelos extraídos de jogos e filmes e não informa a origem deste. Risco de direito autoral.

## Descartados, e por quê

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

- **Só 5 das 26 espécies têm modelo de artista** (tiranossauro, estegossauro, paquicefalossauro, velocirraptor e arqueoptérix). As outras 21 continuam procedurais. Para elas, não foi encontrado um modelo animado, de origem limpa e anatomicamente aceitável.
- **O tiranossauro não tem clipe de andar.** Em velocidade de caminhada, ele usa o clipe de corrida em câmera lenta (cerca de 0,2×). Os pés não deslizam, mas o gesto é de corrida.
- **Cores do tiranossauro:** são as do autor (azulado com listras vermelhas), não as cores da espécie no jogo.
- **Paquicefalossauro em fuga:** a 8 m/s, o clipe de corrida (animado para cerca de 3,6 m/s) toca a 2,2×. Os pés acompanham o chão, mas a cadência fica bem rápida.
- **Distância:** além de 1,2× a distância de detalhe, entra o modelo procedural leve, e a troca de aparência é visível se observada.
- **Filhotes:** usam o mesmo modelo do adulto, em escala menor; as proporções juvenis dos procedurais não se aplicam.
- **Mãos e mandíbula:** não são controladas pelo jogo (o modelo externo não recebe a IK de olhar e de mandíbula dos procedurais).
- **Reação a golpes:** a resposta corporal procedural não se aplica aos modelos externos; o animal reage pelo clipe de estado.
- **Desempenho:** veja a medição no README. Com 16 modelos externos na tela, os triângulos subiram cerca de 30–60% e o FPS no renderizador por software caiu. Não foi medido em GPU real.
