/**
 * Casa dos Botões — Sincronização de pedidos via JSONBin.io
 * ----------------------------------------------------------------
 * Resolve o problema do localStorage (que é por navegador): agora
 * TODOS os pedidos feitos em QUALQUER aparelho aparecem no painel
 * de pedidos, sincronizados via nuvem.
 *
 * Como funciona:
 *   - JSONBin.io é um serviço gratuito (10.000 req/mês) que armazena
 *     JSON na nuvem
 *   - Cada pedido finalizado é salvo no "bin" via API REST
 *   - O painel de pedidos lê o bin e mostra TODOS os pedidos
 *   - Funciona entre navegadores, aparelhos, etc.
 *
 * Configuração em config.js → sincronizacao:
 *   - api_key: sua API key do JSONBin.io
 *   - bin_id: ID do bin criado (gerado automaticamente na 1ª escrita)
 *
 * Documentação: https://jsonbin.io/api-reference
 */

(function (global) {
  'use strict';

  const API_BASE = 'https://api.jsonbin.io/v3';

  /* ---------- Helpers ---------- */
  function getConfig() {
    return global.CDB_CONFIG?.sincronizacao || {};
  }
  function isAtivo() {
    const cfg = getConfig();
    return cfg.ativo === true && cfg.apiKey && cfg.apiKey.length > 10;
  }

  /* ---------- Cria um novo bin (1ª vez) ---------- */
  // POST https://api.jsonbin.io/v3/b
  // Body: JSON com os dados iniciais
  // Headers: X-Master-Key
  async function criarBin(dadosIniciais) {
    const cfg = getConfig();
    if (!cfg.apiKey) throw new Error('API key não configurada');

    const resp = await fetch(`${API_BASE}/b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': cfg.apiKey,
        'X-Bin-Name': 'casadosbotoes-pedidos',
        'X-Bin-Private': 'true',
      },
      body: JSON.stringify({ pedidos: dadosIniciais || [] }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Criar bin HTTP ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    return data.metadata?.id || null;
  }

  /* ---------- Lê todos os pedidos do bin ---------- */
  // GET https://api.jsonbin.io/v3/b/{bin_id}/latest
  async function lerPedidos() {
    const cfg = getConfig();
    if (!cfg.apiKey || !cfg.binId) {
      throw new Error('binId não configurado');
    }
    const resp = await fetch(`${API_BASE}/b/${cfg.binId}/latest`, {
      method: 'GET',
      headers: {
        'X-Master-Key': cfg.apiKey,
        'Cache-Control': 'no-cache',
      },
    });
    if (!resp.ok) {
      throw new Error(`Ler bin HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.record?.pedidos || [];
  }

  /* ---------- Salva a lista completa no bin ---------- */
  // PUT https://api.jsonbin.io/v3/b/{bin_id}
  async function salvarPedidos(pedidos) {
    const cfg = getConfig();
    if (!cfg.apiKey || !cfg.binId) {
      throw new Error('binId não configurado');
    }
    const resp = await fetch(`${API_BASE}/b/${cfg.binId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': cfg.apiKey,
      },
      body: JSON.stringify({ pedidos: pedidos }),
    });
    if (!resp.ok) {
      throw new Error(`Salvar bin HTTP ${resp.status}`);
    }
    return true;
  }

  /* ---------- Adiciona UM pedido novo (lê + adiciona + salva) ---------- */
  // Esta é a função chamada pelo checkout quando um pedido é finalizado.
  // Estratégia:
  //   1. Lê a lista atual do bin
  //   2. Adiciona o novo pedido no início
  //   3. Salva a lista completa de volta
  // Não é a estratégia mais eficiente (lê tudo pra adicionar 1),
  // mas é a mais simples e robusta para volume baixo.
  async function adicionarPedido(pedido) {
    if (!isAtivo()) {
      console.log('[sync] Sincronização desativada, pulando');
      return { success: false, reason: 'desativado' };
    }
    const cfg = getConfig();

    try {
      // Se ainda não tem binId, cria um bin novo
      if (!cfg.binId) {
        console.log('[sync] Criando bin novo...');
        const binId = await criarBin([pedido]);
        if (binId) {
          // Atualiza config em memória (não persiste no config.js,
          // mas funciona para a sessão atual; para próximas sessões
          // precisa atualizar config.js manualmente)
          cfg.binId = binId;
          console.log('[sync] ✓ Bin criado:', binId);
          return { success: true, binId: binId };
        }
        throw new Error('Não foi possível criar o bin');
      }

      // Lê a lista atual
      let pedidos = [];
      try {
        pedidos = await lerPedidos();
      } catch (e) {
        console.warn('[sync] Erro ao ler bin (pode ser 1ª escrita):', e.message);
      }

      // Evita duplicar pelo número do pedido
      if (pedidos.some(p => p.numero === pedido.numero)) {
        console.log('[sync] Pedido já existe no bin:', pedido.numero);
        return { success: true, reason: 'duplicado' };
      }

      // Adiciona no início
      pedidos.unshift(pedido);

      // Salva de volta
      await salvarPedidos(pedidos);
      console.log('[sync] ✓ Pedido sincronizado na nuvem:', pedido.numero);
      return { success: true };
    } catch (err) {
      console.error('[sync] Erro ao adicionar pedido:', err);
      return { success: false, error: err.message };
    }
  }

  /* ---------- Lista TODOS os pedidos do bin ---------- */
  async function listarPedidos() {
    if (!isAtivo()) {
      return [];
    }
    try {
      return await lerPedidos();
    } catch (e) {
      console.error('[sync] Erro ao listar pedidos:', e);
      return [];
    }
  }

  /* ---------- Remove um pedido pelo número ---------- */
  async function removerPedido(numero) {
    if (!isAtivo()) return false;
    try {
      const pedidos = await lerPedidos();
      const filtrados = pedidos.filter(p => p.numero !== numero);
      await salvarPedidos(filtrados);
      return true;
    } catch (e) {
      console.error('[sync] Erro ao remover:', e);
      return false;
    }
  }

  /* ---------- Limpa TODOS os pedidos ---------- */
  async function limparTudo() {
    if (!isAtivo()) return false;
    try {
      await salvarPedidos([]);
      return true;
    } catch (e) {
      console.error('[sync] Erro ao limpar:', e);
      return false;
    }
  }

  /* ---------- API pública ---------- */
  global.CDBSync = {
    isAtivo,
    adicionarPedido,
    listarPedidos,
    removerPedido,
    limparTudo,
    criarBin,
  };

})(window);
