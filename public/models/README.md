# Modelos 3D externos (opcional)

Coloque aqui arquivos `.glb` e registre-os em `manifest.json` para substituir
os modelos procedurais. Exemplo:

```json
{
  "version": 1,
  "species": {
    "tyrannosaurus": {
      "url": "tyrannosaurus.glb",
      "scale": 1,
      "strideM": 3.6,
      "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "eat": "Eat", "rest": "Rest", "attack": "Bite" }
    }
  },
  "player": { "url": "survivor.glb", "scale": 1, "strideM": 1.1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run" } }
}
```

- `scale`: multiplica o modelo para que 1 unidade = 1 metro e o comprimento
  bata com a espécie.
- `strideM`: comprimento do passo da animação de caminhada em metros. O jogo
  ajusta a velocidade do clipe à velocidade real, para os pés não deslizarem.
- `clips`: nomes das animações no arquivo. Os que faltarem usam o mais
  próximo (idle → walk → run).

O modelo deve olhar para +Z, ter Y para cima e pés em y = 0. Arquivos listados
aqui entram no cache offline automaticamente no build.
