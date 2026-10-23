# Realismo dos animais — Fase D: anquilossauro

Antes e depois: [`../visual/realismo-anquilossauro.jpg`](../visual/realismo-anquilossauro.jpg). A ficha científica é a nº 5 em [`fichas.md`](fichas.md).

## O que mudou

| Área | Antes | Depois | Base |
|---|---|---|---|
| Armadura | espinhos cônicos iguais, em 5 fileiras retas do pescoço à cauda | **faixas transversais** de osteodermos **baixos e de tamanhos irregulares**; espinhos com quilha só na borda dos flancos; **dois meios-anéis** de placas maiores sobre o pescoço; placas triangulares nas laterais da cauda, diminuindo até a clava | osteodermos de tamanhos variados em faixas transversais, com ossículos entre eles (fato) |
| Corpo | alto, com "cara de urso" (dorso a ~2,3 m) | **baixo e muito largo**, dorso a ~2 m com as placas | Arbour & Mallon (2017) |
| Base da cauda | mais alta que o quadril | contínua com o dorso, depois um **"cabo" fino e rígido** | vértebras da cauda travadas antes da clava (fato) |
| Clava | pequena | **~0,6 m de largura**, com dois nódulos laterais grandes e achatados e um central menor | clava de osteodermos fundidos (fato) |
| Cabeça | comprida, como a de um ornitísquio genérico | **curta, larga e achatada**, com bico estreito e **chifres nos cantos de trás** (escamosais) e **abaixo dos olhos** (quadratojugais) | crânio de anquilossaurídeo (fato) |
| Coxas | grossas, saindo para fora do corpo | mais finas, dentro do corpo largo | — |
| Bico | cinza-claro | queratina escura | cor desconhecida (**interpretação**) |

O plano de corpo é o mesmo dos outros quadrúpedes, mas todas as mudanças valem só para animais com armadura (`armor`). Hoje o único é o anquilossauro.

## Controle de qualidade (o que foi visto de verdade)

| Item | Visto? | Resultado |
|---|---|---|
| Lateral, frente, trás, de longe e na sombra | sim (folha da espécie) | silhueta baixa e larga; sem pontas de coxa aparecendo |
| Cabeça de perto | sim | chifres nos cantos, bico escuro |
| Andar | **não revisado nesta rodada** | animação igual à de antes |
| Testes automáticos | sim | `tests/dinos.test.ts`: corpo mais largo do que alto, dorso abaixo de 2,1 m, clava entre 0,45 e 0,9 m de largura; 194 testes passando |

## Estado: **parcial**

- **O golpe de clava** ainda usa a animação genérica de ataque; falta a etapa de combate de dinossauros.
- **Membros com seção circular.**
- **Cor:** marrom-terroso, que é **interpretação**. Em *Borealopelta*, um nodossaurídeo, há indícios de dorso escuro e ventre claro, e o jogo segue esse padrão.
