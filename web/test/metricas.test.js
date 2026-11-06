import assert from 'node:assert/strict';
import test from 'node:test';
import { correlacao, diferencaEntreTercos, montarPainel, sensacaoTermica } from '../lib/metricas.js';

const H = 3_600_000;
const AGORA = Date.UTC(2026, 10, 5, 18, 0, 0);
const base = { periodo: '24h', agora: AGORA, onlineMs: 15 * 60_000, modo: 'real' };
const ponto = (id, extras = {}) => ({
  id, nome: id, bairro: null, lat: null, lon: null, referencia: false,
  cobertura_arborea_pct: null, renda_media_sm: null, ...extras,
});
const leitura = (sensor_id, temperatura, atras = 0) => ({ ts: AGORA - atras, sensor_id, temperatura, umidade: 60 });

test('sensação térmica confere com a tabela do NWS', () => {
  // 90 °F com 70 % de umidade = 105 °F na tabela oficial
  assert.ok(Math.abs(sensacaoTermica(32.22, 70) - 40.6) < 0.5);
  // Em temperatura amena a sensação fica próxima da temperatura do ar
  assert.ok(Math.abs(sensacaoTermica(20, 60) - 20) < 1);
});

test('correlação perfeita vale 1 e a reta é recuperada', () => {
  const ajuste = correlacao([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
  assert.equal(ajuste.n, 3);
  assert.ok(Math.abs(ajuste.r - 1) < 1e-9);
  assert.ok(Math.abs(ajuste.inclinacao - 2) < 1e-9);
  assert.ok(Math.abs(ajuste.intercepto - 1) < 1e-9);
});

test('correlação é nula com poucos pontos ou sem variação', () => {
  assert.equal(correlacao([{ x: 0, y: 1 }, { x: 1, y: 2 }]), null);
  assert.equal(correlacao([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]), null);
});

test('diferença entre terços compara os extremos', () => {
  const pares = [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 10 - x }));
  assert.deepEqual(diferencaEntreTercos(pares), { baixo: 8.5, alto: 4.5, diferenca: 4, por_grupo: 2 });
  assert.equal(diferencaEntreTercos(pares.slice(0, 5)), null);
});

test('painel sem leituras não quebra', () => {
  const p = montarPainel({ ...base, leituras: [], cadastro: [ponto('a')] });
  assert.equal(p.agora.online, 0);
  assert.equal(p.agora.icu, null);
  assert.equal(p.agora.temperatura_media, null);
  assert.equal(p.ultima_leitura, null);
  assert.equal(p.referencia, null);
});

test('com um único sensor não há intensidade de ilha de calor', () => {
  const p = montarPainel({ ...base, leituras: [leitura('a', 25)], cadastro: [ponto('a')] });
  assert.equal(p.agora.online, 1);
  assert.equal(p.agora.icu, null);
  assert.equal(p.agora.temperatura_media, 25);
});

test('intensidade usa o ponto de referência cadastrado', () => {
  const p = montarPainel({
    ...base,
    leituras: [leitura('parque', 22), leitura('centro', 27), leitura('frio', 20)],
    cadastro: [ponto('parque', { referencia: true }), ponto('centro'), ponto('frio')],
  });
  assert.equal(p.agora.icu.valor, 5);
  assert.equal(p.agora.icu.quente, 'centro');
  assert.equal(p.agora.icu.origem, 'cadastrada');
  assert.equal(p.pontos.find((x) => x.id === 'frio').ultima.delta, -2);
});

test('sem referência cadastrada, vale o ponto mais frio', () => {
  const p = montarPainel({ ...base, leituras: [leitura('a', 22), leitura('b', 27)], cadastro: [ponto('a'), ponto('b')] });
  assert.equal(p.agora.icu.referencia, 'a');
  assert.equal(p.agora.icu.origem, 'mais_frio');
});

test('referência fora do ar não entra na intensidade atual', () => {
  const p = montarPainel({
    ...base,
    leituras: [leitura('parque', 15, 2 * H), leitura('b', 22), leitura('c', 27)],
    cadastro: [ponto('parque', { referencia: true }), ponto('b'), ponto('c')],
  });
  assert.equal(p.agora.online, 2);
  assert.equal(p.agora.icu.referencia, 'b');
  assert.equal(p.pontos.find((x) => x.id === 'parque').online, false);
});

test('sensor sem cadastro aparece mesmo assim', () => {
  const p = montarPainel({ ...base, leituras: [leitura('novo', 25)], cadastro: [] });
  assert.equal(p.pontos[0].id, 'novo');
  assert.equal(p.pontos[0].nao_cadastrado, true);
});

test('leitura mais antiga que chega depois não substitui a última', () => {
  const p = montarPainel({ ...base, leituras: [leitura('a', 25), leitura('a', 10, H)], cadastro: [ponto('a')] });
  assert.equal(p.pontos[0].ultima.temperatura, 25);
});

test('em 30 dias a grade por hora continua completa', () => {
  const leituras = [];
  for (let h = 0; h < 24; h += 1) leituras.push(leitura('a', 20, h * H), leitura('b', 23, h * H));
  const p = montarPainel({
    ...base, periodo: '30d', leituras, cadastro: [ponto('a', { referencia: true }), ponto('b')],
  });
  assert.equal(p.horario.b.filter((v) => v === 3).length, 24);
  assert.equal(p.series.passo, 24 * H);
});

test('baldes diários começam à meia-noite de Curitiba', () => {
  const p = montarPainel({ ...base, periodo: '30d', leituras: [], cadastro: [] });
  assert.equal(new Date(p.series.inicio).getUTCHours(), 3);
});

test('horário agrupa pela hora de Curitiba (UTC-3)', () => {
  const p = montarPainel({
    ...base,
    leituras: [leitura('a', 20), leitura('b', 23)], // 18h UTC = 15h em Curitiba
    cadastro: [ponto('a', { referencia: true }), ponto('b')],
  });
  assert.equal(p.horario.b[15], 3);
  assert.equal(p.horario.b[18], null);
});
