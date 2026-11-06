// Validação do JSON enviado pelo ESP32 e persistência em arquivo JSONL.
import fs from 'node:fs';
import path from 'node:path';

const ID_VALIDO = /^[A-Za-z0-9._-]{1,40}$/;
// Limites de operação do DHT22 (datasheet): -40 a 80 °C, 0 a 100 %.
const TEMP_MIN = -40, TEMP_MAX = 80;
const INICIO_PLAUSIVEL = Date.UTC(2020, 0, 1);
const TOLERANCIA_FUTURO_MS = 5 * 60_000;

const ehNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/** O ESP32 sem NTP envia relógio zerado; nesse caso vale a hora do servidor. */
function resolverHorario(valor, agora) {
  let ms = null;
  if (ehNumero(valor)) ms = valor * 1000;
  else if (typeof valor === 'string') ms = Date.parse(valor);
  const plausivel = ms !== null && ms >= INICIO_PLAUSIVEL && ms <= agora + TOLERANCIA_FUTURO_MS;
  return plausivel ? ms : agora;
}

export function validarLeitura(corpo, agora = Date.now()) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { erro: 'O corpo precisa ser um objeto JSON.' };
  }
  const { sensor_id, temperatura, umidade, lat, lon, timestamp } = corpo;
  if (typeof sensor_id !== 'string' || !ID_VALIDO.test(sensor_id)) {
    return { erro: 'sensor_id inválido: use até 40 letras, números, ponto, hífen ou sublinhado.' };
  }
  // Uma falha de leitura do DHT22 vira NaN no ESP32, que o JSON serializa como null.
  if (!ehNumero(temperatura) || temperatura < TEMP_MIN || temperatura > TEMP_MAX) {
    return { erro: `temperatura inválida: esperado número entre ${TEMP_MIN} e ${TEMP_MAX} °C.` };
  }
  if (!ehNumero(umidade) || umidade < 0 || umidade > 100) {
    return { erro: 'umidade inválida: esperado número entre 0 e 100 %.' };
  }
  const leitura = { ts: resolverHorario(timestamp, agora), sensor_id, temperatura, umidade };
  const temLat = lat !== undefined && lat !== null;
  const temLon = lon !== undefined && lon !== null;
  if (temLat !== temLon) return { erro: 'Envie lat e lon juntos, ou nenhum dos dois.' };
  if (temLat) {
    if (!ehNumero(lat) || Math.abs(lat) > 90 || !ehNumero(lon) || Math.abs(lon) > 180) {
      return { erro: 'lat/lon fora do intervalo válido.' };
    }
    leitura.lat = lat;
    leitura.lon = lon;
  }
  return { leitura };
}

/** Guarda as leituras em memória e, se houver arquivo, em JSONL (uma por linha). */
export class Armazem {
  constructor(arquivo = null) {
    this.arquivo = arquivo;
    this.leituras = [];
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    if (!fs.existsSync(arquivo)) return;
    let descartadas = 0;
    for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try {
        this.leituras.push(JSON.parse(linha));
      } catch {
        descartadas += 1; // linha cortada por queda de energia, por exemplo
      }
    }
    if (descartadas) console.warn(`${descartadas} linha(s) corrompida(s) ignorada(s) em ${arquivo}`);
  }

  adicionar(leitura) {
    this.leituras.push(leitura);
    if (this.arquivo) fs.appendFileSync(this.arquivo, `${JSON.stringify(leitura)}\n`);
  }
}
