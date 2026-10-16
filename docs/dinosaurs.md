# Dinossauros e outros animais — inventário e reconstrução (v0.4)

Este documento registra **o que existe de fato** em cada espécie do jogo depois da v0.4, como foi feito e o que ainda falta. Todos os números foram extraídos do próprio código (`buildDinoTemplate`) ou medidos neste ambiente. Nenhum modelo externo, arquivo de arte ou animação de captura foi adicionado: **todos os animais continuam sendo gerados proceduralmente** por `src/animals/dinoModel.ts` e animados por `src/animals/animalView.ts`.

> Imagens de referência: a solicitação mencionava "imagens de referência fornecidas", mas nenhuma imagem foi anexada. As referências usadas foram o conhecimento paleontológico geral (proporções publicadas, reconstruções esqueléticas amplamente aceitas). As capturas "antes" e "depois" abaixo são renders reais do jogo.

## Inventário

Colunas: medidas do adulto (comprimento / altura do quadril / massa), número de ossos do esqueleto animado, triângulos por nível de detalhe (antes da v0.4 → agora). "Médio" é um nível novo.

| Espécie | Grupo | Plano corporal | Medidas | Ossos | Perto (tri.) | Médio (tri.) | Longe (tri.) | Estruturas |
|---|---|---|---|---|---|---|---|---|
| Tiranossauro (*Tyrannosaurus rex*) | dinossauro | terópode | 12.3 m / 3.6 m / 8000 kg | 29 | 8060 → **11900** | **3540** (novo) | 1548 → **1818** | — |
| Velocirraptor (*Velociraptor mongoliensis*) | dinossauro | terópode | 1.8 m / 0.5 m / 18 kg | 29 | 8250 → **14850** | **3650** (novo) | 1650 → **1928** | feathers longClaws |
| Tricerátops (*Triceratops horridus*) | dinossauro | quadrúpede | 8.5 m / 2.6 m / 9000 kg | 28 | 7862 → **12008** | **3516** (novo) | 1772 → **2210** | horns3 frill |
| Braquiossauro (*Brachiosaurus altithorax*) | dinossauro | saurópode | 22 m / 5.5 m / 40000 kg | 29 | 7870 → **10998** | **3272** (novo) | 1610 → **1880** | longNeck |
| Anquilossauro (*Ankylosaurus magniventris*) | dinossauro | quadrúpede | 7 m / 1.5 m / 5000 kg | 28 | 9670 → **12820** | **4128** (novo) | 2460 → **2822** | armor club scutes |
| Espinossauro (*Spinosaurus aegyptiacus*) | dinossauro | terópode | 14 m / 2.6 m / 7400 kg | 29 | 8156 → **12642** | **3652** (novo) | 1580 → **1930** | sail longSnout |
| Pteranodonte (*Pteranodon longiceps*) | pterossauro (não é dinossauro) | pterossauro | 1.8 m / 0.9 m / 25 kg | 27 | 6636 → **9322** | **2966** (novo) | 1456 → **1918** | wings headCrest beak |
| Quetzalcoatlo (*Quetzalcoatlus northropi*) | pterossauro (não é dinossauro) | pterossauro | 5 m / 2.5 m / 220 kg | 27 | 6636 → **9322** | **2966** (novo) | 1456 → **1918** | wings headCrest beak longNeck |
| Parassaurolofo (*Parasaurolophus walkeri*) | dinossauro | hadrossauro | 9.5 m / 2.4 m / 2600 kg | 29 | 7822 → **10950** | **3235** (novo) | 1573 → **1843** | crestTube |
| Estegossauro (*Stegosaurus stenops*) | dinossauro | quadrúpede | 7.5 m / 2.2 m / 4500 kg | 28 | 7966 → **11884** | **3806** (novo) | 1896 → **2500** | plates tailSpikes |
| Dilofossauro (*Dilophosaurus wetherilli*) | dinossauro | terópode | 7 m / 1.6 m / 400 kg | 29 | 8140 → **11980** | **3572** (novo) | 1580 → **1850** | dualCrest |
| Compsognato (*Compsognathus longipes*) | dinossauro | terópode | 1 m / 0.25 m / 3 kg | 29 | 8152 → **14752** | **3588** (novo) | 1588 → **1866** | feathers |
| Arqueoptérix (*Archaeopteryx lithographica*) | avialano (ave primitiva) | ave primitiva / paraviano | 0.5 m / 0.15 m / 0.8 kg | 29 | 8176 → **14792** | **3588** (novo) | 1588 → **1866** | feathers wings |
| Microrraptor (*Microraptor zhaoianus*) | dinossauro | ave primitiva / paraviano | 0.8 m / 0.2 m / 1.2 kg | 29 | 8176 → **14864** | **3612** (novo) | 1588 → **1890** | feathers wings |
| Galimimo (*Gallimimus bullatus*) | dinossauro | terópode | 6 m / 1.9 m / 440 kg | 29 | 7888 → **13832** | **3282** (novo) | 1612 → **1890** | feathers beak longNeck |
| Paquicefalossauro (*Pachycephalosaurus wyomingensis*) | dinossauro | terópode | 4.5 m / 1.4 m / 400 kg | 29 | 8038 → **11166** | **3252** (novo) | 1590 → **1860** | dome |
| Iguanodonte (*Iguanodon bernissartensis*) | dinossauro | hadrossauro | 10 m / 2.5 m / 3500 kg | 29 | 7870 → **10998** | **3272** (novo) | 1610 → **1880** | thumbSpike |
| Alossauro (*Allosaurus fragilis*) | dinossauro | terópode | 9 m / 2.6 m / 2000 kg | 29 | 8140 → **11980** | **3580** (novo) | 1588 → **1858** | browHorns |
| Carnotauro (*Carnotaurus sastrei*) | dinossauro | terópode | 8 m / 2.2 m / 1500 kg | 29 | 8140 → **11980** | **3580** (novo) | 1588 → **1858** | browHorns |
| Terizinossauro (*Therizinosaurus cheloniformis*) | dinossauro | terópode | 9 m / 2.8 m / 5000 kg | 29 | 7986 → **13930** | **3344** (novo) | 1674 → **1952** | feathers longClaws longNeck beak |
| Barionix (*Baryonyx walkeri*) | dinossauro | terópode | 8 m / 2 m / 1500 kg | 29 | 8158 → **12348** | **3602** (novo) | 1610 → **1880** | longSnout longClaws |
| Sarcosuco (*Sarcosuchus imperator*) | crocodiliforme (não é dinossauro) | crocodiliforme | 9.5 m / 0.9 m / 3500 kg | 28 | 9128 → **13194** | **4036** (novo) | 2130 → **2400** | longSnout scutes |
| Protocerátops (*Protoceratops andrewsi*) | dinossauro | quadrúpede | 2 m / 0.6 m / 85 kg | 28 | 7766 → **11912** | **3480** (novo) | 1736 → **2174** | frill beak |
| Paquirrinossauro (*Pachyrhinosaurus perotorum*) | dinossauro | quadrúpede | 6 m / 2 m / 3000 kg | 28 | 7982 → **11608** | **3576** (novo) | 1832 → **2270** | nasalBoss frill frillSpikes |
| Troodonte (*Troodon formosus*) | dinossauro | terópode | 2.4 m / 0.8 m / 50 kg | 29 | 7962 → **14850** | **3650** (novo) | 1650 → **1928** | feathers longClaws |
| Mosassauro (*Mosasaurus hoffmannii*) | escamado marinho (não é dinossauro) | mosassauro | 12.5 m / 1.3 m / 9000 kg | 27 | — → **10406** | **2986** (novo) | — → **1436** | fluke |

