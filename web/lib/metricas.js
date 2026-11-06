// Cálculos do painel. Funções puras: recebem leituras e devolvem números.

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
// O Brasil não adota horário de verão desde 2019: Curitiba é UTC-3 o ano todo.
const FUSO_CURITIBA_MS = -3 * HORA_MS;

export const PERIODOS = {
  '24h': { duracao: DIA_MS, passo: 15 * 60_000 },
  '7d': { duracao: 7 * DIA_MS, passo: HORA_MS },
  '30d': { duracao: 30 * DIA_MS, passo: DIA_MS },
};

export const horaLocal = (ts) => new Date(ts + FUSO_CURITIBA_MS).getUTCHours();

export function media(valores) {
  const validos = valores.filter((v) => v !== null && v !== undefined);
  return validos.length ? validos.reduce((a, b) => a + b, 0) / validos.length : null;
}

/** Índice de calor pelo algoritmo do NWS/NOAA (Steadman + regressão de Rothfusz). */
export function sensacaoTermica(tempC, umidade) {
  const f = (tempC * 9) / 5 + 32;
  const simples = 0.5 * (f + 61 + (f - 68) * 1.2 + umidade * 0.094);
  let indice = (simples + f) / 2;
  if (indice >= 80) {
    indice = -42.379 + 2.04901523 * f + 10.14333127 * umidade
      - 0.22475541 * f * umidade - 0.00683783 * f * f - 0.05481717 * umidade * umidade
      + 0.00122874 * f * f * umidade + 0.00085282 * f * umidade * umidade
      - 0.00000199 * f * f * umidade * umidade;
    if (umidade < 13 && f >= 80 && f <= 112) {
      indice -= ((13 - umidade) / 4) * Math.sqrt((17 - Math.abs(f - 95)) / 17);
    } else if (umidade > 85 && f >= 80 && f <= 87) {
      indice += ((umidade - 85) / 10) * ((87 - f) / 5);
    }
  }
  return ((indice - 32) * 5) / 9;
}

/** Correlação de Pearson e reta de mínimos quadrados. Exige 3 pares e variação em x e y. */
export function correlacao(pares) {
  const n = pares.length;
  if (n < 3) return null;
  const mx = media(pares.map((p) => p.x));
  const my = media(pares.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const { x, y } of pares) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const inclinacao = sxy / sxx;
  return { n, r: sxy / Math.sqrt(sxx * syy), inclinacao, intercepto: my - inclinacao * mx };
}

/** Diferença de y entre o terço de menor x e o terço de maior x. Exige 6 pares. */
export function diferencaEntreTercos(pares) {
  if (pares.length < 6) return null;
  const ordenados = [...pares].sort((a, b) => a.x - b.x);
  const terco = Math.floor(ordenados.length / 3);
  const baixo = media(ordenados.slice(0, terco).map((p) => p.y));
  const alto = media(ordenados.slice(-terco).map((p) => p.y));
  return { baixo, alto, diferenca: baixo - alto, por_grupo: terco };
}

function listarPontos(cadastro, leituras) {
  const pontos = new Map(cadastro.map((p) => [p.id, { ...p }]));
  for (const { sensor_id: id, lat, lon } of leituras) {
    if (!pontos.has(id)) {
      pontos.set(id, {
        id, nome: id, bairro: null, lat: null, lon: null, referencia: false,
        cobertura_arborea_pct: null, renda_media_sm: null, nao_cadastrado: true,
      });
    }
    const ponto = pontos.get(id);
    if (lat !== undefined) { ponto.lat = lat; ponto.lon = lon; } // sensor móvel com GPS
  }
  return [...pontos.values()];
}

