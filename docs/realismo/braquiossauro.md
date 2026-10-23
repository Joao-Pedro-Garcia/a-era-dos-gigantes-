# Realismo dos animais — Fase D: braquiossauro

Antes, depois e no jogo: [`../visual/realismo-braquiossauro.jpg`](../visual/realismo-braquiossauro.jpg). A ficha científica é a nº 4 em [`fichas.md`](fichas.md).

## O que mudou

| Área | Antes | Depois | Base |
|---|---|---|---|
| Corpo | centro do tronco alto demais, barriga a ~5 m do chão | tronco em barril mais baixo e fundo; **ombros mais altos que o quadril**, com o dorso descendo para trás | membros anteriores mais longos (fato) |
| Pescoço | quase vertical no alto e fino | **reto e erguido** em diagonal, fundo na base (mais alto do que largo); cabeça a ~13 m | postura exata debatida (**interpretação** dentro do provável) |
| Cabeça | arco nasal discreto, cabeça apontada para baixo | **arco nasal alto** sobre e à frente dos olhos, focinho largo e rombudo, cabeça quase na horizontal | crânio de braquiossaurídeo (fato) |
| Cauda | longa (~12 m), afinando em agulha | **mais curta** (~9 m) | cauda relativamente curta para um saurópode (fato) |
| Pernas | tubos de ~2 m de diâmetro | **colunas** com coxa e braço fortes, canela e antebraço retos | proporções de saurópodes |
| Pés | dedinhos com garras soltas | mão em ferradura com unhas rombudas; pé com almofada e **três garras grandes** | pés de saurópodes (fato) |
| Pele | escamas grandes em boa parte do corpo | mais **mosaico de escamas pequenas e arredondadas** | impressões de pele de saurópodes; sem osteodermos conhecidos no gênero |

Só o braquiossauro usa o plano de corpo "saurópode", então essas mudanças não afetam outras espécies. A única exceção são os pés: o novo tipo de mão (unhas rombudas) vale só para ele.

## Controle de qualidade (o que foi visto de verdade)

| Item | Visto? | Resultado |
|---|---|---|
| Lateral, frente, trás, de longe e na sombra | sim (folha da espécie) | silhueta de braquiossaurídeo: ombros altos, pescoço erguido, cauda curta |
| Cabeça | sim, mas de longe (a câmera da folha enquadra mal a cabeça a 13 m de altura) | arco nasal visível |
| No jogo, com o cenário | sim (uma captura) | pés no chão, escala e cor coerentes |
| Andar | **não revisado nesta rodada** | animação igual à de antes |
| Testes automáticos | sim | `tests/dinos.test.ts`: ombro mais alto que o quadril, cabeça entre 11 e 15 m, cauda curta, pernas em coluna e barriga abaixo da articulação do quadril; 193 testes passando |

## Estado: **parcial**

- **Pescoço com pouco movimento** e sem peso na animação; falta a etapa de animação (fase E).
- **Membros com seção circular**, sem dobras de pele.
- **Cor:** cinza-amarronzada lisa, que é **interpretação** (a cor é desconhecida).
- O holótipo de *Brachiosaurus altithorax* é incompleto. Parte das proporções vem do parente africano *Giraffatitan*, como em quase todas as reconstruções.
