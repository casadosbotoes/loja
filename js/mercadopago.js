/**
 * Casa dos Botões — Integração Mercado Pago (Checkout Transparente via API)
 * --------------------------------------------------------------------------
 * ARQUITETURA (segura — Access Token NUNCA vai pro navegador):
 *
 *   1. SDK MercadoPago.js é carregado no navegador com a PUBLIC KEY (segura).
 *   2. Cliente digita cartão no nosso site.
 *   3. SDK tokeniza o cartão → produz um `token` (PCI compliant).
 *   4. Navegador envia `token` + parcelas + payer (CPF/email) ao Worker.
 *   5. Worker usa o ACCESS TOKEN (que vive só no Cloudflare) para chamar
 *      POST /v1/payments do MP.
 *   6. MP responde: approved / rejected / in_process.
 *   7. Worker retorna status → navegador mostra confirmação.
 *
 * Fluxo alternativo (Checkout Pro) mantido para fallback:
 *   - Se `transparente` estiver desligado em config, gera preferência
 *     e redireciona para a página oficial do MP.
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

  // Limpa CPF/CNPJ para só dígitos
  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

  // Detecta se é CPF (11) ou CNPJ (14)
  function detectarTipoDoc(s) {
    const d = onlyDigits(s);
    if (d.length === 11) return 'CPF';
    if (d.length === 14) return 'CNPJ';
    return null;
  }

  /* ---------- Inicializa SDK com PUBLIC KEY ---------- */
  // A Public Key pode ser exposta no front sem risco.
  // O Access Token (sensível) NUNCA vem para o navegador.
  let mpInstance = null;
  function getSDK() {
    if (mpInstance) return mpInstance;
    const publicKey = global.CDB_CONFIG?.mercadoPago?.publicKey;
    if (!publicKey) {
      throw new Error('mercadoPago.publicKey não configurado em config.js');
    }
    if (!global.MercadoPago) {
      throw new Error('SDK MercadoPago.js não carregou. Verifique sua conexão.');
    }
    // Nova API do SDK v2
    mpInstance = new global.MercadoPago(publicKey);
    return mpInstance;
  }

  /* ---------- Tokeniza cartão via SDK (PCI compliant) ---------- */
  // cardData = {
  //   cardNumber, cardExpirationMonth, cardExpirationYear,
  //   securityCode, cardholderName, identificationType, identificationNumber
  // }
  async function criarCardToken(cardData) {
    const mp = getSDK();
    // SDK v2 expõe createCardToken no nível da instância
    const result = await mp.createCardToken({
      cardNumber: onlyDigits(cardData.cardNumber),
      cardExpirationMonth: String(cardData.cardExpirationMonth).padStart(2, '0'),
      cardExpirationYear: String(cardData.cardExpirationYear).padStart(4, '20'),
      cardholderName: (cardData.cardholderName || '').toUpperCase().trim(),
      securityCode: onlyDigits(cardData.securityCode),
      identificationType: cardData.identificationType || 'CPF',
      identificationNumber: onlyDigits(cardData.identificationNumber),
    });
    if (!result || !result.id) {
      throw new Error('Falha ao tokenizar o cartão. Verifique os dados.');
    }
    return result.id; // token (ex: "1234567890abcdef")
  }

  /* ---------- Consulta parcelas via SDK (público, sem access token) ---------- */
  // Retorna: [{ installments, installment_rate, installment_amount, total_amount, labels: [] }]
  async function getInstallments(bin, amount) {
    if (!bin || bin.length < 6) return [];
    const mp = getSDK();
    const amountNum = Number(amount).toFixed(2);
    // SDK v2: mp.getInstallments({ bin, amount })
    const result = await mp.getInstallments({
      bin: bin,
      amount: amountNum,
    });
    // resposta no formato: [{ payment_method_id: 'visa', payer_costs: [...] }]
    if (!Array.isArray(result) || result.length === 0) return [];
    const payerCosts = result[0].payer_costs || [];
    return payerCosts.map(pc => ({
      installments: pc.installments,
      installmentRate: pc.installment_rate,
      installmentAmount: pc.installment_amount,
      totalAmount: pc.total_amount,
      labels: pc.labels || [],
      // String legível para o <select>: "3x R$ 10,00 sem juros"
      label: formatInstallmentLabel(pc),
    }));
  }

  function formatInstallmentLabel(pc) {
    const parcelas = pc.installments;
    const valor = pc.installment_amount;
    const total = pc.total_amount;
    const semJuros = (pc.labels || []).includes('recommended') ||
                     Number(pc.installment_rate) === 0;
    const txt = `${parcelas}x de ${formatBRL(valor)}` +
                (semJuros ? ' sem juros' : '');
    return txt;
  }

  /* ---------- Envia pagamento ao Worker (que chama a API do MP) ---------- */
  // payload = {
  //   token, paymentMethodId, installments, issuerId,
  //   transactionAmount, description, externalReference,
  //   payer: { email, firstName, lastName, identificationType, identificationNumber,
  //            phone: { area_code, number } }
  // }
  // Retorna: { status, statusDetail, paymentId, message }
  async function processPayment(payload) {
    const cfg = global.CDB_CONFIG?.mercadoPago;
    if (!cfg?.workerUrl) {
      throw new Error('mercadoPago.workerUrl não configurado em config.js — obrigatório para checkout transparente.');
    }
    const resp = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        acao: 'mp_process_payment',
        ...payload,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Worker HTTP ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    if (!data.success) {
      throw new Error(data.error || 'Erro ao processar pagamento');
    }
    return {
      status: data.status,            // 'approved' | 'rejected' | 'in_process' | 'pending'
      statusDetail: data.status_detail,
      paymentId: data.payment_id,
      message: data.message || '',
    };
  }

  /* ---------- Cria preferência (fallback Checkout Pro) ---------- */
  // Mantido para o caso do checkout transparente falhar ou para o fluxo
  // "Pix MP" dinâmico via Worker.
  async function criarPreferencia(pedido, opts) {
    opts = opts || {};
    const cfg = global.CDB_CONFIG?.mercadoPago;
    if (!cfg) throw new Error('Mercado Pago não configurado em config.js');
    if (cfg.workerUrl) {
      return await criarViaWorker(pedido, opts, cfg);
    }
    // Sem Worker → usa Access Token direto (NÃO RECOMENDADO)
    return await criarDireto(pedido, opts, cfg);
  }

  /* ---------- Estratégia 1: direto do front (sem Worker) ---------- */
  // NÃO USAR em produção — access token fica exposto.
  async function criarDireto(pedido, opts, cfg) {
    if (!cfg.accessToken) {
      throw new Error('Access Token do MP não configurado');
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
      throw new Error(`MP HTTP ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    // Detecta se está em modo sandbox (credencial TEST-) e usa sandbox_init_point
    const isSandbox = cfg.accessToken?.startsWith('TEST-');
    const initPoint = isSandbox ? (data.sandbox_init_point || data.init_point) : data.init_point;
    return {
      init_point: initPoint,
      sandbox_init_point: data.sandbox_init_point,
      preference_id: data.id,
    };
  }

  /* ---------- Estratégia 2: via Worker (mais seguro) ---------- */
  async function criarViaWorker(pedido, opts, cfg) {
    const acao = opts.paymentMethod === 'pix-mp' ? 'mp_pix' : 'mp_cartao';
    const body = {
      acao: acao,
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
    // Para cartão (Checkout Pro fallback)
    if (acao === 'mp_cartao') {
      return { init_point: data.init_point, preference_id: data.preference_id };
    }
    // Para Pix MP: retorna dados do QR Code
    return {
      qr_code: data.qr_code,
      qr_code_base64: data.qr_code_base64,
      ticket_url: data.ticket_url,
      payment_id: data.payment_id,
      status: data.status,
    };
  }

  /* ---------- Monta body da preferência (para fallback direto) ---------- */
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
    const excludedPaymentMethods = [{ id: 'ticket' }];
    const shipments = pedido.shippingOption?.retirada
      ? { mode: 'custom', cost: 0 }
      : {
          mode: 'custom',
          cost: Number(pedido.frete.toFixed(2)),
          receiver_address: {
            zip_code: pedido.cliente.cep?.replace(/\D/g, '') || '',
            street_name: pedido.cliente.endereco || '',
            city_name: pedido.cliente.cidade || '',
            state_name: pedido.cliente.uf || '',
          },
        };
    const backUrls = {
      success: `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=approved`,
      pending:  `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=pending`,
      failure:  `${cfg.backUrl}?pedido=${pedido.numero}&mp_status=failure`,
    };
    const payer = {
      name: (pedido.cliente.nome || '').split(' ')[0] || 'Cliente',
      surname: (pedido.cliente.nome || '').split(' ').slice(1).join(' ') || 'Casa dos Botões',
      phone: {
        area_code: onlyDigits(pedido.cliente.telefone).slice(0, 2) || '16',
        number: Number(onlyDigits(pedido.cliente.telefone).slice(2, 12)) || 999999999,
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
      binary_mode: false,
      notification_url: '',
    };
  }

  /* ---------- Redireciona para checkout MP (fallback) ---------- */
  function redirecionar(initPoint) {
    if (!initPoint) throw new Error('init_point vazio');
    window.location.href = initPoint;
  }

  /* ---------- Consulta status do pagamento (opcional) ---------- */
  async function consultarPagamento(paymentId) {
    const cfg = global.CDB_CONFIG?.mercadoPago;
    if (!cfg?.accessToken) throw new Error('Access Token não configurado');
    const resp = await fetch(`${API_BASE}/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${cfg.accessToken}` },
    });
    if (!resp.ok) throw new Error('MP HTTP ' + resp.status);
    return await resp.json();
  }

  /* ---------- Lê status da URL de retorno ---------- */
  function lerStatusUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
      pedido: params.get('pedido'),
      status: params.get('mp_status') || params.get('collection_status') || params.get('status'),
      paymentId: params.get('collection_id') || params.get('payment_id'),
      preferenceId: params.get('preference_id'),
    };
  }

  /* ---------- Traduz status MP para mensagem amigável ---------- */
  function traduzirStatus(status, detail) {
    const map = {
      approved: {
        title: 'Pagamento aprovado! 🎉',
        msg: 'Seu pagamento foi confirmado. Já estamos preparando seu pedido.',
        classe: 'success',
      },
      pending: {
        title: 'Pagamento pendente ⏳',
        msg: 'Aguardando confirmação. Você receberá um e-mail do Mercado Pago.',
        classe: 'pending',
      },
      in_process: {
        title: 'Pagamento em análise 🔍',
        msg: 'O Mercado Pago está analisando a transação. Em até 2 dias úteis terá resposta.',
        classe: 'pending',
      },
      rejected: {
        title: 'Pagamento recusado ❌',
        msg: traduzirRejeicao(detail),
        classe: 'error',
      },
      cancelled: {
        title: 'Pagamento cancelado',
        msg: 'A transação foi cancelada.',
        classe: 'error',
      },
    };
    return map[status] || { title: 'Status desconhecido', msg: 'Tente novamente ou chame no WhatsApp.', classe: 'pending' };
  }

  function traduzirRejeicao(detail) {
    const map = {
      'cc_rejected_bad_filled_card_number': 'Número do cartão inválido. Confira os dígitos.',
      'cc_rejected_bad_filled_date': 'Data de validade incorreta.',
      'cc_rejected_bad_filled_other': 'Algum campo do cartão está incorreto. Reveja os dados.',
      'cc_rejected_bad_filled_security_code': 'Código de segurança (CVV) inválido.',
      'cc_rejected_blacklist': 'O cartão foi recusado pelo banco emissor.',
      'cc_rejected_call_for_authorize': 'Ligue para o banco emissor para autorizar a transação.',
      'cc_rejected_card_disabled': 'Cartão desativado. Entre em contato com o banco.',
      'cc_rejected_card_error': 'Não foi possível processar o cartão.',
      'cc_rejected_duplicated_payment': 'Já existe um pagamento idêntico em processamento.',
      'cc_rejected_high_risk': 'Transação suspeita. Tente outro cartão ou via Pix.',
      'cc_rejected_insufficient_amount': 'Saldo/limite insuficiente.',
      'cc_rejected_invalid_installments': 'O emissor não aceita esse parcelamento.',
      'cc_rejected_max_attempts': 'Excedido o limite de tentativas. Tente mais tarde.',
      'cc_rejected_other_reason': 'Pagamento recusado pelo banco emissor.',
    };
    return map[detail] || 'O pagamento foi recusado. Tente outro cartão ou via Pix.';
  }

  /* ---------- API pública ---------- */
  global.CDBMercadoPago = {
    // Checkout transparente (NOVO)
    criarCardToken,
    getInstallments,
    processPayment,
    traduzirStatus,
    // Checkout Pro (mantido para fallback)
    criarPreferencia,
    redirecionar,
    consultarPagamento,
    lerStatusUrl,
    // Helpers exportados para teste
    _detectarTipoDoc: detectarTipoDoc,
    _onlyDigits: onlyDigits,
  };

})(window);
