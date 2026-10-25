# Multijogador cooperativo: como funciona e como hospedar

Até **8 pessoas** jogam no mesmo mundo. Quem cria a sala **hospeda o mundo**. Os outros entram
com o **código de convite** de 6 caracteres. Um servidor Node pequeno (`server/server.ts`) liga os
jogadores e, se quiser, serve o próprio jogo, então um único processo resolve tudo.

## Como jogar
1. Menu principal → **Multijogador**.
2. Escreva seu nome. O campo **Servidor** pode ficar vazio quando o jogo é aberto pelo mesmo
   endereço do servidor.
3. **Criar sala**: um mundo novo começa e o código aparece no canto superior direito.
   Use **Copiar código** e mande o código para os amigos.
4. Os amigos usam **Entrar na sala** com esse código. Eles nascem a poucos passos de você.
5. O chat fica no mesmo canto: escreva e tecle Enter.

O que é compartilhado:

| Item | Como funciona |
|---|---|
| Mundo | Mesma semente: terreno, rios, vegetação e locais são idênticos para todos. |
| Jogadores | Cada um vê os outros com o modelo do sobrevivente, andando, correndo, agachando, nadando e golpeando, com o nome sobre a cabeça. |
| Animais | Quem hospeda simula a IA de todos os animais, inclusive os que estão perto dos convidados. Os convidados veem os mesmos animais nas mesmas posições. Cada animal percebe o jogador **mais próximo** dele: caça, foge ou ataca qualquer um. |
| Combate | O golpe de um convidado num animal é enviado a quem hospeda, que o aplica (vida, fuga, morte). O ataque de um animal a um convidado chega até ele (dano e empurrão). |
| Construção | Peças construídas ou demolidas por qualquer jogador aparecem para todos. Quem entra depois recebe a base inteira. Peças destruídas por animais somem para todos. |
| Relógio e clima | Seguem os de quem hospeda. |
| Saída de quem hospeda | Se quem hospeda cai ou sai, o jogador conectado há mais tempo assume a simulação, sem reiniciar o mundo. |
| Queda de conexão | O jogo reconecta sozinho (espera de 1, 2, 4, 8 e depois 15 s) e volta como o mesmo jogador. A vaga fica guardada por 60 s. |

## Rodar no seu computador
Requer Node.js 22 ou mais novo (o servidor roda direto do TypeScript).

```bash
npm install
npm run build                     # gera dist/
STATIC_DIR=dist npm run server    # jogo + servidor em http://localhost:8787
```

Na mesma rede, os outros abrem `http://IP-DO-SEU-COMPUTADOR:8787`. O firewall precisa liberar a
porta 8787.

## Hospedar na internet

### Opção A: Docker (VPS, Fly.io, Render, Railway…)
```bash
docker build --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t era-dos-gigantes .
docker run -d --restart unless-stopped -p 8787:8787 --name edg era-dos-gigantes
```
A imagem tem duas etapas:
1. A primeira compila o jogo.
2. A final leva só o servidor, `dist/` e as dependências de produção (`three` e `ws`), roda com o
   usuário `node` e tem checagem de saúde em `/health`.

Nos serviços gerenciados, aponte a porta interna 8787 e a checagem de saúde para `/health`.
O serviço precisa aceitar **WebSocket**: Fly.io, Render e Railway aceitam.

> Não havia daemon Docker no ambiente onde isto foi feito, então a imagem em si não foi
> construída aqui. As duas etapas foram reproduzidas à mão a partir de uma cópia limpa do
> repositório:
> - `npm ci` e `npm run build`;
> - depois `npm ci --omit=dev` com `server/`, `protocol.ts` e `dist/`.
>
> Nesse layout, o servidor serviu o jogo, os modelos e o `/health` corretamente.

### Opção B: VPS sem Docker, com HTTPS
Navegadores em páginas `https` só aceitam `wss://` (WebSocket com TLS). O jeito mais simples é o
Caddy na frente, que emite o certificado sozinho.

`/etc/systemd/system/era-dos-gigantes.service`:
```ini
[Unit]
Description=Era dos Gigantes (jogo + servidor cooperativo)
After=network.target

[Service]
WorkingDirectory=/opt/era-dos-gigantes
Environment=PORT=8787 HOST=127.0.0.1 STATIC_DIR=dist
ExecStart=/usr/bin/node server/server.ts
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile`:
```
jogo.seudominio.com {
    reverse_proxy 127.0.0.1:8787
}
```
O Caddy repassa o WebSocket (`/ws`) sem configuração extra. Com o servidor atrás de proxy,
o IP do jogador é lido do cabeçalho `X-Forwarded-For`, usado no limite de conexões por IP.

### Opção C: jogo num lugar, servidor em outro
Se o jogo estiver em hospedagem estática (GitHub Pages, Netlify…), suba só o servidor e diga ao
jogo onde ele está:
- no campo **Servidor** do menu: `wss://servidor.seudominio.com/ws`;
- ou no endereço da página: `https://seujogo.com/?server=wss://servidor.seudominio.com/ws`.

