# Modelos 3D externos

Os arquivos `.glb` daqui substituem os modelos procedurais das espécies listadas
em `manifest.json`. As espécies que não estão no manifesto continuam com o
modelo gerado pelo jogo.

## Modelos incluídos (v0.5)

| Espécie | Arquivo | Origem | Autor | Licença | Clipes usados |
|---|---|---|---|---|---|
| Tiranossauro | `tyrannosaurus.glb` (1,6 MB, 9,0 mil triângulos) | [Animated Tyrannosaurus Rex Dinosaur Running Loop](https://sketchfab.com/3d-models/animated-tyrannosaurus-rex-dinosaur-running-loop-38007d947ae74dea83988cb0b08ee053) | LasquetiSpice | CC BY 4.0 | idle, run, attack (mordida), roar |
| Estegossauro | `stegosaurus.glb` (1,3 MB, 10,0 mil) | [PBR Stegasaurus (Animated)](https://sketchfab.com/3d-models/pbr-stegasaurus-animated-ec254ea1554941fe8a131f62db0faf3d) | Ferocious Industries | CC BY 4.0 | idle, walk, run, eat, drink, attack (golpe de cauda), roar, death |
| Paquicefalossauro | `pachycephalosaurus.glb` (3,4 MB, 12,6 mil) | [PBR Pachycephalasaurus (Animated)](https://sketchfab.com/3d-models/pbr-pachycephalasaurus-animated-6eea5cee4afa4730bf75c6329a43e56d) | Ferocious Industries | CC BY 4.0 | idle, walk, run, eat, drink, rest (dormir), attack (cabeçada), roar |

Os créditos também aparecem no jogo (menu principal → **Créditos**), como a
licença CC BY exige. Os arquivos foram modificados: escala, orientação,
redução de malha, texturas em WebP, compressão e remoção de clipes não usados.

## Formato do manifesto

```json
{
  "version": 1,
  "species": {
    "stegosaurus": {
      "url": "stegosaurus.glb",
      "scale": 1,
      "strideM": 1.6,
      "clipSpeeds": { "walk": 1.5, "run": 3.6 },
      "clips": { "idle": "idle", "walk": "walk", "run": "run", "eat": "eat", "drink": "drink", "attack": "attack", "roar": "roar", "death": "death" },
      "credit": { "title": "…", "author": "…", "url": "https://sketchfab.com/…", "license": "CC BY 4.0" }
    }
  },
  "player": null
}
```

- `scale`: multiplica o modelo. Os arquivos incluídos já estão em metros (`scale: 1`).
- `clipSpeeds`: velocidade no chão (m/s) em que cada clipe de locomoção foi
  animado, medida nos pés durante o apoio. O jogo toca o clipe a
  `velocidade real ÷ clipSpeed` (limitado entre 0,15× e 3×), para os pés não
  deslizarem.
- `strideM`: alternativa a `clipSpeeds` quando ela não foi medida (um ciclo do
  clipe = dois passos de `strideM`).
- `clips`: nome da animação no arquivo para cada estado do jogo: `idle`, `walk`,
  `run`, `eat`, `drink`, `rest`, `attack`, `roar` (alerta), `swim`, `fly`, `death`.
  Os que faltarem usam o mais próximo (beber → comer → parado; andar ↔ correr).
  Sem `death`, o animal só tomba de lado.
- `credit`: obrigatório para arquivos CC BY; aparece na tela de créditos.

O modelo deve olhar para +Z, ter Y para cima e pés em y = 0. Arquivos listados
aqui entram no cache offline automaticamente no build. Acima de 1,2× a distância
de detalhe, o jogo volta ao modelo procedural leve (sem atualizar a animação), e
as sombras do modelo externo só são projetadas de perto.

## Como preparar um modelo novo

`tools/optimize-model.mjs` normaliza e otimiza um GLB baixado (precisa de
`@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`,
`meshoptimizer` e `sharp`, que não são dependências do projeto):

```sh
node tools/optimize-model.mjs entrada.glb public/models/especie.glb \
  '{"scale":0.8647,"floor":-0.014,"tex":1024,"simplify":0.5,"clips":{"idle":"IdleA","walk":"Walk","run":"Run"}}'
```

- `scale` e `floor`: fator para metros e altura do chão no arquivo original
  (medidos com o modelo parado).
- `simplify`: fração de triângulos mantida.
- `clips`: nome no jogo → nome no arquivo; os outros clipes são descartados.

O script converte materiais spec/gloss para metal/rough, reduz texturas para
WebP, quantiza e comprime com meshopt (o jogo carrega o decodificador).

## Critérios de escolha

Só entram arquivos com licença **CC0 ou CC BY** e origem própria do autor. O
registro da busca (o que foi descartado e por quê) está em
[`docs/modelos-externos.md`](../../docs/modelos-externos.md).
