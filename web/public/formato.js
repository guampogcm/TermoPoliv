// Números e datas no padrão brasileiro. Os horários são sempre os de Curitiba.
const FUSO = 'America/Sao_Paulo';

const comCasas = (casas) => new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: casas, maximumFractionDigits: casas,
});
const comSinal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero',
});
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const diaHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const diaSemana = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: '2-digit' });

const SEM_VALOR = '–';

export const numero = (v, casas = 1) => (v === null || v === undefined ? SEM_VALOR : comCasas(casas).format(v));
export const sinal = (v) => (v === null || v === undefined ? SEM_VALOR : comSinal.format(v).replace('-', '−'));
export const graus = (v) => (v === null || v === undefined ? SEM_VALOR : `${numero(v)}\u00a0°C`);
export const grausSinal = (v) => (v === null || v === undefined ? SEM_VALOR : `${sinal(v)}\u00a0°C`);
export const porcento = (v, casas = 0) => (v === null || v === undefined ? SEM_VALOR : `${numero(v, casas)}\u00a0%`);
export const horaMinuto = (ts) => hora.format(ts);
export const dataHora = (ts) => diaHora.format(ts);
export const dataCurta = (ts) => dia.format(ts);
export const semanaCurta = (ts) => diaSemana.format(ts).replace('.', '').replace(',', '');

export function tempoDecorrido(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}
