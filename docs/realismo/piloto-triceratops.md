# Realismo dos animais — Fase C: piloto (tricerátops)

Antes e depois, com o mesmo enquadramento (lateral, frente, trás, cabeça 3/4, longe e na sombra): [`../visual/realismo-triceratops.jpg`](../visual/realismo-triceratops.jpg).

## O que mudou

| Área | Antes | Depois | Base (ver `fichas.md`) |
|---|---|---|---|
| Crânio | longo, baixo e estreito ("cara de cavalo") | **maciço e fundo** (~0,6 m), bochechas largas (jugais), **bico de papagaio** curvo sobre um pré-dentário pontudo, mandíbula funda | proporções do crânio dos ceratopsídeos |
| Chifres | agulhas finas e retas, apontando para trás | **base grossa, ~1 m, curvando-se para a frente**; chifre nasal curto e grosso; queratina marrom-acinzentada, mais escura e lisa na ponta. Em filhotes, a curva é para trás | curvatura dos chifres de adultos (fato) |
| Gola | leque fino, "colado", com listras vermelhas decorativas | **escudo ósseo sólido** saindo do teto do crânio, inclinado sobre o pescoço, com laterais curvadas para baixo, mais grosso na base e com **epocipitais** irregulares na borda; mesma pele da cabeça, mais escura na borda | gola sólida, sem janelas, com epocipitais (fato); cor desconhecida |
| Pele | uma só textura de escamas pequenas em tudo, brilhante como plástico | **escamas grandes poligonais com tubérculo central** no dorso e nos flancos, **escamas pequenas** nos membros, na face e no ventre (mistura por vértice), e **menos brilho** | impressão de pele do espécime "Lane" (fato, para a região preservada) |
| Cores | marrom com gola vermelha | terrosas: dorso mais escuro, ventre claro | **interpretação** (cor desconhecida) |
| Cauda | longa e fina, terminando numa agulha | **mais curta e robusta**, com ponta arredondada | proporções de ceratopsídeos |
| Membros | "tubos", dedos abertos | coxas integradas ao flanco; **cotovelos um pouco para fora** (postura semi-ereta); dedos curtos e juntos, com cascos | Fujiwara (2009) |

### Melhorias que valem para outras espécies

- A **pele por região** (escamas grandes × pequenas) e o **brilho menor** valem para todos os animais com escamas. A quantidade de escamas grandes depende do grupo (`scuteAmount` em `src/animals/dinoModel.ts`):
  - ceratopsianos: 1;
  - crocodiliformes: 0,85;
  - anquilossauros: 0,75;
  - hadrossauros: 0,6;
  - estegossauros: 0,5;
  - saurópodes: 0,45;
  - terópodes: 0,3;
  - tiranossauro: 0,15;
  - animais com penas, mosassauro e pterossauros: 0.
- **Protocerátops e paquirrinossauro** usam o mesmo crânio de ceratopsiano. O paquirrinossauro ganhou a bossa nasal achatada e os espinhos presos à borda da gola.

## Controle de qualidade (o que foi visto de verdade)

| Item | Visto? | Resultado |
|---|---|---|
| Frente, lateral, trás, perspectiva | sim (folha da espécie) | silhueta própria; a gola agora tem volume visto de lado |
| Cabeça de perto | sim | bico, olhos com pálpebras e chifres sem buracos; corrigi um furo na base da gola e a base aberta dos chifres |
| Materiais de perto | sim | escamas grandes com tubérculos nos flancos; sem brilho plástico |
| Luz do dia e sombra | sim | a gola fica escura na sombra, como deveria |
| Longe (nível de detalhe) | sim | mesma silhueta |
| No jogo, com o cenário | sim (uma captura) | escala e cores coerentes com o ambiente |
| Andar, correr, comer e deitar | **não revisado nesta rodada** | as animações são as que já existiam (passada pela distância percorrida, IK nas pernas, mastigação). Não foram refeitas |
| Testes automáticos | sim | `tests/dinos.test.ts`: região de pele em todas as espécies, proporções do crânio, cauda e comprimento total do tricerátops; todas as 26 espécies continuam gerando 3 níveis de detalhe |

## Estado: **parcial**

O tricerátops ficou **bem mais fiel** à anatomia e à pele conhecidas, mas não chega a "qualidade de cinema". Limitações reais:

- **Membros ainda simples:** são seções circulares com alguns volumes musculares. Não há tendões, dobras de pele nas articulações nem deformação muscular ao andar.
- **Sem dispersão de luz na pele (subsurface scattering)**, nem mapas de oclusão pintados à mão.
- **Animação:** a mesma de antes. Falta o peso da cabeça ao virar e uma mastigação mais rica.
- O modelo continua **gerado por código**. Um modelo esculpido por um artista ainda seria superior.

## Próximos passos propostos

1. Aplicar o mesmo processo às outras espécies, **uma de cada vez**, começando pelas mais vistas: parassaurolofo, braquiossauro, anquilossauro e espinossauro.
2. Criar as 5 espécies novas (deinosuchus, megatério, smilodon, dodô e sucuri) já no padrão novo.
3. Melhorar os membros (seções não circulares, dobras nas articulações) e a animação da cabeça e do pescoço.
