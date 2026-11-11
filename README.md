# TermoPoliv
Repositorio destinado ao nosso projeto de faculdade de Ciberfisica. O TermoPoliv tem como objetivo medir a temperatura e umidade da cidade de Curitiba para fazer um levantamento de mapa de calor.


## Painel web

O painel fica em [`web/`](web/) e mostra ilhas de calor, arborização e segregação socioespacial a partir das leituras dos sensores. Precisa apenas do Node.js 20 ou superior, sem instalar dependências.

```bash
cd web
npm run demo   # dados fictícios, para ver o painel sem hardware
npm start      # modo real, recebe as leituras do ESP32
npm test       # testes do servidor e dos cálculos
```

Depois abra <http://localhost:8080>. Para usar outra porta: `PORT=8081 npm start`.

> **O modo demo não é resultado de pesquisa.** Leituras, cobertura arbórea e renda são inventadas, e a relação "menos árvores e menos renda, mais calor" foi programada em [`web/lib/demo.js`](web/lib/demo.js). Os dados demo nunca são gravados em disco, e o CSV exportado sai marcado como `simulado`.

### Enviando dados do ESP32

No [`sla.c`](sla.c), preencha só `WIFI_NOME` e `WIFI_SENHA` com a mesma rede do computador (hotspot em 2,4 GHz). O ESP32 acha o servidor sozinho: manda `TERMOPOLIV?` em broadcast UDP na porta 8099, e o `npm start` responde com a porta HTTP. Se a rede bloquear broadcast, preencha `URL_SERVIDOR` com o IP do computador.

O ESP32 faz um `POST` para `http://<ip-do-computador>:8080/api/leituras`:

```json
{ "sensor_id": "esp32-01", "temperatura": 27.4, "umidade": 61.2 }
```

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `sensor_id` | texto | sim | Até 40 letras, números, `.`, `-` ou `_` |
| `temperatura` | número | sim | Em °C, de -40 a 80 |
| `umidade` | número | sim | Em %, de 0 a 100 |
| `lat`, `lon` | número | não | Posição do GPS do ponto. Envie os dois juntos. Sem eles, vale a de `config/pontos.json` |
| `timestamp` | número | não | Unix, em segundos. Sem ele, ou com relógio zerado, vale a hora do servidor |

Respostas: `201` gravou, `422` leitura inválida (uma falha do DHT22 chega como `null`), `400` JSON malformado, `401` chave incorreta.

Para testar sem o ESP32:

```bash
curl -X POST http://localhost:8080/api/leituras \
  -H "Content-Type: application/json" \
  -d '{"sensor_id":"esp32-01","temperatura":27.4,"umidade":61.2}'
```

Se o servidor ficar acessível fora da rede local, defina uma chave com `TERMOPOLIV_API_KEY=segredo npm start`. O ESP32 passa a enviá-la no cabeçalho `X-API-Key`.

### Cadastrando os pontos

Cada sensor é descrito em [`web/config/pontos.json`](web/config/pontos.json):

```json
{
  "id": "esp32-01",
  "nome": "Parque Barigui",
  "bairro": "Santo Inácio",
  "lat": -25.4215,
  "lon": -49.3075,
  "referencia": true,
  "cobertura_arborea_pct": 58,
  "renda_media_sm": 6.8
}
```

- `referencia`: marque `true` em um sensor instalado em área verde. A intensidade da ilha de calor é a diferença entre cada ponto e ele. Sem referência, o painel usa o ponto mais frio.
- `cobertura_arborea_pct`: cobertura de árvores no entorno do sensor, em porcentagem.
- `renda_media_sm`: renda média do bairro ou setor censitário, em salários mínimos.

Os dois últimos campos alimentam a seção "Quem sente mais calor?" e precisam vir de fontes como IPPUC, MapBiomas e Censo do IBGE. Reinicie o servidor depois de editar o arquivo.

As leituras ficam em `web/dados/leituras.jsonl`, uma por linha. Esse arquivo não vai para o Git, então faça cópia de segurança dele. O painel carrega tudo na memória, o que atende bem a alguns sensores por vários meses.

### Rotas

| Rota | Função |
|---|---|
| `POST /api/leituras` | Recebe uma leitura |
| `GET /api/painel?periodo=24h\|7d\|30d` | Todos os dados do painel |
| `GET /api/leituras.csv?periodo=24h\|7d\|30d` | Exporta as leituras |
| `GET /api/stream` | Avisa o navegador de novas leituras (SSE) |
