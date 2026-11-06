// Mapa de Curitiba. A superfície de calor interpola o VALOR medido por IDW; um
// "heatmap" comum mostraria a densidade de sensores, e não a temperatura.
import { criarRampa, ESCALA_MAX } from './graficos.js';
import { grausSinal, graus } from './formato.js';

const L = window.L;
const RAIO_CONFIANCA_KM = 7; // além disso de um sensor, a cor desaparece
const KM_POR_GRAU = 111.32;
const GRADE_LARGURA = 170;
const AMPLIACAO = 4;
const LONGITUDE_CENTRAL = -49.27;
const ATRIBUICAO = 'Mapa © Esri, HERE, Garmin, © OpenStreetMap · Limite: IBGE';

const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const temaEscuro = () => getComputedStyle(document.documentElement).colorScheme.includes('dark');
// Tiles sem chave de API. CARTO e OSM respondem 200, mas com aviso desenhado na imagem.
const urlTiles = (camada) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${temaEscuro() ? 'Dark' : 'Light'}_Gray_${camada}/MapServer/tile/{z}/{y}/{x}`;

function aneisDoContorno(geojson) {
  return geojson.features.flatMap(({ geometry: g }) => (
    g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((poligono) => poligono[0])
  ));
}

function limitesDe(aneis) {
  const coordenadas = aneis.flat();
  const lons = coordenadas.map((c) => c[0]);
  const lats = coordenadas.map((c) => c[1]);
  return { oeste: Math.min(...lons), leste: Math.max(...lons), sul: Math.min(...lats), norte: Math.max(...lats) };
}

function pintarSuperficie(amostras, limites, aneis) {
  const { rgb } = criarRampa();
  const { oeste, leste, sul, norte } = limites;
  const yNorte = mercatorY(norte), ySul = mercatorY(sul);
  const cosLat = Math.cos(((sul + norte) / 2) * (Math.PI / 180));
  const largura = GRADE_LARGURA;
  const altura = Math.round((largura * (yNorte - ySul)) / (((leste - oeste) * Math.PI) / 180));

  const pequeno = document.createElement('canvas');
  pequeno.width = largura;
  pequeno.height = altura;
  const contexto = pequeno.getContext('2d');
  const imagem = contexto.createImageData(largura, altura);

  for (let py = 0; py < altura; py += 1) {
    const yMerc = yNorte - (py / (altura - 1)) * (yNorte - ySul);
    const lat = (2 * Math.atan(Math.exp(yMerc)) - Math.PI / 2) * (180 / Math.PI);
    for (let px = 0; px < largura; px += 1) {
      const lon = oeste + (px / (largura - 1)) * (leste - oeste);
      let soma = 0, pesos = 0, maisPerto = Infinity;
      for (const a of amostras) {
        const dx = (a.lon - lon) * cosLat * KM_POR_GRAU;
        const dy = (a.lat - lat) * KM_POR_GRAU;
        const d2 = dx * dx + dy * dy + 0.05;
        const peso = 1 / (d2 * d2 ** 0.5);
        soma += peso * a.valor;
        pesos += peso;
        if (d2 < maisPerto) maisPerto = d2;
      }
      const valor = soma / pesos;
      const confianca = Math.max(0, 1 - Math.sqrt(maisPerto) / RAIO_CONFIANCA_KM);
      const intensidade = Math.min(1, Math.max(0, valor / ESCALA_MAX));
      const alfa = (0.2 + 0.65 * intensidade) * Math.min(1, confianca * 1.8);
      const [r, g, b] = rgb(valor);
      const i = (py * largura + px) * 4;
      imagem.data[i] = r;
      imagem.data[i + 1] = g;
      imagem.data[i + 2] = b;
      imagem.data[i + 3] = alfa * 255;
    }
  }
  contexto.putImageData(imagem, 0, 0);

  const final = document.createElement('canvas');
  final.width = largura * AMPLIACAO;
  final.height = altura * AMPLIACAO;
  const tela = final.getContext('2d');
  tela.beginPath();
  for (const anel of aneis) {
    anel.forEach(([lon, lat], i) => {
      const x = ((lon - oeste) / (leste - oeste)) * final.width;
      const y = ((yNorte - mercatorY(lat)) / (yNorte - ySul)) * final.height;
      if (i === 0) tela.moveTo(x, y); else tela.lineTo(x, y);
    });
    tela.closePath();
  }
  tela.clip();
  tela.imageSmoothingQuality = 'high';
  tela.drawImage(pequeno, 0, 0, final.width, final.height);
  return final.toDataURL('image/png');
}

function conteudoDoRotulo(ponto, compacto) {
  const raiz = document.createElement('div');
  raiz.textContent = ponto.nome;
  const detalhe = document.createElement('small');
  if (!ponto.online) detalhe.textContent = 'sem sinal';
  else if (ponto.referencia_atual) detalhe.textContent = `${graus(ponto.ultima.temperatura)} · referência`;
  else if (ponto.ultima.delta === null) detalhe.textContent = graus(ponto.ultima.temperatura);
  else detalhe.textContent = compacto ? grausSinal(ponto.ultima.delta) : `${grausSinal(ponto.ultima.delta)} · ${graus(ponto.ultima.temperatura)}`;
  raiz.append(detalhe);
  return raiz;
}

export async function criarMapa(el, { aoSelecionar }) {
  const mapa = L.map(el, {
    scrollWheelZoom: false, zoomSnap: 0.25, minZoom: 10, maxZoom: 15, attributionControl: true,
  });
  mapa.attributionControl.setPrefix(false);
  mapa.createPane('rotulosBase').style.zIndex = 450;
  mapa.getPane('rotulosBase').style.pointerEvents = 'none';

  const criarCamadas = () => [
    L.tileLayer(urlTiles('Base'), { attribution: ATRIBUICAO }).addTo(mapa),
    L.tileLayer(urlTiles('Reference'), { pane: 'rotulosBase' }).addTo(mapa),
  ];
  let camadas = criarCamadas();

  const contorno = await (await fetch('dados/curitiba.geojson')).json();
  const aneis = aneisDoContorno(contorno);
  const limites = limitesDe(aneis);
  const caixa = [[limites.sul, limites.oeste], [limites.norte, limites.leste]];

  const estiloContorno = () => ({
    color: getComputedStyle(document.documentElement).getPropertyValue('--tinta-2').trim(),
    weight: 1.5, fill: false, opacity: 0.7, interactive: false,
  });
  const borda = L.geoJSON(contorno, { style: estiloContorno }).addTo(mapa);
  const enquadrar = () => mapa.fitBounds(caixa, { padding: [14, 14] });
  enquadrar();
  new ResizeObserver(() => { mapa.invalidateSize(); enquadrar(); }).observe(el);

  let superficie = null;
  const marcadores = L.layerGroup().addTo(mapa);

  return {
    atualizar(pontos, papeis) {
      const amostras = pontos
        .filter((p) => p.lat !== null && p.online && p.ultima.delta !== null)
        .map((p) => ({ lat: p.lat, lon: p.lon, valor: p.ultima.delta }));

      if (superficie) { superficie.remove(); superficie = null; }
      if (amostras.length >= 2) {
        const imagem = pintarSuperficie(amostras, limites, aneis);
        superficie = L.imageOverlay(imagem, caixa, { interactive: false }).addTo(mapa);
      }

      marcadores.clearLayers();
      const { css } = criarRampa();
      for (const ponto of pontos) {
        if (ponto.lat === null) continue;
        const ehReferencia = ponto.id === papeis.referenciaAgora;
        const emDestaque = ponto.id === papeis.quenteAgora || ehReferencia || ponto.id === papeis.selecionado;
        const classes = ['marcador'];
        if (ehReferencia) classes.push('referencia');
        if (!ponto.online) classes.push('fora-do-ar');
        if (ponto.id === papeis.selecionado) classes.push('selecionado');

        const icone = document.createElement('span');
        icone.className = classes.join(' ');
        icone.style.setProperty('--cor', ponto.online && ponto.ultima.delta !== null ? css(ponto.ultima.delta) : 'var(--superficie)');

        const marcador = L.marker([ponto.lat, ponto.lon], {
          icon: L.divIcon({ html: icone, className: '', iconSize: [16, 16], iconAnchor: [8, 8] }),
          alt: ponto.nome,
          riseOnHover: true,
          zIndexOffset: emDestaque ? 500 : 0,
        });
        const dados = { ...ponto, referencia_atual: ehReferencia };
        // Rótulos para fora da cidade, sem cobrir os pontos do miolo.
        const aLeste = ponto.lon > LONGITUDE_CENTRAL;
        const soDestacado = ponto.id === papeis.selecionado && ponto.id !== papeis.quenteAgora && !ehReferencia;
        marcador.bindTooltip(conteudoDoRotulo(dados, emDestaque), {
          permanent: emDestaque,
          direction: soDestacado ? 'bottom' : (aLeste ? 'right' : 'left'),
          offset: soDestacado ? [0, 8] : [aLeste ? 8 : -8, 0],
          className: 'rotulo-mapa',
        });
        marcador.on('click keypress', () => aoSelecionar(ponto.id));
        marcadores.addLayer(marcador);
      }
    },
    trocarTema() {
      // Recria em vez de usar setUrl: o redraw do Leaflet pede tiles com zoom fracionário.
      camadas.forEach((camada) => camada.remove());
      camadas = criarCamadas();
      borda.setStyle(estiloContorno);
    },
  };
}
