/**
 * Casa dos Botões — Carrinho (cart.js)
 * ---------------------------------------------------------------
 * Gerencia o carrinho no localStorage:
 *   - adicionar / remover / atualizar quantidade
 *   - persistência entre sessões
 *   - cálculo de subtotal
 *   - notifica outros módulos via window.dispatchEvent
 *
 * Estado armazenado em localStorage["cdb_cart"]:
 *   [{ id, nome, preco, unidade, image, qty }]
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'cdb_cart_v1';
  const cart = [];

  /* ---------- Persistência ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cart.length = 0;
        cart.push.apply(cart, parsed);
      }
    } catch (e) {
      console.warn('[cart] erro ao carregar carrinho:', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      console.error('[cart] erro ao salvar carrinho:', e);
    }
    updateUI();
    dispatchChange();
  }

  /* ---------- Helpers ---------- */
  function getProduct(id) {
    return (global.CDB_PRODUCTS || []).find(p => p.id === id);
  }

  function findItem(id) {
    return cart.find(i => i.id === id);
  }

  /* ---------- API pública ---------- */
  function add(id, qty) {
    qty = parseInt(qty, 10) || 1;
    const p = getProduct(id);
    if (!p) return;
    let item = findItem(id);
    if (item) {
      item.qty += qty;
    } else {
      cart.push({
        id: p.id,
        nome: p.nome,
        preco: p.preco,
        unidade: p.unidade,
        image: p.image,        // compatibilidade
        images: p.images || (p.image ? [p.image] : []),
        qty: qty,
      });
    }
    save();
    showToast(qty > 1 ? `${qty}× ${p.nome} adicionado(s)` : `${p.nome} adicionado ao carrinho`);
  }

  function remove(id) {
    const idx = cart.findIndex(i => i.id === id);
    if (idx >= 0) {
      cart.splice(idx, 1);
      save();
    }
  }

  function setQty(id, qty) {
    qty = parseInt(qty, 10);
    if (qty <= 0) {
      remove(id);
      return;
    }
    let item = findItem(id);
    if (item) {
      item.qty = qty;
      save();
    }
  }

  function clear() {
    cart.length = 0;
    save();
  }

  function getItems() {
    return cart.slice();
  }

  function count() {
    return cart.reduce((s, i) => s + i.qty, 0);
  }

  function subtotal() {
    return cart.reduce((s, i) => s + i.preco * i.qty, 0);
  }

  /* ---------- UI: drawer do carrinho ---------- */
  function render() {
    const body = document.getElementById('cartBody');
    if (!body) return;
    if (cart.length === 0) {
      body.innerHTML = `
        <div class="cart-empty">
          <p>Seu carrinho está vazio.</p>
          <p>Adicione botões para continuar!</p>
        </div>`;
      const footer = document.getElementById('cartFooter');
      if (footer) footer.style.display = 'none';
      return;
    }
    const footer = document.getElementById('cartFooter');
    if (footer) footer.style.display = '';

    body.innerHTML = cart.map(item => {
      // Suporta products com images[] (galeria) e legados com image
      const img = (item.images && item.images[0]) || item.image || '';
      return `
      <div class="cart-item" data-id="${item.id}">
        <div class="cart-item-img">
          <img src="images/products/${img}" alt="${escapeHTML(item.nome)}" loading="lazy"
               onerror="this.onerror=null;this.src='images/products/${img.replace(/\.webp$/, '.jpg')}';">
        </div>
        <div class="cart-item-info">
          <span class="cart-item-name">${escapeHTML(item.nome)}</span>
          <span class="cart-item-unid">${escapeHTML(item.unidade)}</span>
          <span class="cart-item-price">R$ ${(item.preco * item.qty).toFixed(2).replace('.', ',')}</span>
          <div class="qty-control">
            <button class="qty-btn" data-action="dec">−</button>
            <span class="qty-val">${item.qty}</span>
            <button class="qty-btn" data-action="inc">+</button>
          </div>
          <button class="cart-item-remove" data-action="remove">Remover</button>
        </div>
        <div></div>
      </div>`;
    }).join('');

    // Adiciona handlers de quantidade/remover
    body.querySelectorAll('.cart-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          const item = findItem(id);
          if (!item) return;
          if (action === 'inc') setQty(id, item.qty + 1);
          else if (action === 'dec') setQty(id, item.qty - 1);
          else if (action === 'remove') remove(id);
        });
      });
    });

    const subtotalEl = document.getElementById('cartSubtotal');
    if (subtotalEl) subtotalEl.textContent = 'R$ ' + subtotal().toFixed(2).replace('.', ',');
  }

  function updateUI() {
    // Contador no header
    const countEl = document.getElementById('cartCount');
    if (countEl) {
      const c = count();
      countEl.textContent = String(c);
      countEl.hidden = c === 0;
    }
    // Render do drawer
    render();
  }

  /* ---------- UI: abrir/fechar ---------- */
  function open() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('overlay');
    if (drawer) {
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    }
    if (overlay) {
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add('show'));
    }
    document.body.style.overflow = 'hidden';
    render();
  }

  function close() {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('overlay');
    if (drawer) {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.hidden = true; }, 200);
    }
    document.body.style.overflow = '';
  }

  function isOpen() {
    const drawer = document.getElementById('cartDrawer');
    return drawer && drawer.classList.contains('open');
  }

  /* ---------- Eventos ---------- */
  function dispatchChange() {
    global.dispatchEvent(new CustomEvent('cdb:cart-change', {
      detail: { items: getItems(), subtotal: subtotal(), count: count() }
    }));
  }

  /* ---------- Toast helper ---------- */
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  /* ---------- Utils ---------- */
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ---------- Init ---------- */
  function init() {
    load();
    // Wire up cart open/close buttons
    const openBtn = document.getElementById('openCart');
    const closeBtn = document.getElementById('closeCart');
    const overlay = document.getElementById('overlay');
    const continueBtn = document.getElementById('continueShopping');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (openBtn) openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', close);
    if (continueBtn) continueBtn.addEventListener('click', close);
    if (checkoutBtn) checkoutBtn.addEventListener('click', () => {
      if (cart.length === 0) {
        showToast('Carrinho vazio. Adicione produtos!');
        return;
      }
      close();
      // dispara evento para o checkout.js abrir
      global.dispatchEvent(new CustomEvent('cdb:open-checkout'));
    });

    // ESC fecha
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });

    updateUI();
  }

  /* ---------- API pública ---------- */
  global.CDBCart = {
    init, add, remove, setQty, clear,
    getItems, count, subtotal,
    open, close, isOpen,
    showToast,
  };

  // Auto-init when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expõe escapeHTML para outros módulos
  global.CDBCart._escapeHTML = escapeHTML;

})(window);
