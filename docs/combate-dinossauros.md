# Combate avançado dos dinossauros

## Golpe em etapas
Todo ataque de animal segue **preparar → golpear → recuperar**:
- **Preparar:** o animal "arma" o golpe e acompanha o alvo. A cabeça recua e a boca abre, a cauda é armada ou a cabeça abaixa para a chifrada.
- **Golpear:** o dano é aplicado **uma única vez**, no início dessa janela, e **só se o alvo estiver dentro da área do golpe naquele instante**. Recuar ou esquivar durante a preparação evita o dano.
- **Recuperar:** o animal fica vulnerável por um momento.

Animais grandes são mais lentos: o T. rex leva cerca de 1,35× o tempo de um raptor. O código está em `src/combat/dinoAttacks.ts`, a IA em `src/ai/brain.ts` (`runAttack`) e as poses em `src/animals/animalView.ts`.

## Golpes de cada espécie
| Espécie | Golpes |
|---|---|
| T. rex, alossauro | mordida, mordida com chacoalhão, rabada |
| Carnotauro | mordida, cabeçada, rabada |
| Espinossauro | mordida, garras, rabada |
| Velocirraptor, troodonte, smilodonte | mordida, garras, bote (salto) |
| Dilofossauro | mordida, **cuspe venenoso** (projétil que dá para esquivar; turva a visão), garras |
| Tricerátops, paquirrinossauro | chifrada com investida, pisoteio |
| Anquilossauro | **clava**: vira de costas para acertar |
| Estegossauro | cauda com espinhos |
| Braquiossauro | pisoteio (empina e bate), rabada |
| Paquicefalossauro | cabeçada |
| Iguanodonte | espinho do polegar, rabada |
| Sarcosuco, deinosuco | mordida, **giro da morte** (prende), rabada |
| Sucuri | mordida, **constrição** (prende) |
| Megatério, terizinossauro | garras, pisoteio |

## Área de acerto, partes do corpo e empurrão
- **Origem do golpe:** cada golpe sai do focinho, da cauda ou das patas da frente. O alcance e o ângulo são próprios de cada golpe; a rabada cobre os lados e a traseira.
- **Dano do jogador no dinossauro por parte do corpo** (por espada, lança ou flecha):

  | Parte | Multiplicador |
  |---|---|
  | Cabeça | ×1,6 |
  | Pescoço | ×1,25 |
  | Corpo | ×1 |
  | Perna | ×0,85, e o animal **manca** por 6 s |
  | Cauda | ×0,65 |

  Cabeças blindadas (tricerátops, paquirrinossauro, paquicefalossauro e anquilossauro) não recebem o bônus.
- **Empurrão:** cresce com a diferença de massa. Uma rabada de T. rex arremessa o jogador; um raptor quase não move um tricerátops.

## Esquiva, contra-ataque e reações
- **Esquiva:** tecla **T** ou **Alt**, botão "Esquiva" no celular, ou o clique do analógico direito no controle. Custa 15 de fôlego e deixa o jogador imune por cerca de 0,3 s.
- **Contra-ataque:**
  - acertar o dinossauro **durante a preparação** interrompe o golpe e causa ×1,5 de dano;
  - esquivar no momento certo abre uma janela de 1,2 s com ×1,5 de dano.
- **O dinossauro também contra-ataca:** depois de ferido no meio da luta, ataca mais rápido.
- **Reações a golpes:** o animal se encolhe na direção do golpe, e o personagem do jogador também reage.

## Equilíbrio no tamanho dos filmes
| Espécie | Vida | Dano |
|---|---|---|
| Velocirraptor (3,6 m, como no filme) | 160 | 18 |
| Dilofossauro (pequeno, como no JP) | 180 | 15 + cuspe |
| Espinossauro (JP3, mais forte que o T. rex) | 1900 | 80 |

## Testes
`tests/dinoCombat.test.ts` (10 testes):
- golpes de cada espécie;
- ordem das fases;
- área de acerto (a mordida não pega atrás, a rabada pega);
- escolha do golpe (clava só atrás, cuspe só à distância);
- partes do corpo e empurrão;
- o dano chega depois da preparação;
- a esquiva evita o golpe;
- golpe na preparação interrompe o ataque.

## Limites conhecidos
- Nos modelos de artista com animação própria (T. rex, velocirraptor e arqueopterix) toca o clipe "attack" do arquivo durante o golpe. As poses por fase só aparecem nos modelos procedurais e no espinossauro com rig.
- A gola do dilofossauro ainda não abre animada: é geometria fixa da cabeça.