Comum a todas as espécies:

- **Modelo:** uma malha esqueletal (SkinnedMesh) procedural por espécie, compartilhada entre indivíduos; três níveis de detalhe.
- **Materiais:** pele com escamas ou penas (texturas PBR procedurais com mapa normal), chifre/queratina, olhos brilhantes, membrana. A cor por vértice traz contrassombreamento, listras ou manchas e uma variação de tom e tamanho por indivíduo (determinística pelo id).
- **Esqueleto:** pelve como centro; cadeia de cauda com 4 ossos; tronco, peito, 2–3 vértebras de pescoço; cabeça; mandíbula articulada; 4 ossos por membro. Pterossauros têm ainda um osso para o dedo da asa.
- **Animação:** procedural, sem clipes. Inclui IK das pernas sobre o terreno, marcha por fase com pé plantado, inclinação do corpo no declive, cauda e pescoço, mandíbula, descanso deitado, voo e reação a golpes. Os comportamentos da v0.4 estão abaixo.
- **Colisão:** para ataques e flechas, uma esfera ou raio proporcional ao comprimento (0,22–0,35 × comprimento). **Não há colisão física corpo a corpo entre o jogador e os animais** (limitação conhecida).
- **Estados de IA (todos):** idle, wander, graze, drink, rest, follow, alert, investigate, flee, hunt, eat, defend, shelter, nest, ridden.
- **Escala:** comprimento, altura do quadril e massa reais da tabela. Filhotes crescem com a idade (`growthScale`).

