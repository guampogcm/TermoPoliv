// Gráficos em SVG. Cor, traço e fonte ficam em estilo.css; aqui só há geometria.
import { dataCurta, dataHora, grausSinal, horaMinuto, numero, semanaCurta } from './formato.js';

const NS = 'http://www.w3.org/2000/svg';
const HORA_MS = 3_600_000;
const FUSO_MS = -3 * HORA_MS;
export const ESCALA_MAX = 6; // °C: topo da escala de calor, igual no mapa e na grade

function criar(tag, atributos = {}, pai = null, texto = null) {
  const elemento = document.createElementNS(NS, tag);
  for (const [nome, valor] of Object.entries(atributos)) elemento.setAttribute(nome, valor);
  if (texto !== null) elemento.textContent = texto;
  if (pai) pai.append(elemento);
  return elemento;
}

function novaTela(el, altura, rotulo) {
  el.replaceChildren();
  const largura = el.clientWidth || 600;
  const svg = criar('svg', { viewBox: `0 0 ${largura} ${altura}`, height: altura, role: 'img', 'aria-label': rotulo }, el);
  return { svg, largura };
}

function escalaBonita(minimo, maximo, marcas = 4) {
  const bruto = (maximo - minimo || 1) / marcas;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].find((m) => m * potencia >= bruto) * potencia;
  let inicio = Math.floor(minimo / passo) * passo;
  let fim = Math.ceil(maximo / passo) * passo;
  if (inicio === fim) { inicio -= passo; fim += passo; } // valor constante: evita divisão por zero
  const valores = [];
  for (let v = inicio; v <= fim + passo / 2; v += passo) valores.push(Number(v.toFixed(6)));
  return { inicio, fim, valores };
}

function lerRampa() {
  const estilo = getComputedStyle(document.documentElement);
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const hex = estilo.getPropertyValue(`--calor-${i}`).trim().slice(1);
    return [0, 2, 4].map((p) => parseInt(hex.slice(p, p + 2), 16));
  });
}

/** Devolve a função que converte °C em cor, de 0 até ESCALA_MAX. */
export function criarRampa() {
  const rampa = lerRampa();
  const rgb = (valor) => {
    const t = Math.min(1, Math.max(0, valor / ESCALA_MAX)) * (rampa.length - 1);
    const i = Math.min(rampa.length - 2, Math.floor(t));
    const f = t - i;
    return rampa[i].map((c, k) => Math.round(c + (rampa[i + 1][k] - c) * f));
  };
  return { rgb, css: (valor) => `rgb(${rgb(valor).join(' ')})` };
}

export function desenharEscalas() {
  const { css } = criarRampa();
  const paradas = [0, 1, 2, 3, 4, 5, 6].map((v) => css(v)).join(', ');
  for (const el of document.querySelectorAll('[data-escala]')) {
    el.replaceChildren();
    const barra = document.createElement('i');
    barra.style.background = `linear-gradient(90deg, ${paradas})`;
    el.append(barra);
    for (const texto of ['0 °C', '+2', '+4', '+6 ou mais']) {
      const marca = document.createElement('span');
      marca.textContent = texto;
      el.append(marca);
    }
  }
}

export function criarDica(el) {
  const posicionar = (x, y) => {
    const { offsetWidth: l, offsetHeight: a } = el;
    const esquerda = x + 16 + l > innerWidth ? x - l - 16 : x + 16;
    el.style.left = `${Math.max(8, esquerda)}px`;
    el.style.top = `${Math.min(innerHeight - a - 8, Math.max(8, y - a / 2))}px`;
  };
  return {
    mostrar(x, y, titulo, linhas) {
      el.replaceChildren();
      const cabecalho = document.createElement('div');
      cabecalho.className = 'dica-titulo';
      cabecalho.textContent = titulo;
      el.append(cabecalho);
      for (const { valor, nome, cor, destaque } of linhas) {
        const linha = document.createElement('div');
        linha.className = destaque ? 'dica-linha destaque' : 'dica-linha';
        if (cor) {
          const chave = document.createElement('i');
          chave.style.setProperty('--cor', cor);
          linha.append(chave);
        }
        const forte = document.createElement('b');
        forte.textContent = valor;
        const nomeEl = document.createElement('span');
        nomeEl.textContent = nome;
        linha.append(forte, nomeEl);
        el.append(linha);
      }
      el.hidden = false;
      posicionar(x, y);
    },
    esconder() { el.hidden = true; },
  };
}

