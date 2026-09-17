/**
 * Casa dos Botões — Envio de pedidos por e-mail (Web3Forms)
 * ----------------------------------------------------------------
 * Recebe cada pedido no seu e-mail usando o serviço gratuito Web3Forms.
 *
 * Como funciona:
 *   1. Você se cadastra em https://web3forms.com com seu e-mail
 *   2. Recebe um access key por e-mail (UUID)
 *   3. Cola o access key em config.js → email.accessKey
 *   4. Quando um pedido é confirmado no checkout, este módulo envia
 *      um POST para a API da Web3Forms com todos os dados do pedido
 *   5. A Web3Forms recebe o POST e envia um e-mail para você
 *
 * Vantagens:
 *   - 100% gratuito (até 250 e-mails/mês, mais que suficiente)
 *   - Sem backend (perfeito para site estático no GitHub Pages)
 *   - Os pedidos chegam no seu e-mail junto com o WhatsApp
 *   - Funciona como redundância: mesmo se o WhatsApp falhar, você
 *     recebe o pedido por e-mail
 *
 * Privacidade:
 *   - O access key é PÚBLICO por design (não é segredo)
 *   - A Web3Forms só envia e-mails para o endereço cadastrado
 *   - Mesmo que alguém descubra seu access key, só consegue enviar
 *     e-mails para VOCÊ (não para outras pessoas)
 */

