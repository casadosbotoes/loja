/**
 * Cloudflare Worker — Casa dos Botões
 * =================================================================
 * Este Worker é OPCIONAL. O site funciona perfeitamente sem ele,
 * usando apenas o Pix direto (gerado no navegador) e o fallback
 * de proxy CORS público para o cálculo de frete.
 *
 * Mas se você quiser:
 *   - Aceitar PAGAMENTO COM CARTÃO via Mercado Pago
 *   - Gerar QR Code Pix DINÂMICO do Mercado Pago
 *   - Ter frete CORREIOS 100% confiável (sem depender de CORS proxy)
 *
 * ...então faça o deploy deste Worker (gratuito, ~100k req/dia) e
 * preencha a URL dele em config.js → mercadoPago.workerUrl e
 * config.js → correios.workerUrl.
 *
 * ------------------ DEPLOY ------------------
 *
 * 1. Crie uma conta gratuita em https://dash.cloudflare.com
 * 2. Vá em "Workers & Pages" → "Create application" → "Create Worker"
 * 3. Dê o nome "casadosbotoes-worker" e clique em "Deploy"
 * 4. Clique em "Edit code" e cole TODO o conteúdo deste arquivo
 * 5. Vá em "Settings" → "Variables" e adicione:
 *      MP_ACCESS_TOKEN   = <seu access token do MP>
 *      CORREIOS_CONTRATO = <seu contrato dos Correios>
 *      CORREIOS_CARTAO   = <seu cartão de postagem dos Correios>
 *   Marque como "Secret" (não ficam visíveis depois de salvas)
 * 6. Salve e faça "Deploy"
 * 7. Copie a URL do Worker (algo como:
 *    https://casadosbotoes-worker.seu-usuario.workers.dev)
 * 8. Cole essa URL em config.js → mercadoPago.workerUrl e
 *    config.js → correios.workerUrl
 *
 * ------------------ SEGURANÇA ------------------
 *
 * - As credenciais (access token do MP, contrato do Correios) ficam
 *   SOMENTE no Cloudflare, nunca no navegador.
 * - O Worker valida um domínio de origem (ORIGEM_PERMITIDA) para
 *   impedir que outros sites usem o seu Worker.
 *
 * =================================================================
 */

// Atualize com o domínio do seu GitHub Pages (sem https://)
// Ex: "casadosbotoes.github.io"
const ORIGEM_PERMITIDA = 'casadosbotoes.github.io';

// Host do Worker (para o MP chamar de volta no webhook).
// Pode ser sobrescrito pela variável de ambiente WORKER_HOST no Cloudflare.
// Se não definida, usa o mesmo domínio do site (útil apenas se o worker
// estiver no mesmo domínio, o que geralmente NÃO é o caso — defina WORKER_HOST).
function getWorkerHost(env) {
  return env?.WORKER_HOST || ORIGEM_PERMITIDA;
}

// Endpoint Mercado Pago (produção)
const MP_API = 'https://api.mercadopago.com';