## O que foi reconstruído na v0.4 (todas as espécies, por família)

A geometria é gerada por família anatômica. Cada melhoria abaixo vale para **todas** as espécies daquela família, e os ajustes que valem só para uma espécie estão indicados. Não há escultura manual espécie a espécie.

1. **Cabeça (todas)** — reescrita por completo:
   - o crânio agora é fechado: teto, bochechas e palato, com a nuca arredondada e unida ao pescoço. O pescoço termina dentro do crânio, então desapareceu o "colarinho" aberto da v0.3;
   - a mandíbula é sólida, num osso próprio, com assoalho da boca e língua. Abrir a boca mostra um interior, não um tubo oco;
   - perfis de crânio por família: terópode, grande predador (crânio largo atrás, focinho alto), pequeno terópode, espinossaurídeo (focinho longo com roseta), crocodiliforme, hadrossauro (bico de pato), bico de queratina (ceratopsianos, ornitomimídeos, tireóforos), saurópode (arco nasal alto), pterossauro (bico longo sem dentes) e mosassauro (crânio de varanídeo);
   - dentes cônicos ao longo das margens das duas arcadas, maiores no meio da fileira, só em carnívoros e piscívoros. Bicos e bicos de pato não têm dentes visíveis;
   - olhos com globo, íris colorida e pupila (em fenda no crocodiliforme), afundados na órbita, com pálpebra superior e inferior e arco supraorbital (mais marcado nos grandes terópodes). Narinas aparecem como depressões escuras.
2. **Corpo e membros:**
   - corpo fechado nas duas pontas;
   - grandes terópodes ficaram mais largos no quadril e nas costelas (vista de trás);
   - base da cauda mais grossa (músculo caudofemoral);
   - coxa musculosa, com o joelho à frente sob a barriga e metatarso longo e fino;
   - quadrúpedes pesados com membros em coluna e cascos curtos;
   - cauda erguida (sem arrastar);
   - a coxa e o ombro continuam a cor do flanco, sem a "mancha" clara da v0.3.
3. **Estruturas por espécie:**
   - **Triceratops/Protoceratops/Pachyrhinosaurus:** gola com espessura real (faces frontal e traseira, borda arredondada, mais grossa na base), epoccipitais na borda e cor de exibição perto da borda. Chifres com bainha de queratina escurecendo para a ponta.
   - **Stegosaurus:** 17 placas **individuais e sólidas** em duas fileiras alternadas, maiores sobre o quadril, levemente inclinadas para fora.
   - **Spinosaurus:** vela sólida, mais grossa na base, com nervuras dos espinhos neurais.
   - **Ankylosaurus:** osteodermos na cor da pele (não mais brancos) e clava da cauda com dois lóbulos laterais.
   - **Dilophosaurus:** cristas duplas, sem gola e sem veneno (como antes).
4. **Penas** (Velociraptor, Troodon, Compsognathus, Gallimimus, Therizinosaurus, Microraptor, Archaeopteryx):
   - cobertura de penas de contorno sobrepostas ao longo do corpo, pescoço e cauda, com focinho e pés escamosos;
   - penas nas coxas;
   - penas de voo dobradas ao longo dos braços;
   - leque na cauda;
   - Microraptor tem penas longas nas pernas (as "quatro asas").
5. **Pterossauros:**
   - o dedo da asa é um osso próprio;
   - a membrana (braquiopatágio) vai do braço e do dedo até o flanco, e o propatágio fica à frente do cotovelo;
   - em solo, o dedo dobra para trás e para cima e a membrana se recolhe numa faixa estreita;
   - em voo, braço e dedo se estendem para o lado e a membrana se abre;
   - o batimento gira a asa no ombro.
6. **Filhotes (todas):**
   - modelo próprio quando o animal está no estágio "juvenil" dos dados de idade já existentes;
   - cabeça 40% maior, focinho mais curto, olhos 30% maiores, pernas relativamente mais longas e cauda mais curta;
   - chifres, golas, placas, velas e cristas pequenos;
   - o jogo troca o modelo quando o animal cresce.
