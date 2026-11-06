// Orquestra o painel: busca os dados, escuta o servidor e redesenha cada seção.
import {
  corDoPapel, criarDica, desenharDispersao, desenharEscalas, desenharGradeHoras, desenharLinhas, desenharMiniserie,
} from './graficos.js';
import { criarMapa } from './mapa.js';
import {
  dataHora, graus, grausSinal, numero, porcento, sinal, tempoDecorrido,
} from './formato.js';

const INTERVALO_MINIMO_MS = 4000; // o servidor pode avisar a cada leitura; não buscamos tanto
const INTERVALO_REDESENHO_MS = 30_000; // gráficos e tabela não mudam sob o mouse a cada segundo
const INTERVALO_VERIFICACAO_MS = 60_000; // sem leituras não há aviso do servidor, e sensor parado precisa aparecer

const $ = (id) => document.getElementById(id);
const dica = criarDica($('dica'));

const estado = {
  periodo: '24h',
  selecionado: null,
  painel: null,
  ordem: { campo: 'delta', decrescente: true },
  requisicao: 0,
  ultimoRedesenho: 0,
  ultimaBusca: 0,
  buscaAgendada: null,
  conectado: false,
  diferencaRelogio: 0,
};
let mapa = null;
let graficosLinhas = [];

const pontoPorId = (id) => estado.painel?.pontos.find((p) => p.id === id);

function papelDe(ponto) {
  const { painel, selecionado } = estado;
  if (ponto.id === selecionado) return 'selecionado';
  if (ponto.id === painel.referencia?.id) return 'referencia';
  if (ponto.id === idMaisQuente()) return 'quente';
  return 'contexto';
}

function idMaisQuente() {
  const candidatos = estado.painel.pontos.filter((p) => p.periodo.delta_medio !== null && p.id !== estado.painel.referencia?.id);
  if (!candidatos.length) return null;
  return candidatos.reduce((a, b) => (b.periodo.delta_medio > a.periodo.delta_medio ? b : a)).id;
}

function comUnidade(el, valor, unidade) {
  const pequeno = document.createElement('small');
  pequeno.textContent = unidade;
  el.replaceChildren(valor, pequeno);
}

function frase(el, partes) {
  el.replaceChildren(...partes.map((parte) => {
    if (typeof parte === 'string') return parte;
    const forte = document.createElement('strong');
    forte.textContent = parte.forte;
    return forte;
  }));
}

function renderStatus() {
  const { painel, conectado, diferencaRelogio } = estado;
  const el = $('status');
  el.classList.toggle('ao-vivo', conectado && painel?.agora.online > 0);
  let texto = 'Reconectando';
  if (conectado && painel) {
    if (painel.ultima_leitura === null) texto = 'Sem leituras';
    else texto = `Última leitura há ${tempoDecorrido(Date.now() + diferencaRelogio - painel.ultima_leitura)}`;
  }
  el.lastElementChild.textContent = texto;
}

function renderAgora() {
  const { painel } = estado;
  const { agora } = painel;
  const nome = (id) => pontoPorId(id)?.nome ?? id;

  if (agora.icu) {
    $('heroi-rotulo').textContent = 'Intensidade da ilha de calor agora';
    comUnidade($('heroi-valor'), sinal(agora.icu.valor), '°C');
    const referencia = agora.icu.origem === 'cadastrada' ? 'o ponto de referência' : 'o ponto mais frio agora';
    const quente = pontoPorId(agora.icu.quente);
    const fria = pontoPorId(agora.icu.referencia);
    frase($('heroi-frase'), [
      'de diferença entre ', { forte: quente.nome }, ` (${graus(quente.ultima.temperatura)}) e `,
      { forte: fria.nome }, ` (${graus(fria.ultima.temperatura)}), ${referencia}.`,
    ]);
  } else if (agora.online === 1) {
    const unico = painel.pontos.find((p) => p.online);
    $('heroi-rotulo').textContent = `Temperatura agora em ${unico.nome}`;
    comUnidade($('heroi-valor'), numero(unico.ultima.temperatura), '°C');
    $('heroi-frase').textContent = 'Com um único sensor no ar ainda não dá para medir ilha de calor: ela é a diferença entre dois pontos.';
  } else {
    $('heroi-rotulo').textContent = 'Intensidade da ilha de calor agora';
    $('heroi-valor').textContent = '–';
    $('heroi-frase').textContent = 'Nenhum sensor enviou dados recentemente.';
  }

  $('kpi-temp').textContent = graus(agora.temperatura_media);
  $('kpi-temp-nota').textContent = 'Agora · curva de 24 h';
  $('kpi-umid').textContent = porcento(agora.umidade_media);
  $('kpi-umid-nota').textContent = 'Agora · curva de 24 h';
  $('kpi-sens').textContent = graus(agora.sensacao_max?.valor);
  $('kpi-sens-nota').textContent = agora.sensacao_max ? nome(agora.sensacao_max.ponto) : '';
  $('kpi-online').textContent = `${agora.online} de ${agora.total}`;
  const fora = agora.total - agora.online;
  $('kpi-online-nota').textContent = fora ? `${fora} sem sinal` : 'Todos enviando';
  desenharMiniserie($('spark-temp'), agora.tendencia.temperatura);
  desenharMiniserie($('spark-umid'), agora.tendencia.umidade);
}