// Endpoint Correios
const CORREIOS_API = 'https://api.correios.com.br/preco/v2/nacional';

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': `https://${ORIGEM_PERMITIDA}`,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    // Pré-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    // Valida método
    if (request.method !== 'POST') {
      // Permite GET para o webhook do MP (algumas notificações vêm por GET)
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const acao = url.searchParams.get('acao') || url.searchParams.get('topic');
        if (acao === 'mp_webhook' || acao === 'merchant_order' || acao === 'payment') {
          return await handleWebhookGET(url.searchParams, corsHeaders, env);
        }
      }
      return jsonError(corsHeaders, 405, 'Método não permitido');
    }

    // Valida origem
    // Para webhook do MP, a origem é do MP (api.mercadopago.com), não do site.
    // Detecta se é webhook pela presença de body.acao === 'mp_webhook' ou por query string.
    const url = new URL(request.url);
    const isWebhook = url.searchParams.get('acao') === 'mp_webhook' ||
                      url.searchParams.get('topic') ||
                      url.searchParams.get('data.id');
    const origin = request.headers.get('Origin') || '';
    if (!isWebhook && !origin.includes(ORIGEM_PERMITIDA)) {
      return jsonError(corsHeaders, 403, 'Origem não autorizada');
    }

    // Parse do body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      // Se for webhook do MP (POST sem body JSON válido), pode ser form-encoded
      body = {};
    }

    // Detecta webhook do MP (POST com topic/data.id)
    const isWebhookPost = url.searchParams.get('acao') === 'mp_webhook' ||
                          url.searchParams.get('topic') ||
                          url.searchParams.get('data.id') ||
                          body.topic || body.action;
    if (isWebhookPost) {
      return await handleWebhookPOST(url.searchParams, body, corsHeaders, env);
    }

    // Roteamento por ação
    try {
      switch (body.acao) {
        case 'correios':
          return await handleCorreios(body, corsHeaders, env);
        case 'mp_pix':
        case 'mp_cartao':
          return await handleMercadoPago(body, corsHeaders, env);
        case 'mp_process_payment':
          return await handleProcessPayment(body, corsHeaders, env);
        default:
          return jsonError(corsHeaders, 400, 'Ação desconhecida');
      }
    } catch (err) {
      console.error('Worker error:', err);
      return jsonError(corsHeaders, 500, err.message || 'Erro interno');
    }
  }
};

/* ---------- Helpers ---------- */
function jsonError(headers, status, msg) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status, headers,
  });
}
function jsonOk(headers, data) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200, headers,
  });
}

/* ---------- Correios ---------- */
async function handleCorreios(body, headers, env) {
  const { cepOrigem, cepDestino, pacote, servicos } = body;
  const contrato = body.contrato || env.CORREIOS_CONTRATO;
  const cartao = body.cartaoPostagem || env.CORREIOS_CARTAO;

  if (!cepOrigem || !cepDestino || !pacote || !servicos) {
    return jsonError(headers, 400, 'Parâmetros incompletos');
  }
  if (!contrato || !cartao) {
    return jsonError(headers, 500, 'Credenciais dos Correios não configuradas');
  }

  // Auth: Basic com contrato:cartão
  const auth = btoa(`${contrato}:${cartao}`);

  const resultados = [];
  for (const codigo of servicos) {
    const reqBody = {
      idContrato: contrato,
      codObjeto: codigo,
      cepOrigem: cepOrigem.replace(/\D/g, ''),
      cepDestino: cepDestino.replace(/\D/g, ''),
      objetos: [{
        tipoObjeto: '1',
        peso: String(pacote.peso),
        comprimento: String(pacote.comprimento),
        largura: String(pacote.largura),
        altura: String(pacote.altura),
      }],
    };

    const resp = await fetch(CORREIOS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(reqBody),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn(`Correios ${codigo} HTTP ${resp.status}: ${txt}`);
      // Pula serviço que deu erro
      continue;
    }
    const data = await resp.json();
    const r = Array.isArray(data) ? data[0] : data;
    resultados.push({
      codigo,
      nome: r?.descServico || (codigo === '03298' ? 'PAC' : codigo === '03220' ? 'SEDEX' : codigo),
      descricao: r?.descServico || '',
      valor: parseFloat(r?.valor || r?.preco || '0') || 0,
      prazo: parseInt(r?.prazoEntrega || '0', 10) || null,
    });
  }

  return jsonOk(headers, { resultados });
}

