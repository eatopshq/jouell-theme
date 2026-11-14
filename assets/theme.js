/* Jouell theme — small, dependency-free behaviours. */
(() => {
  const theme = window.theme || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Money ---------- */

  function formatMoney(cents, format = theme.moneyFormat || '₹{{amount}}') {
    const value = Number(cents) / 100;
    const group = (n, decimals, thousands = ',', decimal = '.') => {
      const fixed = n.toFixed(decimals);
      const [int, frac] = fixed.split('.');
      const intStr = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
      return frac ? intStr + decimal + frac : intStr;
    };
    const indian = (n, decimals) =>
      n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount':
          return group(value, 2);
        case 'amount_no_decimals':
          return group(value, 0);
        case 'amount_with_comma_separator':
          return group(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator':
          return group(value, 0, '.', ',');
        case 'amount_with_space_separator':
          return group(value, 2, ' ', ',');
        case 'amount_no_decimals_with_space_separator':
          return group(value, 0, ' ', ',');
        case 'amount_with_apostrophe_separator':
          return group(value, 2, "'", '.');
        default:
          return indian(value, 0);
      }
    });
  }

  function rupees(cents) {
    // Prices in the design are written whole-rupee, Indian grouping: ₹4,12,000
    const fmt = theme.moneyFormat || '';
    if (/₹|Rs/.test(fmt) || fmt === '') {
      return '₹' + Math.round(cents / 100).toLocaleString('en-IN');
    }
    // Whole amounts, like Liquid's money_without_trailing_zeros
    return formatMoney(cents).replace(/[.,]00(?=\D*$)/, '');
  }

  /* ---------- Header: mobile nav + search ---------- */

  function toggle(button, panel, force) {
    const open = force ?? button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    return open;
  }

  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav-toggle]');
    if (navBtn) {
      toggle(navBtn, $('[data-mobile-nav]'));
      return;
    }
    const searchBtn = e.target.closest('[data-search-toggle]');
    if (searchBtn) {
      const panel = $('[data-search-panel]');
      if (toggle(searchBtn, panel)) $('input[type="search"]', panel)?.focus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const searchBtn = $('[data-search-toggle][aria-expanded="true"]');
    if (searchBtn) toggle(searchBtn, $('[data-search-panel]'), false);
    closeDrawer();
  });

  // Sticky header: soft shadow once it has stuck to the top
  const stickyHeader = $('.header--sticky');
  if (stickyHeader) {
    const onScroll = () =>
      stickyHeader.classList.toggle('is-stuck', window.scrollY > 0 && stickyHeader.getBoundingClientRect().top <= 0);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Cart ---------- */

  const drawer = $('[data-cart-drawer]');
  let lastFocus = null;

  function openDrawer() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    drawer.hidden = false;
    document.body.classList.add('no-scroll');
    $('.drawer__panel', drawer).focus();
  }

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('no-scroll');
    lastFocus?.focus();
  }

  async function refreshCart() {
    const res = await fetch(`${theme.routes.root}?sections=cart-fragment`);
    const data = await res.json();
    const html = data['cart-fragment'];
    if (html && drawer) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const inner = doc.querySelector('.shopify-section') || doc.body;
      $('[data-cart-drawer-body]', drawer).innerHTML = inner.innerHTML;
    }
    const cart = await fetch(`${theme.routes.cart}.js`).then((r) => r.json());
    $$('[data-cart-count]').forEach((el) => (el.textContent = cart.item_count));
    return cart;
  }

  async function addToCart(items) {
    const res = await fetch(`${theme.routes.cartAdd}.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.description || data.message || theme.strings.error);
    return data;
  }

  function afterAdd() {
    if (theme.cartType === 'page' || !drawer) {
      window.location.href = theme.routes.cart;
      return;
    }
    return refreshCart().then(openDrawer);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer-close]')) {
      closeDrawer();
      return;
    }
    const toggleBtn = e.target.closest('[data-cart-toggle]');
    if (toggleBtn && drawer && !document.body.classList.contains('template-cart')) {
      e.preventDefault();
      refreshCart().then(openDrawer);
      return;
    }
    const change = e.target.closest('[data-line-change]');
    if (change) {
      e.preventDefault();
      change.disabled = true;
      fetch(`${theme.routes.cartChange}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: change.dataset.key, quantity: Number(change.dataset.lineChange) }),
      })
        .then(() => {
          if (document.body.classList.contains('template-cart')) {
            window.location.reload();
          } else {
            return refreshCart();
          }
        })
        .catch(() => (change.disabled = false));
    }
  });

  /* ---------- Product page ---------- */

  function initProduct(root) {
    const form = $('[data-product-form]', root);
    if (!form) return;
    const idInput = $('[data-variant-id]', form);
    const addBtn = $('[data-add-button]', form);
    const buyNow = $('[data-buy-now]', form);
    const errorEl = $('[data-form-error]', form);
    const picker = $('[data-variant-picker]', root);
    const variants = picker ? JSON.parse($('[data-variants]', picker).textContent) : [];
    const sticky = $('[data-sticky-buy]', root);
    const stickyAdd = $('[data-sticky-add]', root);
    const stickyPrice = $('[data-sticky-price]', root);

    // Quantity
    const qty = $('[data-qty] input', root);
    $('[data-qty-minus]', root)?.addEventListener('click', () => {
      qty.value = Math.max(1, Number(qty.value) - 1);
    });
    $('[data-qty-plus]', root)?.addEventListener('click', () => {
      qty.value = Number(qty.value) + 1;
    });

    // Variant selection
    picker?.addEventListener('change', () => {
      const selected = $$('[data-option-index]:checked', picker).map((i) => i.value);
      const variant = variants.find((v) => v.options.every((opt, i) => opt === selected[i]));
      const priceWrap = $('[data-product-price]', root);

      if (!variant) {
        addBtn.disabled = true;
        addBtn.textContent = theme.strings.soldOut;
        if (buyNow) buyNow.disabled = true;
        return;
      }

      idInput.value = variant.id;
      addBtn.disabled = !variant.available;
      if (buyNow) buyNow.disabled = !variant.available;
      addBtn.textContent = variant.available ? theme.strings.addToBag : theme.strings.soldOut;
      if (stickyAdd) {
        stickyAdd.disabled = !variant.available;
        stickyAdd.textContent = addBtn.textContent;
      }
      // Sold-out option: offer "Notify me", tagged with the exact option wanted
      const notify = $('[data-notify-form]');
      if (notify) {
        notify.hidden = variant.available;
        const tags = $('[data-notify-tags]', notify);
        if (tags) tags.value = `back-in-stock,notify-${tags.dataset.handle},notify-variant-${variant.id}`;
      }

      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url);

      // Re-render price from the server so "You save" stays in the store's format
      if (priceWrap) {
        fetch(`${root.dataset.url}?variant=${variant.id}&section_id=${root.dataset.sectionId}`)
          .then((r) => r.text())
          .then((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const fresh = doc.querySelector('[data-product-price]');
            if (fresh) priceWrap.innerHTML = fresh.innerHTML;
            const current = fresh && fresh.querySelector('.price__current');
            if (current && stickyPrice) stickyPrice.textContent = current.textContent.trim();
          });
      }

      if (variant.featured_media) showMedia(root, variant.featured_media.id);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const goToCheckout = e.submitter && e.submitter.hasAttribute('data-buy-now');
      errorEl.hidden = true;
      const label = addBtn.textContent;
      addBtn.disabled = true;
      if (!goToCheckout) addBtn.textContent = theme.strings.adding;
      try {
        await addToCart([{ id: Number(idInput.value), quantity: Number(qty?.value || 1) }]);
        if (goToCheckout) {
          window.location.href = '/checkout';
          return;
        }
        await afterAdd();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = label;
      }
    });

    // Gallery thumbs
    $$('[data-thumb]', root).forEach((btn) =>
      btn.addEventListener('click', () => showMedia(root, btn.dataset.thumb))
    );

    // Mobile swipe keeps the thumb state in sync
    const main = $('[data-gallery-main]', root);
    if (main && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && window.matchMedia('(max-width: 989px)').matches) {
              markThumb(root, entry.target.dataset.mediaId);
            }
          });
        },
        { root: main, threshold: 0.6 }
      );
      $$('[data-media-id]', main).forEach((slide) => io.observe(slide));
    }

    // Mobile: show the sticky bar once the main Add to bag button has scrolled away
    if (sticky && 'IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => {
        const passed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        sticky.classList.toggle('is-visible', passed);
        document.body.classList.toggle('has-sticky-buy', passed); // lifts the WhatsApp button above the bar
        sticky.setAttribute('aria-hidden', String(!passed));
        stickyAdd.tabIndex = passed ? 0 : -1;
      }).observe(addBtn);
    }
  }

  function markThumb(root, id) {
    $$('[data-thumb]', root).forEach((t) => {
      const on = t.dataset.thumb === String(id);
      t.classList.toggle('is-active', on);
      if (on) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
    $$('[data-dot]', root).forEach((d) => d.classList.toggle('is-active', d.dataset.dot === String(id)));
  }

  function showMedia(root, id) {
    const main = $('[data-gallery-main]', root);
    const slide = $(`[data-media-id="${id}"]`, main);
    if (!slide) return;
    $$('[data-media-id]', main).forEach((s) => s.classList.toggle('is-active', s === slide));
    if (window.matchMedia('(max-width: 989px)').matches) {
      main.scrollTo({ left: slide.offsetLeft - main.offsetLeft, behavior: 'smooth' });
    }
    markThumb(root, id);
  }

  /* ---------- Product recommendations ---------- */

  function initRecommendations(el) {
    if (el.querySelector('.product-grid')) return;
    fetch(el.dataset.url)
      .then((r) => r.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fresh = doc.querySelector('[data-recommendations]');
        if (fresh && fresh.innerHTML.trim()) {
          el.innerHTML = fresh.innerHTML;
          $$('[data-mobile-scroll]', el).forEach(initMobileScroll);
          syncWishes();
        }
      })
      .catch(() => {});
  }

  /* ---------- Wedding week ---------- */

  function initWeddingWeek(root) {
    const days = $$('[data-week-day]', root);
    const benchmark = Number(root.dataset.benchmark || 0);
    const totalEl = $('[data-week-total]', root);
    const savedEl = $('[data-week-saved]', root);

    const current = (day) => $$('[data-week-option]', day).find((o) => !o.hidden);

    function update() {
      const total = days.reduce((sum, day) => {
        const opt = current(day);
        return sum + (opt ? Number(opt.dataset.price) : 0);
      }, 0);
      totalEl.textContent = rupees(total);
      savedEl.textContent = rupees(Math.max(0, benchmark - total));
    }

    days.forEach((day) => {
      const options = $$('[data-week-option]', day);
      const count = $('[data-week-count]', day);
      const price = $('[data-week-price]', day);
      const step = (dir) => {
        const i = options.indexOf(current(day));
        const next = (i + dir + options.length) % options.length;
        options.forEach((o, n) => (o.hidden = n !== next));
        count.textContent = `${next + 1} ${count.dataset.of} ${options.length}`;
        price.textContent = rupees(Number(options[next].dataset.price));
        update();
      };
      $('[data-week-prev]', day)?.addEventListener('click', () => step(-1));
      $('[data-week-next]', day)?.addEventListener('click', () => step(1));
      const first = current(day);
      if (first) price.textContent = rupees(Number(first.dataset.price));
    });

    update();

    const addBtn = $('[data-week-add]', root);
    addBtn?.addEventListener('click', async () => {
      const items = days
        .map(current)
        .filter((o) => o && o.dataset.available === 'true')
        .map((o) => ({ id: Number(o.dataset.variantId), quantity: 1 }));
      if (!items.length) return;
      const label = addBtn.textContent;
      addBtn.disabled = true;
      addBtn.textContent = theme.strings.adding;
      try {
        await addToCart(items);
        await afterAdd();
      } catch (err) {
        alert(err.message);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = label;
      }
    });
  }

  /* ---------- Craft explorer (tabs) ---------- */

  function initCraft(root) {
    const tabs = $$('[data-craft-tab]', root);
    const panels = $$('[data-craft-panel]', root);
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach((p) => (p.hidden = p.id !== tab.getAttribute('aria-controls')));
    };
    tabs.forEach((tab, i) => {
      tab.tabIndex = i === 0 ? 0 : -1;
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const next = tabs[(i + dir + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });

    // Theme editor: show the block being edited
    document.addEventListener('shopify:block:select', (e) => {
      const panel = root.querySelector(`[data-craft-panel]#CraftPanel-${e.detail.blockId}`);
      if (panel) select($(`#CraftTab-${e.detail.blockId}`, root));
    });
  }

  /* ---------- Collection: filters, sort, load more ---------- */

  function initCollection(root) {
    const sectionId = root.dataset.sectionId;

    async function load(url, push = true) {
      const results = $('[data-collection-results]', root);
      results?.setAttribute('aria-busy', 'true');
      const fetchUrl = new URL(url, window.location.origin);
      fetchUrl.searchParams.set('section_id', sectionId);
      const html = await fetch(fetchUrl).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fresh = doc.querySelector('[data-collection]');
      if (fresh) {
        const wasOpen = $('[data-filters]', root)?.classList.contains('is-open');
        root.innerHTML = fresh.innerHTML;
        if (wasOpen) {
          $('[data-filters]', root)?.classList.add('is-open');
          $('[data-filter-toggle]', root)?.setAttribute('aria-expanded', 'true');
        }
      }
      if (push) window.history.pushState({}, '', url);
    }

    function urlFromForm() {
      const form = $('[data-filter-form]', root);
      const params = new URLSearchParams(new FormData(form));
      const sort = $('[data-sort-select]', root);
      if (sort) params.set('sort_by', sort.value);
      for (const [k, v] of Array.from(params.entries())) if (v === '') params.delete(k);
      return `${window.location.pathname}?${params.toString()}`;
    }

    let timer;
    root.addEventListener('change', (e) => {
      if (!e.target.closest('[data-filter-form]') && !e.target.matches('[data-sort-select]')) return;
      clearTimeout(timer);
      const delay = e.target.type === 'number' ? 600 : 0;
      timer = setTimeout(() => {
        const form = $('[data-filter-form]', root);
        if (!form) {
          const params = new URLSearchParams(window.location.search);
          params.set('sort_by', e.target.value);
          load(`${window.location.pathname}?${params}`);
          return;
        }
        load(urlFromForm());
      }, delay);
    });

    root.addEventListener('click', async (e) => {
      const toggleBtn = e.target.closest('[data-filter-toggle]');
      if (toggleBtn) {
        const panel = $('[data-filters]', root);
        const open = panel.classList.toggle('is-open');
        toggleBtn.setAttribute('aria-expanded', String(open));
        return;
      }
      const filterLink = e.target.closest('[data-filter-link]');
      if (filterLink) {
        e.preventDefault();
        load(filterLink.href);
        return;
      }
      const more = e.target.closest('[data-load-more]');
      if (more) {
        e.preventDefault();
        more.setAttribute('aria-busy', 'true');
        const fetchUrl = new URL(more.href, window.location.origin);
        fetchUrl.searchParams.set('section_id', sectionId);
        const html = await fetch(fetchUrl).then((r) => r.text());
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const grid = $('[data-product-grid]', root);
        $$('[data-product-grid] > *', doc).forEach((card) => grid.appendChild(card));
        const nextWrap = doc.querySelector('[data-load-more-wrap]');
        const wrap = $('[data-load-more-wrap]', root);
        if (nextWrap) wrap.replaceWith(nextWrap);
        else wrap.remove();
      }
    });

    window.addEventListener('popstate', () => load(window.location.href, false));
  }

  /* ---------- Mobile swipe rows: thin progress line ---------- */

  function initMobileScroll(row) {
    if (row.nextElementSibling?.classList.contains('scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(document.createElement('span'));
    row.after(bar);
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      bar.classList.toggle('scroll-progress--hidden', max <= 2);
      if (max <= 2) return;
      const size = Math.max(12, (row.clientWidth / row.scrollWidth) * 100);
      bar.style.setProperty('--progress-size', size + '%');
      const ratio = row.scrollLeft / max;
      bar.style.setProperty('--progress-x', ratio * ((100 - size) / size) * 100 + '%');
    };
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- Instagram reels ---------- */

  function initReels(root) {
    const track = $('[data-scroll-track]', root);
    if (!track) return;
    const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth' });
    $('[data-scroll-prev]', root)?.addEventListener('click', () => step(-1));
    $('[data-scroll-next]', root)?.addEventListener('click', () => step(1));

    // Uploaded reels play silently while on screen, unless the visitor prefers less motion
    const videos = $$('video', track);
    if (!videos.length || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.play().catch(() => {});
          else e.target.pause();
        }),
      { threshold: 0.6 }
    );
    videos.forEach((v) => {
      v.muted = true;
      io.observe(v);
    });
  }

  /* ---------- Wishlist (saved on this device) ---------- */

  const WISH_KEY = 'jouell_wishlist';
  const readWishes = () => {
    try {
      return JSON.parse(localStorage.getItem(WISH_KEY)) || [];
    } catch (e) {
      return [];
    }
  };
  const writeWishes = (list) => {
    try {
      localStorage.setItem(WISH_KEY, JSON.stringify(list));
    } catch (e) {
      /* storage blocked: the heart still toggles for this page view */
    }
  };

  function syncWishes() {
    const list = readWishes();
    $$('[data-wish]').forEach((btn) => {
      const on = list.includes(btn.dataset.wish);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? theme.strings.wishSaved : theme.strings.wishSave);
    });
    $$('[data-wish-count]').forEach((el) => {
      el.textContent = list.length ? `(${list.length})` : '';
      el.hidden = !list.length;
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wish]');
    if (!btn) return;
    e.preventDefault();
    const handle = btn.dataset.wish;
    const list = readWishes();
    const i = list.indexOf(handle);
    if (i > -1) list.splice(i, 1);
    else list.unshift(handle);
    writeWishes(list);
    syncWishes();
    if (btn.closest('[data-wishlist-page]') && i > -1) renderWishlistPage();
  });

  async function renderWishlistPage() {
    const page = $('[data-wishlist-page]');
    if (!page) return;
    const grid = $('[data-wishlist-grid]', page);
    const empty = $('[data-wishlist-empty]', page);
    const list = readWishes();
    const products = (
      await Promise.all(
        list.map((h) =>
          fetch(`${theme.routes.root}products/${encodeURIComponent(h)}.js`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      )
    ).filter(Boolean);
    // Drop products that no longer exist
    if (products.length !== list.length) writeWishes(products.map((p) => p.handle));
    grid.innerHTML = '';
    products.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card';
      const img = p.featured_image ? `${p.featured_image}${p.featured_image.includes('?') ? '&' : '?'}width=600` : '';
      const onSale = p.compare_at_price > p.price;
      const pct = onSale ? Math.round(((p.compare_at_price - p.price) * 100) / p.compare_at_price) : 0;
      card.innerHTML = `
        <a href="${p.url}" class="card__media" style="--ratio: 4/5;">${img ? `<img src="${img}" alt="" loading="lazy">` : ''}
          ${p.available ? '' : `<span class="card__flag card__flag--soldout">${theme.strings.soldOutLabel}</span>`}</a>
        <h3 class="card__title"><a href="${p.url}"></a></h3>
        <div class="price"><span class="price__current">${rupees(p.price)}</span>
          ${onSale ? `<s class="price__compare">${rupees(p.compare_at_price)}</s><span class="price__save">${theme.strings.savePercent.replace('PERCENT', pct)}</span>` : ''}</div>
        <button type="button" class="wishlist-card__remove" data-wish="${p.handle}">${theme.strings.wishRemove}</button>`;
      $('.card__title a', card).textContent = p.title;
      grid.appendChild(card);
    });
    empty.hidden = products.length > 0;
    syncWishes();
  }

  /* ---------- Bangle size guide ---------- */

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-size-guide-open]');
    if (open) {
      const dialog = document.getElementById(open.getAttribute('aria-controls'));
      if (dialog?.showModal) dialog.showModal();
      return;
    }
    if (e.target.closest('[data-size-guide-close]')) e.target.closest('dialog')?.close();
    else if (e.target.matches('dialog[data-size-guide]')) e.target.close(); // click on the backdrop
  });

  /* ---------- WhatsApp button: out of the way while scrolling on phones ---------- */

  const waFloat = $('.wa-float');
  if (waFloat && window.matchMedia('(max-width: 749px)').matches) {
    let idle;
    window.addEventListener(
      'scroll',
      () => {
        waFloat.classList.add('is-scrolling');
        clearTimeout(idle);
        idle = setTimeout(() => waFloat.classList.remove('is-scrolling'), 700);
      },
      { passive: true }
    );
  }

  /* ---------- Hero slideshow ---------- */

  function initHero(root) {
    const track = $('[data-hero-track]', root);
    const slides = $$('[data-hero-slide]', root);
    if (!track || slides.length < 2) return;
    const dots = $$('[data-hero-dot]', root);
    let current = 0;
    let timer = null;

    const goTo = (i) => {
      const next = (i + slides.length) % slides.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    };

    const mark = (i) => {
      current = i;
      dots.forEach((d, n) => {
        if (n === i) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
      // Off-screen slides stay out of the tab order
      slides.forEach((s, n) => (s.inert = n !== i));
    };

    let raf = null;
    track.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const i = Math.round(track.scrollLeft / track.clientWidth);
          if (i !== current) mark(i);
        });
      },
      { passive: true }
    );

    // Autoplay, unless switched off or the visitor prefers less motion
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const auto = root.dataset.autoplay === 'true' && !reduce;
    const interval = Number(root.dataset.interval || 6) * 1000;
    const stop = () => {
      clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (!auto || timer || document.hidden) return;
      timer = setInterval(() => goTo(current + 1), interval);
    };

    dots.forEach((d) =>
      d.addEventListener('click', () => {
        stop();
        goTo(Number(d.dataset.heroDot));
        start();
      })
    );
    $('[data-hero-prev]', root)?.addEventListener('click', () => {
      stop();
      goTo(current - 1);
      start();
    });
    $('[data-hero-next]', root)?.addEventListener('click', () => {
      stop();
      goTo(current + 1);
      start();
    });

    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', start);
    track.addEventListener('touchstart', stop, { passive: true });
    track.addEventListener('touchend', start, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    window.addEventListener('resize', () => track.scrollTo({ left: current * track.clientWidth }));

    // Theme editor: jump to the slide being edited
    root.addEventListener('shopify:block:select', (e) => {
      stop();
      const i = slides.indexOf(e.target);
      if (i > -1) goTo(i);
    });

    mark(0);
    start();
  }

  /* ---------- Popups ---------- */

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    sget: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  let openPopup = null;
  let popupReturnFocus = null;

  function showPopup(el) {
    if (!el || openPopup || (drawer && !drawer.hidden)) return false;
    popupReturnFocus = document.activeElement;
    el.hidden = false;
    document.body.classList.add('no-scroll');
    openPopup = el;
    ($('input:not([type="hidden"])', el) || $('.popup__close', el))?.focus();
    return true;
  }

  function hidePopup() {
    if (!openPopup) return;
    const el = openPopup;
    el.hidden = true;
    openPopup = null;
    document.body.classList.remove('no-scroll');
    if (el.dataset.popup === 'signup' && !store.get('jouell_signup_done')) {
      store.set('jouell_signup_dismissed', String(Date.now()));
    }
    popupReturnFocus?.focus?.();
  }

  document.addEventListener('click', (e) => {
    if (openPopup && e.target.closest('[data-popup-close]')) hidePopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePopup();
  });

  // WhatsApp signup: once per visitor; a dismissal rests it for 7 days
  function initSignup() {
    const el = $('[data-popup="signup"]');
    if (!el) return;
    const fromPopup = location.hash === '#SignupPopupForm';

    if ($('[data-signup-success]', el)) {
      // The page reloads after the form posts; only reopen if this popup sent it
      if (fromPopup) {
        store.set('jouell_signup_done', '1');
        showPopup(el);
      }
      const copy = $('[data-copy-code]', el);
      copy?.addEventListener('click', () => {
        navigator.clipboard?.writeText($('[data-code]', el).textContent.trim()).then(() => {
          copy.textContent = theme.strings.copied;
        });
      });
      return;
    }

    const form = $('[data-signup-form]', el);
    const phone = $('[data-signup-phone]', el);
    const tags = $('[data-signup-tags]', el);
    const error = $('[data-signup-error]', el);
    form?.addEventListener('submit', (e) => {
      const digits = phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      if (!/^[6-9]\d{9}$/.test(digits)) {
        e.preventDefault();
        error.hidden = false;
        phone.focus();
        return;
      }
      // Shopify's signup form saves email; the number rides along as a customer tag
      tags.value = `${tags.value},wa-91${digits}`;
    });

    if (fromPopup) {
      showPopup(el); // came back with a form error: show it again
      return;
    }
    if (store.get('jouell_signup_done')) return;
    if (Date.now() - Number(store.get('jouell_signup_dismissed') || 0) < 7 * 864e5) return;
    setTimeout(() => showPopup(el), Number(el.dataset.delay || 10) * 1000);
  }

  // Exit intent: once per session, only when the bag has items
  function initExit() {
    const el = $('[data-popup="exit"]');
    if (!el || store.sget('jouell_exit_shown')) return;
    const start = Date.now();
    let armed = true;

    const trigger = async () => {
      if (!armed || openPopup || Date.now() - start < 4000) return;
      armed = false;
      try {
        const cart = await fetch(`${theme.routes.cart}.js`).then((r) => r.json());
        if (!cart.item_count) {
          armed = true;
          return;
        }
        const sized = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}width=160` : '');
        const list = $('[data-exit-items]', el);
        list.innerHTML = '';
        cart.items.slice(0, 3).forEach((item) => {
          const li = document.createElement('li');
          const img = document.createElement('img');
          img.src = sized(item.image);
          img.alt = item.product_title;
          img.width = 64;
          img.height = 80;
          li.appendChild(img);
          list.appendChild(li);
        });
        if (cart.items.length > 3) {
          const more = document.createElement('li');
          more.className = 'popup__more';
          more.textContent = theme.strings.more.replace('{{ count }}', cart.items.length - 3);
          list.appendChild(more);
        }
        $('[data-exit-subtotal]', el).textContent = rupees(cart.total_price);
        if (showPopup(el)) store.sset('jouell_exit_shown', '1');
        else armed = true;
      } catch (err) {
        armed = true;
      }
    };

    // Desktop: the cursor leaves through the top of the window
    document.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget && e.clientY <= 0) trigger();
    });

    // Touch screens: a fast flick back up after browsing down the page
    if (window.matchMedia('(hover: none)').matches) {
      let lastY = window.scrollY;
      let lastT = performance.now();
      window.addEventListener(
        'scroll',
        () => {
          const y = window.scrollY;
          const t = performance.now();
          const speed = (lastY - y) / Math.max(t - lastT, 1);
          if (speed > 1.5 && lastY > 600) trigger();
          lastY = y;
          lastT = t;
        },
        { passive: true }
      );
    }
  }

  // Theme editor: show a popup while its section is selected
  document.addEventListener('shopify:section:select', (e) => {
    const popup = e.target.querySelector('[data-popup]');
    if (!popup) return;
    hidePopup();
    showPopup(popup);
  });
  document.addEventListener('shopify:section:deselect', (e) => {
    if (e.target.querySelector('[data-popup]')) hidePopup();
  });

  /* ---------- Init ---------- */

  function init(scope = document) {
    $$('[data-hero]', scope).forEach(initHero);
    $$('[data-product]', scope).forEach(initProduct);
    $$('[data-recommendations]', scope).forEach(initRecommendations);
    $$('[data-wedding-week]', scope).forEach(initWeddingWeek);
    $$('[data-craft-explorer]', scope).forEach(initCraft);
    $$('[data-collection]', scope).forEach(initCollection);
    $$('[data-reels]', scope).forEach(initReels);
    $$('[data-mobile-scroll]', scope).forEach(initMobileScroll);
  }

  init();
  syncWishes();
  renderWishlistPage();
  initSignup();
  initExit();
  document.addEventListener('shopify:section:load', (e) => init(e.target));
})();