function renderMapa() {
  if (!mapa) return;
  const { painel, selecionado } = estado;
  mapa.atualizar(painel.pontos, {
    quenteAgora: painel.agora.icu?.quente,
    referenciaAgora: painel.agora.icu?.referencia,
    selecionado,
  });
  const semCoordenadas = painel.pontos.filter((p) => p.ultima && p.lat === null).length;
  const aviso = $('mapa-aviso');
  aviso.hidden = semCoordenadas === 0;
  aviso.textContent = semCoordenadas === 1
    ? 'Um sensor está sem coordenadas. Preencha lat e lon em config/pontos.json.'
    : `${semCoordenadas} sensores estão sem coordenadas. Preencha lat e lon em config/pontos.json.`;
}

function renderSeletor() {
  const seletor = $('seletor-ponto');
  const opcoes = estado.painel.pontos.map((p) => {
    const opcao = document.createElement('option');
    opcao.value = p.id;
    opcao.textContent = p.nome;
    return opcao;
  });
  const nenhum = document.createElement('option');
  nenhum.value = '';
  nenhum.textContent = 'Nenhum';
  seletor.replaceChildren(nenhum, ...opcoes);
  seletor.value = estado.selecionado ?? '';
}

function renderLegendaLinhas() {
  const { painel } = estado;
  const itens = [];
  const idQuente = idMaisQuente();
  if (idQuente) itens.push(['quente', `Mais quente: ${pontoPorId(idQuente).nome}`]);
  if (painel.referencia) itens.push(['referencia', `Referência: ${pontoPorId(painel.referencia.id).nome}`]);
  if (estado.selecionado) itens.push(['selecionado', `Destacado: ${pontoPorId(estado.selecionado).nome}`]);
  itens.push(['contexto', 'Demais pontos']);
  $('legenda-linhas').replaceChildren(...itens.map(([papel, texto]) => {
    const item = document.createElement('span');
    const chave = document.createElement('i');
    chave.style.setProperty('--cor', corDoPapel(papel));
    item.append(chave, texto);
    return item;
  }));
}

function renderTempo() {
  const { painel } = estado;
  const { series } = painel;
  renderLegendaLinhas();
  const montar = (campo) => painel.pontos
    .filter((p) => series.pontos[p.id][campo].some((v) => v !== null))
    .map((p) => ({ id: p.id, nome: p.nome, valores: series.pontos[p.id][campo], papel: papelDe(p) }));
  const comum = {
    inicio: series.inicio, passo: series.passo, baldes: series.baldes, periodo: painel.periodo, dica,
    aoCursor: (i) => graficosLinhas.forEach((g) => g.cursor(i)),
  };
  graficosLinhas = [
    desenharLinhas($('grafico-temp'), { ...comum, series: montar('temperatura'), casas: 1, unidade: ' °C', titulo: 'Temperatura por ponto' }),
    desenharLinhas($('grafico-umid'), { ...comum, series: montar('umidade'), casas: 0, unidade: ' %', titulo: 'Umidade relativa por ponto' }),
  ];

  const linhas = painel.pontos
    .filter((p) => p.periodo.delta_medio !== null)
    .sort((a, b) => b.periodo.delta_medio - a.periodo.delta_medio)
    .map((p) => ({ id: p.id, nome: p.nome, valores: painel.horario[p.id], ativo: p.id === estado.selecionado }));
  const grade = $('grafico-horas');
  const cartao = grade.closest('.cartao');
  if (linhas.length) {
    cartao.querySelector('.detalhes').hidden = false;
    cartao.querySelector('[data-escala]').hidden = false;
    desenharGradeHoras(grade, { linhas, dica, aoSelecionar: selecionar });
    renderTabelaHoras(linhas);
  } else {
    cartao.querySelector('.detalhes').hidden = true;
    cartao.querySelector('[data-escala]').hidden = true;
    const vazio = document.createElement('p');
    vazio.className = 'vazio-grafico';
    vazio.textContent = 'São necessários pelo menos dois pontos com leituras para comparar.';
    grade.replaceChildren(vazio);
  }
}