/* ---------- Mercado Pago ---------- */
async function handleMercadoPago(body, headers, env) {
  const accessToken = env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return jsonError(headers, 500, 'MP_ACCESS_TOKEN não configurado');
  }

  const { items, frete, total, numero, cliente, back_url } = body;
  if (!items || !items.length) {
    return jsonError(headers, 400, 'Carrinho vazio');
  }

  // Cria a "preference" no Mercado Pago
  // Doc: https://www.mercadopago.com.br/developers/pt/reference/preferences/_checkout_preferences/post
  const preference = {
    items: items.map(i => ({
      id: i.id,
      title: i.title,
      quantity: i.qty || i.quantity,
      unit_price: parseFloat(i.unit_price || i.preco),
      currency_id: 'BRL',
    })),
    // Adiciona o frete como item separado se houver
    ...(frete > 0 ? {
      shipments: [{
        mode: 'custom',
        cost: parseFloat(frete),
        receiver_address: {
          zip_code: cliente?.cep?.replace(/\D/g, '') || '',
          street_name: cliente?.endereco || '',
          city_name: { name: cliente?.cidade || '' },
          state_name: cliente?.uf || '',
        },
      }],
    } : {}),
    back_urls: {
      success: back_url || `https://${ORIGEM_PERMITIDA}/?pedido=${numero}&status=sucesso`,
      pending: back_url || `https://${ORIGEM_PERMITIDA}/?pedido=${numero}&status=pendente`,
      failure: back_url || `https://${ORIGEM_PERMITIDA}/?pedido=${numero}&status=falha`,
    },
    auto_return: 'approved',
    external_reference: numero,
    payment_methods: body.acao === 'mp_cartao' ? {
      // Aceita cartão de crédito (até 12x), débito ePix também
      installments: 12,
      excluded_payment_types: [], // nenhum excluído
    } : {
      // Pix only
      installments: 1,
      default_payment_method_id: 'pix',
      excluded_payment_types: [
        { id: 'credit_card' },
        { id: 'debit_card' },
        { id: 'ticket' },
      ],
    },
  };

  const resp = await fetch(`${MP_API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(preference),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('MP preference error:', resp.status, txt);
    return jsonError(headers, resp.status, `Mercado Pago: ${txt}`);
  }
  const data = await resp.json();

  // Para cartão: retorna init_point (URL de checkout do MP)
  if (body.acao === 'mp_cartao') {
    return jsonOk(headers, {
      init_point: data.init_point,
      preference_id: data.id,
    });
  }

  // Para Pix MP: o usuário precisa criar um pagamento via /v1/payments
  // endpoint com payment_method_id=pix. Retorna os dados do QR Code.
  const pixPayment = {
    transaction_amount: parseFloat(total),
    description: `Pedido ${numero} — Casa dos Botões`,
    payment_method_id: 'pix',
    payer: {
      email: `cliente_${numero}@casadosbotoes.com.br`, // MP exige email
      first_name: (cliente?.nome || 'Cliente').split(' ')[0],
      last_name: (cliente?.nome || '').split(' ').slice(1).join(' ') || 'Cliente',
      identification: {
        type: 'cpf',
        number: cliente?.cpf || '00000000000',
      },
    },
    external_reference: numero,
    notification_url: `https://${ORIGEM_PERMITIDA}/?pedido=${numero}&mp=webhook`,
  };

  const payResp = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(pixPayment),
  });

  if (!payResp.ok) {
    const txt = await payResp.text();
    console.error('MP payment error:', payResp.status, txt);
    return jsonError(headers, payResp.status, `Mercado Pago (payment): ${txt}`);
  }

  const payData = await payResp.json();
  return jsonOk(headers, {
    qr_code: payData.point_of_interaction?.transaction_data?.qr_code || '',
    qr_code_base64: payData.point_of_interaction?.transaction_data?.qr_code_base64 || '',
    ticket_url: payData.point_of_interaction?.transaction_data?.ticket_url || '',
    payment_id: payData.id,
    status: payData.status,
  });
}

/* ============================================================
 * CHECKOUT TRANSPARENTE — Processa pagamento de cartão
 * ============================================================
 * Recebe do navegador:
 *   { acao: 'mp_process_payment',
 *     token, paymentMethodId, installments, issuerId,
 *     transactionAmount, description, externalReference,
 *     payer: { email, firstName, lastName, identificationType, identificationNumber, phone },
 *     items, shippingOption }
 *
 * Cria o pagamento no MP via POST /v1/payments.
 * Retorna: { status, status_detail, payment_id, message }
 */
