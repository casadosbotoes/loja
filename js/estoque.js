/**
 * Casa dos Botões — Gerenciamento de estoque (estoque.js)
 * ----------------------------------------------------------------
 * Controla o estoque de cada produto:
 *   - Lê do JSONBin.io (nuvem) na primeira carga
 *   - Se não tiver na nuvem, usa o valor inicial do products.js
 *   - Atualiza no localStorage para acesso rápido
 *   - Sincroniza decrementos na nuvem (entre dispositivos)
 *
 * Métodos principais:
 *   - getEstoque(produtoId) → número
 *   - decrementar(produtoId, quantidade) → boolean
 *   - validarPedido(items) → { valido, erros }
 *   - temEstoque(produtoId, quantidade) → boolean
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'cdb_estoque_v1';
  let estoqueLocal = null; // cache em memória
  let carregandoNuvem = false;

  /* ---------- Carrega do localStorage ---------- */
  function carregarLocal() {
    if (estoqueLocal !== null) return estoqueLocal;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      estoqueLocal = raw ? JSON.parse(raw) : {};
    } catch (e) {
      estoqueLocal = {};
    }
    return estoqueLocal;
  }

  /* ---------- Salva no localStorage ---------- */
  function salvarLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(estoqueLocal));
    } catch (e) {
      console.error('[estoque] erro ao salvar local:', e);
    }
  }

  /* ---------- Pega estoque inicial do products.js ---------- */
  function getEstoqueInicial(produtoId) {
    const p = (global.CDB_PRODUCTS || []).find(p => p.id === produtoId);
    if (!p) return 0;
    return Number(p.estoque) || 0;
  }

  /* ---------- Pega estoque atual (local + inicial) ---------- */
  function getEstoque(produtoId) {
    const local = carregarLocal();
    if (local[produtoId] !== undefined && local[produtoId] !== null) {
      return Math.max(0, local[produtoId]);
    }
    return getEstoqueInicial(produtoId);
  }

  /* ---------- Verifica se tem estoque suficiente ---------- */
  function temEstoque(produtoId, quantidade) {
    const atual = getEstoque(produtoId);
    return atual >= quantidade;
  }

  /* ---------- Valida um pedido inteiro ---------- */
  // items = [{ id, qty }]
  // Retorna { valido: boolean, erros: [string] }
  function validarPedido(items) {
    const erros = [];
    for (const item of items) {
      const atual = getEstoque(item.id);
      if (atual < item.qty) {
        const p = (global.CDB_PRODUCTS || []).find(p => p.id === item.id);
        const nome = p ? p.nome : item.id;
        if (atual === 0) {
          erros.push(`❌ "${nome}" está esgotado (0 em estoque)`);
        } else {
          erros.push(`❌ "${nome}": solicitado ${item.qty}, mas só tem ${atual} em estoque`);
        }
      }
    }
    return {
      valido: erros.length === 0,
      erros: erros,
    };
  }

  /* ---------- Decrementa estoque ---------- */
  // Chamado quando um pedido é confirmado
  function decrementar(produtoId, quantidade) {
    const local = carregarLocal();
    const atual = getEstoque(produtoId);
    const novo = Math.max(0, atual - quantidade);
    local[produtoId] = novo;
    salvarLocal();
    console.log(`[estoque] ${produtoId}: ${atual} → ${novo} (-${quantidade})`);
    // Tenta sincronizar na nuvem (sem bloquear)
    sincronizarNuvem(produtoId, novo);
    return true;
  }

  /* ---------- Decrementa todos os itens de um pedido ---------- */
  function decrementarPedido(items) {
    for (const item of items) {
      decrementar(item.id, item.qty);
    }
  }

  /* ---------- Sincroniza na nuvem (JSONBin.io) ---------- */
  async function sincronizarNuvem(produtoId, novoValor) {
    if (!global.CDBSync || !global.CDBSync.isAtivo()) return;
    try {
      // Lê o bin de estoque (cria se não existir)
      const cfg = global.CDB_CONFIG?.estoque || {};
      const binId = cfg.binId;
      if (!binId) {
        // Sem binId, não sincroniza (mas funciona local)
        return;
      }
      // Lê o estado atual da nuvem
      const resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': global.CDB_CONFIG.sincronizacao.apiKey,
          'Cache-Control': 'no-cache',
        },
      });
      let data = {};
      if (resp.ok) {
        const json = await resp.json();
        data = json.record || {};
      }
      if (!data.estoque) data.estoque = {};
      data.estoque[produtoId] = novoValor;
      // Salva de volta
      await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': global.CDB_CONFIG.sincronizacao.apiKey,
        },
        body: JSON.stringify(data),
      });
      console.log(`[estoque] ${produtoId} sincronizado na nuvem: ${novoValor}`);
    } catch (e) {
      console.warn('[estoque] erro ao sincronizar nuvem:', e);
    }
  }

  /* ---------- Carrega estoque da nuvem (chamado no início) ---------- */
  async function carregarNuvem() {
    if (carregandoNuvem) return;
    carregandoNuvem = true;
    if (!global.CDBSync || !global.CDBSync.isAtivo()) {
      carregandoNuvem = false;
      return;
    }
    const cfg = global.CDB_CONFIG?.estoque || {};
    if (!cfg.binId) {
      carregandoNuvem = false;
      return;
    }
    try {
      const resp = await fetch(`https://api.jsonbin.io/v3/b/${cfg.binId}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': global.CDB_CONFIG.sincronizacao.apiKey,
          'Cache-Control': 'no-cache',
        },
      });
      if (!resp.ok) {
        carregandoNuvem = false;
        return;
      }
      const json = await resp.json();
      const estoqueNuvem = json.record?.estoque || {};
      // Mescla com local (nuvem tem prioridade)
      const local = carregarLocal();
      for (const [id, qtd] of Object.entries(estoqueNuvem)) {
        local[id] = qtd;
      }
      salvarLocal();
      console.log('[estoque] Estoque sincronizado da nuvem:', Object.keys(estoqueNuvem).length, 'produtos');
      // Dispara evento para UI atualizar
      global.dispatchEvent(new CustomEvent('cdb:estoque-atualizado'));
    } catch (e) {
      console.warn('[estoque] erro ao carregar nuvem:', e);
    } finally {
      carregandoNuvem = false;
    }
  }

  /* ---------- API pública ---------- */
  global.CDBEstoque = {
    getEstoque,
    temEstoque,
    validarPedido,
    decrementar,
    decrementarPedido,
    carregarNuvem,
  };

  // Auto-carrega da nuvem quando documento carrega
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', carregarNuvem);
  } else {
    carregarNuvem();
  }

})(window);
