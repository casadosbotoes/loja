/**
 * Casa dos Botões — Cálculo de Frete (Correios)
 * -------------------------------------------------------------
 * Estratégia em camadas:
 *
 *   1. Se config.correios.workerUrl + contrato + cartao estiverem
 *      configurados: usa a API oficial dos Correios via Worker
 *      (Cloudflare Worker que faz a chamada com CORS resolvido).
 *
 *   2. Senão: usa a TABELA INTERNA DE FRETE por região do CEP.
 *      Sempre funciona, sem depender de contrato dos Correios.
 *      Valores configuráveis em config.js → correios.tabelaFrete.
 *
 *   3. Busca de endereço (ViaCEP) sempre disponível, grátis.
 *
 * Para ativar a API oficial:
 *   1. Cadastre-se em https://www.correios.com.br/precos-e-prazos-de-encomendas-e-servicos-online
 *   2. Pegue contrato + cartão de postagem
 *   3. Faça deploy do worker.js no Cloudflare (gratuito)
 *   4. Preencha config.js → correios.{contrato, cartaoPostagem, workerUrl}
 */

(function (global) {
  'use strict';

  const VIACEP_API = 'https://viacep.com.br/ws';

  /* ---------- Validação de CEP ---------- */
  function onlyDigits(s) { return (s || '').toString().replace(/\D/g, ''); }
  function isValidCEP(cep) { return onlyDigits(cep).length === 8; }
  function formatCEP(cep) {
    cep = onlyDigits(cep);
    if (cep.length !== 8) return cep;
    return cep.slice(0, 5) + '-' + cep.slice(5);
  }

  /* ---------- Tabela de frete padrão (valores 2025) ----------
   * Baseada na região do Brasil (primeiro dígito do CEP).
   * Valores médios de mercado para pacote de 0,3kg (1 pacote com 6 botões).
   * Para pedidos maiores, multiplica pelo peso (0,05kg por pacote extra).
   * EDITE em config.js → correios.tabelaFrete para personalizar.
   */
  const TABELA_FRETE_PADRAO = {
    // 1º dígito do CEP → {regiao, pac, sedex, prazoPac, prazoSedex}
    '0': { regiao: 'Grande São Paulo',                pac: 12.90, sedex: 19.90, prazoPac: 4, prazoSedex: 1 },
    '1': { regiao: 'Interior SP + RJ + MG + ES',       pac: 16.90, sedex: 26.90, prazoPac: 6, prazoSedex: 2 },
    '2': { regiao: 'RJ + ES',                          pac: 17.90, sedex: 27.90, prazoPac: 6, prazoSedex: 2 },
    '3': { regiao: 'Minas Gerais + Bahia',             pac: 19.90, sedex: 32.90, prazoPac: 7, prazoSedex: 3 },
    '4': { regiao: 'BA + SE + AL + PE',                pac: 22.90, sedex: 38.90, prazoPac: 8, prazoSedex: 4 },
    '5': { regiao: 'PE + PB + RN + CE',                pac: 24.90, sedex: 42.90, prazoPac: 9, prazoSedex: 4 },
    '6': { regiao: 'Norte (PA, AM, AC, RO, RR, AP)',   pac: 34.90, sedex: 62.90, prazoPac: 12, prazoSedex: 6 },
    '7': { regiao: 'Centro-Oeste (DF, GO, TO, MT, MS)',pac: 26.90, sedex: 47.90, prazoPac: 10, prazoSedex: 4 },
    '8': { regiao: 'Sul (PR, SC)',                     pac: 19.90, sedex: 32.90, prazoPac: 6, prazoSedex: 3 },
    '9': { regiao: 'Rio Grande do Sul',                pac: 22.90, sedex: 38.90, prazoPac: 7, prazoSedex: 3 },
  };

  /* ---------- Busca endereço por CEP (ViaCEP) ---------- */
  async function buscarEndereco(cep) {
    cep = onlyDigits(cep);
    if (!isValidCEP(cep)) throw new Error('CEP inválido');
    const url = `${VIACEP_API}/${cep}/json/`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Falha ao buscar CEP (HTTP ' + resp.status + ')');
    const data = await resp.json();
    if (data.erro) throw new Error('CEP não encontrado');
    return {
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
    };
  }

  /* ---------- Cálculo de frete (estratégia em camadas) ---------- */
  // Retorna array de { codigo, nome, descricao, valor, prazo }
  async function calcularFrete(cepDestino, pacote) {
    const cfg = global.CDB_CONFIG || {};
    const corr = cfg.correios || {};
    cepDestino = onlyDigits(cepDestino);
    if (!isValidCEP(cepDestino)) throw new Error('CEP de destino inválido');
    if (!isValidCEP(cfg.store?.cepOrigem)) throw new Error('CEP de origem não configurado no config.js (store.cepOrigem)');

    // Serviços a consultar
    const servicos = corr.servicos && corr.servicos.length
      ? corr.servicos
      : [
          { codigo: '03298', nome: 'PAC',  descricao: 'Econômico, 4-12 dias úteis' },
          { codigo: '03220', nome: 'SEDEX', descricao: 'Rápido, 1-6 dias úteis' },
        ];

    // --- Estratégia 1: Worker configurado (API oficial Correios) ---
    if (corr.workerUrl && corr.contrato && corr.cartaoPostagem) {
      try {
        return await calcularViaWorker(cepDestino, pacote, servicos, corr.workerUrl);
      } catch (e) {
        console.warn('[shipping] Worker falhou:', e.message, '— usando tabela interna');
      }
    }

    // --- Estratégia 2: Tabela interna por região (sempre funciona) ---
    return calcularPorTabela(cepDestino, pacote, servicos, corr);
  }

  /* ---------- Estratégia 1: Worker (API oficial Correios) ---------- */
  async function calcularViaWorker(cepDestino, pacote, servicos, workerUrl) {
    const body = {
      acao: 'correios',
      cepOrigem: global.CDB_CONFIG.store.cepOrigem,
      cepDestino: cepDestino,
      pacote: pacote,
      servicos: servicos.map(s => s.codigo),
      contrato: global.CDB_CONFIG.correios.contrato,
      cartaoPostagem: global.CDB_CONFIG.correios.cartaoPostagem,
    };
    const resp = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Erro do Worker');
    return data.resultados;
  }

  /* ---------- Estratégia 2: Tabela interna por região ---------- */
  function calcularPorTabela(cepDestino, pacote, servicos, corr) {
    // Tabela customizada do config.js ou a padrão
    const tabela = (corr.tabelaFrete && Object.keys(corr.tabelaFrete).length)
      ? corr.tabelaFrete
      : TABELA_FRETE_PADRAO;

    // Pega o primeiro dígito do CEP de destino
    const primeiroDigito = cepDestino.charAt(0);
    const faixa = tabela[primeiroDigito];
    if (!faixa) throw new Error('Região de CEP não atendida: ' + primeiroDigito);

    // Calcula multiplicador de peso: pacote base 0,3kg (1 pacote com 6 botões)
    // Cada 0,3kg adicional (outro pacote) adiciona 30% ao valor do frete
    const pesoKg = pacote.peso || 0.3;
    const pacotesAdicionais = Math.max(0, (pesoKg / 0.3) - 1);
    const multiplicadorPeso = 1 + (pacotesAdicionais * 0.30);

    // Origem: se a origem começa com o mesmo dígito, é "local" (mais barato)
    const cepOrigem = onlyDigits(global.CDB_CONFIG?.store?.cepOrigem || '');
    const mesmoDigito = cepOrigem.charAt(0) === primeiroDigito;
    const fatorLocal = mesmoDigito ? 0.85 : 1.0; // 15% desconto na mesma região

    const resultados = [];
    for (const s of servicos) {
      const isSedex = (s.nome === 'SEDEX' || s.codigo === '03220' || s.codigo === '04014');
      const valorBase = isSedex ? faixa.sedex : faixa.pac;
      const prazoBase = isSedex ? faixa.prazoSedex : faixa.prazoPac;

      const valor = valorBase * multiplicadorPeso * fatorLocal;
      resultados.push({
        codigo: s.codigo,
        nome: s.nome,
        descricao: s.descricao || (faixa.regiao + ' · ' + prazoBase + ' dias úteis'),
        valor: Math.round(valor * 100) / 100, // arredonda 2 casas
        prazo: prazoBase,
        regiao: faixa.regiao,
        tabelaInterna: true, // marca para a UI saber que é estimado
      });
    }
    return resultados;
  }

  /* ---------- Cálculo do pacote total do carrinho ---------- */
  function pacoteDoCarrinho() {
    const cart = (global.CDBCart && global.CDBCart.getItems()) || [];
    if (cart.length === 0) return null;
    let pesoTotalG = 0;
    let maxComp = 16, maxLarg = 11, altTotal = 0;
    for (const item of cart) {
      const prod = (global.CDB_PRODUCTS || []).find(p => p.id === item.id);
      const dim = prod?.dimensao || global.CDB_CONFIG?.correios?.pacote || { pesoBaseKg: 0.05, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 };
      // dim.pesoG está em gramas; se vier pesoBaseKg (config), converte
      const pesoItem = dim.pesoG ? dim.pesoG : (dim.pesoBaseKg ? dim.pesoBaseKg * 1000 : 50);
      pesoTotalG += pesoItem * item.qty;
      const comp = dim.comprimentoCm || dim.comprimento || 16;
      const larg = dim.larguraCm || dim.largura || 11;
      const alt = dim.alturaCm || dim.altura || 2;
      if (comp > maxComp) maxComp = comp;
      if (larg > maxLarg) maxLarg = larg;
      altTotal += alt * item.qty;
    }
    // Limites mínimos e máximos dos Correios
    return {
      peso: Math.max(0.3, pesoTotalG / 1000), // kg, mínimo 300g
      comprimento: Math.min(70, Math.max(16, maxComp)),
      largura: Math.min(70, Math.max(11, maxLarg)),
      altura: Math.min(70, Math.max(2, altTotal)),
    };
  }

  /* ---------- API pública ---------- */
  global.CDBShipping = {
    calcularFrete,
    buscarEndereco,
    pacoteDoCarrinho,
    isValidCEP,
    formatCEP,
    onlyDigits,
    TABELA_FRETE_PADRAO,
  };

})(window);