function renderTabelaHoras(linhas) {
  const tabela = $('tabela-horas');
  const cabecalho = document.createElement('tr');
  const celula = (tag, texto) => { const c = document.createElement(tag); c.textContent = texto; return c; };
  cabecalho.append(celula('th', 'Ponto'), ...Array.from({ length: 24 }, (_, h) => celula('th', `${String(h).padStart(2, '0')}h`)));
  const thead = document.createElement('thead');
  thead.append(cabecalho);
  const tbody = document.createElement('tbody');
  for (const linha of linhas) {
    const tr = document.createElement('tr');
    tr.append(celula('td', linha.nome), ...linha.valores.map((v) => celula('td', sinal(v))));
    tbody.append(tr);
  }
  tabela.replaceChildren(thead, tbody);
}

function renderDesigualdade() {
  const { painel } = estado;
  const { arborizacao, renda } = painel.desigualdade;
  const temDados = arborizacao.n >= 3 || renda.n >= 3;
  const aviso = $('desigualdade-aviso');
  $('desigualdade-corpo').hidden = !temDados;
  aviso.hidden = temDados;
  if (!temDados) {
    aviso.textContent = 'Para esta análise, preencha cobertura_arborea_pct e renda_media_sm em config/pontos.json em pelo menos três pontos com leituras.';
    return;
  }

  const blocos = [];
  const bloco = (valor, texto) => {
    const cartao = document.createElement('div');
    cartao.className = 'cartao diferenca';
    const forte = document.createElement('strong');
    comUnidade(forte, sinal(valor), ' °C');
    const descricao = document.createElement('p');
    descricao.textContent = texto;
    cartao.append(forte, descricao);
    blocos.push(cartao);
  };
  if (arborizacao.tercos) bloco(arborizacao.tercos.diferenca, `é quanto o terço de pontos com menos árvores fica acima do terço com mais árvores (${arborizacao.tercos.por_grupo} pontos em cada grupo).`);
  if (renda.tercos) bloco(renda.tercos.diferenca, `é quanto o terço de pontos de menor renda fica acima do terço de maior renda (${renda.tercos.por_grupo} pontos em cada grupo).`);
  $('diferencas').replaceChildren(...blocos);

  const comContexto = painel.pontos.filter((p) => p.periodo.delta_medio !== null);
  const ys = comContexto.map((p) => p.periodo.delta_medio);
  const dominioY = [Math.min(0, ...ys), Math.max(...ys)];
  const dispersao = (el, campo, rotuloX, formatoX, ajuste) => desenharDispersao(el, {
    pontos: comContexto.filter((p) => p[campo] !== null).map((p) => ({
      id: p.id, nome: p.nome, x: p[campo], y: p.periodo.delta_medio, papel: papelDe(p),
    })),
    ajuste, rotuloX, formatoX, dominioY, dica, aoSelecionar: selecionar,
  });
  const resumo = ({ ajuste, n }) => (ajuste ? `r = ${numero(ajuste.r, 2).replace('-', '−')} · ${n} pontos` : `${n} pontos`);

  $('ajuste-arvores').textContent = resumo(arborizacao);
  $('ajuste-renda').textContent = resumo(renda);
  dispersao($('grafico-arvores'), 'cobertura_arborea_pct', 'Cobertura arbórea (%)', (v) => porcento(v), arborizacao.ajuste);
  dispersao($('grafico-renda'), 'renda_media_sm', 'Renda média (salários mínimos)', (v) => `${numero(v)} SM`, renda.ajuste);
}

// Sensor sem sinal não tem valor "agora": a última leitura dele já é passado.
const atual = (ponto, campo) => (ponto.online ? ponto.ultima[campo] : null);

const COLUNAS = [
  { campo: 'nome', titulo: 'Ponto', valor: (p) => p.nome },
  { campo: 'temperatura', titulo: 'Agora', valor: (p) => atual(p, 'temperatura'), texto: (p) => graus(atual(p, 'temperatura')) },
  { campo: 'umidade', titulo: 'Umidade', valor: (p) => atual(p, 'umidade'), texto: (p) => porcento(atual(p, 'umidade')) },
  { campo: 'sensacao', titulo: 'Sensação', valor: (p) => atual(p, 'sensacao'), texto: (p) => graus(atual(p, 'sensacao')) },
  { campo: 'delta', titulo: 'Diferença média', valor: (p) => p.periodo.delta_medio },
  { campo: 'arvores', titulo: 'Cobertura arbórea', valor: (p) => p.cobertura_arborea_pct, texto: (p) => porcento(p.cobertura_arborea_pct) },
  { campo: 'renda', titulo: 'Renda (SM)', valor: (p) => p.renda_media_sm, texto: (p) => numero(p.renda_media_sm) },
  { campo: 'situacao', titulo: 'Situação', valor: (p) => (p.online ? 1 : 0) },
];