(function (global) {
  'use strict';

  const API_URL = 'https://api.web3forms.com/submit';

  /* ---------- Helpers ---------- */
  function formatBRL(n) { return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ','); }
  function formatData(d) {
    const pad2 = n => String(n).padStart(2, '0');
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ` +
           `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /* ---------- Monta o HTML do e-mail (formato bonito) ---------- */
  function gerarHtmlEmail(pedido, opts) {
    opts = opts || {};
    const itens = pedido.items.map((i, idx) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${idx + 1}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">
          <strong>${escapeHtml(i.nome)}</strong><br>
          <small style="color: #888;">${escapeHtml(i.unidade || '')}</small>
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${i.qty}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatBRL(i.preco)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;"><strong>${formatBRL(i.preco * i.qty)}</strong></td>
      </tr>
    `).join('');

    const cfgRet = global.CDB_CONFIG?.retirada;
    const endRet = cfgRet?.endereco;
    const freteTxt = pedido.shippingOption && pedido.shippingOption.retirada
      ? `<span style="color: #2e7d32; font-weight: bold;">🏠 RETIRAR NO LOCAL (Ribeirão Preto)</span>${endRet ? `<br><br><strong>📍 Endereço de retirada:</strong><br>${escapeHtml(endRet.rua || '')}<br>${escapeHtml(endRet.bairro || '')} — ${escapeHtml(endRet.cidade || '')}/${escapeHtml(endRet.uf || '')}<br>CEP: ${escapeHtml(endRet.cep || '')}<br><small>⏰ ${escapeHtml(endRet.horario || 'Seg-Sex 9h às 18h')}</small>` : ''}`
      : `${escapeHtml(pedido.shippingOption?.nome || '-')} — ${pedido.frete === 0 ? 'Grátis' : formatBRL(pedido.frete)}`;

    const metodos = {
      'pix':     '💳 Pix (QR Code gerado no site)',
      'pix-mp':  '💳 Pix via Mercado Pago',
      'cartao':  '💳 Cartão via Mercado Pago',
      'whatsapp':'📱 Confirmar pagamento via WhatsApp',
    };
    const pagamentoTxt = metodos[opts.paymentMethod] || opts.paymentMethod || '-';

    return `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 640px; margin: 0 auto; color: #2a1810;">
        <div style="background: #6b1f2a; color: #fff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">🧵 Casa dos Botões — Novo Pedido</h1>
          <p style="margin: 4px 0 0; opacity: 0.9;">Pedido <strong>${escapeHtml(pedido.numero)}</strong> · ${formatData(new Date())}</p>
        </div>

        <div style="background: #fff; padding: 24px; border: 1px solid #ddd; border-top: none;">

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">👤 Cliente</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr><td style="padding: 4px 0; width: 100px; color: #888;">Nome:</td><td><strong>${escapeHtml(pedido.cliente.nome)}</strong></td></tr>
            <tr><td style="padding: 4px 0; color: #888;">Telefone:</td><td>${escapeHtml(pedido.cliente.telefone)}</td></tr>
          </table>

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">📍 Entrega</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr><td style="padding: 4px 0; width: 100px; color: #888;">CEP:</td><td>${escapeHtml(pedido.cliente.cep || '-')}</td></tr>
            <tr><td style="padding: 4px 0; color: #888;">Rua:</td><td>${escapeHtml(pedido.cliente.endereco || '-')}</td></tr>
            <tr><td style="padding: 4px 0; color: #888;">Número:</td><td><strong style="color: #c62828;">${escapeHtml(pedido.cliente.numero || '⚠ NÃO PREENCHIDO')}</strong></td></tr>
            ${pedido.cliente.complemento ? `<tr><td style="padding: 4px 0; color: #888;">Complemento:</td><td>${escapeHtml(pedido.cliente.complemento)}</td></tr>` : ''}
            <tr><td style="padding: 4px 0; color: #888;">Bairro:</td><td>${escapeHtml(pedido.cliente.bairro || '-')}</td></tr>
            ${pedido.cliente.referencia ? `<tr><td style="padding: 4px 0; color: #888;">Referência:</td><td>${escapeHtml(pedido.cliente.referencia)}</td></tr>` : ''}
            <tr><td style="padding: 4px 0; color: #888;">Cidade:</td><td>${escapeHtml(pedido.cliente.cidade || '-')} / ${escapeHtml(pedido.cliente.uf || '-')}</td></tr>
          </table>

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">🛒 Itens do Pedido</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <thead>
              <tr style="background: #f6ecd9;">
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #6b1f2a;">#</th>
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #6b1f2a;">Produto</th>
                <th style="padding: 8px; text-align: center; border-bottom: 2px solid #6b1f2a;">Qtd</th>
                <th style="padding: 8px; text-align: right; border-bottom: 2px solid #6b1f2a;">Unit.</th>
                <th style="padding: 8px; text-align: right; border-bottom: 2px solid #6b1f2a;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itens}
            </tbody>
          </table>

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">📦 Entrega / Retirada</h2>
          <p style="margin: 0 0 20px; padding: 12px; background: #faf3e7; border-radius: 4px;">${freteTxt}</p>

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">💰 Resumo Financeiro</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr><td style="padding: 6px 0; color: #888;">Subtotal produtos:</td><td style="text-align: right;">${formatBRL(pedido.subtotal)}</td></tr>
            <tr><td style="padding: 6px 0; color: #888;">Frete:</td><td style="text-align: right;">${pedido.frete === 0 ? '<span style="color:#2e7d32;font-weight:bold;">Grátis</span>' : formatBRL(pedido.frete)}</td></tr>
            <tr style="background: #6b1f2a; color: #fff;">
              <td style="padding: 12px 8px; font-size: 18px;"><strong>TOTAL</strong></td>
              <td style="padding: 12px 8px; font-size: 22px; text-align: right;"><strong>${formatBRL(pedido.total)}</strong></td>
            </tr>
          </table>

          <h2 style="color: #6b1f2a; margin: 0 0 12px; font-size: 16px;">💳 Pagamento</h2>
          <p style="padding: 12px; background: #faf3e7; border-radius: 4px;">${pagamentoTxt}</p>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #888; text-align: center;">
            Pedido gerado automaticamente pelo site da Casa dos Botões.<br>
            Para confirmar, fale com o cliente no WhatsApp: ${escapeHtml(pedido.cliente.telefone)}
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ---------- Envia o e-mail via Web3Forms ---------- */
  async function enviarPedido(pedido, opts) {
    const cfg = global.CDB_CONFIG?.email;
    if (!cfg || !cfg.ativo || !cfg.accessKey) {
      console.log('[email] E-mail desativado ou sem access key');
      return { success: false, reason: 'desativado' };
    }

    const html = gerarHtmlEmail(pedido, opts);
    // Resumo em texto puro (caso o cliente não veja HTML)
    const texto = `
NOVO PEDIDO - Casa dos Botões
Pedido: ${pedido.numero}
Data: ${formatData(new Date())}

CLIENTE:
${pedido.cliente.nome}
Telefone: ${pedido.cliente.telefone}

ENTREGA:
CEP: ${pedido.cliente.cep}
${pedido.cliente.endereco}
${pedido.cliente.cidade}/${pedido.cliente.uf}

ITENS:
${pedido.items.map(i => `- ${i.qty}x ${i.nome} (${i.unidade}) - ${formatBRL(i.preco * i.qty)}`).join('\n')}

ENTREGA/RETIRADA:
${pedido.shippingOption?.retirada ? 'RETIRAR NO LOCAL (Ribeirão Preto)' : `${pedido.shippingOption?.nome} - ${pedido.frete === 0 ? 'Grátis' : formatBRL(pedido.frete)}`}

RESUMO:
Subtotal: ${formatBRL(pedido.subtotal)}
Frete: ${pedido.frete === 0 ? 'Grátis' : formatBRL(pedido.frete)}
TOTAL: ${formatBRL(pedido.total)}

PAGAMENTO: ${opts.paymentMethod || '-'}
`;

    const body = {
      access_key: cfg.accessKey,
      subject: `${cfg.assunto || 'Novo pedido'} - ${pedido.numero}`,
      from_name: 'Casa dos Botões (site)',
      // Campos obrigatórios da Web3Forms:
      // name = nome do "remetente" (usamos o nome do cliente)
      name: pedido.cliente.nome || 'Cliente do site',
      // email = e-mail do remetente (precisa ser válido para a Web3Forms aceitar)
      email: 'no-reply@casadosbotoes.com.br',
      // O destinatário real é configurado no painel da Web3Forms
      // (casadebotao1@gmail.com). O campo 'to' abaixo é opcional e
      // só funciona se a Web3Forms permitir múltiplos destinatários.
      to: cfg.para || undefined,
      replyto: 'no-reply@casadosbotoes.com.br',
      // Campos personalizados (aparecem no corpo do e-mail)
      pedido_numero: pedido.numero,
      cliente_nome: pedido.cliente.nome,
      cliente_telefone: pedido.cliente.telefone,
      pedido_total: formatBRL(pedido.total),
      pedido_data: formatData(new Date()),
      // Corpo do e-mail (HTML formatado)
      html: html,
      // Resumo em texto puro (fallback)
      text: texto,
    };

    try {
      console.log('[email] Enviando para Web3Forms...');
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });
      console.log('[email] HTTP status:', resp.status);
      const data = await resp.json();
      if (data.success) {
        console.log('[email] ✅ E-mail enviado! Verifique casadebotao1@gmail.com');
        return { success: true, message_id: data.message_id };
      } else {
        console.error('[email] ❌ Web3Forms rejeitou:', data.message);
        return { success: false, error: data.message };
      }
    } catch (err) {
      console.error('[email] Erro de rede:', err);
      return { success: false, error: err.message };
    }
  }

  /* ---------- API pública ---------- */
  global.CDBEmail = {
    enviarPedido,
    gerarHtmlEmail,
  };

})(window);
