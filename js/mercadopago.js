/**
 * Casa dos Botões — Integração Mercado Pago Checkout Pro
 * ----------------------------------------------------------------
 * Quando o cliente escolhe "Cartão" no checkout, este módulo:
 *   1. Cria uma "preferência" via API do MP (POST /checkout/preferences)
 *   2. Recebe o init_point (URL do checkout MP)
 *   3. Redireciona o navegador para essa URL
 *   4. Cliente paga na página oficial do MP (cartão, débito, Pix MP)
 *   5. MP redireciona de volta para o site com status do pagamento
 *
 * Endpoints usados:
 *   - POST https://api.mercadopago.com/checkout/preferences
 *     Cria preferência (precisa Access Token no header)
 *   - GET  https://api.mercadopago.com/v1/payments/{id}
 *     Consulta status (opcional, para confirmação)
 *
 * Documentação oficial:
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/integrate-with-pix
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/integration-configuration/integrate
 */

(function (global) {
  'use strict';

  const API_BASE = 'https://api.mercadopago.com';

  /* ---------- Helpers ---------- */
  function formatBRL(n) { return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ','); }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ---------- Cria a preferência no MP ---------- */
  // pedido = { numero, items, frete, total, cliente, shippingOption }
  //   items: [{ id, nome, preco, qty, unidade }]
  //   cliente: { nome, telefone, cep, endereco, cidade, uf }
  //   shippingOption: { nome, valor, retirada } | null
  // Retorna: { init_point, preference_id } ou lança erro
  async function criarPreferencia(pedido, opts) {
    opts = opts || {};
    const cfg = global.CDB_CONFIG?.mercadoPago;
    if (!cfg) throw new Error('Mercado Pago não configurado em config.js');

    // Se tiver Worker configurado, usa ele (mais seguro)
    if (cfg.workerUrl) {
      return await criarViaWorker(pedido, opts, cfg);
    }

    // Sem Worker: chama a API direto do navegador (CORS permite)
    return await criarDireto(pedido, opts, cfg);
  }

  /* ---------- Estratégia 1: direto do front (sem Worker) ---------- */
  async function criarDireto(pedido, opts, cfg) {
    if (!cfg.accessToken) {
      throw new Error('Access Token do Mercado Pago não configurado em config.js');
    }

    const body = montarBodyPreferencia(pedido, opts, cfg);

    const resp = await fetch(`${API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      let errMsg = `MP HTTP ${resp.status}`;
      try {
        const errData = JSON.parse(txt);
        if (errData.message) errMsg += ': ' + errData.message;
        if (errData.cause && Array.isArray(errData.cause)) {
          errMsg += ' | ' + errData.cause.map(c => c.description).join('; ');
        }
      } catch (e) {}
      throw new Error(errMsg);
    }

    const data = await resp.json();
    return {
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      preference_id: data.id,
    };
  }

  /* ---------- Estratégia 2: via Cloudflare Worker (mais seguro) ---------- */
  async function criarViaWorker(pedido, opts, cfg) {
    const body = {
      acao: 'mp_cartao',
      items: pedido.items.map(i => ({
        id: i.id,
        title: i.nome + ' (' + (i.unidade || '') + ')',
        quantity: i.qty,
        unit_price: i.preco,
        currency_id: 'BRL',
      })),
      frete: pedido.frete,
      total: pedido.total,
      numero: pedido.numero,
      cliente: pedido.cliente,
      back_url: cfg.backUrl,
    };

    const resp = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error('Worker MP HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Erro do Worker');
    return {
      init_point: data.init_point,
      preference_id: data.preference_id,
    };
  }

  /* ---------- Monta o body da preferência ---------- */
  function montarBodyPreferencia(pedido, opts, cfg) {
    const items = pedido.items.map(i => ({
      id: String(i.id || ''),
      title: (i.nome + ' - ' + (i.unidade || '')).slice(0, 256),
      description: (i.descricao || i.nome).slice(0, 256),
      quantity: i.qty,
      unit_price: Number(i.preco.toFixed(2)),
      currency_id: 'BRL',
      category_id: 'fashion',
    }));

    // Adiciona o frete como item separado se houver
    if (pedido.frete > 0) {
      items.push({
        id: 'frete',
        title: pedido.shippingOption?.retirada
          ? 'Retirada no local'
          : 'Frete - ' + (pedido.shippingOption?.nome || 'Correios'),
        description: 'Envio/retirada',
        quantity: 1,
        unit_price: Number(pedido.frete.toFixed(2)),
        currency_id: 'BRL',
        category_id: 'shipping',
      });
    }

    // Configurações de pagamento
    const excludedPaymentMethods = [];
    // Sempre exclui boleto (você não quer)
    excludedPaymentMethods.push({ id: 'ticket' });
    // Se você não quiser Pix via MP (já tem Pix direto sem taxa), descomente:
    // excludedPaymentMethods.push({ id: 'pix' });

    // Endereço de envio (para o MP validar CEP)
    const shipments = pedido.shippingOption?.retirada
      ? { mode: 'custom', cost: 0 }
      : {
          mode: 'custom',
          cost: Number(pedido.frete.toFixed(2)),
          receiver_address: {
            zip_code: pedido.cliente.cep?.replace(/\D/g, '') || '',
            street_name: pedido.cliente.endereco || '',
            city_name: { name: pedido.cliente.cidade || '' },
            state_name: pedido.cliente.uf || '',
          },
        };

    // URLs de retorno
    const backUrls = {
      success: `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=approved`,
      pending:  `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=pending`,
      failure:  `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=failure`,
    };

    // Dados do pagador (opcional mas recomendado)
    const payer = {
      name: (pedido.cliente.nome || '').split(' ')[0] || 'Cliente',
      surname: (pedido.cliente.nome || '').split(' ').slice(1).join(' ') || 'Casa dos Botões',
      phone: {
        area_code: (pedido.cliente.telefone || '').replace(/\D/g, '').slice(0, 2) || '16',
        number: Number((pedido.cliente.telefone || '').replace(/\D/g, '').slice(2, 12)) || 999999999,
      },
      address: {
        zip_code: pedido.cliente.cep?.replace(/\D/g, '') || '',
        street_name: pedido.cliente.endereco || '',
        city_name: pedido.cliente.cidade || '',
        state_name: pedido.cliente.uf || '',
      },
    };

    return {
      items: items,
      payer: payer,
      shipments: shipments,
      back_urls: backUrls,
      auto_return: 'approved',
      external_reference: pedido.numero,
      statement_descriptor: 'CASA DOS BOTOES',
      payment_methods: {
        installments: cfg.maxParcelas || 12,
        default_installments: 1,
        excluded_payment_types: excludedPaymentMethods,
      },
      // Não envia e-mail pro cliente automaticamente (você faz isso no WhatsApp)
      binary_mode: false,
      notification_url: '', // sem webhook por enquanto
    };
  }

  /* ---------- Redireciona para o checkout do MP ---------- */
  function redirecionar(initPoint) {
    if (!initPoint) throw new Error('init_point vazio');
    window.location.href = initPoint;
  }

  /* ---------- Consulta status do pagamento (opcional) ---------- */
  // Útil quando o cliente volta do MP para confirmar o status
  async function consultarPagamento(paymentId) {
    const cfg = global.CDB_CONFIG?.mercadoPago;
    if (!cfg?.accessToken) throw new Error('Access Token não configurado');

    const resp = await fetch(`${API_BASE}/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cfg.accessToken}`,
      },
    });
    if (!resp.ok) throw new Error('MP HTTP ' + resp.status);
    return await resp.json();
  }

  /* ---------- Lê status do pagamento da URL de retorno ---------- */
  // Quando o cliente volta do MP, a URL tem parâmetros como:
  //   ?pedido=CDB123&mp_status=approved
  //   ?collection_id=12345&collection_status=approved&preference_id=...
  function lerStatusUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
      pedido: params.get('pedido'),
      status: params.get('mp_status') || params.get('collection_status') || params.get('status'),
      paymentId: params.get('collection_id') || params.get('payment_id'),
      preferenceId: params.get('preference_id'),
    };
  }

  /* ---------- API pública ---------- */
  global.CDBMercadoPago = {
    criarPreferencia,
    redirecionar,
    consultarPagamento,
    lerStatusUrl,
    montarBodyPreferencia, // exposto para testes
  };

})(window);
