/**
 * Casa dos Botões — Gerador de .txt do pedido (order-txt.js)
 * ----------------------------------------------------------------
 * Quando o cliente confirma o pedido, este módulo:
 *   1. Gera o conteúdo .txt do pedido de forma organizada, com
 *      seções claras para o lojista saber TUDO que precisa para
 *      embalar e enviar a encomenda.
 *   2. Dispara o download automático do arquivo no navegador do
 *      cliente (nome: pedido-CDB00000000.txt).
 *   3. Fornece a mesma string para ser usada no corpo da mensagem
 *      de WhatsApp, assim o lojista recebe os dados organizados
 *      mesmo que o cliente não anexe o arquivo.
 *
 * Por que baixar no navegador do cliente?
 *   Como o site é estático (GitHub Pages), não há backend para
 *   salvar o .txt no servidor. A solução: o cliente baixa o .txt
 *   e é convidado a anexá-lo no WhatsApp ao confirmar o pedido.
 *   Além disso, o conteúdo vai no corpo do WhatsApp como texto
 *   (sempre recebido, mesmo sem anexar o arquivo).
 */

(function (global) {
  'use strict';

  /* ---------- Helpers ---------- */
  function pad(s, len) { s = String(s); return s + ' '.repeat(Math.max(0, len - s.length)); }
  function formatBRL(n) { return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ','); }
  function formatData(d) {
    const pad2 = n => String(n).padStart(2, '0');
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ` +
           `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function linha(char = '-', n = 60) { return char.repeat(n); }

  /* ---------- Gera o conteúdo .txt ----------
   * pedido = { numero, subtotal, frete, total, items, cliente, shippingOption, paymentMethod? }
   *   items: [{ id, nome, preco, unidade, image, qty }]
   *   cliente: { nome, telefone, cep, endereco, cidade, uf }
   *   shippingOption: { codigo, nome, descricao, valor, prazo } | null
   */
  function gerarTxtPedido(pedido, opts) {
    opts = opts || {};
    const cfg = global.CDB_CONFIG || {};
    const agora = new Date();
    const L = linha();
    const L2 = linha('=');

    let txt = '';
    txt += L2 + '\n';
    txt += '       CASA DOS BOTÕES - COMPROVANTE DE PEDIDO\n';
    txt += L2 + '\n\n';
    txt += `PEDIDO Nº: ${pedido.numero}\n`;
    txt += `DATA/HORA: ${formatData(agora)}\n`;
    txt += `STATUS: ${opts.status || 'AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO'}\n\n`;

    // ----- Dados do cliente -----
    txt += L + '\n';
    txt += 'DADOS DO CLIENTE\n';
    txt += L + '\n';
    txt += `Nome:      ${pedido.cliente.nome || '-'}\n`;
    txt += `Telefone:  ${pedido.cliente.telefone || '-'}\n`;
    if (pedido.cliente.email) txt += `E-mail:    ${pedido.cliente.email}\n`;
    txt += '\n';

    // ----- Endereço de entrega -----
    txt += L + '\n';
    txt += 'ENDEREÇO DE ENTREGA\n';
    txt += L + '\n';
    txt += `CEP:       ${pedido.cliente.cep || '-'}\n`;
    txt += `Rua:       ${pedido.cliente.endereco || '-'}\n`;
    txt += `Número:    ${pedido.cliente.numero || '-'} ⚠\n`;
    if (pedido.cliente.complemento) txt += `Complemento: ${pedido.cliente.complemento}\n`;
    txt += `Bairro:    ${pedido.cliente.bairro || '-'}\n`;
    if (pedido.cliente.referencia) txt += `Referência: ${pedido.cliente.referencia}\n`;
    txt += `Cidade:    ${pedido.cliente.cidade || '-'}\n`;
    txt += `UF:        ${pedido.cliente.uf || '-'}\n`;
    txt += '\n';

    // ----- Itens do pedido -----
    txt += L + '\n';
    txt += 'ITENS DO PEDIDO\n';
    txt += L + '\n';
    pedido.items.forEach((i, idx) => {
      const sub = i.preco * i.qty;
      txt += `${idx + 1}. ${i.nome}\n`;
      txt += `   Unidade:        ${i.unidade || '-'}\n`;
      txt += `   Quantidade:     ${i.qty}\n`;
      txt += `   Preço unitário: ${formatBRL(i.preco)}\n`;
      txt += `   Subtotal:       ${formatBRL(sub)}\n\n`;
    });

    // ----- Frete -----
    txt += L + '\n';
    txt += 'ENTREGA / RETIRADA\n';
    txt += L + '\n';
    if (pedido.shippingOption && pedido.shippingOption.retirada) {
      const cfg = global.CDB_CONFIG || {};
      const endRet = cfg.retirada?.endereco;
      txt += '⚠ ATENÇÃO: CLIENTE VAI RETIRAR NO LOCAL\n';
      txt += `Local:    ${cfg.store?.enderecoCidade || 'Ribeirão Preto / SP'}\n`;
      if (endRet) {
        txt += `Endereço: ${endRet.rua || '-'}\n`;
        txt += `Bairro:   ${endRet.bairro || '-'}\n`;
        txt += `Cidade:   ${endRet.cidade || '-'} / ${endRet.uf || '-'}\n`;
        txt += `CEP:      ${endRet.cep || '-'}\n`;
        if (endRet.referencia) txt += `Ref:      ${endRet.referencia}\n`;
        if (endRet.horario) txt += `Horário:  ${endRet.horario}\n`;
      }
      txt += `Valor:    GRÁTIS (retirada no local)\n`;
      txt += '\n';
      txt += '>>> PEDIDO PRONTO PARA RETIRADA. AVISAR CLIENTE NO WHATSAPP <<<\n\n';
    } else if (pedido.shippingOption) {
      txt += `Serviço:  ${pedido.shippingOption.nome || '-'}\n`;
      txt += `Código:   ${pedido.shippingOption.codigo || '-'}\n`;
      if (pedido.shippingOption.descricao) txt += `Descrição: ${pedido.shippingOption.descricao}\n`;
      if (pedido.shippingOption.prazo) txt += `Prazo:    ${pedido.shippingOption.prazo} dias úteis\n`;
      txt += `Valor:    ${pedido.frete === 0 ? 'GRÁTIS' : formatBRL(pedido.frete)}\n`;
    } else {
      txt += 'Não calculado (retirada ou frete a combinar).\n';
    }
    txt += '\n';

    // ----- Pagamento -----
    txt += L + '\n';
    txt += 'PAGAMENTO\n';
    txt += L + '\n';
    const metodos = {
      'pix':     'Pix (QR Code gerado no site)',
      'pix-mp':  'Pix via Mercado Pago',
      'cartao':  'Cartão de crédito via Mercado Pago',
      'whatsapp':'Confirmar pagamento via WhatsApp',
    };
    txt += `Forma de pagamento: ${metodos[opts.paymentMethod] || opts.paymentMethod || '-'}\n`;
    if (opts.paymentMethod === 'pix') {
      const pix = cfg.pix || {};
      txt += `Chave Pix:           ${formatarChavePix(pix.chave, pix.tipoChave)}\n`;
      txt += `Tipo de chave:       ${pix.tipoChave || '-'}\n`;
      txt += `Nome do recebedor:   ${pix.nomeRecebedor || '-'}\n`;
      txt += `Cidade do recebedor: ${pix.cidadeRecebedor || '-'}\n`;
      txt += `ID do pedido:        ${pedido.numero}\n`;
      txt += `Valor a pagar:       ${formatBRL(pedido.total)}\n`;
      txt += `\nStatus do Pix: AGUARDANDO COMPROVAÇÃO DO CLIENTE\n`;
    }
    txt += '\n';

    // ----- Resumo financeiro -----
    txt += L + '\n';
    txt += 'RESUMO FINANCEIRO\n';
    txt += L + '\n';
    txt += `Subtotal produtos: ${formatBRL(pedido.subtotal)}\n`;
    txt += `Frete:             ${pedido.frete === 0 ? 'GRÁTIS' : formatBRL(pedido.frete)}\n`;
    txt += L + '\n';
    txt += `TOTAL DO PEDIDO:   ${formatBRL(pedido.total)}\n\n`;

    // ----- Rodapé -----
    txt += L2 + '\n';
    txt += 'Mensagem gerada automaticamente pelo site da Casa dos Botões.\n';
    txt += `Loja: ${cfg.store?.name || 'Casa dos Botões'} — ${cfg.store?.slogan || 'Tudo para sua criatividade'}\n`;
    if (cfg.whatsapp?.numero) {
      txt += `WhatsApp da loja: +${cfg.whatsapp.numero}\n`;
    }
    txt += L2 + '\n';

    return txt;
  }

  /* ---------- Formata chave Pix para exibição ---------- */
  function formatarChavePix(chave, tipo) {
    if (!chave) return '-';
    if (tipo === 'phone') {
      // +55 16 99184-2936
      let c = chave.replace(/\D/g, '');
      if (c.length >= 12) {
        return `+${c.slice(0,2)} ${c.slice(2,4)} ${c.slice(4, c.length-4)}-${c.slice(-4)}`;
      }
      return '+' + c;
    }
    if (tipo === 'cpf') {
      let c = chave.replace(/\D/g, '');
      if (c.length === 11) return `${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`;
      return c;
    }
    if (tipo === 'cnpj') {
      let c = chave.replace(/\D/g, '');
      if (c.length === 14) return `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}`;
      return c;
    }
    return chave;
  }

  /* ---------- Dispara download do .txt ---------- */
  function baixarTxtPedido(pedido, opts) {
    const conteudo = gerarTxtPedido(pedido, opts);
    const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedido-${pedido.numero}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // libera a memória depois de 1s (dá tempo do download iniciar)
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return conteudo;
  }

  /* ---------- Versão compacta para WhatsApp ---------- */
  // Mantém a mesma estrutura organizada, mas mais curta para caber
  // bem na mensagem do WhatsApp (limite ~4096 chars na URL).
  function gerarResumoWhatsapp(pedido, opts) {
    opts = opts || {};
    let msg = '';
    msg += `Olá, Casa dos Botões! 🧵\n`;
    msg += `*Novo pedido ${pedido.numero}*\n\n`;
    msg += `📅 ${new Date().toLocaleString('pt-BR')}\n\n`;

    msg += `👤 *CLIENTE*\n`;
    msg += `${pedido.cliente.nome}\n`;
    msg += `📞 ${pedido.cliente.telefone}\n\n`;

    msg += `📍 *ENTREGA*\n`;
    msg += `CEP: ${pedido.cliente.cep}\n`;
    msg += `${pedido.cliente.endereco || ''}, ${pedido.cliente.numero || '⚠ SEM Nº'}`;
    if (pedido.cliente.complemento) msg += ` - ${pedido.cliente.complemento}`;
    msg += `\n`;
    if (pedido.cliente.bairro) msg += `Bairro: ${pedido.cliente.bairro}\n`;
    if (pedido.cliente.referencia) msg += `Ref: ${pedido.cliente.referencia}\n`;
    msg += `${pedido.cliente.cidade}/${pedido.cliente.uf}\n\n`;

    msg += `🛒 *ITENS*\n`;
    pedido.items.forEach((i, idx) => {
      msg += `${idx+1}. ${i.qty}x ${i.nome} (${i.unidade})\n   ${formatBRL(i.preco * i.qty)}\n`;
    });
    msg += `\n`;

    msg += `📦 *ENTREGA / RETIRADA*\n`;
    if (pedido.shippingOption && pedido.shippingOption.retirada) {
      const cfg = global.CDB_CONFIG || {};
      const end = cfg.retirada?.endereco;
      msg += `🏠 *RETIRAR NO LOCAL* (Ribeirão Preto)\n`;
      if (end) {
        msg += `📍 ${end.rua}\n`;
        msg += `${end.bairro} — ${end.cidade}/${end.uf}\n`;
        msg += `CEP: ${end.cep}\n`;
      }
      msg += `⏰ ${end?.horario || 'Seg-Sex 9h às 18h'}\n\n`;
    } else if (pedido.shippingOption) {
      msg += `${pedido.shippingOption.nome}`;
      if (pedido.shippingOption.prazo) msg += ` · ${pedido.shippingOption.prazo} dias úteis`;
      msg += `: ${pedido.frete === 0 ? 'Grátis' : formatBRL(pedido.frete)}\n\n`;
    }

    msg += `💰 *RESUMO*\n`;
    msg += `Subtotal: ${formatBRL(pedido.subtotal)}\n`;
    msg += `Frete: ${pedido.frete === 0 ? 'Grátis' : formatBRL(pedido.frete)}\n`;
    msg += `*TOTAL: ${formatBRL(pedido.total)}*\n\n`;

    msg += `💳 *PAGAMENTO*\n`;
    const metodos = {
      'pix':     'Pix (enviarei o comprovante)',
      'pix-mp':  'Pix Mercado Pago',
      'cartao':  'Cartão Mercado Pago',
      'whatsapp':'A combinar no WhatsApp',
    };
    msg += `${metodos[opts.paymentMethod] || opts.paymentMethod || '-'}\n`;
    if (opts.paymentMethod === 'pix') {
      msg += `ID: ${pedido.numero}\n`;
    }
    msg += `\n📎 _Pedido gerado pelo site. Arquivo .txt já foi baixado no meu dispositivo._`;

    return msg;
  }

  /* ---------- API pública ---------- */
  global.CDBOrderTxt = {
    gerarTxtPedido,
    baixarTxtPedido,
    gerarResumoWhatsapp,
    formatarChavePix,
  };

})(window);