No servidor, defina `ALLOWED_ORIGINS=https://seujogo.com` para aceitar só o seu site.

> **O artifact do claude.ai não serve para o multijogador.** A página dele bloqueia conexões
> com outros endereços, então o botão Multijogador ali sempre mostra "Não foi possível
> conectar". Para jogar junto, use uma das opções acima.

### Variáveis de ambiente
| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | 8787 | Porta HTTP e WebSocket. |
| `HOST` | 0.0.0.0 | Interface; use 127.0.0.1 atrás de proxy. |
| `STATIC_DIR` | (vazio) | Pasta do jogo compilado (`dist`) para servir junto. |
| `ALLOWED_ORIGINS` | (vazio = qualquer) | Sites que podem conectar, separados por vírgula. |
| `MAX_ROOMS` | 200 | Salas simultâneas. |
| `MAX_CONN_PER_IP` | 16 | Conexões simultâneas por IP. |

## Proteções do servidor
O servidor **não simula o mundo**: ele repassa e confere o que dá para conferir sem simular.
- **Mensagens:**
  - no máximo 48 KB e 40 por segundo (rajada de 80);
  - todo campo é validado: tipo, faixa, tamanho de texto e números finitos;
  - mensagem malformada conta como infração.
- **Movimento:** acima de 32 m/s (mais 6 m de folga por atraso), o servidor devolve o jogador
  à última posição aceita e não repassa o salto (bloqueia teletransporte e *speed hack*).
- **Golpes:** dano até 250, até 6 por segundo, e o ponto do golpe a até 40 m da posição aceita
  de quem bate.
- **Só quem hospeda** pode mandar animais, relógio, clima e dano em outro jogador.
- **Infrações:** com 12 infrações (movimento impossível, mensagem inválida, excesso), a conexão é
  encerrada.
- **Nomes e chat:** sem caracteres de controle, invisíveis ou de inversão de texto; nome com
  até 16 caracteres e mensagem com até 200.
- **Salas e sessão:**
  - código de sala com 31⁶ (≈ 887 milhões) combinações, gerado com `crypto`;
  - token de reconexão de 192 bits;
  - limite de conexões por IP;
  - *heartbeat* a cada 15 s derruba conexões mortas.
- **Arquivos:** os estáticos nunca saem de `STATIC_DIR` (testado com `../` normal e
  codificado).

Limite de confiança: **quem hospeda é confiável**. Inventário, vida e progresso de cada jogador
ficam no aparelho dele. Isso basta para jogar entre amigos, mas não serve como servidor público
competitivo.

## Testes
| Teste | Comando | Resultado (25/10/2026) |
|---|---|---|
| Protocolo (unitário) | `npx vitest run tests/net-protocol.test.ts` | 5/5 |
| Servidor real com sockets | `npx vitest run tests/net-server.test.ts` | 10/10 |
| IA com vários jogadores | `npx vitest run tests/coop-eco.test.ts` | 2/2 |
| Dois navegadores reais | `node tests/e2e/coop.mjs` (veja o cabeçalho) | 14/14, em três rodadas seguidas |
| Carga | `npm run test:load` | veja abaixo |

Os 14 itens do teste com dois navegadores:
- entrar na sala;
- ver o outro jogador;
- animais iguais nos dois lados;
- chat;
- golpe do convidado;
- dano no convidado;
- construir e demolir;
- reconexão;
- troca de quem hospeda;
- animais continuando vivos depois da troca;
- nenhum erro de página.

### Carga medida
Condições:
- contêiner de 4 núcleos, clientes e servidor na mesma máquina;
- 8 jogadores por sala, cada um mandando posição a 10 Hz;
- quem hospeda manda 120 animais a 5 Hz;
- 30 s por rodada.

| Jogadores | Mensagens entregues/s | Latência p50 / p95 / p99 | CPU do servidor | Memória máx. | Erros |
|---|---|---|---|---|---|
| 200 (25 salas) | 3065 | 0 / 2 / 4 ms | 13% de um núcleo | 104 MB | 0 |
| 400 (50 salas) | 6118 | 0 / 4 / 9 ms | 20% de um núcleo | 118 MB | 0 |

A latência acima é só a do servidor, sem a internet. Num servidor real, some o ping entre os
jogadores e ele.

## Limitações conhecidas
- **Inventário, vida, habilidades e diário** são de cada jogador. O convidado **não grava**,
  porque o mundo é de quem hospeda. Quem hospeda grava a partida cooperativa num espaço
  separado (`coop`), sem apagar o mundo solo.
- **O desempenho de quem hospeda** define o dos animais de todos. Prefira que hospede o
  aparelho mais forte.
- **Ainda não sincronizados:**
  - conteúdo de baús;
  - plantações;
  - armadilhas;
  - comandos e montaria de animais domesticados (um jogador montado fica invisível para os
    outros);
  - eventos raros (meteoros, erupção) e itens largados no chão.
- O dano de um animal num convidado chega sem a animação de esquiva dele: um convidado não
  consegue "esquivar" do golpe que o anfitrião já resolveu.