const COR_PAPEL = {
  quente: 'var(--quente)', referencia: 'var(--referencia)',
  selecionado: 'var(--selecionado)', contexto: 'var(--contexto)',
};
export const corDoPapel = (papel) => COR_PAPEL[papel];

function marcasDeTempo(inicio, passo, baldes, periodo) {
  const marcas = [];
  const fim = inicio + passo * (baldes - 1);
  const intervalo = { '24h': 6 * HORA_MS, '7d': 24 * HORA_MS, '30d': 5 * 24 * HORA_MS }[periodo];
  const rotulo = { '24h': (t) => `${horaMinuto(t).slice(0, 2)}h`, '7d': semanaCurta, '30d': dataCurta }[periodo];
  // Alinha as marcas à meia-noite de Curitiba.
  let t = Math.ceil((inicio + FUSO_MS) / intervalo) * intervalo - FUSO_MS;
  for (; t <= fim; t += intervalo) marcas.push({ indice: (t - inicio) / passo, rotulo: rotulo(t) });
  return marcas;
}

function caminho(valores, x, y) {
  let d = '';
  let aberto = false;
  valores.forEach((v, i) => {
    if (v === null) { aberto = false; return; }
    d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    aberto = true;
  });
  return d;
}

/** Afasta rótulos verticalmente; a linha-guia mantém cada um ligado à sua série. */
function separarRotulos(rotulos, distancia) {
  const ordenados = [...rotulos].sort((a, b) => a.y - b.y);
  for (let i = 1; i < ordenados.length; i += 1) {
    const anterior = ordenados[i - 1];
    if (ordenados[i].y - anterior.yFinal < distancia) ordenados[i].yFinal = anterior.yFinal + distancia;
  }
  return ordenados;
}

function mostrarVazio(el, texto) {
  const vazio = document.createElement('p');
  vazio.className = 'vazio-grafico';
  vazio.textContent = texto;
  el.replaceChildren(vazio);
}

