/**
 * Casa dos Botões — Gerenciador de pedidos salvos (orders-store.js)
 * ----------------------------------------------------------------
 * Salva todos os pedidos no localStorage do navegador.
 * - Quando um pedido é finalizado no checkout, é salvo aqui
 * - A página pedidos.html mostra todos os pedidos salvos
 * - Botão "Importar .txt" permite adicionar pedidos recebidos por e-mail
 *
 * Limitação: localStorage é por navegador. Só aparecem aqui os pedidos
 * feitos neste navegador. Para ver pedidos de outros clientes, importe
 * o .txt que você recebeu por e-mail/WhatsApp.
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'cdb_pedidos_v1';

  /* ---------- Carrega todos os pedidos ---------- */
  function listar() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.error('[orders-store] erro ao carregar:', e);
      return [];
    }
  }

  /* ---------- Salva lista completa ---------- */
  function salvar(pedidos) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pedidos));
      return true;
    } catch (e) {
      console.error('[orders-store] erro ao salvar:', e);
      return false;
    }
  }

  /* ---------- Adiciona um pedido ---------- */
  function adicionar(pedido) {
    const pedidos = listar();
    // Evita duplicar pelo número do pedido
    if (pedidos.some(p => p.numero === pedido.numero)) {
      console.log('[orders-store] pedido já existe:', pedido.numero);
      return false;
    }
    pedido.salvoEm = new Date().toISOString();
    pedidos.unshift(pedido); // mais recente primeiro
    salvar(pedidos);
    return true;
  }

  /* ---------- Remove um pedido pelo número ---------- */
  function remover(numero) {
    const pedidos = listar().filter(p => p.numero !== numero);
    salvar(pedidos);
    return true;
  }

  /* ---------- Limpa todos ---------- */
  function limpar() {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  }

  /* ---------- Faz parse de um .txt de pedido para extrair dados ---------- */
  // Tenta extrair número do pedido, cliente, telefone, etc.
  function parseTxt(txt) {
    const pedido = {
      numero: '',
      data: '',
      cliente: { nome: '', telefone: '', cep: '', endereco: '', cidade: '', uf: '' },
      items: [],
      shippingOption: null,
      subtotal: 0,
      frete: 0,
      total: 0,
      paymentMethod: '',
      rawTxt: txt,
    };

    const linhas = txt.split('\n').map(l => l.trim());

    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      // Número do pedido
      if (l.startsWith('PEDIDO Nº:')) pedido.numero = l.split(':')[1].trim();
      // Data
      else if (l.startsWith('DATA/HORA:')) pedido.data = l.split(':')[1].trim() + ':' + l.split(':').slice(2).join(':').trim();
      // Cliente
      else if (l.startsWith('Nome:')) pedido.cliente.nome = l.split(':').slice(1).join(':').trim();
      else if (l.startsWith('Telefone:')) pedido.cliente.telefone = l.split(':').slice(1).join(':').trim();
      // Endereço
      else if (l.startsWith('CEP:')) pedido.cliente.cep = l.split(':').slice(1).join(':').trim();
      else if (l.startsWith('Endereço:')) pedido.cliente.endereco = l.split(':').slice(1).join(':').trim();
      else if (l.startsWith('Cidade:')) pedido.cliente.cidade = l.split(':').slice(1).join(':').trim();
      else if (l.startsWith('UF:')) pedido.cliente.uf = l.split(':').slice(1).join(':').trim();
      // Itens - linhas começando com número.
      else {
        const m = l.match(/^(\d+)\.\s+(.+?)\s+—\s+R\$\s+([\d.,]+)/);
        if (m) {
          // Tenta pegar quantidade do nome (ex: "2x Botão...")
          const qtdMatch = m[2].match(/^(\d+)x\s+(.+)/);
          pedido.items.push({
            nome: qtdMatch ? qtdMatch[2] : m[2],
            qty: qtdMatch ? parseInt(qtdMatch[1]) : 1,
            preco: parseFloat(m[3].replace('.', '').replace(',', '.')) / (qtdMatch ? parseInt(qtdMatch[1]) : 1),
            unidade: '',
          });
        }
      }
      // Total
      if (l.startsWith('TOTAL DO PEDIDO:')) {
        const m = l.match(/R\$\s+([\d.,]+)/);
        if (m) pedido.total = parseFloat(m[1].replace('.', '').replace(',', '.'));
      }
      // Forma de pagamento
      if (l.startsWith('Forma de pagamento:')) {
        pedido.paymentMethod = l.split(':').slice(1).join(':').trim();
      }
    }
    // Tenta pegar subtotal e frete também
    for (const l of linhas) {
      if (l.startsWith('Subtotal produtos:')) {
        const m = l.match(/R\$\s+([\d.,]+)/);
        if (m) pedido.subtotal = parseFloat(m[1].replace('.', '').replace(',', '.'));
      } else if (l.startsWith('Frete:') && !l.includes('GRÁTIS')) {
        const m = l.match(/R\$\s+([\d.,]+)/);
        if (m) pedido.frete = parseFloat(m[1].replace('.', '').replace(',', '.'));
      } else if (l.startsWith('Frete:') && l.includes('GRÁTIS')) {
        pedido.frete = 0;
      }
      // Serviço (frete)
      if (l.startsWith('Serviço:')) {
        pedido.shippingOption = { nome: l.split(':')[1].trim() };
      }
      // Cliente vai retirar
      if (l.includes('RETIRAR NO LOCAL')) {
        pedido.shippingOption = { nome: 'Retirada no local', retirada: true };
      }
    }
    // Se não achou número, gera um baseado no timestamp
    if (!pedido.numero) {
      pedido.numero = 'IMP-' + Date.now().toString().slice(-8);
    }
    return pedido;
  }

  /* ---------- API pública ---------- */
  global.CDBOrders = {
    listar,
    adicionar,
    remover,
    limpar,
    parseTxt,
  };

})(window);