function agruparPorPasso(leituras, inicio, fim, passo, ids) {
  const baldes = Math.ceil((fim - inicio) / passo);
  const acumulado = new Map(ids.map((id) => [id, {
    somaT: new Float64Array(baldes), somaU: new Float64Array(baldes), n: new Uint32Array(baldes),
    max: -Infinity, min: Infinity,
  }]));
  for (const l of leituras) {
    if (l.ts < inicio || l.ts >= fim) continue;
    const a = acumulado.get(l.sensor_id);
    const i = Math.floor((l.ts - inicio) / passo);
    a.somaT[i] += l.temperatura;
    a.somaU[i] += l.umidade;
    a.n[i] += 1;
    if (l.temperatura > a.max) a.max = l.temperatura;
    if (l.temperatura < a.min) a.min = l.temperatura;
  }
  const series = {};
  for (const [id, a] of acumulado) {
    const porBalde = (soma) => Array.from(soma, (s, i) => (a.n[i] ? s / a.n[i] : null));
    series[id] = {
      temperatura: porBalde(a.somaT),
      umidade: porBalde(a.somaU),
      max: a.max === -Infinity ? null : a.max,
      min: a.min === Infinity ? null : a.min,
    };
  }
  return { baldes, series };
}

function escolherReferencia(pontos, temDados, temperaturaDe) {
  const comDados = pontos.filter((p) => temDados(p.id));
  if (comDados.length < 2) return null;
  const cadastrada = comDados.find((p) => p.referencia);
  if (cadastrada) return { id: cadastrada.id, origem: 'cadastrada' };
  const maisFrio = comDados.reduce((a, b) => (temperaturaDe(b.id) < temperaturaDe(a.id) ? b : a));
  return { id: maisFrio.id, origem: 'mais_frio' };
}

function calcularAgora(pontos, ultimas, limiteOnline, leituras, agora) {
  const online = pontos.filter((p) => ultimas.get(p.id)?.ts >= limiteOnline);
  const temperaturaDe = (id) => ultimas.get(id).temperatura;
  const referencia = escolherReferencia(online, () => true, temperaturaDe);

  let icu = null;
  if (referencia) {
    const quente = online
      .filter((p) => p.id !== referencia.id)
      .reduce((a, b) => (temperaturaDe(b.id) > temperaturaDe(a.id) ? b : a));
    icu = {
      valor: temperaturaDe(quente.id) - temperaturaDe(referencia.id),
      quente: quente.id,
      referencia: referencia.id,
      origem: referencia.origem,
    };
  }

  let sensacaoMax = null;
  for (const p of online) {
    const { temperatura, umidade } = ultimas.get(p.id);
    const valor = sensacaoTermica(temperatura, umidade);
    if (!sensacaoMax || valor > sensacaoMax.valor) sensacaoMax = { valor, ponto: p.id };
  }

  // Média da cidade hora a hora nas últimas 24 h, para as minisséries dos indicadores.
  const inicio = agora - DIA_MS;
  const somaT = new Float64Array(24), somaU = new Float64Array(24), n = new Uint32Array(24);
  for (const l of leituras) {
    if (l.ts < inicio || l.ts >= agora) continue;
    const i = Math.floor((l.ts - inicio) / HORA_MS);
    somaT[i] += l.temperatura;
    somaU[i] += l.umidade;
    n[i] += 1;
  }
  const tendencia = (soma) => Array.from(soma, (s, i) => (n[i] ? s / n[i] : null));

  return {
    online: online.length,
    total: pontos.length,
    temperatura_media: media(online.map((p) => ultimas.get(p.id).temperatura)),
    umidade_media: media(online.map((p) => ultimas.get(p.id).umidade)),
    sensacao_max: sensacaoMax,
    icu,
    tendencia: { temperatura: tendencia(somaT), umidade: tendencia(somaU) },
    referencia_id: referencia?.id ?? null,
    online_ids: online.map((p) => p.id),
  };
}

function calcularDesigualdade(pontosResumo) {
  const pares = (campo) => pontosResumo
    .filter((p) => p[campo] !== null && p[campo] !== undefined && p.periodo.delta_medio !== null)
    .map((p) => ({ x: p[campo], y: p.periodo.delta_medio }));
  const arborizacao = pares('cobertura_arborea_pct');
  const renda = pares('renda_media_sm');
  return {
    arborizacao: { n: arborizacao.length, ajuste: correlacao(arborizacao), tercos: diferencaEntreTercos(arborizacao) },
    renda: { n: renda.length, ajuste: correlacao(renda), tercos: diferencaEntreTercos(renda) },
  };
}