export function desenharLinhas(el, opcoes) {
  const { series, inicio, passo, baldes, periodo, casas, unidade, dica, titulo, aoCursor } = opcoes;
  const valores = series.flatMap((s) => s.valores).filter((v) => v !== null);
  if (!valores.length) {
    mostrarVazio(el, 'Sem leituras neste período.');
    return { cursor() {} };
  }

  const altura = 260;
  const { svg, largura } = novaTela(el, altura, titulo);
  const compacto = largura < 520;
  const m = { topo: 8, direita: compacto ? 8 : 156, baixo: 24, esquerda: 32 };
  const larguraUtil = largura - m.esquerda - m.direita;
  const alturaUtil = altura - m.topo - m.baixo;
  const eixoY = escalaBonita(Math.min(...valores), Math.max(...valores));
  const x = (i) => m.esquerda + (i / Math.max(1, baldes - 1)) * larguraUtil;
  const y = (v) => m.topo + (1 - (v - eixoY.inicio) / (eixoY.fim - eixoY.inicio)) * alturaUtil;

  for (const v of eixoY.valores) {
    const py = y(v);
    criar('line', { x1: m.esquerda, x2: m.esquerda + larguraUtil, y1: py, y2: py, class: v === eixoY.inicio ? 'g-eixo' : 'g-grade' }, svg);
    criar('text', { x: m.esquerda - 6, y: py + 4, 'text-anchor': 'end', class: 'g-texto' }, svg, numero(v, 0));
  }
  const marcas = marcasDeTempo(inicio, passo, baldes, periodo);
  const pulo = compacto && marcas.length > 4 ? 2 : 1;
  marcas.filter((_, i) => i % pulo === 0).forEach(({ indice, rotulo }) => {
    criar('text', { x: x(indice), y: altura - 6, 'text-anchor': 'middle', class: 'g-texto' }, svg, rotulo);
  });

  const ordem = [...series].sort((a, b) => (a.papel === 'contexto' ? 0 : 1) - (b.papel === 'contexto' ? 0 : 1));
  for (const s of ordem) {
    criar('path', { d: caminho(s.valores, x, y), class: `g-linha g-${s.papel}` }, svg);
  }

  const destaques = series.filter((s) => s.papel !== 'contexto').map((s) => {
    const ultimo = s.valores.findLastIndex((v) => v !== null);
    return ultimo < 0 ? null : { serie: s, indice: ultimo, valor: s.valores[ultimo], y: y(s.valores[ultimo]), yFinal: y(s.valores[ultimo]) };
  }).filter(Boolean);

  for (const d of destaques) {
    criar('circle', { cx: x(d.indice), cy: d.y, r: 4, class: `g-anel p-${d.serie.papel}` }, svg);
  }
  if (!compacto) {
    const xRotulo = m.esquerda + larguraUtil + 16;
    for (const d of separarRotulos(destaques, 32)) {
      if (Math.abs(d.yFinal - d.y) > 1) {
        criar('line', { x1: x(d.indice) + 5, y1: d.y, x2: xRotulo - 3, y2: d.yFinal - 4, class: 'g-guia' }, svg);
      }
      criar('text', { x: xRotulo, y: d.yFinal - 1, class: 'g-rotulo' }, svg, d.serie.nome.length > 19 ? `${d.serie.nome.slice(0, 18)}…` : d.serie.nome);
      criar('text', { x: xRotulo, y: d.yFinal + 13, class: 'g-rotulo-2' }, svg, `${numero(d.valor, casas)}${unidade}`);
    }
  }

  const cursor = criar('g', { visibility: 'hidden' }, svg);
  const linhaCursor = criar('line', { y1: m.topo, y2: m.topo + alturaUtil, class: 'g-cursor' }, cursor);
  const pontosCursor = series.filter((s) => s.papel !== 'contexto').map((s) => ({
    serie: s, marca: criar('circle', { r: 4, class: `g-anel p-${s.papel}` }, cursor),
  }));

  const posicionarCursor = (i) => {
    if (i === null) { cursor.setAttribute('visibility', 'hidden'); return; }
    cursor.setAttribute('visibility', 'visible');
    linhaCursor.setAttribute('x1', x(i));
    linhaCursor.setAttribute('x2', x(i));
    for (const { serie, marca } of pontosCursor) {
      const v = serie.valores[i];
      marca.setAttribute('visibility', v === null ? 'hidden' : 'inherit');
      if (v !== null) { marca.setAttribute('cx', x(i)); marca.setAttribute('cy', y(v)); }
    }
  };

  const mostrarDica = (i, cx, cy) => {
    const linhas = series
      .filter((s) => s.valores[i] !== null)
      .sort((a, b) => b.valores[i] - a.valores[i])
      .map((s) => ({
        valor: `${numero(s.valores[i], casas)}${unidade}`, nome: s.nome,
        cor: corDoPapel(s.papel), destaque: s.papel !== 'contexto',
      }));
    const instante = inicio + i * passo;
    dica.mostrar(cx, cy, passo >= 24 * HORA_MS ? `Média de ${dataCurta(instante)}` : dataHora(instante), linhas);
  };

  let atual = null;
  const alvo = criar('rect', {
    x: m.esquerda, y: m.topo, width: larguraUtil, height: alturaUtil, fill: 'transparent', tabindex: 0,
    'aria-label': `${titulo}. Use as setas para percorrer o tempo.`,
  }, svg);
  const indiceDoPonteiro = (evento) => {
    const caixa = svg.getBoundingClientRect();
    const px = ((evento.clientX - caixa.left) / caixa.width) * largura;
    return Math.round(Math.min(1, Math.max(0, (px - m.esquerda) / larguraUtil)) * (baldes - 1));
  };
  alvo.addEventListener('pointermove', (evento) => {
    atual = indiceDoPonteiro(evento);
    aoCursor(atual);
    mostrarDica(atual, evento.clientX, evento.clientY);
  });
  alvo.addEventListener('pointerleave', () => { aoCursor(null); dica.esconder(); });
  alvo.addEventListener('blur', () => { aoCursor(null); dica.esconder(); });
  alvo.addEventListener('keydown', (evento) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[evento.key];
    if (!delta) return;
    evento.preventDefault();
    atual = Math.min(baldes - 1, Math.max(0, (atual ?? baldes - 1) + delta));
    aoCursor(atual);
    const caixa = alvo.getBoundingClientRect();
    mostrarDica(atual, caixa.left + (atual / (baldes - 1)) * caixa.width, caixa.top + caixa.height / 2);
  });

  return { cursor: posicionarCursor };
}

