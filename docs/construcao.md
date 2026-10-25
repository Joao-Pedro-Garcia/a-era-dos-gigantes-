# Construção destrutível e torres

## Vida, desgaste e reparo
- **Vida por material:** cada peça tem pontos de vida conforme o material (`src/building/durability.ts`).

  | Peça | Vida |
  |---|---|
  | Cerca | 160 |
  | Parede de madeira | 300 |
  | Paliçada | 520 |
  | Torre | 650 |
  | Fundação | 700 |
  | Parede de pedra | 1100 |
  | Fundação de pedra | 1600 |

- **Desgaste:** a chuva desgasta as peças aos poucos: um dia de chuva tira cerca de 4% de uma peça de madeira, e a tempestade desgasta 2,5× mais rápido. A pedra quase não sofre. O tempo sozinho nunca derruba nada: o desgaste para em 30% da vida.
- **Reparo:** olhe para uma peça danificada e aperte **E**. Aparecem a vida atual e o custo, que é no máximo ¼ do custo original, proporcional ao dano.

## Dano dos dinossauros
- **Quem ataca:** animais com mais de 60 kg, caçando ou lutando, atacam a parede, porta, cerca ou torre que estiver no caminho.
- **Força:** cada golpe vale 80% do ataque da espécie, e um alfa bate mais forte.
- **Peça destruída:** quebra com efeito de destroços e deixa ⅓ dos materiais numa bolsa no chão, junto com o conteúdo dos baús.

## Integridade estrutural
- **Como a estabilidade se espalha:**
  - o que está no chão ou é fundação, plataforma ou torre vale 1;
  - uma peça apoiada sobre outra recebe a estabilidade dela menos uma perda (madeira 0,14; pedra 0,08);
  - pisos e telhados também se apoiam na peça vizinha da mesma altura (perda 0,3) ou nas paredes abaixo.
- **Desabamento:** quando uma peça quebra, tudo que fica abaixo de 0,2 de estabilidade **desaba em cascata**. Exemplo: quebrar a fundação derruba as paredes e o telhado. Perder uma só parede não derruba o telhado, que continua sustentado pelas outras.
- **Saves antigos:** peças que já estavam sem apoio continuam de pé; só cai o que perdeu o apoio por causa da destruição.

## Torre de observação
- **Construção:** categoria Defesa. Custa 30 madeira, 4 cordas e 10 fibras.
- **Estrutura:** 4 pernas de tronco com travessas, escada, plataforma a 8 m com guarda-corpo e telhado de palha.
- **Uso:** **E** para subir e para descer. Lá de cima, a cada 5 s o mapa é revelado num raio de 320 m e as espécies a até 300 m entram no diário.

## Testes
`tests/building3.test.ts` (9 testes):
- vida por material;
- desgaste com limite mínimo;
- reparo com materiais;
- cabana inteira estável;
- cascata ao quebrar a fundação;
- o telhado se mantém com 3 paredes;
- o telhado cai sem paredes;
- torre caminhável no topo;
- vida salva no save.