function celulaNome(ponto) {
  const td = document.createElement('td');
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'ponto-nome';
  botao.textContent = ponto.nome;
  botao.addEventListener('click', () => selecionar(ponto.id));
  const bairro = document.createElement('span');
  bairro.className = 'ponto-bairro';
  const partes = [];
  if (ponto.bairro && ponto.bairro !== ponto.nome) partes.push(ponto.bairro);
  if (ponto.id === estado.painel.referencia?.id) partes.push('referência');
  if (ponto.nao_cadastrado) partes.push('não cadastrado');
  bairro.textContent = partes.join(' · ');
  td.append(botao);
  if (partes.length) td.append(bairro);
  return td;
}

function celulaDelta(ponto) {
  const td = document.createElement('td');
  const valor = ponto.periodo.delta_medio;
  const grupo = document.createElement('span');
  grupo.className = 'barra-celula';
  const trilho = document.createElement('span');
  trilho.className = 'barra';
  const preenchido = document.createElement('i');
  preenchido.style.width = `${Math.min(100, Math.max(0, ((valor ?? 0) / 6) * 100))}%`;
  trilho.append(preenchido);
  const texto = document.createElement('span');
  texto.textContent = grausSinal(valor);
  grupo.append(trilho, texto);
  td.append(grupo);
  return td;
}

function celulaSituacao(ponto) {
  const td = document.createElement('td');
  const situacao = document.createElement('span');
  situacao.className = ponto.online ? 'situacao' : 'situacao fora';
  if (ponto.online) situacao.textContent = 'No ar';
  else if (ponto.ultima) situacao.textContent = `Sem sinal há ${tempoDecorrido(estado.painel.gerado_em - ponto.ultima.ts)}`;
  else situacao.textContent = 'Nunca enviou';
  td.append(situacao);
  return td;
}

function compararPontos(a, b) {
  const { campo, decrescente } = estado.ordem;
  const { valor } = COLUNAS.find((c) => c.campo === campo);
  const va = valor(a), vb = valor(b);
  if (va === null) return vb === null ? 0 : 1; // vazios sempre no fim
  if (vb === null) return -1;
  const resultado = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
  return decrescente ? -resultado : resultado;
}

function renderTabela() {
  const { ordem, selecionado, painel } = estado;
  const tabela = $('tabela-pontos');
  const linhaTopo = document.createElement('tr');
  for (const coluna of COLUNAS) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (coluna.campo === ordem.campo) th.setAttribute('aria-sort', ordem.decrescente ? 'descending' : 'ascending');
    const botao = document.createElement('button');
    botao.type = 'button';
    const seta = coluna.campo === ordem.campo ? (ordem.decrescente ? ' ↓' : ' ↑') : '';
    botao.textContent = coluna.titulo + seta;
    botao.addEventListener('click', () => {
      estado.ordem = {
        campo: coluna.campo,
        decrescente: ordem.campo === coluna.campo ? !ordem.decrescente : coluna.campo !== 'nome',
      };
      renderTabela();
    });
    th.append(botao);
    linhaTopo.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(linhaTopo);

  const tbody = document.createElement('tbody');
  for (const ponto of [...painel.pontos].sort(compararPontos)) {
    const tr = document.createElement('tr');
    if (ponto.id === selecionado) tr.className = 'ativo';
    tr.append(celulaNome(ponto));
    for (const coluna of COLUNAS.slice(1)) {
      if (coluna.campo === 'delta') tr.append(celulaDelta(ponto));
      else if (coluna.campo === 'situacao') tr.append(celulaSituacao(ponto));
      else {
        const td = document.createElement('td');
        td.textContent = coluna.texto(ponto);
        tr.append(td);
      }
    }
    tbody.append(tr);
  }
  tabela.replaceChildren(thead, tbody);
}

function renderCompleto() {
  estado.ultimoRedesenho = Date.now();
  renderSeletor();
  renderMapa();
  renderTempo();
  renderDesigualdade();
  renderTabela();
}