/** Monta, numa única resposta, tudo o que o painel mostra para um período. */
export function montarPainel({ leituras, cadastro, periodo, agora, onlineMs, modo }) {
  const { duracao, passo } = PERIODOS[periodo];
  const pontos = listarPontos(cadastro, leituras);
  const ids = pontos.map((p) => p.id);

  const ultimas = new Map();
  let ultimaLeitura = null;
  for (const l of leituras) {
    const atual = ultimas.get(l.sensor_id);
    if (!atual || l.ts >= atual.ts) ultimas.set(l.sensor_id, l);
    if (ultimaLeitura === null || l.ts > ultimaLeitura) ultimaLeitura = l.ts;
  }

  const estadoAgora = calcularAgora(pontos, ultimas, agora - onlineMs, leituras, agora);

  // Alinha os baldes à hora de Curitiba para o gráfico não "andar" a cada atualização.
  const inicio = Math.floor((agora - duracao + FUSO_CURITIBA_MS) / passo) * passo - FUSO_CURITIBA_MS;
  const { baldes, series } = agruparPorPasso(leituras, inicio, agora + 1, passo, ids);

  // O passo do gráfico pode ser de um dia, mas as estatísticas precisam da hora do dia.
  const { series: analise } = passo > HORA_MS
    ? agruparPorPasso(leituras, inicio, agora + 1, HORA_MS, ids)
    : { series };
  const passoAnalise = Math.min(passo, HORA_MS);

  const mediaT = new Map(ids.map((id) => [id, media(analise[id].temperatura)]));
  const referencia = escolherReferencia(pontos, (id) => mediaT.get(id) !== null, (id) => mediaT.get(id));

  const horario = {};
  const pontosResumo = pontos.map((p) => {
    const s = analise[p.id];
    const deltas = [];
    const porHora = Array.from({ length: 24 }, () => []);
    if (referencia) {
      const refT = analise[referencia.id].temperatura;
      s.temperatura.forEach((t, i) => {
        if (t === null || refT[i] === null) return;
        const delta = t - refT[i];
        deltas.push(delta);
        porHora[horaLocal(inicio + i * passoAnalise)].push(delta);
      });
    }
    horario[p.id] = porHora.map(media);

    const ultima = ultimas.get(p.id) ?? null;
    const online = ultima !== null && estadoAgora.online_ids.includes(p.id);
    const refAgora = estadoAgora.referencia_id ? ultimas.get(estadoAgora.referencia_id) : null;
    return {
      ...p,
      online,
      ultima: ultima && {
        ts: ultima.ts,
        temperatura: ultima.temperatura,
        umidade: ultima.umidade,
        sensacao: sensacaoTermica(ultima.temperatura, ultima.umidade),
        delta: online && refAgora ? ultima.temperatura - refAgora.temperatura : null,
      },
      periodo: {
        temperatura_media: mediaT.get(p.id),
        umidade_media: media(s.umidade),
        temperatura_max: s.max,
        temperatura_min: s.min,
        delta_medio: media(deltas),
        delta_max: deltas.length ? Math.max(...deltas) : null,
      },
    };
  });

  const seriesSaida = {};
  for (const id of ids) seriesSaida[id] = { temperatura: series[id].temperatura, umidade: series[id].umidade };
  const { online_ids: _ids, referencia_id: _ref, ...agoraSaida } = estadoAgora;

  return {
    modo,
    gerado_em: agora,
    periodo,
    ultima_leitura: ultimaLeitura,
    referencia,
    agora: agoraSaida,
    pontos: pontosResumo,
    series: { inicio, passo, baldes, pontos: seriesSaida },
    horario,
    desigualdade: calcularDesigualdade(pontosResumo),
  };
}
