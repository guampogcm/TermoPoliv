// Servidor do TermoPoliv: recebe o JSON do ESP32 e entrega o painel web.
//   npm start      modo real: grava em dados/leituras.jsonl
//   npm run demo   modo demonstração: dados fictícios, somente em memória
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Armazem, validarLeitura } from './lib/leituras.js';
import { montarPainel, PERIODOS } from './lib/metricas.js';
import { criarSimulador } from './lib/demo.js';
import { iniciarDescoberta, PORTA_DESCOBERTA } from './lib/descoberta.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, 'public');
const TAMANHO_MAX_CORPO = 4096;
const INTERVALO_DEMO_MS = 5000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function responderJson(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      // Descarta o excesso sem derrubar a conexão, para o cliente receber o 413.
      if (tamanho > TAMANHO_MAX_CORPO) {
        reject(Object.assign(new Error('Corpo grande demais.'), { status: 413 }));
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function servirArquivo(url, res) {
  const relativo = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const caminho = path.resolve(PUBLICO, relativo);
  if (!caminho.startsWith(PUBLICO + path.sep)) return responderJson(res, 403, { erro: 'Caminho proibido.' });
  fs.readFile(caminho, (erro, conteudo) => {
    if (erro) return responderJson(res, 404, { erro: 'Não encontrado.' });
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(caminho)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(conteudo);
  });
}

function gerarCsv(leituras, inicio, modo) {
  const fonte = modo === 'demo' ? 'simulado' : 'esp32';
  const linhas = ['data_hora_utc,sensor_id,temperatura_c,umidade_pct,fonte'];
  for (const l of leituras) {
    if (l.ts >= inicio) {
      linhas.push(`${new Date(l.ts).toISOString()},${l.sensor_id},${l.temperatura},${l.umidade},${fonte}`);
    }
  }
  return `${linhas.join('\n')}\n`;
}

/** Cria o servidor sem colocá-lo no ar, para que os testes escolham a porta. */
export function criarServidor({
  modo = 'real',
  arquivoDados = path.join(RAIZ, 'dados', 'leituras.jsonl'),
  arquivoPontos = path.join(RAIZ, 'config', modo === 'demo' ? 'pontos.demo.json' : 'pontos.json'),
  chaveApi = process.env.TERMOPOLIV_API_KEY ?? null,
  onlineMs = Number(process.env.TERMOPOLIV_ONLINE_MIN ?? 15) * 60_000,
} = {}) {
  const cadastro = JSON.parse(fs.readFileSync(arquivoPontos, 'utf8'));
  const armazem = new Armazem(modo === 'demo' ? null : arquivoDados);
  const ouvintes = new Set();
  const avisarOuvintes = () => {
    for (const ouvinte of ouvintes) ouvinte.write(`event: leitura\ndata: ${Date.now()}\n\n`);
  };

  let relogioDemo = null;
  if (modo === 'demo') {
    const simulador = criarSimulador(cadastro);
    armazem.leituras = simulador.historico;
    relogioDemo = setInterval(() => {
      armazem.leituras.push(...simulador.proximas(Date.now()));
      avisarOuvintes();
    }, INTERVALO_DEMO_MS);
  }

  async function receberLeitura(req, res) {
    if (modo === 'demo') {
      return responderJson(res, 409, { erro: 'Modo demonstração não aceita leituras reais. Use npm start.' });
    }
    if (chaveApi && req.headers['x-api-key'] !== chaveApi) {
      return responderJson(res, 401, { erro: 'Chave de API ausente ou incorreta.' });
    }
    let corpo;
    try {
      corpo = JSON.parse(await lerCorpo(req));
    } catch (erro) {
      return responderJson(res, erro.status ?? 400, { erro: erro.status ? erro.message : 'JSON inválido.' });
    }
    const { leitura, erro } = validarLeitura(corpo);
    if (erro) return responderJson(res, 422, { erro });
    armazem.adicionar(leitura);
    avisarOuvintes();
    return responderJson(res, 201, { ok: true, ts: leitura.ts });
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rota = `${req.method} ${url.pathname}`;
    const periodo = url.searchParams.get('periodo') ?? '24h';
    try {
      if (rota === 'POST /api/leituras') return await receberLeitura(req, res);
      if (rota === 'GET /api/painel' || rota === 'GET /api/leituras.csv') {
        if (!PERIODOS[periodo]) return responderJson(res, 400, { erro: 'periodo deve ser 24h, 7d ou 30d.' });
      }
      if (rota === 'GET /api/painel') {
        return responderJson(res, 200, montarPainel({
          leituras: armazem.leituras, cadastro, periodo, agora: Date.now(), onlineMs, modo,
        }));
      }
      if (rota === 'GET /api/leituras.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="termopoliv-${modo}-${periodo}.csv"`,
        });
        return res.end(gerarCsv(armazem.leituras, Date.now() - PERIODOS[periodo].duracao, modo));
      }
      if (rota === 'GET /api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': conectado\n\n');
        ouvintes.add(res);
        req.on('close', () => ouvintes.delete(res));
        return undefined;
      }
      if (req.method === 'GET') return servirArquivo(url, res);
      return responderJson(res, 404, { erro: 'Rota não encontrada.' });
    } catch (erro) {
      console.error(erro);
      if (!res.headersSent) responderJson(res, 500, { erro: 'Erro interno.' });
      else res.end();
      return undefined;
    }
  });

  servidor.on('close', () => clearInterval(relogioDemo));
  servidor.encerrar = () => {
    for (const ouvinte of ouvintes) ouvinte.end();
    servidor.close();
  };
  return servidor;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const modo = process.argv.includes('--demo') ? 'demo' : 'real';
  const porta = Number(process.env.PORT ?? 8080);
  const servidor = criarServidor({ modo });
  servidor.on('error', (erro) => {
    if (erro.code !== 'EADDRINUSE') throw erro;
    console.error(`A porta ${porta} já está em uso. Feche o outro programa ou escolha outra porta: PORT=8081 npm start`);
    process.exit(1);
  });
  servidor.listen(porta, '0.0.0.0', () => {
    console.log(`TermoPoliv (${modo}) em http://localhost:${porta}`);
    if (modo === 'real') {
      console.log(`ESP32: POST http://<ip-deste-computador>:${porta}/api/leituras`);
      // Só no modo real: o demo recusa leituras, então não deve atrair o ESP32.
      iniciarDescoberta({ portaHttp: porta }).pronto
        .then(() => console.log(`Descoberta automática do ESP32 ativa (UDP ${PORTA_DESCOBERTA}).`));
    }
  });
}
