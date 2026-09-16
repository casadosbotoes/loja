/**
 * Casa dos Botões — Checkout (checkout.js)
 * -------------------------------------------------------------
 * Fluxo de checkout em 3 etapas (mostradas num modal único):
 *
 *   1. Identificação + Cálculo de frete (CEP)
 *   2. Seleção de forma de pagamento (Pix / Cartão / WhatsApp)
 *   3. Confirmação + (se Pix) exibição do QR Code
 *
 * Casos de pagamento:
 *   - Pix direto (estático): gera BR Code e QR Code no navegador a
 *     partir da chave Pix da loja (config.pix). Sem taxa, sem MP.
 *
 *   - Pix Mercado Pago (dinâmico): se config.mercadoPago.workerUrl
 *     estiver preenchido, chama o Worker que cria a transação no
 *     MP e retorna o QR Code oficial. Tem taxa do MP.
 *
 *   - Cartão (Mercado Pago Checkout Pro): chama o Worker para criar
 *     uma "preferência" no MP e redireciona o cliente para a página
 *     de checkout do MP, onde ele paga com cartão.
 *
 *   - WhatsApp: monta o resumo do pedido como mensagem e abre o
 *     WhatsApp da loja.
 */

(function (global) {
  'use strict';

  /* ---------- Estado ---------- */
  const state = {
    currentStep: 'shipping',
    shippingOption: null,  // {codigo, nome, valor, prazo}
    shippingResults: [],
    paymentMethod: null,   // 'pix' | 'cartao' | 'whatsapp'
    pedido: null,          // { numero, total, items, cliente, frete }
    pixData: null,         // { brcode, qrUrl } retornado pelo MP ou gerado localmente
  };

  /* ---------- Helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const formatBRL = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ---------- Abrir/Fechar ---------- */
  function open() {
    const modal = $('checkoutModal');
    if (!modal) return;
    // Reseta para etapa 1
    goToStep('shipping');
    state.shippingOption = null;
    state.shippingResults = [];
    state.paymentMethod = null;
    state.pixData = null;
    renderPaymentMethods();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    const modal = $('checkoutModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function goToStep(step) {
    state.currentStep = step;
    document.querySelectorAll('.checkout-step').forEach(el => el.classList.remove('active'));
    const target = $('step-' + step);
    if (target) target.classList.add('active');
  }

  /* ---------- Etapa 1: Cálculo de frete ---------- */
  async function onCalcularFrete() {
    const cepInput = $('ck-cep');
    const status = $('shippingOptions');
    const calcularBtn = $('ck-calcular');

    if (!cepInput || !status) return;
    let cep = cepInput.value.replace(/\D/g, '');
    if (cep.length !== 8) {
      status.innerHTML = '<p class="shipping-empty" style="color:var(--c-erro)">Digite um CEP válido com 8 dígitos.</p>';
      return;
    }

    calcularBtn.disabled = true;
    calcularBtn.textContent = 'Calculando...';
    status.innerHTML = '<p class="shipping-empty">Calculando frete...</p>';

    try {
      // 1. Busca endereço
      const end = await global.CDBShipping.buscarEndereco(cep);
      $('ck-endereco').value = [end.logradouro, end.bairro].filter(Boolean).join(', ');
      $('ck-cidade').value = end.cidade;
      $('ck-uf').value = end.uf;

      // 2. Calcula frete
      const pacote = global.CDBShipping.pacoteDoCarrinho();
      if (!pacote) throw new Error('Carrinho vazio');
      const resultados = await global.CDBShipping.calcularFrete(cep, pacote);

      state.shippingResults = resultados;
      renderShippingOptions(resultados);
    } catch (err) {
      console.error('[checkout] erro frete:', err);
      status.innerHTML = `
        <div class="shipping-empty">
          <p style="color:var(--c-erro);margin-bottom:8px">Não foi possível calcular o frete automaticamente.</p>
          <p style="font-size:0.82rem">Tente novamente ou chame a gente no WhatsApp para confirmar o valor do frete.</p>
        </div>`;
    } finally {
      calcularBtn.disabled = false;
      calcularBtn.textContent = 'Calcular frete';
    }
  }

  function renderShippingOptions(resultados) {
    const cont = $('shippingOptions');
    if (!resultados || resultados.length === 0) {
      cont.innerHTML = '<p class="shipping-empty">Nenhum serviço disponível para o CEP informado. Tente novamente.</p>';
      return;
    }
    // Se a primeira opção for retirada, mostra destaque
    const temRetirada = resultados.some(r => r.retirada);
    const regiaoTxt = resultados.find(r => !r.retirada)?.regiao;
    const regiao = regiaoTxt ? `<p class="shipping-regiao">📍 Região de destino: <strong>${escapeHTML(regiaoTxt)}</strong></p>` : '';
    const aviso = !temRetirada
      ? '<p class="shipping-aviso">Frete estimado por região. O valor final é confirmado no WhatsApp após o pagamento.</p>'
      : '<p class="shipping-aviso shipping-aviso-retirada">🏠 Tem opção de <strong>retirar no local em Ribeirão Preto</strong> (grátis) ou receber em casa via Correios.</p>';

    cont.innerHTML = regiao + aviso + resultados.map((r, i) => {
      const prazoTxt = r.prazo ? ' · ' + r.prazo + ' dias úteis' : (r.retirada ? ' · combinar' : '');
      const desc = r.descricao ? escapeHTML(r.descricao) : '';
      const icon = r.retirada ? '🏠 ' : '';
      return `
      <label class="shipping-option ${i === 0 ? 'selected' : ''} ${r.retirada ? 'shipping-option-retirada' : ''}" data-codigo="${r.codigo}">
        <input type="radio" name="frete" value="${r.codigo}" ${i === 0 ? 'checked' : ''} hidden>
        <div class="shipping-option-info">
          <span class="shipping-option-name">${icon}${escapeHTML(r.nome)}${prazoTxt}</span>
          ${desc ? `<span class="shipping-option-desc">${desc}</span>` : ''}
        </div>
        <span class="shipping-option-price">${r.valor === 0 ? 'Grátis' : formatBRL(r.valor)}</span>
      </label>`;
    }).join('');

    // Handlers
    cont.querySelectorAll('.shipping-option').forEach(el => {
      el.addEventListener('click', () => {
        cont.querySelectorAll('.shipping-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        const codigo = el.dataset.codigo;
        state.shippingOption = state.shippingResults.find(r => r.codigo === codigo);
        updateTotals();
      });
    });

    // Seleciona primeiro por padrão
    state.shippingOption = resultados[0];
    updateTotals();
  }

  function updateTotals() {
    const totals = $('checkoutTotals');
    if (!totals) return;
    const subtotal = global.CDBCart && global.CDBCart.subtotal() || 0;
    const cfg = global.CDB_CONFIG || {};
    let freteValor = state.shippingOption ? state.shippingOption.valor : 0;

    // Frete grátis acima do mínimo
    if (cfg.freteGratis && cfg.freteGratis.ativo && subtotal >= cfg.freteGratis.valorMinimo) {
      freteValor = 0;
    }

    const total = subtotal + freteValor;
    $('ck-subtotal').textContent = formatBRL(subtotal);
    $('ck-frete').textContent = freteValor === 0 ? 'Grátis' : formatBRL(freteValor);
    $('ck-total').textContent = formatBRL(total);
    totals.hidden = false;

    // Habilita botão continuar
    const goBtn = $('goToPayment');
    if (goBtn) goBtn.disabled = !state.shippingOption;
  }

  /* ---------- Etapa 2: Pagamento ---------- */
  function renderPaymentMethods() {
    const cont = $('paymentMethods');
    if (!cont) return;
    const metodos = global.CDB_CONFIG?.checkout?.metodos || ['pix', 'cartao', 'whatsapp'];
    const mpCfg = global.CDB_CONFIG?.mercadoPago || {};
    const mpDisponivel = (mpCfg.accessToken && mpCfg.accessToken.length > 20) || (mpCfg.workerUrl && mpCfg.workerUrl.length > 0);

    const cards = [];
    for (const m of metodos) {
      if (m === 'pix') {
        cards.push({ id: 'pix', nome: 'Pix', desc: 'QR Code na hora, 100% seguro' });
      } else if (m === 'cartao' && mpDisponivel) {
        cards.push({ id: 'cartao', nome: 'Cartão', desc: 'Crédito/Débito via Mercado Pago — até 12x' });
      } else if (m === 'cartao' && !mpDisponivel) {
        // sem worker MP, cartão fica oculto
        continue;
      } else if (m === 'pix-mp' && mpDisponivel) {
        cards.push({ id: 'pix-mp', nome: 'Pix Mercado Pago', desc: 'Protegido pelo MP' });
      } else if (m === 'whatsapp') {
        cards.push({ id: 'whatsapp', nome: 'WhatsApp', desc: 'Confirma o pedido no chat' });
      }
    }
    if (cards.length === 0) {
      cont.innerHTML = '<p>Nenhuma forma de pagamento configurada.</p>';
      return;
    }
    cont.innerHTML = cards.map((c, i) => `
      <button type="button" class="payment-method ${i === 0 ? 'selected' : ''}" data-metodo="${c.id}">
        <strong>${escapeHTML(c.nome)}</strong>
        <span>${escapeHTML(c.desc)}</span>
      </button>
    `).join('');

    // Handler
    cont.querySelectorAll('.payment-method').forEach(el => {
      el.addEventListener('click', () => {
        cont.querySelectorAll('.payment-method').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        state.paymentMethod = el.dataset.metodo;
        renderPaymentContent();
      });
    });
    state.paymentMethod = cards[0].id;
    renderPaymentContent();
  }

  function renderPaymentContent() {
    const cont = $('paymentContent');
    const confirmBtn = $('confirmOrder');
    if (!cont) return;
    if (state.paymentMethod === 'pix') {
      cont.innerHTML = `
        <p><strong>Pix direto (sem taxa, sem intermediário):</strong> ao confirmar, geraremos um QR Code Pix no valor total do pedido. Você paga no app do seu banco e envia o comprovante no WhatsApp.</p>
        <span class="hint">Pagamento confirmado em até 24h em dias úteis.</span>`;
      confirmBtn.textContent = 'Confirmar e gerar QR Code';
      confirmBtn.disabled = false;
    } else if (state.paymentMethod === 'pix-mp' || state.paymentMethod === 'cartao') {
      const tipo = state.paymentMethod === 'cartao' ? 'cartão' : 'Pix';
      cont.innerHTML = `
        <p><strong>${escapeHTML(tipo)} via Mercado Pago:</strong> ao confirmar, você será redirecionado para a página oficial do Mercado Pago, onde o pagamento é processado de forma segura.</p>
        <span class="hint">Compra protegida pelo Mercado Pago.</span>`;
      confirmBtn.textContent = 'Confirmar e ir para o Mercado Pago';
      confirmBtn.disabled = false;
    } else if (state.paymentMethod === 'whatsapp') {
      cont.innerHTML = `
        <p><strong>Pedido via WhatsApp:</strong> ao confirmar, abriremos o WhatsApp com o resumo do pedido pré-preenchido. Nossa equipe finaliza com você o pagamento (Pix ou cartão) e a confirmação.</p>
        <span class="hint">Resposta em até 30 minutos em horário comercial.</span>`;
      confirmBtn.textContent = 'Confirmar e abrir WhatsApp';
      confirmBtn.disabled = false;
    }
  }

  /* ---------- Etapa 3: Confirmação ---------- */
  async function onConfirmOrder() {
    const confirmBtn = $('confirmOrder');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processando...';

    try {
      // Cria o número do pedido (timestamp + aleatório)
      const numero = gerarNumeroPedido();
      const subtotal = global.CDBCart.subtotal();
      let freteValor = state.shippingOption ? state.shippingOption.valor : 0;
      const cfg = global.CDB_CONFIG || {};
      if (cfg.freteGratis?.ativo && subtotal >= cfg.freteGratis.valorMinimo) freteValor = 0;
      const total = subtotal + freteValor;

      const items = global.CDBCart.getItems();
      const cliente = {
        nome: $('ck-nome').value.trim(),
        telefone: $('ck-telefone').value.trim(),
        cep: $('ck-cep').value.trim(),
        endereco: $('ck-endereco').value.trim(),
        cidade: $('ck-cidade').value.trim(),
        uf: $('ck-uf').value.trim(),
      };

      if (!cliente.nome || !cliente.telefone) {
        throw new Error('Preencha nome e telefone.');
      }

      state.pedido = {
        numero, subtotal, frete: freteValor, total, items, cliente,
        shippingOption: state.shippingOption,
        dataHora: new Date(),
      };

      // Sempre gera e baixa o .txt do pedido para o cliente ter uma
      // cópia organizada e poder anexar no WhatsApp.
      // O lojista recebe os mesmos dados via WhatsApp (em texto).
      try {
        if (global.CDBOrderTxt) {
          global.CDBOrderTxt.baixarTxtPedido(state.pedido, {
            paymentMethod: state.paymentMethod,
            status: 'AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO',
          });
          global.CDBCart?.showToast('Arquivo .txt do pedido baixado. Anexe no WhatsApp!');
        }
      } catch (e) {
        console.warn('[checkout] erro ao gerar .txt:', e);
      }

      // Envia o pedido por e-mail para o lojista (Web3Forms)
      // Não bloqueia o fluxo se falhar — o WhatsApp ainda funciona.
      if (global.CDBEmail) {
        global.CDBEmail.enviarPedido(state.pedido, {
          paymentMethod: state.paymentMethod,
        }).then(result => {
          if (result.success) {
            console.log('[checkout] E-mail enviado ao lojista');
          } else if (result.reason !== 'desativado') {
            console.warn('[checkout] Falha no e-mail:', result.error);
          }
        }).catch(err => console.warn('[checkout] Erro e-mail:', err));
      }

      // Salva o pedido no histórico (localStorage) para a página pedidos.html
      // Também guarda o .txt completo para re-download
      try {
        if (global.CDBOrders) {
          const pedidoComTxt = Object.assign({}, state.pedido, {
            rawTxt: global.CDBOrderTxt
              ? global.CDBOrderTxt.gerarTxtPedido(state.pedido, { paymentMethod: state.paymentMethod })
              : '',
          });
          const salvou = global.CDBOrders.adicionar(pedidoComTxt);
          if (salvou) {
            console.log('[checkout] ✓ Pedido salvo no histórico:', state.pedido.numero);
          }
        }
      } catch (e) {
        console.warn('[checkout] erro ao salvar no histórico:', e);
      }

      // Caminho por método de pagamento
      if (state.paymentMethod === 'pix') {
        // Gera QR Code Pix localmente (sem MP)
        await gerarPixLocal(numero, total);
      } else if (state.paymentMethod === 'pix-mp' || state.paymentMethod === 'cartao') {
        // Chama o Cloudflare Worker que cria a preferência no MP
        await criarPreferenciaMP();
        return; // redireciona o navegador, não mostra step 3
      } else if (state.paymentMethod === 'whatsapp') {
        // Abre WhatsApp com resumo do pedido
        abrirWhatsappComPedido();
        return;
      }

      // Caso tenha gerado Pix local, vai para step 3
      goToStep('confirm');
    } catch (err) {
      console.error('[checkout] erro confirmação:', err);
      alert(err.message || 'Erro ao processar o pedido. Tente novamente.');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar pedido';
    }
  }

  function gerarNumeroPedido() {
    const ts = Date.now().toString().slice(-8);
    const rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `CDB${ts}${rand}`;
  }

  /* ---------- Pix local (sem MP) ---------- */
  async function gerarPixLocal(numeroPedido, valor) {
    const pix = global.CDB_CONFIG.pix || {};
    const brCode = global.CDBPix.gerarBRCode({
      chave: pix.chave,
      tipoChave: pix.tipoChave,
      nomeRecebedor: pix.nomeRecebedor,
      cidadeRecebedor: pix.cidadeRecebedor,
      valor: valor,
      identificador: numeroPedido.slice(0, 25),
      descricao: 'PEDIDO ' + numeroPedido,
    });
    const qrUrl = global.CDBPix.gerarQRCodeDataURL(brCode, 240);
    state.pixData = { brcode: brCode, qrUrl: qrUrl, valor: valor };

    // Render step 3 com QR Code
    const msg = `Pedido <strong>${escapeHTML(numeroPedido)}</strong> no valor de <strong>${formatBRL(valor)}</strong> criado! Escaneie o QR Code abaixo com o app do seu banco para pagar via Pix.`;
    $('confirmMsg').innerHTML = msg +
      `<p style="font-size:0.88rem;color:var(--c-texto-claro);margin-top:8px"> 📄 O arquivo <strong>pedido-${escapeHTML(numeroPedido)}.txt</strong> com todos os seus dados foi baixado automaticamente. Anexe no WhatsApp para agilizar a confirmação.</p>`;
    const qrArea = $('pixQrArea');
    qrArea.innerHTML = `
      <div class="pix-qr">
        ${qrUrl ? `<img src="${qrUrl}" alt="QR Code Pix" width="240" height="240">` : '<p>QR Code indisponível</p>'}
        <span class="pix-code" id="pixCodeText">${escapeHTML(brCode)}</span>
        <button class="pix-copy-btn" id="copyPixBtn" type="button">Copiar código Pix</button>
      </div>
      <button class="btn btn-outline btn-block" id="baixarTxtBtn" type="button" style="margin-top:12px">📄 Baixar pedido .txt novamente</button>`;

    // Botão copiar
    const copyBtn = $('copyPixBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(brCode).then(() => {
        copyBtn.textContent = 'Código copiado!';
        setTimeout(() => copyBtn.textContent = 'Copiar código Pix', 2000);
      }).catch(() => {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = brCode;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.textContent = 'Código copiado!';
        setTimeout(() => copyBtn.textContent = 'Copiar código Pix', 2000);
      });
    });

    // Botão de re-baixar o .txt
    const baixarBtn = $('baixarTxtBtn');
    if (baixarBtn) baixarBtn.addEventListener('click', () => {
      if (global.CDBOrderTxt && state.pedido) {
        global.CDBOrderTxt.baixarTxtPedido(state.pedido, {
          paymentMethod: state.paymentMethod,
          status: 'AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO',
        });
      }
    });

    // Configura o botão de WhatsApp com o comprovante
    const sendBtn = $('sendOrderWhatsapp');
    if (sendBtn) {
      sendBtn.href = montarLinkWhatsapp();
    }
  }

  /* ---------- Mercado Pago ---------- */
  async function criarPreferenciaMP() {
    if (!global.CDBMercadoPago) {
      throw new Error('Módulo Mercado Pago não carregou.');
    }

    // Cria a preferência (direto do front ou via Worker)
    const result = await global.CDBMercadoPago.criarPreferencia(state.pedido, {
      paymentMethod: state.paymentMethod,
    });

    if (state.paymentMethod === 'cartao' && result.init_point) {
      // Redireciona para o Checkout Pro do MP
      console.log('[checkout] Redirecionando para MP:', result.init_point);
      // Mostra feedback antes de redirecionar
      const confirmBtn = $('confirmOrder');
      if (confirmBtn) {
        confirmBtn.textContent = 'Redirecionando...';
        confirmBtn.disabled = true;
      }
      // Salva o pedido no histórico antes de sair
      try {
        if (global.CDBOrders && state.pedido) {
          const pedidoComTxt = Object.assign({}, state.pedido, {
            rawTxt: global.CDBOrderTxt
              ? global.CDBOrderTxt.gerarTxtPedido(state.pedido, { paymentMethod: state.paymentMethod })
              : '',
            mpPreferenceId: result.preference_id,
          });
          global.CDBOrders.adicionar(pedidoComTxt);
        }
      } catch (e) { console.warn('[checkout] erro ao salvar:', e); }

      // Pequeno delay para o usuário ver a mensagem
      setTimeout(() => {
        window.location.href = result.init_point;
      }, 800);
      return;
    }
    throw new Error('Resposta do MP inválida: init_point ausente');
  }

  /* ---------- WhatsApp ---------- */
  function montarLinkWhatsapp() {
    const cfg = global.CDB_CONFIG || {};
    const numero = (cfg.whatsapp?.numero || '').replace(/\D/g, '');
    if (!numero) return '#';

    let msg = '';
    if (state.pedido && global.CDBOrderTxt) {
      // Usa o resumo organizado do módulo order-txt.js
      msg = global.CDBOrderTxt.gerarResumoWhatsapp(state.pedido, {
        paymentMethod: state.paymentMethod,
      });
    } else if (state.pedido) {
      // Fallback: resumo simples se o módulo não carregou
      msg = `Olá! Pedido ${state.pedido.numero} no valor de ${formatBRL(state.pedido.total)}.`;
    } else {
      msg = cfg.whatsapp?.mensagemPadrao || 'Olá! Tenho interesse em produtos da Casa dos Botões.';
    }

    return `https://wa.me/${numero}?text=${encodeURIComponent(msg)}`;
  }

  function abrirWhatsappComPedido() {
    const url = montarLinkWhatsapp();
    window.open(url, '_blank');
    goToStep('confirm');
    $('confirmMsg').innerHTML = `Pedido <strong>${escapeHTML(state.pedido.numero)}</strong> registrado! Abra o WhatsApp para confirmar com a nossa equipe.` +
      `<p style="font-size:0.88rem;color:var(--c-texto-claro);margin-top:8px"> 📄 O arquivo <strong>pedido-${escapeHTML(state.pedido.numero)}.txt</strong> foi baixado. Anexe no WhatsApp para agilizar.</p>`;
    $('pixQrArea').innerHTML = `
      <a class="btn btn-whatsapp btn-block" href="${url}" target="_blank">Abrir WhatsApp novamente</a>
      <button class="btn btn-outline btn-block" id="baixarTxtBtn2" type="button" style="margin-top:12px">📄 Baixar pedido .txt novamente</button>`;
    const sendBtn = $('sendOrderWhatsapp');
    if (sendBtn) sendBtn.href = url;
    const baixarBtn = $('baixarTxtBtn2');
    if (baixarBtn) baixarBtn.addEventListener('click', () => {
      if (global.CDBOrderTxt && state.pedido) {
        global.CDBOrderTxt.baixarTxtPedido(state.pedido, {
          paymentMethod: state.paymentMethod,
          status: 'AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO',
        });
      }
    });
  }

  /* ---------- Init ---------- */
  function init() {
    // Botões principais
    $('closeCheckout')?.addEventListener('click', close);
    $('backToShipping')?.addEventListener('click', () => goToStep('shipping'));
    $('goToPayment')?.addEventListener('click', () => {
      if (!state.shippingOption) {
        alert('Calcule o frete antes de continuar.');
        return;
      }
      // Valida nome e telefone
      const nome = $('ck-nome').value.trim();
      const tel = $('ck-telefone').value.trim();
      if (!nome || !tel) {
        alert('Preencha nome e telefone para continuar.');
        return;
      }
      goToStep('payment');
    });
    $('ck-calcular')?.addEventListener('click', onCalcularFrete);
    $('ck-cep')?.addEventListener('input', (e) => {
      // formata CEP: 00000-000
      let v = e.target.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
      e.target.value = v;
    });
    $('ck-cep')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onCalcularFrete(); }
    });
    $('confirmOrder')?.addEventListener('click', onConfirmOrder);
    $('closeAfterConfirm')?.addEventListener('click', () => {
      // Limpa carrinho e fecha
      global.CDBCart?.clear();
      close();
    });

    // Recebe evento "open checkout" do cart.js
    global.addEventListener('cdb:open-checkout', open);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CDBCheckout = { open, close, state };
})(window);
