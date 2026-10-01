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
    // Checkout transparente (cartão no site):
    cardData: null,        // { cardNumber, cardExpirationMonth, cardExpirationYear, securityCode, cardholderName, identificationType, identificationNumber }
    installments: [],      // [{ installments, installmentAmount, label, ... }]
    selectedInstallment: null, // { installments, installmentAmount, ... }
    paymentMethodId: null, // 'visa' | 'master' | 'elo' | 'amex' | 'hipercard' detectado do BIN
    issuerId: null,        // banco emissor (opcional)
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
    state.cardData = null;
    state.installments = [];
    state.selectedInstallment = null;
    state.paymentMethodId = null;
    state.issuerId = null;
    state.pedido = null;
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
      $('ck-endereco').value = end.logradouro || '';
      $('ck-bairro').value = end.bairro || '';
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
    const cfgRetirada = global.CDB_CONFIG?.retirada;
    const endRet = cfgRetirada?.endereco;
    const mapQuery = endRet?.mapQuery || `${endRet?.rua}, ${endRet?.cidade}, ${endRet?.uf}, ${endRet?.cep}`;
    const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`;
    const comoChegarUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapQuery)}`;
    const fotoFachada = endRet?.fotoFachada;

    const aviso = !temRetirada
      ? '<p class="shipping-aviso">Frete estimado por região. O valor final é confirmado no WhatsApp após o pagamento.</p>'
      : `<p class="shipping-aviso shipping-aviso-retirada">🏠 Tem opção de <strong>retirar no local em Ribeirão Preto</strong> (grátis) ou receber em casa via Correios.</p>${endRet ? `<div class="retirada-card">
        <div class="retirada-info">
          <div class="retirada-endereco">
            <strong>📍 Endereço de retirada:</strong><br>
            ${escapeHTML(endRet.rua || '')}<br>
            ${escapeHTML(endRet.bairro || '')} — ${escapeHTML(endRet.cidade || '')}/${escapeHTML(endRet.uf || '')}<br>
            CEP: ${escapeHTML(endRet.cep || '')}<br>
            <small>⏰ ${escapeHTML(endRet.horario || 'Seg-Sex 9h às 18h')}</small>
          </div>
          ${fotoFachada ? `<div class="retirada-fachada"><img src="images/${fotoFachada}" alt="Fachada do prédio" loading="lazy"></div>` : ''}
          <div class="retirada-mapa">
            <iframe src="${mapUrl}" width="100%" height="200" style="border:0;border-radius:6px;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa de retirada"></iframe>
          </div>
          <div class="retirada-acoes">
            <a href="${comoChegarUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-small">📐 Como chegar</a>
            ${endRet.referencia ? `<span class="retirada-ref">📌 ${escapeHTML(endRet.referencia)}</span>` : ''}
          </div>
          ${endRet.estacionamento ? `
          <details class="retirada-estacionamento">
            <summary>🅿️ Estacionamento</summary>
            <p>${escapeHTML(endRet.estacionamento.texto || '')}</p>
            ${endRet.estacionamento.locais && endRet.estacionamento.locais.length ? `
              <ul>${endRet.estacionamento.locais.map(l => `<li><strong>${escapeHTML(l.nome)}</strong> — ${escapeHTML(l.distancia)}</li>`).join('')}</ul>
            ` : ''}
          </details>` : ''}
        </div>
      </div>` : ''}`;

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
    const transparenteAtivo = !!(mpCfg.workerUrl && mpCfg.workerUrl.length > 0);

    const cards = [];
    for (const m of metodos) {
      if (m === 'pix') {
        cards.push({ id: 'pix', nome: 'Pix', desc: 'QR Code na hora, 100% seguro' });
      } else if (m === 'cartao' && mpDisponivel) {
        const desc = transparenteAtivo
          ? 'Pague no próprio site com cartão de crédito — até ' + (mpCfg.maxParcelas || 12) + 'x'
          : 'Crédito/Débito via Mercado Pago — até 12x';
        cards.push({ id: 'cartao', nome: 'Cartão', desc });
      } else if (m === 'cartao' && !mpDisponivel) {
        continue; // sem MP, cartão fica oculto
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
    } else if (state.paymentMethod === 'cartao') {
      const mpCfg = global.CDB_CONFIG?.mercadoPago || {};
      const transparente = !!(mpCfg.workerUrl && mpCfg.workerUrl.length > 0);
      if (transparente) {
        cont.innerHTML = renderCardForm();
        confirmBtn.textContent = 'Pagar com cartão';
        confirmBtn.disabled = false;
        initCardFormHandlers();
      } else {
        cont.innerHTML = `
          <p><strong>Cartão via Mercado Pago Checkout Pro:</strong> ao confirmar, você será redirecionado para a página oficial do Mercado Pago, onde o pagamento é processado de forma segura.</p>
          <span class="hint">Compra protegida pelo Mercado Pago.</span>`;
        confirmBtn.textContent = 'Confirmar e ir para o Mercado Pago';
        confirmBtn.disabled = false;
      }
    } else if (state.paymentMethod === 'pix-mp') {
      cont.innerHTML = `
        <p><strong>Pix via Mercado Pago:</strong> ao confirmar, geraremos um QR Code Pix dinâmico pelo MP. Protegido pelo Mercado Pago.</p>
        <span class="hint">Compra protegida pelo Mercado Pago.</span>`;
      confirmBtn.textContent = 'Confirmar e gerar Pix MP';
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
        numero: $('ck-numero').value.trim(),
        complemento: $('ck-complemento').value.trim(),
        bairro: $('ck-bairro').value.trim(),
        referencia: $('ck-referencia').value.trim(),
        cidade: $('ck-cidade').value.trim(),
        uf: $('ck-uf').value.trim(),
      };

      if (!cliente.nome || !cliente.telefone) {
        throw new Error('Preencha nome e telefone.');
      }
      // Valida número do endereço (a menos que seja retirada no local)
      const isRetirada = state.shippingOption?.retirada;
      if (!isRetirada && !cliente.numero) {
        throw new Error('Por favor, preencha o NÚMERO do endereço para entrega.');
      }
      // Valida e-mail e CPF/CNPJ para pagamento com CARTÃO (Mercado Pago exige)
      if (state.paymentMethod === 'cartao') {
        const email = $('ck-email')?.value.trim() || '';
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error('Para pagar com cartão, preencha um e-mail válido.');
        }
        const doc = ($('ck-cpf')?.value || '').replace(/\D/g, '');
        if (doc.length !== 11 && doc.length !== 14) {
          throw new Error('Para pagar com cartão, preencha um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
        }
        // Adiciona e-mail e CPF ao cliente para uso pelo Mercado Pago
        cliente.email = email;
        cliente.cpf = doc;
      }

      // Valida estoque de TODOS os itens antes de confirmar
      if (global.CDBEstoque) {
        const validacao = global.CDBEstoque.validarPedido(items);
        if (!validacao.valido) {
          throw new Error('Estoque insuficiente:\n\n' + validacao.erros.join('\n'));
        }
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
            console.log('[checkout] ✓ Pedido salvo no histórico local:', state.pedido.numero);
          }
        }
      } catch (e) {
        console.warn('[checkout] erro ao salvar no histórico local:', e);
      }

      // Salva o pedido na NUVEM (JSONBin.io) — aparece em TODOS os aparelhos
      try {
        if (global.CDBSync && global.CDBSync.isAtivo()) {
          const pedidoSync = Object.assign({}, state.pedido, {
            rawTxt: global.CDBOrderTxt
              ? global.CDBOrderTxt.gerarTxtPedido(state.pedido, { paymentMethod: state.paymentMethod })
              : '',
          });
          global.CDBSync.adicionarPedido(pedidoSync).then(result => {
            if (result.success) {
              console.log('[checkout] ✓ Pedido sincronizado na nuvem');
              // Se criou um bin novo, avisa o usuário para pegar o bin_id
              if (result.binId && !global.CDB_CONFIG?.sincronizacao?.binId) {
                console.log('═══════════════════════════════════════════════════');
                console.log('🎯 BIN ID CRIADO! Copie este ID e cole em config.js:');
                console.log('   binId: "' + result.binId + '"');
                console.log('═══════════════════════════════════════════════════');
              }
            } else if (result.reason !== 'desativado') {
              console.warn('[checkout] Falha na sincronização:', result.error);
            }
          }).catch(err => console.warn('[checkout] Erro sync:', err));
        }
      } catch (e) {
        console.warn('[checkout] erro ao sincronizar:', e);
      }

      // DECREMENTA ESTOQUE — após pedido confirmado, reduz do estoque
      // Sincronizado na nuvem (todos os aparelhos veem o estoque atualizado)
      try {
        if (global.CDBEstoque) {
          global.CDBEstoque.decrementarPedido(state.pedido.items);
          console.log('[checkout] ✓ Estoque decrementado');
          // Dispara evento para UI atualizar
          global.dispatchEvent(new CustomEvent('cdb:estoque-atualizado'));
        }
      } catch (e) {
        console.warn('[checkout] erro ao decrementar estoque:', e);
      }

      // Caminho por método de pagamento
      if (state.paymentMethod === 'pix') {
        // Gera QR Code Pix localmente (sem MP)
        await gerarPixLocal(numero, total);
      } else if (state.paymentMethod === 'cartao') {
        const mpCfg = global.CDB_CONFIG?.mercadoPago || {};
        const transparente = !!(mpCfg.workerUrl && mpCfg.workerUrl.length > 0);
        if (transparente) {
          // Checkout transparente: processa o pagamento via Worker
          await processarPagamentoCartao();
          return; // já mostra tela de confirmação
        } else {
          // Fallback: Checkout Pro (redireciona)
          await criarPreferenciaMP();
          return;
        }
      } else if (state.paymentMethod === 'pix-mp') {
        // Pix MP dinâmico (via Worker) — cria preferência/pagamento
        await criarPixMP();
        return;
      } else if (state.paymentMethod === 'whatsapp') {
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

  /* ============================================================
   * CHECKOUT TRANSPARENTE — Cartão no próprio site
   * ============================================================ */

  /* ---------- Renderiza o form de cartão ---------- */
  function renderCardForm() {
    return `
      <div class="card-form">
        <p class="card-form-info">
          🔒 <strong>Pagamento seguro via Mercado Pago.</strong> Seus dados de cartão são
          tokenizados no próprio navegador e nunca passam pelo nosso servidor.
        </p>

        <div class="form-row">
          <div class="form-group form-group-card-num">
            <label for="ck-card-number">Número do cartão *</label>
            <div class="card-input-wrapper">
              <input type="text" id="ck-card-number" placeholder="0000 0000 0000 0000"
                     inputmode="numeric" autocomplete="cc-number" maxlength="23">
              <span class="card-brand-badge" id="ck-card-brand"></span>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="ck-card-name">Nome impresso no cartão *</label>
            <input type="text" id="ck-card-name" placeholder="Como está no cartão"
                   autocomplete="cc-name" style="text-transform:uppercase">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group form-group-small">
            <label for="ck-card-expiry">Validade *</label>
            <input type="text" id="ck-card-expiry" placeholder="MM/AA"
                   inputmode="numeric" autocomplete="cc-exp" maxlength="5">
          </div>
          <div class="form-group form-group-small">
            <label for="ck-card-cvv">CVV *</label>
            <input type="text" id="ck-card-cvv" placeholder="123"
                   inputmode="numeric" autocomplete="cc-csc" maxlength="4">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="ck-card-installments">Parcelas *</label>
            <select id="ck-card-installments" disabled>
              <option value="">Digite o número do cartão</option>
            </select>
          </div>
        </div>

        <div class="card-form-summary" id="cardFormSummary"></div>
      </div>
    `;
  }

  /* ---------- Handlers do form de cartão ---------- */
  function initCardFormHandlers() {
    const cardNumber = $('ck-card-number');
    const cardName = $('ck-card-name');
    const cardExpiry = $('ck-card-expiry');
    const cardCvv = $('ck-card-cvv');
    const installmentsSel = $('ck-card-installments');
    const summary = $('cardFormSummary');

    if (!cardNumber) return;

    // Formata número do cartão: 0000 0000 0000 0000
    cardNumber.addEventListener('input', async (e) => {
      let v = e.target.value.replace(/\D/g, '').slice(0, 19);
      v = v.replace(/(.{4})/g, '$1 ').trim();
      e.target.value = v;

      // Detecta bandeira quando tiver 6+ dígitos
      const digits = v.replace(/\s/g, '');
      const brandEl = $('ck-card-brand');
      if (digits.length >= 6) {
        const brand = detectarBandeira(digits);
        if (brandEl) {
          brandEl.textContent = brand ? brand.toUpperCase() : '';
          brandEl.className = 'card-brand-badge' + (brand ? ' brand-' + brand : '');
        }
        state.paymentMethodId = brand;
        // Busca parcelas via SDK do MP
        await buscarEAtualizarParcelas(digits);
      } else {
        if (brandEl) {
          brandEl.textContent = '';
          brandEl.className = 'card-brand-badge';
        }
        state.paymentMethodId = null;
        state.installments = [];
        state.selectedInstallment = null;
        if (installmentsSel) {
          installmentsSel.innerHTML = '<option value="">Digite o número do cartão</option>';
          installmentsSel.disabled = true;
        }
      }
    });

    // Nome em maiúsculas
    if (cardName) {
      cardName.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
      });
    }

    // Validade MM/AA
    if (cardExpiry) {
      cardExpiry.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').slice(0, 4);
        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
        e.target.value = v;
      });
    }

    // CVV
    if (cardCvv) {
      cardCvv.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
      });
    }

    // Seleção de parcela
    if (installmentsSel) {
      installmentsSel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        if (!isNaN(idx) && state.installments[idx]) {
          state.selectedInstallment = state.installments[idx];
          if (summary) {
            summary.innerHTML = `
              <div class="card-summary-line">
                <span>${state.selectedInstallment.installments}x de</span>
                <strong>${formatBRL(state.selectedInstallment.installmentAmount)}</strong>
              </div>
              <div class="card-summary-line card-summary-total">
                <span>Total:</span>
                <strong>${formatBRL(state.selectedInstallment.totalAmount)}</strong>
              </div>
            `;
          }
        } else {
          state.selectedInstallment = null;
          if (summary) summary.innerHTML = '';
        }
      });
    }
  }

  /* ---------- Detecta bandeira por BIN (heurística simples) ---------- */
  // Não substitui a validação oficial do MP (feita via SDK getInstallments).
  function detectarBandeira(digits) {
    if (digits.length < 1) return null;
    const d = digits;
    // Visa: começa com 4
    if (d[0] === '4') return 'visa';
    // Master: 51-55 ou 2221-2720
    if (/^5[1-5]/.test(d)) return 'master';
    if (/^2(2[2-9]|[3-6][0-9]|7[01]|720)/.test(d.slice(0, 4))) return 'master';
    // Amex: 34 ou 37
    if (/^3[47]/.test(d)) return 'amex';
    // Elo: vários ranges (heurística aproximada)
    if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return 'elo';
    // Hipercard: 6062
    if (/^6062/.test(d)) return 'hipercard';
    return null;
  }

  /* ---------- Busca parcelas via SDK do MP ---------- */
  async function buscarEAtualizarParcelas(cardDigits) {
    const installmentsSel = $('ck-card-installments');
    if (!installmentsSel) return;

    // Calcula total do pedido
    const subtotal = global.CDBCart ? global.CDBCart.subtotal() : 0;
    const frete = state.shippingOption ? state.shippingOption.valor : 0;
    const cfg = global.CDB_CONFIG || {};
    const freteGratis = cfg.freteGratis?.ativo && subtotal >= cfg.freteGratis.valorMinimo;
    const total = subtotal + (freteGratis ? 0 : frete);

    const bin = cardDigits.slice(0, 6);
    if (bin.length < 6) return;

    installmentsSel.disabled = true;
    installmentsSel.innerHTML = '<option value="">Carregando parcelas...</option>';

    try {
      if (!global.CDBMercadoPago) throw new Error('Módulo MP não carregou');
      const maxParcelas = (global.CDB_CONFIG?.mercadoPago?.maxParcelas) || 12;
      const todas = await global.CDBMercadoPago.getInstallments(bin, total);
      // Filtra pelo máximo configurado
      state.installments = todas.filter(p => p.installments <= maxParcelas);

      if (state.installments.length === 0) {
        installmentsSel.innerHTML = '<option value="">Nenhuma parcela disponível</option>';
        return;
      }

      // Marca opção recomendada (1x sem juros normalmente)
      installmentsSel.innerHTML = state.installments.map((p, i) => {
        const isRecommended = (p.labels || []).includes('recommended');
        const sel = isRecommended ? ' selected' : '';
        return `<option value="${i}"${sel}>${escapeHTML(p.label)}</option>`;
      }).join('');
      installmentsSel.disabled = false;

      // Pré-seleciona a recomendada
      const recommendedIdx = state.installments.findIndex(p => (p.labels || []).includes('recommended'));
      const defaultIdx = recommendedIdx >= 0 ? recommendedIdx : 0;
      installmentsSel.value = String(defaultIdx);
      state.selectedInstallment = state.installments[defaultIdx];

      const summary = $('cardFormSummary');
      if (summary && state.selectedInstallment) {
        summary.innerHTML = `
          <div class="card-summary-line">
            <span>${state.selectedInstallment.installments}x de</span>
            <strong>${formatBRL(state.selectedInstallment.installmentAmount)}</strong>
          </div>
          <div class="card-summary-line card-summary-total">
            <span>Total:</span>
            <strong>${formatBRL(state.selectedInstallment.totalAmount)}</strong>
          </div>
        `;
      }
    } catch (err) {
      console.warn('[checkout] erro ao buscar parcelas:', err);
      installmentsSel.innerHTML = '<option value="">Erro ao carregar parcelas. Tente novamente.</option>';
    }
  }

  /* ---------- Processa pagamento de cartão (transparente) ---------- */
  async function processarPagamentoCartao() {
    const confirmBtn = $('confirmOrder');
    // 1. Lê e valida os dados do cartão
    const cardNumber = $('ck-card-number')?.value.replace(/\D/g, '') || '';
    const cardName = $('ck-card-name')?.value.trim() || '';
    const cardExpiry = $('ck-card-expiry')?.value || '';
    const cardCvv = $('ck-card-cvv')?.value || '';

    if (!cardNumber || cardNumber.length < 13) {
      throw new Error('Número do cartão inválido.');
    }
    if (!cardName || cardName.length < 3) {
      throw new Error('Preencha o nome impresso no cartão.');
    }
    const expiryMatch = cardExpiry.match(/^(\d{2})\/(\d{2})$/);
    if (!expiryMatch) {
      throw new Error('Validade inválida. Use o formato MM/AA.');
    }
    const [, expMonth, expYear] = expiryMatch;
    if (parseInt(expMonth, 10) < 1 || parseInt(expMonth, 10) > 12) {
      throw new Error('Mês de validade inválido.');
    }
    // Verifica validade: ano atual + 20 (ex: 2025 -> "25")
    const currentYear = String(new Date().getFullYear()).slice(2);
    if (parseInt(expYear, 10) < parseInt(currentYear, 10) ||
        (parseInt(expYear, 10) === parseInt(currentYear, 10) &&
         parseInt(expMonth, 10) < new Date().getMonth() + 1)) {
      throw new Error('Cartão vencido. Confira a validade.');
    }
    if (!cardCvv || cardCvv.length < 3) {
      throw new Error('CVV inválido (mínimo 3 dígitos).');
    }
    if (!state.selectedInstallment) {
      throw new Error('Selecione o número de parcelas.');
    }
    if (!state.paymentMethodId) {
      throw new Error('Não foi possível identificar a bandeira do cartão.');
    }

    // Pega dados do cliente (CPF/email já validados em goToPayment)
    const docValue = $('ck-cpf')?.value.replace(/\D/g, '') || '';
    const identificationType = docValue.length === 11 ? 'CPF' :
                               docValue.length === 14 ? 'CNPJ' : null;
    if (!identificationType) {
      throw new Error('CPF ou CNPJ inválido.');
    }
    const email = $('ck-email')?.value.trim() || '';

    // 2. Tokeniza o cartão via SDK MP (no navegador, PCI compliant)
    confirmBtn.textContent = 'Tokenizando cartão...';
    confirmBtn.disabled = true;

    const token = await global.CDBMercadoPago.criarCardToken({
      cardNumber: cardNumber,
      cardExpirationMonth: expMonth,
      cardExpirationYear: '20' + expYear,
      cardholderName: cardName,
      securityCode: cardCvv,
      identificationType: identificationType,
      identificationNumber: docValue,
    });
    console.log('[checkout] ✓ Cartão tokenizado:', token.slice(0, 8) + '...');

    // 3. Envia ao Worker que cria o pagamento no MP (com access token)
    confirmBtn.textContent = 'Processando pagamento...';

    const nomeParts = ($('ck-nome').value.trim() || 'Cliente').split(' ');
    const firstName = nomeParts[0];
    const lastName = nomeParts.slice(1).join(' ') || 'Cliente';
    const telDigits = ($('ck-telefone').value || '').replace(/\D/g, '');

    const paymentResult = await global.CDBMercadoPago.processPayment({
      token: token,
      paymentMethodId: state.paymentMethodId,
      installments: state.selectedInstallment.installments,
      issuerId: state.issuerId || undefined,
      transactionAmount: state.selectedInstallment.totalAmount,
      description: `Pedido ${state.pedido.numero} — Casa dos Botões`,
      externalReference: state.pedido.numero,
      payer: {
        email: email,
        firstName: firstName,
        lastName: lastName,
        identificationType: identificationType,
        identificationNumber: docValue,
        phone: {
          areaCode: telDigits.slice(0, 2) || '16',
          number: Number(telDigits.slice(2, 12)) || 999999999,
        },
      },
      items: state.pedido.items,
      shippingOption: state.pedido.shippingOption,
    });

    console.log('[checkout] ✓ Pagamento processado:', paymentResult);

    // 4. Atualiza o pedido com info do pagamento
    if (state.pedido) {
      state.pedido.mpPaymentId = paymentResult.paymentId;
      state.pedido.mpStatus = paymentResult.status;
      state.pedido.mpStatusDetail = paymentResult.statusDetail;
    }
    // Re-salva o pedido no histórico com status do pagamento
    try {
      if (global.CDBOrders && state.pedido) {
        global.CDBOrders.atualizar(state.pedido.numero, {
          mpPaymentId: paymentResult.paymentId,
          mpStatus: paymentResult.status,
          mpStatusDetail: paymentResult.statusDetail,
        });
      }
    } catch (e) { console.warn('[checkout] erro ao atualizar histórico:', e); }

    // 5. Mostra tela de confirmação com base no status
    mostrarConfirmacaoCartao(paymentResult);

    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Pagar com cartão';
  }

  /* ---------- Tela de confirmação para cartão ---------- */
  function mostrarConfirmacaoCartao(result) {
    const traducao = global.CDBMercadoPago.traduzirStatus(result.status, result.statusDetail);
    const icon = traducao.classe === 'success' ? '✓' :
                 traducao.classe === 'error' ? '✕' : '⏳';

    $('confirmMsg').innerHTML = `
      <div class="payment-result payment-result-${traducao.classe}">
        <div class="payment-result-icon">${icon}</div>
        <h4>${escapeHTML(traducao.title)}</h4>
        <p>${escapeHTML(traducao.msg)}</p>
        ${result.paymentId ? `<p class="payment-result-id">ID transação: <strong>${escapeHTML(String(result.paymentId))}</strong></p>` : ''}
        <p class="payment-result-pedido">Pedido: <strong>${escapeHTML(state.pedido.numero)}</strong> — ${formatBRL(state.pedido.total)}</p>
      </div>
      <p style="font-size:0.88rem;color:var(--c-texto-claro);margin-top:8px">
        📄 O arquivo <strong>pedido-${escapeHTML(state.pedido.numero)}.txt</strong> com todos os seus dados foi baixado.
        ${traducao.classe === 'success'
          ? 'Anexe no WhatsApp para combinarmos o envio.'
          : 'Chame a gente no WhatsApp para resolvermos.'}
      </p>
    `;

    // Configura botão WhatsApp
    const sendBtn = $('sendOrderWhatsapp');
    if (sendBtn) sendBtn.href = montarLinkWhatsapp();

    // Área extra do QR / botões
    $('pixQrArea').innerHTML = `
      <button class="btn btn-outline btn-block" id="baixarTxtBtn2" type="button" style="margin-top:12px">📄 Baixar pedido .txt novamente</button>
    `;
    const baixarBtn = $('baixarTxtBtn2');
    if (baixarBtn) baixarBtn.addEventListener('click', () => {
      if (global.CDBOrderTxt && state.pedido) {
        global.CDBOrderTxt.baixarTxtPedido(state.pedido, {
          paymentMethod: state.paymentMethod,
          status: state.pedido.mpStatus || 'AGUARDANDO',
        });
      }
    });

    goToStep('confirm');
  }

  /* ---------- Cria Pix MP dinâmico (via Worker) ---------- */
  async function criarPixMP() {
    if (!global.CDBMercadoPago) throw new Error('Módulo MP não carregou');
    const result = await global.CDBMercadoPago.criarPreferencia(state.pedido, {
      paymentMethod: 'pix-mp',
    });
    if (!result.qr_code) {
      throw new Error('Não foi possível gerar o QR Code Pix via MP.');
    }

    // Render step 3 com QR Code do MP
    const msg = `Pedido <strong>${escapeHTML(state.pedido.numero)}</strong> no valor de <strong>${formatBRL(state.pedido.total)}</strong> criado! Escaneie o QR Code abaixo com o app do seu banco para pagar via Pix (Mercado Pago).`;
    $('confirmMsg').innerHTML = msg +
      `<p style="font-size:0.88rem;color:var(--c-texto-claro);margin-top:8px"> 📄 O arquivo <strong>pedido-${escapeHTML(state.pedido.numero)}.txt</strong> foi baixado. Anexe no WhatsApp.</p>`;

    let qrHtml = '';
    if (result.qr_code_base64) {
      // Imagem PNG base64 direto do MP
      qrHtml = `<img src="data:image/png;base64,${result.qr_code_base64}" alt="QR Code Pix" width="240" height="240">`;
    } else {
      // Gera QR Code a partir da string usando a lib qrcode-generator
      qrHtml = `<img src="${gerarQrCodeDataUrl(result.qr_code, 240)}" alt="QR Code Pix" width="240" height="240">`;
    }

    const qrArea = $('pixQrArea');
    qrArea.innerHTML = `
      <div class="pix-qr">
        ${qrHtml}
        <span class="pix-code" id="pixCodeText">${escapeHTML(result.qr_code)}</span>
        <button class="pix-copy-btn" id="copyPixBtn" type="button">Copiar código Pix</button>
      </div>
      <button class="btn btn-outline btn-block" id="baixarTxtBtn" type="button" style="margin-top:12px">📄 Baixar pedido .txt novamente</button>`;

    // Botão copiar
    const copyBtn = $('copyPixBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(result.qr_code).then(() => {
        copyBtn.textContent = 'Código copiado!';
        setTimeout(() => copyBtn.textContent = 'Copiar código Pix', 2000);
      }).catch(() => {});
    });

    // Botão baixar txt
    const baixarBtn = $('baixarTxtBtn');
    if (baixarBtn) baixarBtn.addEventListener('click', () => {
      if (global.CDBOrderTxt && state.pedido) {
        global.CDBOrderTxt.baixarTxtPedido(state.pedido, {
          paymentMethod: 'pix-mp',
          status: 'AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO',
        });
      }
    });

    // Atualiza pedido com payment_id do MP
    if (state.pedido && result.payment_id) {
      state.pedido.mpPaymentId = result.payment_id;
      state.pedido.mpStatus = result.status || 'pending';
    }

    // WhatsApp
    const sendBtn = $('sendOrderWhatsapp');
    if (sendBtn) sendBtn.href = montarLinkWhatsapp();

    goToStep('confirm');
  }

  /* ---------- Helper: gera QR Code data URL ---------- */
  function gerarQrCodeDataUrl(text, size) {
    try {
      if (typeof qrcode === 'undefined') return '';
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const cellSize = Math.max(2, Math.floor(size / qr.getModuleCount()));
      return qr.createDataURL(cellSize, 0);
    } catch (e) {
      console.warn('[checkout] erro QR Code:', e);
      return '';
    }
  }

  /* ---------- Helpers de formatação (CPF/CNPJ/Telefone) ---------- */
  function formatarCpfCnpj(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 14);
    if (v.length <= 11) {
      // CPF: 000.000.000-00
      v = v.replace(/(\d{3})(\d)/, '$1.$2')
           .replace(/(\d{3})(\d)/, '$1.$2')
           .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    } else {
      // CNPJ: 00.000.000/0000-00
      v = v.replace(/(\d{2})(\d)/, '$1.$2')
           .replace(/(\d{3})(\d)/, '$1.$2')
           .replace(/(\d{3})(\d)/, '$1/$2')
           .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
    }
    input.value = v;
  }

  function formatarTelefone(input) {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    if (v.length > 6) {
      // Celular: (00) 00000-0000
      v = `(${v.slice(0,2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    } else if (v.length > 2) {
      v = `(${v.slice(0,2)}) ${v.slice(2)}`;
    } else if (v.length > 0) {
      v = `(${v}`;
    }
    input.value = v;
  }

  /* ---------- Verifica retorno do MP via URL ---------- */
  // Caso o cliente venha de fluxo de Checkout Pro (redirecionamento)
  function verificarRetornoMP() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('mp_status') || params.get('collection_status');
    const pedido = params.get('pedido');
    if (!status || !pedido) return;

    // Traduz status
    const traducao = global.CDBMercadoPago?.traduzirStatus(status, '') ||
      { title: 'Status: ' + status, msg: '', classe: 'pending' };

    // Cria uma notificação no topo da página
    const banner = document.createElement('div');
    banner.className = 'mp-return-banner mp-return-' + traducao.classe;
    banner.innerHTML = `
      <div class="mp-return-inner">
        <div class="mp-return-icon">${traducao.classe === 'success' ? '✓' : '!'}</div>
        <div class="mp-return-text">
          <strong>${escapeHTML(traducao.title)}</strong>
          <span>Pedido ${escapeHTML(pedido)} — ${escapeHTML(traducao.msg)}</span>
        </div>
        <button class="mp-return-close" aria-label="Fechar">×</button>
      </div>
    `;
    document.body.appendChild(banner);
    banner.querySelector('.mp-return-close')?.addEventListener('click', () => {
      banner.remove();
      // Limpa URL
      const url = window.location.pathname;
      window.history.replaceState({}, document.title, url);
    });
    // Auto-fecha após 15s
    setTimeout(() => {
      if (banner.parentNode) banner.remove();
      const url = window.location.pathname;
      window.history.replaceState({}, document.title, url);
    }, 15000);
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
      // NOTA: E-mail e CPF/CNPJ são opcionais para Pix e WhatsApp
      // (só obrigatórios para Cartão via Mercado Pago - validado no onConfirmOrder)
      // Valida número do endereço (se NÃO for retirada)
      const isRetirada = state.shippingOption?.retirada;
      if (!isRetirada) {
        const numero = $('ck-numero').value.trim();
        if (!numero) {
          alert('Por favor, preencha o NÚMERO do endereço para entrega.');
          $('ck-numero').focus();
          return;
        }
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

    // Adiciona formatação automática do CPF/CNPJ e máscara de telefone
    $('ck-cpf')?.addEventListener('input', (e) => {
      formatarCpfCnpj(e.target);
    });
    $('ck-telefone')?.addEventListener('input', (e) => {
      formatarTelefone(e.target);
    });

    // Recebe evento "open checkout" do cart.js
    global.addEventListener('cdb:open-checkout', open);

    // Verifica se voltou do MP com status na URL
    verificarRetornoMP();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CDBCheckout = { open, close, state };
})(window);