export function desenharGradeHoras(el, { linhas, dica, aoSelecionar }) {
  const alturaLinha = 24;
  const baixo = 22;
  const altura = linhas.length * alturaLinha + baixo;
  const { svg, largura } = novaTela(el, altura, 'Diferença para a referência por ponto e hora do dia. Os valores estão na tabela abaixo.');
  const esquerda = largura < 520 ? 104 : 148;
  const coluna = (largura - esquerda) / 24;
  const { css } = criarRampa();
  const semCalor = 'var(--superficie-2)';

  linhas.forEach((linha, l) => {
    const y = l * alturaLinha;
    const nome = linha.nome.length > (largura < 520 ? 13 : 20) ? `${linha.nome.slice(0, largura < 520 ? 12 : 19)}…` : linha.nome;
    const rotulo = criar('text', { x: esquerda - 10, y: y + 16, 'text-anchor': 'end', class: `g-nome${linha.ativo ? ' ativo' : ''}` }, svg, nome);
    rotulo.addEventListener('click', () => aoSelecionar(linha.id));
    linha.valores.forEach((valor, h) => {
      const celula = criar('rect', {
        x: esquerda + h * coluna + 1, y: y + 1, width: Math.max(1, coluna - 2), height: alturaLinha - 2, rx: 3,
        class: valor === null ? 'g-celula g-sem-dado' : 'g-celula', fill: valor === null ? 'none' : (valor <= 0 ? semCalor : css(valor)),
      }, svg);
      const texto = `${String(h).padStart(2, '0')}h`;
      celula.addEventListener('pointermove', (e) => {
        dica.mostrar(e.clientX, e.clientY, `${linha.nome} · ${texto}`, [{ valor: grausSinal(valor), nome: 'em relação à referência' }]);
      });
      celula.addEventListener('pointerleave', () => dica.esconder());
      celula.addEventListener('click', () => aoSelecionar(linha.id));
    });
  });

  const passoHoras = largura < 520 ? 6 : 3;
  for (let h = 0; h < 24; h += passoHoras) {
    criar('text', { x: esquerda + (h + 0.5) * coluna, y: altura - 6, 'text-anchor': 'middle', class: 'g-texto' }, svg, `${String(h).padStart(2, '0')}h`);
  }
}

