// Gerador de dados FICTÍCIOS para demonstrar o painel sem hardware.
//
// Atenção: a relação "menos árvores e menos renda = mais calor" é programada aqui
// (ver intensidadeBase). Os gráficos do modo demo mostram essa hipótese porque ela
// foi inserida na simulação, e não porque ela tenha sido medida em Curitiba.
import { horaLocal } from './metricas.js';

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
const INTERVALO_HISTORICO = 10 * MINUTO;
const SENSOR_FORA_DO_AR = 'demo-caximba';
const QUEDA_MS = 3 * 60 * MINUTO;

function geradorAleatorio(semente) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const horaDecimal = (ts) => horaLocal(ts) + (new Date(ts).getUTCMinutes() / 60);

function temperaturaDeFundo(ts) {
  const dias = ts / DIA;
  const ciclo = Math.cos((2 * Math.PI * (horaDecimal(ts) - 15)) / 24);
  const frentes = 2.4 * Math.sin((2 * Math.PI * dias) / 6.3) + 1.4 * Math.sin((2 * Math.PI * dias) / 2.7 + 1);
  return 19.5 + 5.2 * ciclo + frentes;
}

function intensidadeBase(ponto, aleatorio) {
  if (ponto.referencia) return 0;
  const faltaDeArvores = 1 - Math.min(ponto.cobertura_arborea_pct, 50) / 50;
  const baixaRenda = 1 - Math.min(ponto.renda_media_sm, 10) / 10;
  return 4.6 * faltaDeArvores + 1.1 * baixaRenda + (aleatorio() - 0.5) * 1.2;
}

// Ilhas de calor costumam ser mais fortes à noite, quando o concreto devolve o calor.
const fatorNoturno = (ts) => 0.6 + 0.4 * (0.5 + 0.5 * Math.cos((2 * Math.PI * (horaDecimal(ts) - 22)) / 24));

function simularLeitura(ponto, base, ts, aleatorio) {
  const ruido = (amplitude) => (aleatorio() - 0.5) * amplitude;
  const temperatura = temperaturaDeFundo(ts) + base * fatorNoturno(ts) + ruido(0.35);
  const umidade = 92 - 2.7 * (temperatura - 13) + ponto.cobertura_arborea_pct * 0.09 + ruido(2.5);
  return {
    ts,
    sensor_id: ponto.id,
    temperatura: Math.round(temperatura * 10) / 10,
    umidade: Math.round(Math.min(100, Math.max(18, umidade)) * 10) / 10,
  };
}

export function criarSimulador(pontos, agora = Date.now()) {
  const aleatorio = geradorAleatorio(20261105);
  const bases = new Map(pontos.map((p) => [p.id, intensidadeBase(p, aleatorio)]));
  const foraDoAr = (id, ts) => id === SENSOR_FORA_DO_AR && ts > agora - QUEDA_MS;

  const historico = [];
  const inicio = agora - 31 * DIA;
  for (let ts = inicio; ts <= agora; ts += INTERVALO_HISTORICO) {
    for (const p of pontos) {
      if (!foraDoAr(p.id, ts)) historico.push(simularLeitura(p, bases.get(p.id), ts, aleatorio));
    }
  }

  return {
    historico,
    proximas: (ts) => pontos
      .filter((p) => !foraDoAr(p.id, ts))
      .map((p) => simularLeitura(p, bases.get(p.id), ts, aleatorio)),
  };
}
