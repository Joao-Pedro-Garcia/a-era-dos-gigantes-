# Ecossistema: hierarquia, herança, idade, eventos raros e bússola

## Hierarquia nos grupos
- **Posição no bando:** cada animal tem uma posição no bando (`rankScore` em `src/animals/genetics.ts`), recalculada a cada 2 s. A ordem é:
  1. alfas;
  2. adultos antes dos jovens;
  3. tamanho herdado, coragem e agressividade;
  4. por último, a idade.
- **Líder:** o 1º lugar lidera o grupo, e o resto segue.
- **Ordem para comer:** enquanto alguém de posição mais alta come a carcaça, os outros esperam a vez a alguns metros.
- **Na observação:** "líder do bando" ou "3º de 5 no bando".

## Herança entre gerações
- **Genes:** cada animal tem **tamanho** (0,85–1,18) e **velocidade** (0,90–1,10). O tamanho muda a vida e o peso.
- **Filhotes:** recebem a média do pai e da mãe, com pequena variação. O temperamento (coragem, agressividade, curiosidade, sociabilidade) também é herdado. Há **3% de chance de mutação**, e a geração aumenta em 1.
- **Pai:** o macho adulto de posição mais alta que estiver por perto, com os alfas primeiro.
- **Save:** genes salvos e validados ao carregar; saves antigos carregam sem genes, como animais médios.
- **Na observação detalhada (naturalista ou scanner):** "herança: tamanho 104%, velocidade 98%, geração 2".

## Envelhecimento
- **Morte por velhice:** já existia.
- **Idosos:** no último quinto da vida, o animal fica 15% mais lento e aparece como "idoso" na observação.

## Eventos raros com aviso
`src/world/rareEvents.ts`:
- **Frequência:** no máximo um evento a cada 1,5 dia, com chance de 3,5% por minuto de jogo. Média de menos de um por dia.
- **Estouro de manada (de dia):** o rebanho grande mais próximo, num raio de até 350 m, dispara correndo e passa pelo jogador. O aviso diz a espécie e a direção.
- **Migração de alfa:** um predador grande alfa aparece a 220 m e toma a região do jogador como território. O aviso diz a espécie e a direção.
- **Chuva de meteoros (à noite):** 70 s de rastros no céu e três fragmentos caindo a 60–170 m. Cada fragmento deixa uma bolsa com 3 minérios e 1 cristal, marcada na bússola por 1 dia.
- **Eventos que já existiam:** erupção, enchente, seca, incêndio e tempestade continuam.

## Bússola e marcadores
Barra no alto da tela, abaixo do relógio (`docs/visual/bussola.jpg`):
- **Direções:** N, NE, L… aparecem só com o item **bússola**. Sem ela, o topo continua mostrando só a direção aproximada pelo sol.
- **Marcadores**, sempre visíveis, com a distância:

  | Símbolo | Marca |
  |---|---|
  | ◆ | seus pontos |
  | 🏠 | a cama |
  | 🦖 | até 3 animais domados |
  | ☄ | meteoritos caídos |
  | ★ | locais descobertos a até 700 m |

- **Tecla Y:** marca o ponto para onde você olha (até 300 m). Repetir sobre um ponto já marcado o remove. São até 5 pontos, salvos no jogo.

## Testes
- `tests/genetics.test.ts` (6 testes): herança, temperamento herdado, genes do mundo e do save, idade, hierarquia e posições de 1 a N em cada grupo.
- `tests/rareEvents.test.ts` (2 testes): raridade, intervalo mínimo, dia e noite, caverna e save.
