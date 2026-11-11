import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validarLeitura } from '../lib/leituras.js';
import { criarServidor } from '../server.js';

const valido = { sensor_id: 'esp32-01', temperatura: 27.4, umidade: 61.2 };

async function comServidor(opcoes, usar) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'termopoliv-'));
  const arquivoDados = path.join(pasta, 'leituras.jsonl');
  const servidor = criarServidor({ chaveApi: null, arquivoDados, ...opcoes });
  await new Promise((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  try {
    await usar(url, arquivoDados);
  } finally {
    servidor.encerrar();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

const enviar = (url, corpo, headers = {}) => fetch(`${url}/api/leituras`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
});

test('validação recusa leituras impossíveis', () => {
  assert.ok(validarLeitura({ ...valido, temperatura: null }).erro, 'NaN do DHT22 chega como null');
  assert.ok(validarLeitura({ ...valido, temperatura: 120 }).erro);
  assert.ok(validarLeitura({ ...valido, umidade: 101 }).erro);
  assert.ok(validarLeitura({ ...valido, sensor_id: '<script>' }).erro);
  assert.ok(validarLeitura({ ...valido, lat: -25.4 }).erro);
  assert.ok(validarLeitura([valido]).erro);
  assert.ok(validarLeitura(null).erro);
});

test('relógio zerado do ESP32 cai na hora do servidor', () => {
  const agora = Date.UTC(2026, 10, 5);
  assert.equal(validarLeitura({ ...valido, timestamp: 0 }, agora).leitura.ts, agora);
  assert.equal(validarLeitura({ ...valido, timestamp: agora / 1000 + 86400 }, agora).leitura.ts, agora);
  assert.equal(validarLeitura({ ...valido, timestamp: agora / 1000 - 60 }, agora).leitura.ts, agora - 60_000);
});

test('leitura enviada aparece no painel e sobrevive a reinício', async () => {
  await comServidor({}, async (url, arquivoDados) => {
    const resposta = await enviar(url, valido);
    assert.equal(resposta.status, 201);
    const painel = await (await fetch(`${url}/api/painel`)).json();
    const ponto = painel.pontos.find((p) => p.id === 'esp32-01');
    assert.equal(ponto.ultima.temperatura, 27.4);
    assert.equal(painel.agora.online, 1);

    await comServidor({ arquivoDados }, async (urlNova) => {
      const recarregado = await (await fetch(`${urlNova}/api/painel`)).json();
      assert.equal(recarregado.agora.online, 1);
    });
  });
});

test('erros devolvem o status certo', async () => {
  await comServidor({}, async (url) => {
    assert.equal((await enviar(url, '{quebrado')).status, 400);
    assert.equal((await enviar(url, { ...valido, umidade: 'alta' })).status, 422);
    assert.equal((await enviar(url, { ...valido, pad: 'x'.repeat(5000) })).status, 413);
    assert.equal((await fetch(`${url}/api/painel?periodo=1ano`)).status, 400);
  });
});

test('chave de API protege a escrita', async () => {
  await comServidor({ chaveApi: 'segredo' }, async (url) => {
    assert.equal((await enviar(url, valido)).status, 401);
    assert.equal((await enviar(url, valido, { 'X-API-Key': 'errada' })).status, 401);
    assert.equal((await enviar(url, valido, { 'X-API-Key': 'segredo' })).status, 201);
  });
});

test('modo demo recusa leituras e marca o CSV como simulado', async () => {
  await comServidor({ modo: 'demo' }, async (url, arquivoDados) => {
    assert.equal((await enviar(url, valido)).status, 409);
    const painel = await (await fetch(`${url}/api/painel`)).json();
    assert.equal(painel.modo, 'demo');
    assert.ok(painel.agora.icu.valor > 0);
    const csv = await (await fetch(`${url}/api/leituras.csv?periodo=24h`)).text();
    assert.match(csv.split('\n')[1], /,simulado$/);
    assert.equal(fs.existsSync(arquivoDados), false, 'demo nunca grava em disco');
  });
});

test('arquivos fora de public não são servidos', async () => {
  await comServidor({}, async (url) => {
    for (const caminho of ['/..%2fserver.js', '/%2e%2e/package.json', '/..%2f..%2fREADME.md']) {
      const resposta = await fetch(`${url}${caminho}`);
      assert.notEqual(resposta.status, 200, caminho);
    }
  });
});

test('servidor responde à descoberta do ESP32 com a porta HTTP', async () => {
  const dgram = await import('node:dgram');
  const { iniciarDescoberta } = await import('../lib/descoberta.js');
  const { socket: servidor, pronto } = iniciarDescoberta({ portaHttp: 8080, porta: 0, endereco: '127.0.0.1' });
  await pronto;
  const cliente = dgram.createSocket('udp4');
  try {
    const resposta = new Promise((resolve) => cliente.once('message', (m, r) => resolve({ texto: m.toString(), r })));
    cliente.send('TERMOPOLIV?', servidor.address().port, '127.0.0.1');
    const { texto, r } = await resposta;
    assert.equal(texto, 'TERMOPOLIV 8080');
    assert.equal(r.address, '127.0.0.1', 'o ESP32 tira o IP do servidor do remetente');
  } finally {
    cliente.close();
    servidor.close();
  }
});