7. **Níveis de detalhe:** três níveis (perto, médio e longe) gerados do mesmo esqueleto e da mesma planta, então a silhueta é a mesma. Um teste verifica que o nível longe fica a até 12% do perto em comprimento e a até 15% em altura.
8. **Mosassauro (novo):** *Mosasaurus hoffmannii*, um escamado marinho (não é dinossauro).
   - corpo hidrodinâmico, crânio longo com dentes cônicos e quatro nadadeiras achatadas;
   - cauda achatada que se curva para baixo numa nadadeira em meia-lua, com o lóbulo inferior maior, conforme mosassauros com tecidos moles preservados;
   - dorso escuro e ventre claro;
   - vive só em mar profundo (fundo abaixo de −3 m): aparece apenas em setores de mar aberto, nunca sai da água, mergulha e volta à superfície;
   - caça apenas presas e jogadores que estejam na água;
   - é vivíparo: dá à luz filhotes, sem ninho.

## Animações de comportamento (v0.4)

Camadas procedurais sobre a locomoção existente (`animalView.ts`):

- **Observar:**
  - em idle ou alerta, a cabeça varre o ambiente (os pequenos olham mais rápido e com mais frequência);
  - ao investigar, o animal fareja com mergulhos curtos do focinho;
  - ao beber, a cabeça desce até a água e a mandíbula lambe.
- **Ameaça e combate por tipo de corpo:**
  - ceratopsianos e paquicefalossauros baixam a cabeça com chifres ou domo à frente;
  - estegossauros e anquilossauros balançam a cauda armada;
  - predadores abrem a boca, baixam a cabeça e erguem a cauda, e mordem ao caçar em velocidade;
  - outros herbívoros assumem postura de alarme.
- **Cuidado com o ninho:** cabeça baixa sobre os ovos.
- **Inércia nas curvas:**
  - o pescoço lidera a curva, o corpo inclina para dentro e a cauda abre para fora;
  - gigantes respondem devagar, com peso, e animais pequenos viram rápido.
- **Morte animada:** o corpo cede, as pernas dobram e o animal tomba de lado em 0,9–2,2 s (mais lento nos gigantes); pescoço e cauda ficam moles.
- **Reação a golpes:**
  - o animal recua para longe do golpe, sacode a cabeça em direção ao agressor, abre a mandíbula e chicoteia a cauda;
  - a intensidade depende do tamanho (≈1,2 para 10 kg, ≈0,6 para 1 t, 0,15 para 50 t);
  - a IA interrompe o pastar, beber ou descansar;
  - o animal desacelera mais quanto menor for (gigantes quase não param).
- **Nado:** a cauda impulsiona e as pernas remam. No mosassauro, o corpo ondula ao longo do comprimento.
- **Voo:**
  - perto do chão (decolagem e pouso), as batidas ficam rápidas e as pernas se estendem para baixo;
  - pterossauros abrem e dobram as asas como descrito acima.

## Testes visuais

O jogo tem um modo de revisão: `?showcase&sheet&species=<id>` (acrescente `&juvenile` para o filhote e `&air` para voadores no ar). Ele mostra seis vistas do mesmo indivíduo no mesmo instante:

- lateral;
- frente;
- trás;
- cabeça em 3/4;
- longe (nível de detalhe distante);
- sombra com postura de ameaça, ou em voo para voadores.

As capturas reais de todas as espécies, antes e depois, estão em `docs/visual/dinos/` (antes = build da v0.3; depois = v0.4).

## Limitações reais (o que ainda falta)

- **Não é escultura digital nem fotogrametria.** A forma vem de seções transversais (loft) por família. Não há musculatura detalhada, dobras de pele, escamas modeladas individualmente, osteodermos com formato anatômico real nem dentes serrilhados. O detalhe fino continua vindo de mapas normais procedurais.
- **Sem animações profissionais.** Não há captura de movimento nem clipes de animador. Toda a animação é procedural. O caminho para modelos e animações externos (GLB via `public/models/manifest.json`) continua existindo, mas **nenhum arquivo foi adicionado**.
- **Cobertura de penas:** cartões de pena (planos), visíveis só no nível de detalhe próximo. De perto, ainda se nota que são cartões.
- **Mãos:** dedos dos terópodes são tubos simples com garras. Não há articulação de dedos.
- **Pterossauros:** a dobra da membrana em solo é aproximada (a membrana se recolhe por interpolação, sem dobras reais) e o pteroide não foi modelado.
- **Mosassauro:** não há natação 3D livre (a profundidade segue um ciclo de mergulho), não há caça submersa a peixes (não existem peixes como animais) e não há animação de respirar na superfície.
- **Colisão física** entre animais e jogador não existe (só aproximações para golpes e flechas).
- Os filhotes usam proporções gerais de juvenis, sem dados ontogenéticos específicos de cada espécie.
