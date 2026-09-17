/**
 * Casa dos Botões — Renderização do catálogo (store.js)
 * -------------------------------------------------------------
 * Responsável por:
 *   - Renderizar a grade de categorias
 *   - Renderizar os filtros por categoria
 *   - Renderizar os produtos (com lazy loading de imagem)
 *   - Aplicar busca, filtro e ordenação
 *   - Abrir modal de detalhes do produto
 *   - Configurar links do WhatsApp e ano do rodapé
 */

(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const formatBRL = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');

  /* ---------- Estado ---------- */
  const state = {
    categoriaAtiva: 'todos',
    busca: '',
    ordenar: 'destaque',
  };

  /* ---------- Helpers ---------- */
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function getCategoriaNome(catId) {
    const c = (global.CDB_CATEGORIES || []).find(c => c.id === catId);
    return c ? c.nome : catId;
  }

  /* ---------- Render categorias ---------- */
  function renderCategorias() {
    const cont = $('categoriasGrid');
    if (!cont) return;
    const cats = global.CDB_CATEGORIES || [];
    cont.innerHTML = cats.map(c => `
      <button type="button" class="cat-card" data-cat="${c.id}" aria-label="${escapeHTML(c.nome)}">
        <div class="cat-card-icon">${c.icone}</div>
        <h3>${escapeHTML(c.nome)}</h3>
        <p>${escapeHTML(c.descricao)}</p>
      </button>
    `).join('');

    // Adiciona o card "Ver tudo"
    const verTudo = document.createElement('button');
    verTudo.type = 'button';
    verTudo.className = 'cat-card';
    verTudo.dataset.cat = 'todos';
    verTudo.innerHTML = `
      <div class="cat-card-icon">⌘</div>
      <h3>Ver tudo</h3>
      <p>Todos os produtos da loja</p>`;
    cont.appendChild(verTudo);

    cont.querySelectorAll('.cat-card').forEach(el => {
      el.addEventListener('click', () => filtrarPorCategoria(el.dataset.cat));
    });
  }

  /* ---------- Render filtros ---------- */
  function renderFiltros() {
    const cont = $('filtros');
    if (!cont) return;
    const cats = global.CDB_CATEGORIES || [];
    const html = cats.map(c => `
      <button type="button" class="filtro" data-cat="${c.id}">${escapeHTML(c.nome)}</button>
    `).join('');
    cont.insertAdjacentHTML('beforeend', html);

    cont.querySelectorAll('.filtro').forEach(el => {
      el.addEventListener('click', () => filtrarPorCategoria(el.dataset.cat));
    });
  }

  function filtrarPorCategoria(cat) {
    state.categoriaAtiva = cat;
    // Atualiza os filtros visuais
    document.querySelectorAll('.filtro').forEach(el => {
      el.classList.toggle('active', el.dataset.cat === cat);
    });
    renderProdutos();
    // Scroll para a seção
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Render produtos ---------- */
  function getProdutosFiltrados() {
    let prods = (global.CDB_PRODUCTS || []).slice();

    // Filtro por categoria
    if (state.categoriaAtiva !== 'todos') {
      prods = prods.filter(p => p.categoria === state.categoriaAtiva);
    }
    // Filtro por busca
    if (state.busca) {
      const q = state.busca.toLowerCase().trim();
      prods = prods.filter(p =>
        p.nome.toLowerCase().includes(q) ||
        p.descricao.toLowerCase().includes(q) ||
        getCategoriaNome(p.categoria).toLowerCase().includes(q)
      );
    }
    // Ordenação
    if (state.ordenar === 'preco-asc') prods.sort((a,b) => a.preco - b.preco);
    else if (state.ordenar === 'preco-desc') prods.sort((a,b) => b.preco - a.preco);
    else if (state.ordenar === 'nome') prods.sort((a,b) => a.nome.localeCompare(b.nome));
    else if (state.ordenar === 'destaque') {
      // Destaques primeiro, depois promoções, depois por nome
      prods.sort((a,b) => {
        const score = p => (p.destaque ? 2 : 0) + (p.promocao ? 1 : 0);
        const sa = score(a), sb = score(b);
        if (sb !== sa) return sb - sa;
        return a.nome.localeCompare(b.nome);
      });
    }
    return prods;
  }

  function renderProdutos() {
    const cont = $('produtosGrid');
    const empty = $('produtosEmpty');
    if (!cont) return;
    const prods = getProdutosFiltrados();

    if (prods.length === 0) {
      cont.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    cont.innerHTML = prods.map(p => {
      const badges = [];
      if (p.destaque) badges.push('<span class="product-badge badge-destaque">Destaque</span>');
      if (p.promocao) badges.push('<span class="product-badge badge-promo">Promoção</span>');
      const precoAntigo = p.precoAntigo ? `<span class="preco-antigo">${formatBRL(p.precoAntigo)}</span>` : '';
      // Sistema de galeria: usa images[] se existir, senão fallback image
      const imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
      const imgPrincipal = imgs[0] || '';
      const hasGaleria = imgs.length > 1;
      const galeriaBadges = hasGaleria ? `<span class="product-badge badge-galeria">📷 ${imgs.length} fotos</span>` : '';

      // Estoque: mostra no badge e desabilita botão se esgotado
      let estoqueBadge = '';
      let botaoCarrinho = '';
      let cardEsgotado = '';
      // Quantidade por pacote (extraída do campo "unidade")
      const qtdPorPacote = (function() {
        const m = String(p.unidade || '').match(/(\d+)\s*unidades?/i);
        return m ? parseInt(m[1], 10) : 1;
      })();
      // Badge destacado com a quantidade de botões por pacote
      const pacoteBadge = qtdPorPacote > 1
        ? `<span class="product-badge badge-pacote">📦 ${qtdPorPacote} un.</span>`
        : '';
      if (global.CDBEstoque && p.estoque !== undefined && p.estoque !== 9999) {
        const atual = global.CDBEstoque.getEstoque(p.id);
        if (atual === 0) {
          estoqueBadge = '<span class="product-badge badge-esgotado">Esgotado</span>';
          botaoCarrinho = '<button class="btn-add-cart" disabled style="opacity:0.5;cursor:not-allowed">Esgotado</button>';
          cardEsgotado = 'esgotado';
        } else if (atual <= 5) {
          estoqueBadge = `<span class="product-badge badge-pouco">Restam ${atual}</span>`;
          botaoCarrinho = `<button class="btn-add-cart" data-action="add">+ Carrinho</button>`;
        } else {
          estoqueBadge = `<span class="product-badge badge-estoque">${atual} em estoque</span>`;
          botaoCarrinho = `<button class="btn-add-cart" data-action="add">+ Carrinho</button>`;
        }
      } else {
        botaoCarrinho = `<button class="btn-add-cart" data-action="add">+ Carrinho</button>`;
      }

      return `
        <article class="product-card ${cardEsgotado}" data-id="${p.id}">
          <div class="product-img" data-action="view">
            <div class="product-badges">${badges.join('')}${galeriaBadges}${pacoteBadge}${estoqueBadge}</div>
            <img src="images/products/${imgPrincipal}" alt="${escapeHTML(p.nome)}" loading="lazy"
                 onerror="this.onerror=null;this.src='images/products/${imgPrincipal.replace(/\.webp$/, '.jpg')}'">
          </div>
          <div class="product-info">
            <span class="product-cat">${escapeHTML(getCategoriaNome(p.categoria))}</span>
            <h3 class="product-name">${escapeHTML(p.nome)}</h3>
            <span class="product-unid">${escapeHTML(p.unidade)}</span>
            <div class="product-price">
              <span class="preco-atual">${formatBRL(p.preco)}</span>
              ${precoAntigo}
            </div>
            ${qtdPorPacote > 1 ? `<span class="product-price-per-unit">${formatBRL(p.preco / qtdPorPacote)} por botão</span>` : ''}
          </div>
          <div class="product-actions">
            ${botaoCarrinho}
            <button class="btn-quick-view" data-action="view" aria-label="Ver detalhes">Detalhes</button>
          </div>
        </article>
      `;
    }).join('');

    // Handlers
    cont.querySelectorAll('.product-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const action = e.currentTarget.dataset.action;
          if (action === 'add') global.CDBCart.add(id);
          else if (action === 'view') openProductModal(id);
        });
      });
    });
  }

  /* ---------- Product modal (com galeria dinâmica) ---------- */
  function openProductModal(id) {
    const p = (global.CDB_PRODUCTS || []).find(p => p.id === id);
    if (!p) return;
    const modal = $('productModal');
    const title = $('productModalTitle');
    const body = $('productModalBody');
    if (!modal || !body) return;

    title.textContent = p.nome;
    const detalhes = (p.detalhes || []).map(d => `<li>${escapeHTML(d)}</li>`).join('');
    const precoAntigo = p.precoAntigo ? `<span class="preco-antigo">${formatBRL(p.precoAntigo)}</span>` : '';

    // Sistema de galeria: lista de imagens (1 ou mais)
    const imgs = (p.images && p.images.length) ? p.images : (p.image ? [p.image] : []);
    const hasGaleria = imgs.length > 1;
    const imgPrincipal = imgs[0] || '';

    // Monta a galeria: imagem principal + miniaturas (se >1 foto)
    const galeriaPrincipal = `
      <div class="galeria-principal">
        <img id="galeriaImgPrincipal" src="images/products/${imgPrincipal}" alt="${escapeHTML(p.nome)}"
             onerror="this.onerror=null;this.src='images/products/${imgPrincipal.replace(/\.webp$/, '.jpg')}'">
        ${hasGaleria ? `<div class="galeria-counter"><span id="galeriaIdx">1</span> / ${imgs.length}</div>` : ''}
        ${hasGaleria && imgs.length > 1 ? `
          <button class="galeria-nav galeria-prev" type="button" aria-label="Foto anterior">‹</button>
          <button class="galeria-nav galeria-next" type="button" aria-label="Próxima foto">›</button>
        ` : ''}
      </div>
    `;
    const galeriaThumbs = hasGaleria ? `
      <div class="galeria-thumbs">
        ${imgs.map((img, i) => `
          <button class="galeria-thumb ${i === 0 ? 'active' : ''}" data-img="${img}" data-idx="${i}" type="button">
            <img src="images/products/${img}" alt="Miniatura ${i+1}" loading="lazy"
                 onerror="this.onerror=null;this.src='images/products/${img.replace(/\.webp$/, '.jpg')}'">
          </button>
        `).join('')}
      </div>
    ` : '';

    body.innerHTML = `
      <div class="product-modal-grid">
        <div class="product-modal-img">
          ${galeriaPrincipal}
          ${galeriaThumbs}
        </div>
        <div class="product-modal-info">
          <span class="product-cat">${escapeHTML(getCategoriaNome(p.categoria))}</span>
          <h2 class="product-name">${escapeHTML(p.nome)}</h2>
          <span class="product-unid">${escapeHTML(p.unidade)}</span>
          <div class="product-price">
            <span class="preco-atual">${formatBRL(p.preco)}</span>
            ${precoAntigo}
          </div>
          ${(() => {
            const qtdMatch = String(p.unidade || '').match(/(\d+)\s*unidades?/i);
            const qtd = qtdMatch ? parseInt(qtdMatch[1], 10) : 1;
            if (qtd > 1) {
              return `<span class="product-price-per-unit">${formatBRL(p.preco / qtd)} por botão</span>`;
            }
            return '';
          })()}
          <p class="product-modal-desc">${escapeHTML(p.descricao)}</p>
          <div class="product-modal-detalhes">
            <h4>Detalhes do produto</h4>
            <ul>${detalhes}</ul>
          </div>
          <div class="product-modal-actions">
            <button class="btn btn-primary" data-action="add">Adicionar ao carrinho</button>
            <button class="btn btn-outline" data-action="wpp">Chamar no WhatsApp</button>
          </div>
        </div>
      </div>`;

    // ----- Galeria dinâmica: troca de imagem -----
    if (hasGaleria) {
      const imgEl = body.querySelector('#galeriaImgPrincipal');
      const idxEl = body.querySelector('#galeriaIdx');
      const thumbs = body.querySelectorAll('.galeria-thumb');
      const prevBtn = body.querySelector('.galeria-prev');
      const nextBtn = body.querySelector('.galeria-next');
      let currentIdx = 0;

      function changeImage(newIdx) {
        if (newIdx < 0) newIdx = imgs.length - 1;
        if (newIdx >= imgs.length) newIdx = 0;
        currentIdx = newIdx;
        const newImg = imgs[newIdx];
        imgEl.style.opacity = '0';
        setTimeout(() => {
          imgEl.src = 'images/products/' + newImg;
          imgEl.onerror = function() {
            this.onerror = null;
            this.src = 'images/products/' + newImg.replace(/\.webp$/, '.jpg');
          };
          imgEl.style.opacity = '1';
        }, 150);
        if (idxEl) idxEl.textContent = newIdx + 1;
        thumbs.forEach((t, i) => t.classList.toggle('active', i === newIdx));
      }

      thumbs.forEach((t, i) => t.addEventListener('click', () => changeImage(i)));
      if (prevBtn) prevBtn.addEventListener('click', () => changeImage(currentIdx - 1));
      if (nextBtn) nextBtn.addEventListener('click', () => changeImage(currentIdx + 1));

      // Navegação por teclado
      document.addEventListener('keydown', function galeriaKey(e) {
        if (!modal.classList.contains('open')) {
          document.removeEventListener('keydown', galeriaKey);
          return;
        }
        if (e.key === 'ArrowLeft') changeImage(currentIdx - 1);
        else if (e.key === 'ArrowRight') changeImage(currentIdx + 1);
      });

      // Swipe no mobile
      let touchStartX = 0;
      imgEl.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      imgEl.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
          if (dx > 0) changeImage(currentIdx - 1);
          else changeImage(currentIdx + 1);
        }
      }, { passive: true });
    }

    // Ações do modal
    body.querySelector('[data-action="add"]')?.addEventListener('click', () => {
      global.CDBCart.add(id);
    });
    body.querySelector('[data-action="wpp"]')?.addEventListener('click', () => {
      const numero = (global.CDB_CONFIG?.whatsapp?.numero || '').replace(/\D/g, '');
      const msg = `Olá! Tenho interesse no produto "${p.nome}" (R$ ${p.preco.toFixed(2).replace('.', ',')}). Ele está disponível?`;
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, '_blank');
    });

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeProductModal() {
    const modal = $('productModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /* ---------- Busca ---------- */
  function initBusca() {
    const input = $('busca');
    if (!input) return;
    let timer;
    input.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.busca = e.target.value.trim();
        renderProdutos();
      }, 200);
    });
  }

  /* ---------- Ordenar ---------- */
  function initOrdenar() {
    const sel = $('ordenar');
    if (!sel) return;
    sel.addEventListener('change', (e) => {
      state.ordenar = e.target.value;
      renderProdutos();
    });
  }

  /* ---------- WhatsApp links + footer ---------- */
  function initFooter() {
    // Ano atual
    const ano = new Date().getFullYear();
    const anoEl = $('anoAtual');
    if (anoEl) anoEl.textContent = ano;

    // Link do WhatsApp no CTA e no rodapé
    const numero = (global.CDB_CONFIG?.whatsapp?.numero || '').replace(/\D/g, '');
    const msgPadrao = global.CDB_CONFIG?.whatsapp?.mensagemPadrao || 'Olá, Casa dos Botões!';
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(msgPadrao)}`;
    const cta = $('ctaWhatsapp');
    if (cta) cta.href = url;
    const footer = $('footerWhatsapp');
    if (footer) footer.href = url;
  }

  /* ---------- Init ---------- */
  function init() {
    renderCategorias();
    renderFiltros();
    renderProdutos();
    initBusca();
    initOrdenar();
    initFooter();

    // Product modal
    $('closeProductModal')?.addEventListener('click', closeProductModal);
    $('productModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'productModal') closeProductModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeProductModal();
    });

    // Re-renderiza quando o carrinho muda (para atualizar contadores)
    global.addEventListener('cdb:cart-change', () => {
      // Não precisa re-renderizar os produtos, só o carrinho
    });

    // Re-renderiza quando o estoque muda (pedido confirmado, sincronização nuvem)
    global.addEventListener('cdb:estoque-atualizado', () => {
      console.log('[store] Re-renderizando produtos (estoque atualizado)');
      renderProdutos();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.CDBStore = { renderProdutos, openProductModal };
})(window);
