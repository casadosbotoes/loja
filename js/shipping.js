/**
 * Casa dos Botões — Cálculo de Frete (Correios)
 * -------------------------------------------------------------
 * Integra a API oficial dos Correios para cálculo de frete.
 *
 * Como o site é estático (GitHub Pages), não temos backend próprio.
 * A API dos Correios (api.correios.com.br) NÃO permite CORS direto
 * do navegador, então precisamos de um proxy. Estratégia em camadas:
 *
 *   1. Se config.correios.workerUrl estiver preenchido, usa o Worker
 *      (Cloudflare Worker que faz a chamada com CORS resolvido).
 *      Código do Worker em /worker.js (deploy gratuito).
 *
 *   2. Senão, tenta fallback com proxy CORS público (corsproxy.io).
 *      Pode ser instável em horários de pico, mas funciona para
 *      desenvolvimento. Para produção, recomendamos o Worker.
 *
 *   3. Se tudo falhar, mostra uma mensagem amigável sugerindo
 *      contato via WhatsApp para confirmar o frete.
 *
 * Documentação da API dos Correios:
 *   https://www.correios.com.br/atendimento/developers
 *
 * Fluxo:
 *   POST https://api.correios.com.br/preco/v2/nacional
 *   Body: { "idContrato", "codObjeto": "PAC/SEDEX", "cepOrigem", "cepDestino",
 *           "objeto": [{"tipoObjeto": "1", "peso", "comprimento", "largura", "altura"}] }
 */