export function desenharDispersao(el, { pontos, ajuste, rotuloX, formatoX, dominioY, dica, aoSelecionar }) {
  if (!pontos.length) {
    mostrarVazio(el, 'Nenhum ponto com este dado preenchido em config/pontos.json.');
    return;
  }
  const altura = 320;
  const { svg, largura } = novaTela(el, altura, `Dispersão: ${rotuloX} contra diferença para a referência. Os valores estão na tabela de pontos.`);
  const m = { topo: 26, direita: 16, baixo: 44, esquerda: 38 };
  const larguraUtil = largura - m.esquerda - m.direita;
  const alturaUtil = altura - m.topo - m.baixo;
  const xs = pontos.map((p) => p.x);
  const eixoX = escalaBonita(Math.min(...xs), Math.max(...xs), largura < 400 ? 3 : 5);
  const eixoY = escalaBonita(dominioY[0], dominioY[1]);
  const x = (v) => m.esquerda + ((v - eixoX.inicio) / (eixoX.fim - eixoX.inicio)) * larguraUtil;
  const y = (v) => m.topo + (1 - (v - eixoY.inicio) / (eixoY.fim - eixoY.inicio)) * alturaUtil;

  for (const v of eixoY.valores) {
    criar('line', { x1: m.esquerda, x2: largura - m.direita, y1: y(v), y2: y(v), class: v === eixoY.inicio ? 'g-eixo' : 'g-grade' }, svg);
    criar('text', { x: m.esquerda - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'g-texto' }, svg, numero(v, 0));
  }
  for (const v of eixoX.valores) {
    criar('text', { x: x(v), y: altura - m.baixo + 18, 'text-anchor': 'middle', class: 'g-texto' }, svg, numero(v, 0));
  }
  criar('text', { x: m.esquerda + larguraUtil / 2, y: altura - 6, 'text-anchor': 'middle', class: 'g-texto' }, svg, rotuloX);
  criar('text', { x: 0, y: 12, class: 'g-texto' }, svg, 'Diferença média para a referência (°C)');

  if (ajuste) {
    const noEixo = (v) => ajuste.inclinacao * v + ajuste.intercepto;
    const dentro = (v) => Math.min(eixoY.fim, Math.max(eixoY.inicio, v));
    const [a, b] = [Math.min(...xs), Math.max(...xs)];
    criar('line', { x1: x(a), y1: y(dentro(noEixo(a))), x2: x(b), y2: y(dentro(noEixo(b))), class: 'g-ajuste' }, svg);
  }

  const ordem = [...pontos].sort((a, b) => (a.papel === 'contexto' ? 0 : 1) - (b.papel === 'contexto' ? 0 : 1));
  for (const p of ordem) {
    const cx = x(p.x), cy = y(p.y);
    criar('circle', { cx, cy, r: p.papel === 'contexto' ? 5 : 6, class: `g-anel p-${p.papel}` }, svg);
    if (p.papel !== 'contexto') {
      const aDireita = cx < largura - 130;
      const sobreOEixo = cy > altura - m.baixo - 16;
      criar('text', {
        x: cx + (aDireita ? 11 : -11), y: sobreOEixo ? cy - 10 : cy + 4,
        'text-anchor': aDireita ? 'start' : 'end', class: 'g-rotulo',
      }, svg, p.nome);
    }
    const alvo = criar('circle', {
      cx, cy, r: 13, class: 'g-alvo', tabindex: 0, role: 'button',
      'aria-label': `${p.nome}: ${formatoX(p.x)}, ${grausSinal(p.y)}`,
    }, svg);
    const mostrar = (px, py) => dica.mostrar(px, py, p.nome, [
      { valor: grausSinal(p.y), nome: 'diferença média' },
      { valor: formatoX(p.x), nome: rotuloX.toLowerCase() },
    ]);
    alvo.addEventListener('pointermove', (e) => mostrar(e.clientX, e.clientY));
    alvo.addEventListener('pointerleave', () => dica.esconder());
    alvo.addEventListener('focus', () => { const c = alvo.getBoundingClientRect(); mostrar(c.right, c.top); });
    alvo.addEventListener('blur', () => dica.esconder());
    alvo.addEventListener('click', () => aoSelecionar(p.id));
    alvo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoSelecionar(p.id); } });
  }
}

export function desenharMiniserie(svg, valores) {
  svg.replaceChildren();
  const validos = valores.filter((v) => v !== null);
  if (validos.length < 2) return;
  const largura = 76, altura = 30;
  svg.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  const minimo = Math.min(...validos), maximo = Math.max(...validos);
  const x = (i) => (i / (valores.length - 1)) * (largura - 5);
  const y = (v) => 3 + (1 - (v - minimo) / (maximo - minimo || 1)) * (altura - 6);
  criar('path', { d: caminho(valores, x, y), class: 'g-linha g-contexto' }, svg);
  const ultimo = valores.findLastIndex((v) => v !== null);
  criar('circle', { cx: x(ultimo), cy: y(valores[ultimo]), r: 3, fill: 'var(--tinta-2)' }, svg);
}
