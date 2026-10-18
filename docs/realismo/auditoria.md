# Realismo dos animais — Fase A: auditoria

Data: 18/10/2026. Projeto: Era dos Gigantes (Three.js 0.170, TypeScript, Vite).

## Como os animais funcionam hoje

| Etapa | Arquivo | O que faz |
|---|---|---|
| Dados da espécie | `src/animals/species.ts` | medidas, dieta, sentidos, cores e estruturas (`look.features`) de 26 espécies |
| Malha | `src/animals/dinoModel.ts` | gera **por código** um modelo com pele e esqueleto para cada espécie: corpo contínuo ao longo da coluna, pernas, crânio por família, estruturas (chifres, gola, placas, vela, penas, membranas), 3 níveis de detalhe e proporções de filhote |
| Pele | `src/graphics/textureLibrary.ts` e `animalView.ts` | uma textura procedural "escamas" (ou "penas") **igual para todas as espécies**, aplicada com mapa normal; a cor vem pintada nos vértices (contrassombreamento, listras, manchas) |
| Animação | `src/animals/animalView.ts` | passada calculada pela distância percorrida, pernas com IK sobre o terreno, cauda, pescoço, mandíbula, respiração, deitar, morrer, reação a golpes |
| Modelos de artista | `src/graphics/externalModels.ts` e `public/models/manifest.json` | GLB animado substitui o modelo procedural **de perto** (3 espécies) |
| Comportamento | `src/ai/brain.ts` e `src/animals/ecosystem.ts` | IA, ecossistema e Alfas (não muda nesta frente de trabalho) |

## Os 17 animais pedidos

| # | Animal | No jogo hoje | Modelo atual | Principais problemas visuais (conferidos em `docs/visual/dinos/`) |
|---|---|---|---|---|
| 1 | Tiranossauro | sim | **modelo de artista** (LasquetiSpice, CC BY) de perto, procedural de longe | cores do autor (azul e vermelho); sem clipe de andar |
| 2 | Velocirraptor | sim | procedural, com penas, 1,8 m | penas em cartões rígidos, crânio genérico de terópode |
| 3 | Tricerátops | sim | procedural | corpo "inflado", membros em tubo, gola em leque com listras vermelhas, pele uniforme |
| 4 | Braquiossauro | sim | procedural | pescoço tubular, pele uniforme |
| 5 | Anquilossauro | sim | procedural | osteodermos regulares demais |
| 6 | Espinossauro | sim | procedural | vela fina, cauda genérica (antes de 2020) |
| 7 | Pterossauro | sim (pteranodonte e quetzalcoatlo) | procedural, com membrana e dedo alar | membrana sem espessura aparente, corpo simplificado |
| 8 | Parassaurolofo | sim | procedural | crista de tubo liso |
| 9 | Estegossauro | sim | **modelo de artista** (Ferocious Industries, CC BY) de perto | placas do modelo do autor (não conferidas com fósseis) |
| 10 | Dilofossauro | sim | procedural (sem gola e sem veneno) | cristas finas sem volume |
| 11 | Compsognato | sim | procedural, com penas | é uma versão reduzida do terópode genérico |
| 12 | Mosassauro | sim | procedural, com nadadeiras | cauda sem lobo, pele uniforme |
| 13 | Deinosuchus | **não** (existe o Sarcosuchus, outro crocodiliforme) | — | a criar |
| 14 | Megatério | **não** | — | a criar |
| 15 | Smilodon | **não** | — | a criar |
| 16 | Dodô | **não** | — | a criar |
| 17 | Sucuri | **não** | — | a criar |

Ponto comum a todos os procedurais: **uma única textura de escamas para todas as espécies**, sem diferença por região do corpo (dorso, flancos, membros, cabeça). A pele parece borracha com bolinhas, e é o que mais denuncia o modelo gerado por código. A pesquisa anterior (v0.5) está em [`../modelos-externos.md`](../modelos-externos.md).

## Pesquisa de recursos gratuitos (fase B, parte de recursos)

| Site | Consultado? | Resultado |
|---|---|---|
| Sketchfab (API) | **sim**, em 18/10/2026: 13 buscas para as espécies novas (megatério, smilodon, dodô, sucuri, deinosuchus, mosassauro, dilofossauro), só modelos baixáveis, animados e CC0/CC BY | nenhum modelo aproveitável (detalhes abaixo); a busca da v0.5 para as 26 espécies está em `modelos-externos.md` |
| Smithsonian 3D (3d.si.edu) e Open Access (api.si.edu) | **não**: o acesso à rede deste ambiente recusa esses endereços | — |
| BlenderKit | **não**: rede bloqueada | — |
| Natural History Museum (nhm.ac.uk) | **não**: rede bloqueada | — |
| threejs.org e khronos.org | **não**: rede bloqueada; usei a versão do Three.js instalada no projeto | — |

### Candidatos do Sketchfab (18/10/2026) e decisão

| Espécie | Modelo | Licença declarada | Decisão |
|---|---|---|---|
| Smilodon | "SABRE" (slang107123456789), 44 animações | CC BY | **recusado**: é reenvio de um modelo idêntico (mesmos 6.706 triângulos e 44 animações) publicado antes por outra conta sem descrição; a origem não está clara |
| Smilodon | "Smilodon Game Animations" (BPoole) | CC BY | recusado: trabalho de estudante com 1.276 triângulos, muito abaixo da qualidade pedida |
| Smilodon / megatério | "Ice Age – Diego / Sid" | CC BY | recusado: personagens de filme (A Era do Gelo) |
| Dodô | "Kulu-Ya-Ku Anims" | CC BY | recusado: extraído de Monster Hunter, e não é um dodô |
| Sucuri | "Anaconda attack jungle" (ayoubbenz) | CC BY | recusado: cena de baixa resolução (3.778 triângulos com árvores) |
| Deinosuchus | "deinosuchus" (victory_) | CC BY | recusado: objetos espalhados e escala errada (já visto na v0.5) |
| Mosassauro | "Toon Mosasaurus", "MOSASAUR" | CC BY | recusados: estilo cartum ou muito simples |
| Dilofossauro | "Dino Hunter Deadly Shores …", "dilophosaur (cred lvlapp)" | CC BY | recusados: extraídos de jogos |

## Conclusão e caminho escolhido

- Não existe hoje, nas fontes acessíveis, modelo gratuito, animado, de origem limpa e com qualidade realista para as espécies que faltam. Para chegar a uma qualidade "cinematográfica" nelas, seria preciso um artista 3D, ou modelos pagos com licença para jogos (com a sua aprovação).
- **O que dá para fazer de verdade aqui:** melhorar o **gerador procedural**, de que todas as espécies se beneficiam, seguindo o processo pedido: piloto primeiro, depois uma espécie de cada vez.
- **Piloto: tricerátops.** Não tem nenhum modelo externo aproveitável, é muito conhecido (dá para comparar com as referências) e mostra os problemas comuns: pele uniforme, corpo inflado, membros em tubo e gola artificial.
- **Para liberar os sites bloqueados:** nas configurações do ambiente (menu do ambiente no topo da sessão → Editar → Acesso à rede), adicione `3d.si.edu`, `api.si.edu`, `www.si.edu`, `www.blenderkit.com` e `www.nhm.ac.uk` aos domínios permitidos.