(function (global) {
  'use strict';

  const CORREIOS_API = 'https://api.correios.com.br/preco/v2/nacional';
  const VIACEP_API = 'https://viacep.com.br/ws';

  /* ---------- Validação de CEP ---------- */
  function onlyDigits(s) { return (s || '').toString().replace(/\D/g, ''); }
  function isValidCEP(cep) { return onlyDigits(cep).length === 8; }
  function formatCEP(cep) {
    cep = onlyDigits(cep);
    if (cep.length !== 8) return cep;
    return cep.slice(0, 5) + '-' + cep.slice(5);
  }

  /* ---------- Busca endereço por CEP (ViaCEP) ---------- */
  async function buscarEndereco(cep) {
    cep = onlyDigits(cep);
    if (!isValidCEP(cep)) throw new Error('CEP inválido');
    const url = `${VIACEP_API}/${cep}/json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Falha ao buscar CEP');
    const data = await resp.json();
    if (data.erro) throw new Error('CEP não encontrado');
    return {
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
    };
  }

  /* ---------- Cálculo de frete ---------- */
  // Parâmetros:
  //   cepDestino: string (8 dígitos)
  //   pacote: { peso, comprimento, largura, altura }  (em gramas e centímetros)
  // Retorna:
  //   array de { codigo, nome, descricao, valor, prazo, origem }
  //   origem: 'worker' | 'api-direta' | 'proxy' | 'fallback-fixo'
  async function calcularFrete(cepDestino, pacote) {
    const cfg = global.CDB_CONFIG || {};
    const corr = cfg.correios || {};
    cepDestino = onlyDigits(cepDestino);
    if (!isValidCEP(cepDestino)) throw new Error('CEP de destino inválido');
    if (!isValidCEP(cfg.store?.cepOrigem)) throw new Error('CEP de origem não configurado no config.js');

    // Serviços a consultar
    const servicos = corr.servicos && corr.servicos.length
      ? corr.servicos
      : [{ codigo: '04510', nome: 'PAC', descricao: 'Econômico' }, { codigo: '04014', nome: 'SEDEX', descricao: 'Rápido' }];

    const erros = [];

    // Estratégia 1: Worker configurado
    if (corr.workerUrl) {
      try {
        const r = await calcularViaWorker(cepDestino, pacote, servicos, corr.workerUrl);
        return marcarOrigem(r, 'worker');
      } catch (e) {
        erros.push('worker: ' + e.message);
        console.warn('[shipping] Worker falhou:', e.message, '— tentando fallback');
      }
    }

    // Estratégia 2: chamada direta à API (provavelmente falha CORS, mas tenta)
    try {
      const r = await calcularViaCorreiosDirect(cepDestino, pacote, servicos, corr);
      return marcarOrigem(r, 'api-direta');
    } catch (directErr) {
      erros.push('api-direta: ' + directErr.message);
      console.warn('[shipping] direto falhou:', directErr.message, '— tentando proxy');
      // Estratégia 3: CORS proxy público
      try {
        const r = await calcularViaCorreiosProxy(cepDestino, pacote, servicos, corr);
        return marcarOrigem(r, 'proxy');
      } catch (proxyErr) {
        erros.push('proxy: ' + proxyErr.message);
        console.warn('[shipping] proxy falhou:', proxyErr.message, '— usando fallback fixo');
      }
    }

    // Estratégia 4 (FINAL): fallback de frete fixo configurado
    // Garante que o checkout nunca trave por falta de frete online.
    const fb = cfg.freteFixoFallback;
    if (fb && fb.ativo && fb.valores && fb.valores.length) {
      const resultados = fb.valores.map(v => ({
        codigo: v.codigo,
        nome: v.nome,
        descricao: v.descricao,
        valor: v.valor,
        prazo: v.prazo,
        origem: 'fallback-fixo',
        aviso: fb.aviso || '',
      }));
      console.warn('[shipping] usando fallback fixo. Erros:', erros.join(' | '));
      return resultados;
    }

    // Se chegou aqui, não há fallback configurado — lança erro amigável
    console.error('[shipping] todas as tentativas falharam:', erros.join(' | '));
    throw new Error('Não foi possível calcular o frete agora. Tente novamente ou chame no WhatsApp para confirmar o valor.');
  }

  function marcarOrigem(resultados, origem) {
    return resultados.map(r => ({ ...r, origem: r.origem || origem }));
  }

  /* ---------- Estratégia 1: Cloudflare Worker ---------- */
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

  /* ---------- Estratégia 2: chamada direta à API dos Correios ---------- */
  // Provavelmente vai falhar por CORS, mas tenta primeiro.
  async function calcularViaCorreiosDirect(cepDestino, pacote, servicos, corr) {
    const resultados = [];
    // auth: contrato + cartão de postagem como credenciais básicas no header
    const authStr = btoa(`${corr.contrato || ''}:${corr.cartaoPostagem || ''}`);
    for (const s of servicos) {
      const body = {
        idContrato: corr.contrato || '',
        codObjeto: s.codigo,
        cepOrigem: String(corr._cepOrigemRaw || global.CDB_CONFIG.store.cepOrigem).replace(/\D/g, ''),
        cepDestino: cepDestino,
        objetos: [{
          tipoObjeto: '1', // 1 = caixa/pacote
          peso: String(pacote.peso),
          comprimento: String(pacote.comprimento),
          largura: String(pacote.largura),
          altura: String(pacote.altura),
        }],
      };
      const url = `${CORREIOS_API}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + authStr,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`Correios HTTP ${resp.status}`);
      const data = await resp.json();
      const r = data[0] || {};
      resultados.push({
        codigo: s.codigo,
        nome: s.nome,
        descricao: s.descricao || '',
        valor: parseFloat(r.valor || r.preco || '0') || 0,
        prazo: parseInt(r.prazoEntrega || '0', 10) || null,
        raw: r,
      });
    }
    return resultados;
  }

  /* ---------- Estratégia 3: CORS proxy público ---------- */
  async function calcularViaCorreiosProxy(cepDestino, pacote, servicos, corr) {
    const resultados = [];
    const authStr = btoa(`${corr.contrato || ''}:${corr.cartaoPostagem || ''}`);
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(CORREIOS_API)}`;

    for (const s of servicos) {
      const body = {
        idContrato: corr.contrato || '',
        codObjeto: s.codigo,
        cepOrigem: String(global.CDB_CONFIG.store.cepOrigem).replace(/\D/g, ''),
        cepDestino: cepDestino,
        objetos: [{
          tipoObjeto: '1',
          peso: String(pacote.peso),
          comprimento: String(pacote.comprimento),
          largura: String(pacote.largura),
          altura: String(pacote.altura),
        }],
      };
      const resp = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + authStr,
          'Origin': window.location.origin,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
      const data = await resp.json();
      const r = data[0] || {};
      resultados.push({
        codigo: s.codigo,
        nome: s.nome,
        descricao: s.descricao || '',
        valor: parseFloat(r.valor || r.preco || '0') || 0,
        prazo: parseInt(r.prazoEntrega || '0', 10) || null,
        raw: r,
      });
    }
    return resultados;
  }

  /* ---------- Cálculo do pacote total do carrinho ---------- */
  // Soma dimensões e peso dos itens do carrinho.
  function pacoteDoCarrinho() {
    const cart = (global.CDBCart && global.CDBCart.getItems()) || [];
    if (cart.length === 0) return null;
    let pesoTotal = 0;
    let maxComp = 16, maxLarg = 11, altTotal = 0;
    for (const item of cart) {
      const prod = (global.CDB_PRODUCTS || []).find(p => p.id === item.id);
      const dim = prod?.dimensao || global.CDB_CONFIG?.correios?.pacote || { pesoBaseKg: 0.05, comprimentoCm: 16, larguraCm: 11, alturaCm: 2 };
      // dim.pesoG está em gramas; se vier pesoBaseKg (config), converte
      const pesoItem = dim.pesoG ? dim.pesoG : (dim.pesoBaseKg ? dim.pesoBaseKg * 1000 : 50);
      pesoTotal += pesoItem * item.qty;
      const comp = dim.comprimentoCm || dim.comprimento || 16;
      const larg = dim.larguraCm || dim.largura || 11;
      const alt = dim.alturaCm || dim.altura || 2;
      if (comp > maxComp) maxComp = comp;
      if (larg > maxLarg) maxLarg = larg;
      altTotal += alt * item.qty;
    }
    // Limites mínimos e máximos dos Correios
    return {
      peso: Math.max(0.3, pesoTotal / 1000), // kg, mínimo 300g
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
  };

})(window);