function aplicarPainel(painel, forcarRedesenho) {
  const anterior = estado.painel;
  estado.painel = painel;
  estado.diferencaRelogio = painel.gerado_em - Date.now();
  if (estado.selecionado && !pontoPorId(estado.selecionado)) estado.selecionado = null;

  const semDados = painel.ultima_leitura === null;
  document.body.classList.toggle('sem-dados', semDados);
  $('vazio').hidden = !semDados;
  $('aviso-demo').hidden = painel.modo !== 'demo';
  $('exportar').href = `/api/leituras.csv?periodo=${estado.periodo}`;
  renderStatus();
  if (semDados) return;

  renderAgora();
  const primeiraVez = !anterior || anterior.ultima_leitura === null;
  if (forcarRedesenho || primeiraVez || Date.now() - estado.ultimoRedesenho > INTERVALO_REDESENHO_MS) renderCompleto();
}

async function buscarPainel({ forcar = false } = {}) {
  const numeroRequisicao = ++estado.requisicao;
  estado.ultimaBusca = Date.now();
  try {
    const resposta = await fetch(`/api/painel?periodo=${estado.periodo}`);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const painel = await resposta.json();
    if (numeroRequisicao !== estado.requisicao) return; // resposta velha de outro período
    estado.conectado = true;
    aplicarPainel(painel, forcar);
  } catch (erro) {
    console.error('Falha ao buscar o painel:', erro);
    estado.conectado = false;
    renderStatus();
  } finally {
    if (numeroRequisicao === estado.requisicao) $('conteudo').classList.remove('atualizando');
  }
}

function agendarBusca() {
  if (estado.buscaAgendada) return;
  const espera = Math.max(0, INTERVALO_MINIMO_MS - (Date.now() - estado.ultimaBusca));
  estado.buscaAgendada = setTimeout(() => {
    estado.buscaAgendada = null;
    buscarPainel();
  }, espera);
}

function selecionar(id) {
  estado.selecionado = estado.selecionado === id ? null : id;
  $('seletor-ponto').value = estado.selecionado ?? '';
  renderCompleto();
}

function temaAtualEscuro() {
  return getComputedStyle(document.documentElement).colorScheme.includes('dark');
}

function alternarTema() {
  const novo = temaAtualEscuro() ? 'light' : 'dark';
  document.documentElement.dataset.theme = novo;
  try { localStorage.setItem('termopoliv-tema', novo); } catch { /* navegação privada */ }
  aoMudarTema();
}

function aoMudarTema() {
  desenharEscalas();
  mapa?.trocarTema();
  if (estado.painel?.ultima_leitura !== null && estado.painel) renderCompleto();
}

function iniciar() {
  $('vazio-comando').textContent = `curl -X POST ${location.origin}/api/leituras \\\n  -H "Content-Type: application/json" \\\n  -d '{"sensor_id":"esp32-01","temperatura":27.4,"umidade":61.2}'`;
  desenharEscalas();

  $('tema').addEventListener('click', alternarTema);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aoMudarTema);
  $('seletor-ponto').addEventListener('change', (e) => {
    estado.selecionado = e.target.value || null;
    renderCompleto();
  });
  $('filtros').addEventListener('submit', (e) => e.preventDefault());
  $('filtros').addEventListener('change', (e) => {
    if (e.target.name !== 'periodo') return;
    estado.periodo = e.target.value;
    $('conteudo').classList.add('atualizando');
    buscarPainel({ forcar: true });
  });

  let esperaRedimensionar = null;
  new ResizeObserver(() => {
    clearTimeout(esperaRedimensionar);
    esperaRedimensionar = setTimeout(() => {
      if (estado.painel && estado.painel.ultima_leitura !== null) { renderTempo(); renderDesigualdade(); }
    }, 120);
  }).observe($('conteudo'));

  const fluxo = new EventSource('/api/stream');
  fluxo.addEventListener('open', () => { estado.conectado = true; agendarBusca(); });
  fluxo.addEventListener('leitura', agendarBusca);
  fluxo.addEventListener('error', () => { estado.conectado = false; renderStatus(); });

  setInterval(renderStatus, 1000);
  setInterval(agendarBusca, INTERVALO_VERIFICACAO_MS);
  document.body.classList.remove('carregando');

  criarMapa($('mapa'), { aoSelecionar: selecionar })
    .then((criado) => {
      mapa = criado;
      if (estado.painel && estado.painel.ultima_leitura !== null) renderMapa();
    })
    .catch((erro) => {
      console.error('Falha ao criar o mapa:', erro);
      const aviso = $('mapa-aviso');
      aviso.hidden = false;
      aviso.textContent = 'Não foi possível carregar o mapa. Os valores continuam na tabela de pontos.';
    });

  buscarPainel({ forcar: true });
}

iniciar();
