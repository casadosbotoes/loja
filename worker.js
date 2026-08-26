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
 *      MP_ACCESS_TOKEN   = <seu access token do MP>           (só se for usar cartão/Pix MP)
 *      CORREIOS_CONTRATO = <seu contrato dos Correios>         (OPCIONAL — só se tiver contrato)
 *      CORREIOS_CARTAO   = <seu cartão de postagem dos Correios> (OPCIONAL — só se tiver contrato)
 *   Marque como "Secret" (não ficam visíveis depois de salvas)
 *   → Sem contrato, o Worker usa a API pública (PAC 04510 / SEDEX 04014)
 *   → Com contrato, usa serviços com desconto (PAC 03298 / SEDEX 03220)
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
      return jsonError(corsHeaders, 405, 'Método não permitido');
    }

    // Valida origem
    const origin = request.headers.get('Origin') || '';
    if (!origin.includes(ORIGEM_PERMITIDA)) {
      return jsonError(corsHeaders, 403, 'Origem não autorizada');
    }

    // Parse do body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonError(corsHeaders, 400, 'JSON inválido');
    }

    // Roteamento por ação
    try {
      switch (body.acao) {
        case 'correios':
          return await handleCorreios(body, corsHeaders, env);
        case 'mp_pix':
        case 'mp_cartao':
          return await handleMercadoPago(body, corsHeaders, env);
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
// Modos de operação:
//   1. COM contrato: usa credenciais (CORREIOS_CONTRATO + CORREIOS_CARTAO)
//      e serviços com contrato (03298 PAC, 03220 SEDEX) — preços com desconto.
//   2. SEM contrato: chama a API pública sem auth, usando serviços
//      sem contrato (04510 PAC, 04014 SEDEX) — preços de balcão.
//      O campo "contrato" pode vir vazio do front-end (config.js) ou
//      das variáveis de ambiente do Worker.
async function handleCorreios(body, headers, env) {
  const { cepOrigem, cepDestino, pacote, servicos } = body;
  const contrato = body.contrato || env.CORREIOS_CONTRATO || '';
  const cartao = body.cartaoPostagem || env.CORREIOS_CARTAO || '';

  if (!cepOrigem || !cepDestino || !pacote || !servicos) {
    return jsonError(headers, 400, 'Parâmetros incompletos');
  }

  const temContrato = contrato && cartao;
  const authHeader = temContrato
    ? { 'Authorization': `Basic ${btoa(`${contrato}:${cartao}`)}` }
    : {}; // sem contrato: API pública, sem header de auth

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
        ...authHeader,
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
    const nomeMap = { '04510': 'PAC', '04014': 'SEDEX', '03298': 'PAC', '03220': 'SEDEX' };
    resultados.push({
      codigo,
      nome: r?.descServico || nomeMap[codigo] || codigo,
      descricao: r?.descServico || '',
      valor: parseFloat(r?.valor || r?.preco || '0') || 0,
      prazo: parseInt(r?.prazoEntrega || '0', 10) || null,
    });
  }

  if (resultados.length === 0) {
    return jsonError(headers, 502, 'Correios não retornou nenhum serviço válido (verifique CEPs e códigos de serviço).');
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