async function handleProcessPayment(body, headers, env) {
  const accessToken = env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return jsonError(headers, 500, 'MP_ACCESS_TOKEN não configurado no Worker');
  }

  const { token, paymentMethodId, installments, issuerId,
          transactionAmount, description, externalReference,
          payer, items, shippingOption } = body;

  // Validações
  if (!token) return jsonError(headers, 400, 'Token do cartão ausente');
  if (!paymentMethodId) return jsonError(headers, 400, 'paymentMethodId ausente');
  if (!transactionAmount) return jsonError(headers, 400, 'transactionAmount ausente');
  if (!payer || !payer.email) return jsonError(headers, 400, 'E-mail do pagador ausente');
  if (!payer.identificationNumber || !payer.identificationType) {
    return jsonError(headers, 400, 'CPF/CNPJ do pagador ausente');
  }

  // Monta payload para o MP
  // Doc: https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
  const paymentPayload = {
    transaction_amount: parseFloat(transactionAmount),
    token: token,
    description: description || ('Pedido ' + (externalReference || '')),
    installments: parseInt(installments, 10) || 1,
    payment_method_id: paymentMethodId,
    issuer_id: issuerId ? String(issuerId) : undefined,
    payer: {
      email: payer.email,
      first_name: payer.firstName || 'Cliente',
      last_name: payer.lastName || '',
      identification: {
        type: payer.identificationType,    // 'CPF' | 'CNPJ'
        number: String(payer.identificationNumber).replace(/\D/g, ''),
      },
      phone: payer.phone ? {
        area_code: String(payer.phone.areaCode || '16'),
        number: Number(payer.phone.number) || 999999999,
      } : undefined,
    },
    external_reference: externalReference,
    statement_descriptor: 'CASA DOS BOTOES',
    // binary_mode: true → não aceita status pendente (recusa se não puder aprovar na hora)
    // binary_mode: false → aceita pending/in_process (cartão em análise)
    binary_mode: false,
    // URL que o MP vai chamar quando o status mudar (webhook)
    notification_url: `https://${getWorkerHost(env)}/?acao=mp_webhook`,
    metadata: {
      pedido_numero: externalReference,
      items: (items || []).map(i => ({
        id: i.id,
        nome: i.nome,
        qty: i.qty,
        preco: i.preco,
      })),
      shipping: shippingOption ? {
        nome: shippingOption.nome,
        valor: shippingOption.valor,
        retirada: shippingOption.retirada || false,
      } : null,
    },
  };

  // Remove campos undefined
  Object.keys(paymentPayload).forEach(k => paymentPayload[k] === undefined && delete paymentPayload[k]);
  if (paymentPayload.payer) {
    Object.keys(paymentPayload.payer).forEach(k => paymentPayload.payer[k] === undefined && delete paymentPayload.payer[k]);
    if (paymentPayload.payer.phone) {
      Object.keys(paymentPayload.payer.phone).forEach(k => paymentPayload.payer.phone[k] === undefined && delete paymentPayload.payer.phone[k]);
    }
    if (paymentPayload.payer.identification) {
      Object.keys(paymentPayload.payer.identification).forEach(k => paymentPayload.payer.identification[k] === undefined && delete paymentPayload.payer.identification[k]);
    }
  }

  const resp = await fetch(`${MP_API}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Idempotency-Key': externalReference || crypto.randomUUID(),
    },
    body: JSON.stringify(paymentPayload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('MP payment error:', resp.status, txt);
    let errMsg = `Mercado Pago HTTP ${resp.status}`;
    try {
      const errData = JSON.parse(txt);
      if (errData.message) errMsg += ': ' + errData.message;
      if (errData.cause && Array.isArray(errData.cause)) {
        errMsg += ' | ' + errData.cause.map(c => c.description).join('; ');
      }
    } catch (e) {}
    return jsonError(headers, resp.status, errMsg);
  }

  const data = await resp.json();
  return jsonOk(headers, {
    status: data.status,             // 'approved' | 'rejected' | 'in_process' | 'pending' | 'cancelled'
    status_detail: data.status_detail,
    payment_id: data.id,
    message: traduzirStatusInterno(data.status, data.status_detail),
  });
}

/* ---------- Webhook do MP (POST) ---------- */
// MP envia: POST https://.../?acao=mp_webhook
// Body: { action: 'payment.updated', data: { id: '1234567890' }, ... }
async function handleWebhookPOST(query, body, headers, env) {
  // Não bloqueia a resposta ao MP — confirma recebimento rápido.
  // Em background, busca o payment e atualiza o pedido no JSONBin.

  const paymentId = body?.data?.id || query.get('data.id') || query.get('payment_id');
  const topic = body?.topic || query.get('topic') || body?.action || 'payment';

  console.log('[webhook] Recebido:', { topic, paymentId, body });

  if (!paymentId || (topic !== 'payment' && topic !== 'payment.updated')) {
    // Webhook de merchant_order ou outro — apenas confirma
    return jsonOk(headers, { received: true, ignored: topic });
  }

  // Em background (sem await), busca o pagamento e atualiza JSONBin
  // Como Cloudflare Workers não têm "background", fazemos aqui mas rápido.
  try {
    await atualizarPedidoDoPagamento(String(paymentId), env);
  } catch (e) {
    console.warn('[webhook] erro ao atualizar pedido:', e);
  }

  return jsonOk(headers, { received: true, payment_id: paymentId });
}

/* ---------- Webhook do MP (GET — usado em alguns fluxos) ---------- */
async function handleWebhookGET(query, headers, env) {
  const paymentId = query.get('data.id') || query.get('payment_id');
  const topic = query.get('topic') || 'payment';
  console.log('[webhook GET]', { topic, paymentId });
  if (!paymentId) {
    return jsonOk(headers, { received: true, no_payment_id: true });
  }
  try {
    await atualizarPedidoDoPagamento(String(paymentId), env);
  } catch (e) {
    console.warn('[webhook GET] erro:', e);
  }
  return jsonOk(headers, { received: true, payment_id: paymentId });
}

/* ---------- Busca pagamento no MP e atualiza o pedido no JSONBin ---------- */
async function atualizarPedidoDoPagamento(paymentId, env) {
  const accessToken = env.MP_ACCESS_TOKEN;
  if (!accessToken) return;

  const resp = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    console.warn(`[webhook] pagamento ${paymentId} HTTP ${resp.status}`);
    return;
  }
  const payment = await resp.json();
  const numeroPedido = payment.external_reference;
  if (!numeroPedido) {
    console.warn('[webhook] pagamento sem external_reference');
    return;
  }

  console.log(`[webhook] Pagamento ${paymentId} (pedido ${numeroPedido}): ${payment.status} / ${payment.status_detail}`);

  // Atualiza o pedido no JSONBin (se configurado)
  const jsonbinKey = env.JSONBIN_API_KEY;
  const jsonbinBin = env.JSONBIN_BIN_ID;
  if (jsonbinKey && jsonbinBin) {
    try {
      // Lê o bin de pedidos
      const getResp = await fetch(`https://api.jsonbin.io/v3/b/${jsonbinBin}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': jsonbinKey,
          'Cache-Control': 'no-cache',
        },
      });
      if (getResp.ok) {
        const json = await getResp.json();
        const data = json.record || {};
        const pedidos = data.pedidos || [];
        const idx = pedidos.findIndex(p => p && p.numero === numeroPedido);
        if (idx >= 0) {
          pedidos[idx].mpPaymentId = payment.id;
          pedidos[idx].mpStatus = payment.status;
          pedidos[idx].mpStatusDetail = payment.status_detail;
          pedidos[idx].atualizadoEm = new Date().toISOString();
          data.pedidos = pedidos;
          await fetch(`https://api.jsonbin.io/v3/b/${jsonbinBin}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Master-Key': jsonbinKey,
            },
            body: JSON.stringify(data),
          });
          console.log(`[webhook] Pedido ${numeroPedido} atualizado no JSONBin`);
        }
      }
    } catch (e) {
      console.warn('[webhook] erro JSONBin:', e);
    }
  }
}

/* ---------- Tradução interna de status (usada no webhook log) ---------- */
function traduzirStatusInterno(status, detail) {
  const map = {
    approved: 'Pagamento aprovado',
    rejected: 'Pagamento recusado',
    in_process: 'Pagamento em análise',
    pending: 'Pagamento pendente',
    cancelled: 'Pagamento cancelado',
  };
  return map[status] || 'Status desconhecido';
}
