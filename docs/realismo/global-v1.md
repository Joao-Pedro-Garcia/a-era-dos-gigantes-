# Realismo dos animais — melhoria global (todas as espécies)

Comparação, com a fileira de cima antes e a de baixo depois: [`../visual/realismo-global-v1.jpg`](../visual/realismo-global-v1.jpg).

## O que mudou para todas as 26 espécies

| Melhoria | Como |
|---|---|
| **Sombra de contato** (oclusão ambiente) | calculada no próprio modelo: escurece axilas, virilha, a barriga, o espaço entre as pernas e a junção do pescoço |
| **Pintura natural** | manchas em três escalas, sela escura suave no dorso (antes era uma linha dura), variação de tom entre manchas, listras e pintas com bordas irregulares, lama e poeira nos pés |
| **Mais detalhe de perto** | ~2,2 vezes mais vértices no nível de detalhe próximo (corpo, pernas e cabeça) |
| **Anatomia na superfície** | crista da coluna, volumes do quadril (ílio) e da escápula, costelas leves nos flancos, dobras na garganta e no pescoço e irregularidades naturais |
| **Articulações** | dobras de pele no joelho, cotovelo, tornozelo e punho |
| **Membros ovais** | coxas e braços mais fundos que largos |
| **Coxa integrada ao corpo** | a coxa e o braço nascem de dentro do corpo com uma curva; acabou a "placa" reta que aparecia no topo da coxa (muito visível no tiranossauro) |
| **Pele** | brilho aveludado suave nas bordas (sheen) no lugar do aspecto de tinta chapada |

## Custo

- Gerar os modelos de todas as espécies passou de ~0,5 s para ~1,7 s no total. Isso acontece na tela de carregamento, que já reserva tempo para essa etapa.
- O nível de detalhe próximo tem ~15 mil vértices por animal, e só os animais perto da câmera o usam.

## Limite honesto

O resultado está **melhor, mas não chega a "qualidade de cinema"**. Um modelo gerado por código não alcança um modelo esculpido por um artista (músculos, pregas e escamas esculpidos à mão, texturas pintadas e animação capturada). Para isso, o caminho é usar **modelos profissionais**. A busca de modelos gratuitos (Sketchfab e BlenderKit) não encontrou nenhum realista. Os pagos estão na seção "Opções" do relatório da conversa.
