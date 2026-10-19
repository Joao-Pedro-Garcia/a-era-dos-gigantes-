# Menu de itens e habilidades

## Inventário
- **Busca**: campo "Buscar item…" no topo. Filtra na hora enquanto se digita, sem diferenciar
  maiúsculas nem acentos ("pocao" encontra "Poção"). Cada palavra digitada precisa aparecer no
  nome, na descrição ou na categoria do item, em qualquer ordem. `Esc` ou o botão ✕ limpam a busca.
  Enquanto o campo está em foco, as teclas não acionam comandos do jogo.
- **Filtros por categoria**: chips com ícone e nome (no celular só o ícone). Combinam com a busca.
- **Cores por categoria**: cada espaço tem uma faixa inferior na cor da categoria
  (recurso, comida, ferramenta, arma, roupa, tratamento, especial).
- **Barra de peso**: verde; fica laranja acima de 90% da capacidade.
- **Detalhes do item**: ícone grande, categoria, quantidade, atributos em etiquetas
  (peso, dano, armadura, isolamento, capacidade, comida, cura), barra de durabilidade
  com porcentagem, descrição e ações (usar, equipar, descartar, atalho 1–6).
- Quando nada corresponde à busca/filtro, aparece "Nada encontrado com essa busca."

## Fabricação
- O mesmo campo de busca filtra receitas pelo nome do resultado, descrição, categoria
  ou pelos ingredientes ("madeira" mostra tudo que usa madeira).

## Habilidades
- Cabeçalho com nível total, dias sobrevividos e pontos disponíveis (selo pulsante).
- Um cartão por árvore com ícone, nível em círculo, barra de XP e pontos da árvore;
  cartões com pontos para gastar ficam com borda dourada.
- Cada habilidade mostra o estado: **aprendida** (verde, ✓), **disponível** (dourada, botão
  Aprender), **sem pontos** (nível atingido, falta ponto) e **bloqueada** (🔒, esmaecida),
  além do nível exigido.

## Código e testes
- `src/ui/search.ts` — `normalize()` e `matches()`.
- `src/ui/hud.ts` — `searchBox()`, `renderInventory()`, `renderCrafting()`, `renderSkills()`.
- `src/ui/style.css` — seção "Item menu" e "Skills tab".
- `tests/ui-menu.test.ts` — busca sem acentos, consulta vazia, várias palavras.

Capturas: `docs/visual/menu-busca.jpg`, `docs/visual/menu-habilidades.jpg`, `docs/visual/menu-celular.jpg`.
