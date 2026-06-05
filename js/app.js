// =============================================================
//  app.js — Catalog, render, filters, search, theme, chat, init
// =============================================================
// ===== CATALOG (Firestore-only) =====
async function loadCatalogFromFirestore(forceRefresh = false) {
    const now = Date.now();
    const CACHE_TTL = 30000; // 30s

    if (!forceRefresh && window.appState.catalogCache && (now - window.appState.catalogLastFetch < CACHE_TTL)) {
        window.appState.catalogData = window.appState.catalogCache;
        renderItems(getFilteredData());
        return;
    }

    // Wait for Firebase module to finish assigning window.fb* globals before
    // calling Firestore — fixes "window.fbCollection is not a function" race.
    try {
        await waitForFirebase();
    } catch (e) {
        showCatalogError(e.message, true);
        return;
    }

    // 5-second timeout — if Firestore hasn't responded, show a clear error
    // instead of leaving the skeleton / empty grid indefinitely.
    const timeoutId = setTimeout(() => {
        if (AppStore.get('catalogData').length === 0) {
            showCatalogError(
                'Taking too long to load. Check your internet connection.',
                true /* showRetry */
            );
        }
    }, 5000);

    try {
        const snap = await window.fbGetDocs(window.fbCollection(window.db, "products"));
        clearTimeout(timeoutId);

        const parsed = snap.docs.map(d => {
            const data = d.data();
            return {
                ...data,
                firestoreId: d.id,
                id: data.id ?? data.sheet_id ?? d.id,
                price: parseFloat(data.price) || 0,
                quantityType: data.quantityType || inferQuantityType(data.type),
                minQty: parseFloat(data.minQty) || 1,
                step: parseFloat(data.step) || 1,
            };
        }).filter(p => p.name);

        if (!parsed.length) {
            showCatalogError(
                'No products in the catalog yet. Add your first product via the Admin panel.',
                true /* showRetry */
            );
            return;
        }
        window.appState.catalogData = parsed;
        window.appState.catalogCache = parsed;
        window.appState.catalogLastFetch = Date.now();
        if (typeof _sf !== 'undefined') sfApply(); else renderItems(getFilteredData());
    } catch(e) {
        clearTimeout(timeoutId);
        console.error("loadCatalogFromFirestore error:", e);
        showCatalogError(
            'Could not load catalog — ' + (e.message || 'Check internet connection and Firestore rules.'),
            true /* showRetry */
        );
    }
}
window.loadProductsFromFirestore = loadCatalogFromFirestore;

const CONCERN_KEYWORDS = {
    immunity: ['immunity','immune','cold','fever','vitamin','antioxidant','infection','flu','viral','antiviral','antibacterial','antibiotic','resist','tulsi','giloy','amla','neem','turmeric'],
    digestion: ['digest','gut','stomach','bowel','constipation','bloat','gas','acidity','liver','bile','detox','laxative','curry','ginger','ajwain','jeera','fennel','triphala'],
    skin: ['skin','glow','acne','pimple','complexion','eczema','rash','wound','heal','aloe','neem','turmeric','sandalwood','kumkum','face','anti-ageing','collagen'],
    diabetes: ['diabetes','sugar','blood sugar','glucose','insulin','glycemic','bitter','karela','fenugreek','methi','jamun','cinnamon','gurmar'],
    hair: ['hair','scalp','dandruff','alopecia','growth','shining','strengthen','bhringraj','amla','curry leaves','hibiscus','neem','coconut'],
    weight: ['weight','fat','obesity','metabolism','slimming','appetite','calorie','detox','green tea','garcinia','triphala','guggul','fennel'],
    heart: ['heart','cholesterol','blood pressure','cardiac','artery','circulation','omega','garlic','arjuna','amla','brahmi','turmeric'],
    stress: ['stress','anxiety','sleep','calm','relax','mood','mental','adaptogen','ashwagandha','brahmi','shankhpushpi','tulsi','lavender','chamomile']
};

window._activeConcern = null;
window._activeHealthFilter = 'all';
window._priceMin = null;
window._priceMax = null;
;

window.filterByHealth = function(type, el) {
    window._activeHealthFilter = type;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    updateFilterClearBtn();
    renderItems(getFilteredData());
};
;

function updateFilterClearBtn() {
    const btn = document.getElementById('filterClearBtn');
    const hasFilters = window._activeHealthFilter !== 'all' || window._priceMin !== null || window._priceMax !== null;
    if (btn) btn.style.display = hasFilters ? 'block' : 'none';
}

window.clearAllFilters = function() {
    window._activeHealthFilter = 'all';
    window._priceMin = null;
    window._priceMax = null;
    window._activeConcern = null;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    const allChip = document.querySelector('.filter-chip[data-health="all"]');
    if (allChip) allChip.classList.add('active');
    document.querySelectorAll('.concern-card').forEach(c => c.classList.remove('active'));
    document.getElementById('concernClearWrap').innerHTML = '';
    const minEl = document.getElementById('priceMin'); if (minEl) minEl.value = '';
    const maxEl = document.getElementById('priceMax'); if (maxEl) maxEl.value = '';
    updateFilterClearBtn();
    renderItems(getFilteredData());
};

// ===== SMART SEARCH SUGGESTIONS =====
const sugBox = () => document.getElementById('searchSuggestions');

function showSuggestions(term) {
    const box = sugBox();
    if (!box) return;
    if (!term || term.length < 2) { box.style.display = 'none'; return; }
    const lower = term.toLowerCase();
    const catalog = window.appState?.catalogData || [];
    const matches = catalog.filter(p =>
        (p.name || '').toLowerCase().includes(lower) ||
        (p.scientific || '').toLowerCase().includes(lower) ||
        (p.uses || '').toLowerCase().includes(lower) ||
        (p.description || '').toLowerCase().includes(lower)
    ).slice(0, 7);

    if (!matches.length) {
        box.innerHTML = `<div class="search-suggestions-empty">No matches found</div>`;
        box.style.display = 'block';
        return;
    }
    box.innerHTML = matches.map(p => `
        <div class="search-suggestion-item" onclick="selectSuggestion(${JSON.stringify(p.name)})">
            <i class="fas fa-seedling sug-icon"></i>
            <span>${escapeHTML(p.name)}</span>
            ${p.scientific ? `<em style="font-size:0.63rem;color:var(--text-muted);font-style:italic">${escapeHTML(p.scientific)}</em>` : ''}
            <span class="sug-type">${String(p.type||'').replace('_',' ')}</span>
        </div>`).join('');
    box.style.display = 'block';
}

window.selectSuggestion = function(name) {
    const input = document.getElementById('searchInput');
    if (input) input.value = name;
    sugBox().style.display = 'none';
    renderItems(getFilteredData());
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) sugBox() && (sugBox().style.display = 'none');
});

// ===== FREQUENTLY BOUGHT TOGETHER =====
function getFrequentlyBoughtTogether(itemId, catalog, count = 3) {
    // Client-side affinity: same type category, different item, sorted by simulated affinity score
    const current = catalog.find(p => p.id == itemId);
    if (!current || !catalog.length) return [];
    return catalog
        .filter(p => p.id != itemId && p.stock !== '0')
        .map(p => ({
            ...p,
            score: (p.type === current.type ? 3 : 0) +
                   (p.uses && current.uses && p.uses.split(',').some(u => (current.uses || '').toLowerCase().includes(u.trim().toLowerCase())) ? 5 : 0) +
                   Math.random() * 2
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

// ===== ESTIMATED DELIVERY DATE =====
const EDD_ZONES = {
    // Hyderabad districts: 1–2 days
    '500': 1, '501': 1, '502': 1, '503': 1, '504': 2, '505': 2,
    // Telangana: 2–3 days
    '506': 2, '507': 2, '508': 2, '509': 2, '510': 3, '511': 3, '512': 3, '513': 3,
    // AP: 3–5 days
    '515': 4, '516': 4, '517': 4, '518': 4, '519': 5, '520': 3, '521': 3, '522': 3, '523': 3, '524': 3, '525': 3,
};

function calcEDD(pincode) {
    if (!pincode || pincode.length !== 6) return null;
    const prefix3 = pincode.slice(0, 3);
    const days = EDD_ZONES[prefix3] || null;
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() + days + (new Date().getHours() >= 14 ? 1 : 0)); // cutoff 2pm
    return { days, date: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) };
}

window.checkEDD = function(pincode, resultElId) {
    const edd = calcEDD(pincode);
    const el = document.getElementById(resultElId);
    if (!el) return;
    if (!edd) {
        el.innerHTML = `<span style="color:var(--text-muted);font-size:0.7rem">Delivery available on request</span>`;
    } else {
        el.innerHTML = `<span style="color:#34d399"><i class="fas fa-truck" style="margin-right:0.3rem"></i>Delivery by <strong style="color:white">${edd.date}</strong> (${edd.days}–${edd.days+1} days)</span>`;
    }
};

window.checkShippingEDD = function(pincode) {
    if (pincode.length !== 6) { document.getElementById('eddResult').innerHTML = ''; return; }
    const edd = calcEDD(pincode);
    const el = document.getElementById('eddResult');
    if (!el) return;
    el.innerHTML = edd
        ? `<i class="fas fa-truck" style="margin-right:0.25rem"></i>By ${edd.date}`
        : `<span style="color:var(--text-muted)">Check availability</span>`;
};


// Helper: infer quantityType from product type when not set
function inferQuantityType(type) {
    if (!type) return 'bunch';
    const t = String(type).toLowerCase();
    if (t.includes('leaf') || t.includes('leave') || t.includes('powder') || t.includes('flower')) return 'bunch';
    if (t.includes('seed') || t.includes('dry_fruit') || t === 'dry fruit') return 'g';
    if (t.includes('fruit') || t.includes('wild') || t.includes('vegetable')) return 'kg';
    return 'bunch';
}

// Format quantity display
function formatQty(qty, quantityType) {
    if (quantityType === 'kg') return qty + ' kg';
    if (quantityType === 'g') return qty + ' g';
    return qty + (qty === 1 ? ' bunch' : ' bunches');
}

// Format price per unit
function formatPriceUnit(price, quantityType) {
    if (quantityType === 'g') {
        // Show per 100g and per kg equivalent
        return `₹${price}/g · ₹${(price * 100).toFixed(0)}/100g`;
    }
    return `₹${price}/${quantityType}`;
}

function showCatalogError(msg, showRetry = false) {
    const c = document.getElementById('gridContainer');
    if (!c) return;
    const retryBtn = showRetry
        ? `<button onclick="showCatalogSkeleton();loadCatalogFromFirestore(true)"
               style="margin-top:1rem;background:#059669;color:#fff;padding:0.5rem 1.5rem;border-radius:9999px;font-weight:700;border:none;cursor:pointer">
               <i class="fas fa-redo"></i> Try Again
           </button>`
        : '';
    c.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <i class="fas fa-exclamation-circle"></i>
        <p style="font-weight:700;margin-bottom:0.5rem">${escapeHTML(msg)}</p>
        ${retryBtn}
    </div>`;
    const countEl = document.getElementById('itemCount');
    if (countEl) countEl.textContent = '0';
}

function getFilteredData() {
    const term = (document.getElementById('searchInput')?.value || "").toLowerCase();
    const catType = localStorage.getItem('selectedFilter') || 'all';
    const healthType = window._activeHealthFilter || 'all';
    const concern = window._activeConcern;
    const pMin = window._priceMin;
    const pMax = window._priceMax;
    const concernKw = concern ? (CONCERN_KEYWORDS[concern] || []) : null;

    return window.appState.catalogData.filter(item => {
        // Category nav filter (from top nav)
        const matchCat = catType === 'all' || item.type === catType ||
            (catType === 'favorites' && window.appState.favorites.map(String).includes(String(item.id)));
        // Health filter toolbar (type chip)
        const matchHealth = healthType === 'all' || item.type === healthType;
        // Search term
        const matchSearch = !term || (
            (item.name || "").toLowerCase().includes(term) ||
            (item.uses || "").toLowerCase().includes(term) ||
            (item.scientific || "").toLowerCase().includes(term) ||
            (item.description || "").toLowerCase().includes(term)
        );
        // Concern keyword match
        const matchConcern = !concernKw || concernKw.some(kw => {
            const haystack = ((item.name || '') + ' ' + (item.uses || '') + ' ' + (item.description || '')).toLowerCase();
            return haystack.includes(kw);
        });
        // Price range
        const matchPrice = (pMin === null || item.price >= pMin) && (pMax === null || item.price <= pMax);

        return matchCat && matchHealth && matchSearch && matchConcern && matchPrice;
    });
}

// Auto-fill quantityType defaults when product type changes in admin form
window.autoFillQuantityType = function() {
    const type = document.getElementById('ap_type').value;
    const qt = document.getElementById('ap_quantityType');
    const minQty = document.getElementById('ap_minQty');
    const step = document.getElementById('ap_step');
    if (!qt) return;
    if (type === 'leaf') { qt.value = 'bunch'; minQty.value = '1'; step.value = '1'; }
    else if (type === 'fruit' || type === 'wild_fruit') { qt.value = 'kg'; minQty.value = '0.5'; step.value = '0.5'; }
    else if (type === 'seed') { qt.value = 'g'; minQty.value = '100'; step.value = '50'; }
    else if (type === 'vegetable') { qt.value = 'kg'; minQty.value = '0.5'; step.value = '0.5'; }
    else if (type === 'dry_fruit') { qt.value = 'g'; minQty.value = '100'; step.value = '50'; }
    else if (type === 'flower') { qt.value = 'bunch'; minQty.value = '1'; step.value = '1'; }
};

// Returns real rating from product data, or null if none exists.
// Stars are only shown when a product carries an explicit `rating` field
// (set by the admin) — we never fabricate ratings as that misleads customers.
function getStarRating(item) {
    const r = parseFloat(item?.rating);
    const count = parseInt(item?.reviewCount, 10);
    if (!r || r < 1 || r > 5) return null;
    return { r: Math.round(r * 10) / 10, count: count || 0 };
}

// ===== DOM CARD TEMPLATE — no innerHTML string concatenation =====
// Builds a product card using DOM APIs, which are:
// 1. Safer (no XSS via template literal concatenation)
// 2. Easier to maintain (each element is explicit)
// 3. Allows direct event-listener attachment (no inline onclick strings)
function el(tag, cls, attrs) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;   // only for icon markup
        else node.setAttribute(k, v);
    });
    return node;
}

function buildProductCard(item, idx) {
    const isFav       = AppStore.get('favorites').map(String).includes(String(item.id));
    const inCart      = AppStore.get('cart').some(c => c.id == item.id);
    const isOutOfStock = item.stock === '0' || item.stock === 'out';
    const isBestseller = item.bestseller === '1' || item.bestseller === 'true';
    const isUrgent    = item.stock && parseInt(item.stock) <= 10 && parseInt(item.stock) > 0;
    const limitedOffer = item.limited_offer === 'true' || item.limited_offer === '1';
    const starData    = getStarRating(item);

    // Root card
    const card = el('div', [
        'product-card',
        isOutOfStock ? 'out-of-stock' : '',
        isBestseller ? 'is-bestseller' : '',
        isUrgent     ? 'show-urgency'  : '',
    ].filter(Boolean).join(' '));
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => window.openModalById(item.id));

    // --- Image wrap ---
    const imgWrap = el('div', 'card-img-wrap');
    const img = el('img', null, { src: safeURL(item.image), loading: 'lazy', alt: item.name || '' });
    imgWrap.appendChild(img);

    if (limitedOffer && !isOutOfStock) {
        imgWrap.appendChild(el('div', 'limited-offer-badge', { html: '🔥 Limited Offer' }));
    } else {
        const typeBadge = el('div', 'card-type-badge');
        typeBadge.textContent = String(item.type || 'botanical').replace('_', ' ');
        imgWrap.appendChild(typeBadge);
    }
    imgWrap.appendChild(el('div', 'card-bestseller', { html: '🏆 Best Seller' }));
    imgWrap.appendChild(el('div', 'stock-badge', { text: 'Out of Stock' }));
    const urgTag = el('div', 'urgency-tag'); urgTag.innerHTML = '<i class="fas fa-fire"></i> Only <strong>' + item.stock + '</strong> left!'; imgWrap.appendChild(urgTag);

    const actions = el('div', 'card-actions');
    const favBtn = el('button', 'card-action-btn', { title: 'Wishlist', 'aria-label': isFav ? 'Remove from wishlist' : 'Add to wishlist' });
    const favIcon = el('i', (isFav ? 'fas' : 'far') + ' fa-heart');
    favIcon.style.color = isFav ? '#f43f5e' : '#94a3b8';
    favBtn.appendChild(favIcon);
    favBtn.addEventListener('click', e => { e.stopPropagation(); window.toggleFav(e, item.id); });
    actions.appendChild(favBtn);

    if (!isOutOfStock) {
        const cartBtn = el('button', 'card-action-btn', { title: 'Add to cart', 'aria-label': inCart ? 'Already in cart' : 'Add to cart' });
        const cartIcon = el('i', 'fas ' + (inCart ? 'fa-shopping-cart' : 'fa-cart-plus'));
        cartIcon.style.color = inCart ? '#059669' : '#94a3b8';
        cartBtn.appendChild(cartIcon);
        cartBtn.addEventListener('click', e => { e.stopPropagation(); window.addToCartSimple(item.id); });
        actions.appendChild(cartBtn);
    }
    imgWrap.appendChild(actions);
    card.appendChild(imgWrap);

    // --- Card body ---
    const body = el('div', 'card-body');
    body.appendChild(el('div', 'card-name', { text: item.name || '' }));
    body.appendChild(el('div', 'card-scientific', { text: item.scientific || '' }));
    // Social proof signal — show when popularity data exists
    if (item.bought_count && parseInt(item.bought_count) > 0) {
        const proof = el('div', 'card-social-proof');
        proof.innerHTML = '<i class="fas fa-users"></i> ' + parseInt(item.bought_count).toLocaleString('en-IN') + '+ bought this month';
        body.appendChild(proof);
    } else if (isBestseller) {
        const proof = el('div', 'card-social-proof');
        proof.innerHTML = '<i class="fas fa-fire"></i> Popular choice';
        body.appendChild(proof);
    }
    body.appendChild(el('div', 'card-desc', { text: item.description || '' }));

    const footer = el('div', 'card-footer');
    const price = el('span', 'card-price');
    price.textContent = '₹' + (item.price || 0).toFixed(item.quantityType === 'g' ? 2 : 0);
    const unit = el('span', null, { text: '/' + (item.quantityType === 'piece' ? 'pc' : (item.quantityType || 'unit')) });
    unit.style.cssText = 'font-size:0.6rem;font-weight:500;color:var(--text-muted)';
    price.appendChild(unit);
    footer.appendChild(price);

    // Only show stars when real rating data exists — never fabricate
    if (starData) {
        const starsStr = '★'.repeat(Math.floor(starData.r)) + (starData.r % 1 ? '☆' : '');
        const starsEl = el('span', 'card-stars');
        starsEl.textContent = starsStr + ' ';
        const cnt = el('span', null, { text: '(' + starData.count + ')' });
        cnt.style.cssText = 'color:var(--text-muted);font-size:0.6rem';
        starsEl.appendChild(cnt);
        footer.appendChild(starsEl);
    }
    body.appendChild(footer);

    if (isBestseller) {
        const bsLabel = el('div', null, { text: '⭐ Best Seller' });
        bsLabel.style.cssText = 'font-size:0.62rem;font-weight:700;color:#d97706;margin-top:0.2rem';
        body.appendChild(bsLabel);
    }
    if (isOutOfStock) {
        const notifyBtn = el('button', 'card-notify-btn');
        notifyBtn.innerHTML = '<i class="fas fa-bell"></i> Notify Me When Available';
        notifyBtn.addEventListener('click', e => { e.stopPropagation(); window.notifyMe(item.name); });
        body.appendChild(notifyBtn);
    }
    card.appendChild(body);
    return card;
}

// Show skeleton loading cards while catalog is being fetched
function showCatalogSkeleton(count = 8) {
    const container = document.getElementById('gridContainer');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const sk = document.createElement('div');
        sk.className = 'skeleton';
        sk.setAttribute('aria-hidden', 'true');
        container.appendChild(sk);
    }
    const countDisplay = document.getElementById('itemCount');
    if (countDisplay) countDisplay.textContent = '—';
}

function renderItems(items) {
    const container = document.getElementById('gridContainer');
    const countDisplay = document.getElementById('itemCount');
    if (!container) return;

    // Catalog not yet loaded — skeletons are already in place from page load;
    // do nothing and let loadCatalogFromFirestore call us again when ready.
    if (AppStore.get('catalogData').length === 0) return;

    container.innerHTML = '';
    if (countDisplay) countDisplay.textContent = items.length;

    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.style.gridColumn = '1 / -1';
        empty.innerHTML = '<i class="fas fa-seedling"></i>';
        const msg = document.createElement('p');
        msg.textContent = 'No products found.';
        empty.appendChild(msg);
        container.appendChild(empty);
        return;
    }

    // --- DOM-based templating (no innerHTML string concatenation) ---
    items.forEach((item, idx) => {
        container.appendChild(buildProductCard(item, idx));
    });
}

// ===== ITEM DETAIL — AMAZON-STYLE FULL-PAGE VIEW =====
window.openModalById = function(id) {
    const item = window.appState.catalogData.find(i => String(i.id) === String(id));
    if (!item) return;

    const isOOS       = item.stock === '0' || item.stock === 'out';
    const isBestseller= item.bestseller === '1' || item.bestseller === 'true';
    const isLimited   = item.limited_offer === 'true' || item.limited_offer === '1';
    const starData    = getStarRating(item);
    const isFav       = AppStore.get('favorites').map(String).includes(String(item.id));
    const waMsg       = `Hi! I want to order *${item.name}* from Nature's Heal.`;
    const fbt         = getFrequentlyBoughtTogether(item.id, window.appState.catalogData, 8);

    // Gallery
    const mainImg  = safeURL(item.image);
    const extraImgs = [];
    if (Array.isArray(item.images)) item.images.forEach(u => { const s=safeURL(u); if(s&&s!==mainImg) extraImgs.push(s); });
    ['image2','image3','image4'].forEach(k => { if(item[k]){const s=safeURL(item[k]); if(s&&s!==mainImg&&!extraImgs.includes(s)) extraImgs.push(s);} });
    const gallery = [mainImg, ...extraImgs].filter(Boolean);

    const thumbsHTML = gallery.map((src,i) => `
        <button class="az-thumb ${i===0?'active':''}" onclick="pdpGoTo(${i},'${item.id}')" aria-label="Image ${i+1}">
            <img src="${src}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
        </button>`).join('');

    const slidesHTML = gallery.map((src,i) => `
        <div class="az-slide">
            <img src="${src}" alt="${escapeHTML(item.name)} image ${i+1}" loading="${i===0?'eager':'lazy'}">
        </div>`).join('');

    const dotsHTML = gallery.length > 1 ? gallery.map((_,i) =>
        `<button class="az-dot ${i===0?'active':''}" onclick="pdpGoTo(${i},'${item.id}')"></button>`
    ).join('') : '';

    // Badges
    const badges = [];
    if (isBestseller) badges.push(`<span class="az-badge az-badge--best">🏆 Best Seller</span>`);
    if (isLimited && !isOOS) badges.push(`<span class="az-badge az-badge--hot">🔥 Limited Offer</span>`);
    if (isOOS)       badges.push(`<span class="az-badge az-badge--oos">Out of Stock</span>`);

    // Stars
    const starsHTML = starData ? (() => {
        const full = Math.floor(starData.r);
        const half = starData.r % 1 >= 0.5 ? 1 : 0;
        const empty = 5 - full - half;
        return '<span class="az-stars">' +
            '★'.repeat(full) + (half?'½':'') + '☆'.repeat(empty) +
            `</span><span class="az-review-count">${starData.r} · ${starData.count} reviews</span>`;
    })() : '';

    // Uses list
    const usesList = (item.uses||'').split(',').filter(u=>u.trim())
        .map(u => `<li><i class="fas fa-check"></i> ${escapeHTML(u.trim())}</li>`).join('');

    // CTA
    const ctaHTML = isOOS
        ? `<button class="az-btn az-btn--notify" onclick="notifyMe('${escapeHTML(item.name).replace(/'/g,"\\'")}')">
               <i class="fas fa-bell"></i> Notify Me
           </button>
           <a class="az-btn az-btn--wa" href="https://wa.me/918919011159?text=${encodeURIComponent(waMsg)}" target="_blank" rel="noopener">
               <i class="fab fa-whatsapp"></i> Pre-Order via WhatsApp
           </a>`
        : `<div class="az-qty-row">
               <label class="az-qty-label">Qty</label>
               <button class="az-qty-minus" onclick="modalQtyChange('${item.id}',-1)">−</button>
               <span class="az-qty-val" id="modalQtyVal_${item.id}">${item.minQty||1} ${item.quantityType||'unit'}</span>
               <button class="az-qty-plus" onclick="modalQtyChange('${item.id}',1)">+</button>
               <span class="az-qty-sub" id="modalSubtotal_${item.id}">₹${((item.price||0)*(item.minQty||1)).toFixed(0)}</span>
           </div>
           <div class="az-cta-row">
               <button class="az-btn az-btn--cart" onclick="addToCartFromModal('${item.id}');openCartSidebar()">
                   <i class="fas fa-cart-plus"></i> Add to Cart
               </button>
               <a class="az-btn az-btn--wa" href="https://wa.me/918919011159?text=${encodeURIComponent(waMsg)}" target="_blank" rel="noopener">
                   <i class="fab fa-whatsapp"></i> WhatsApp Order
               </a>
           </div>`;

    // Frequently bought — horizontal scrollable cards
    const fbtHTML = fbt.length ? `
    <section class="az-rec-section">
        <div class="az-rec-header">
            <h2 class="az-rec-title"><i class="fas fa-boxes"></i> Customers Also Bought</h2>
        </div>
        <div class="az-rec-grid" id="azRecGrid">
            ${fbt.map(p => {
                const ps = getStarRating(p);
                const stStr = ps ? '★'.repeat(Math.floor(ps.r)) : '';
                const pOOS = p.stock === '0' || p.stock === 'out';
                const _pid = String(p.id).replace(/'/g, "\'");
                return `<div class="az-rec-card" onclick="window.openModalById('${_pid}');document.getElementById('itemModal').scrollTop=0" role="button" tabindex="0">
                    <div class="az-rec-img">
                        <img src="${safeURL(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.parentElement.style.background='#d1fae5'">
                        ${p.bestseller==='1'||p.bestseller==='true' ? '<span class="az-rec-badge">Best Seller</span>' : ''}
                    </div>
                    <div class="az-rec-body">
                        <div class="az-rec-name">${escapeHTML(p.name)}</div>
                        ${p.description ? `<div class="az-rec-desc">${escapeHTML(p.description)}</div>` : '<div class="az-rec-desc"></div>'}
                        ${ps ? `<div class="az-rec-stars">${stStr} <span>${ps.r}</span></div>` : ''}
                        <div class="az-rec-price">₹${(p.price||0).toFixed(0)}<span class="az-rec-unit"> /${p.quantityType||'unit'}</span></div>
                        ${!pOOS
                            ? `<button class="az-rec-add" onclick="event.stopPropagation();window.addToCartSimple('${_pid}');window.showToast('&#x2705; Added to cart')">
                                   <i class="fas fa-cart-plus"></i> Add to Cart
                               </button>`
                            : `<span class="az-rec-oos">Out of Stock</span>`}
                    </div>
                </div>`;
            }).join('')}
        </div>
    </section>` : '';

    // Recommended (same category, different from current)
    const relatedCatLabel = String(item.type||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) || "Nature\'s Heal";
    const related = (window.appState.catalogData||[])
        .filter(p => String(p.id) !== String(id) && p.type === item.type && !fbt.find(f => String(f.id)===String(p.id)))
        .sort(() => Math.random()-0.5).slice(0, 8);

    const relatedHTML = related.length ? `
    <section class="az-rec-section">
        <div class="az-rec-header">
            <h2 class="az-rec-title"><i class="fas fa-seedling"></i> More from ${relatedCatLabel}</h2>
        </div>
        <div class="az-rec-grid">
            ${related.map(p => {
                const ps = getStarRating(p);
                const stStr = ps ? '★'.repeat(Math.floor(ps.r)) : '';
                const pOOS = p.stock === '0' || p.stock === 'out';
                const _pid = String(p.id).replace(/'/g, "\'");
                return `<div class="az-rec-card" onclick="window.openModalById('${_pid}');document.getElementById('itemModal').scrollTop=0" role="button" tabindex="0">
                    <div class="az-rec-img">
                        <img src="${safeURL(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.parentElement.style.background='#d1fae5'">
                        ${p.bestseller==='1'||p.bestseller==='true' ? '<span class="az-rec-badge">Best Seller</span>' : ''}
                    </div>
                    <div class="az-rec-body">
                        <div class="az-rec-name">${escapeHTML(p.name)}</div>
                        ${p.description ? `<div class="az-rec-desc">${escapeHTML(p.description)}</div>` : '<div class="az-rec-desc"></div>'}
                        ${ps ? `<div class="az-rec-stars">${stStr} <span>${ps.r}</span></div>` : ''}
                        <div class="az-rec-price">₹${(p.price||0).toFixed(0)}<span class="az-rec-unit"> /${p.quantityType||'unit'}</span></div>
                        ${!pOOS
                            ? `<button class="az-rec-add" onclick="event.stopPropagation();window.addToCartSimple('${_pid}');window.showToast('&#x2705; Added to cart')">
                                   <i class="fas fa-cart-plus"></i> Add to Cart
                               </button>`
                            : `<span class="az-rec-oos">Out of Stock</span>`}
                    </div>
                </div>`;
            }).join('')}
        </div>
    </section>` : '';

    document.getElementById('itemModalContent').innerHTML = `
    <!-- ── TOP BAR ── -->
    <div class="az-topbar">
        <button class="az-back-btn" onclick="closeItemModal()">
            <i class="fas fa-arrow-left"></i> Back to catalog
        </button>
        <nav class="az-breadcrumb">
            <span onclick="closeItemModal()" style="cursor:pointer">Home</span>
            <i class="fas fa-chevron-right"></i>
            <span onclick="closeItemModal();sfFilter(this.dataset.type)" data-type="${item.type||'all'}" style="cursor:pointer">${String(item.type||'All').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>
            <i class="fas fa-chevron-right"></i>
            <span class="az-breadcrumb-current">${escapeHTML(item.name)}</span>
        </nav>
        <button class="az-fav-topbar" onclick="toggleFav(event,'${item.id}')" title="${isFav?'Remove from wishlist':'Save to wishlist'}">
            <i class="${isFav?'fas':'far'} fa-heart" style="color:${isFav?'#f43f5e':'#94a3b8'}"></i>
        </button>
    </div>

    <!-- ── MAIN PRODUCT AREA ── -->
    <div class="az-product-wrap">

        <!-- LEFT: Image column -->
        <div class="az-img-col">
            <!-- Thumb strip -->
            <div class="az-thumb-strip" id="azThumbs_${item.id}">${thumbsHTML}</div>
            <!-- Main viewer -->
            <div class="az-main-viewer">
                <div class="az-track" id="pdpTrack_${item.id}">${slidesHTML}</div>
                ${gallery.length>1 ? `
                <button class="az-arr az-arr--prev hidden-arrow" id="pdpPrev_${item.id}" onclick="pdpNav(-1,'${item.id}')"><i class="fas fa-chevron-left"></i></button>
                <button class="az-arr az-arr--next" id="pdpNext_${item.id}" onclick="pdpNav(1,'${item.id}')"><i class="fas fa-chevron-right"></i></button>` : ''}
                <div class="az-dot-strip" id="pdpDots_${item.id}">${dotsHTML}</div>
                <div class="az-gallery-badges">${badges.join('')}</div>
            </div>
        </div>

        <!-- RIGHT: Info column -->
        <div class="az-info-col">
            <!-- Name + scientific -->
            <h1 class="az-product-name">${escapeHTML(item.name)}</h1>
            ${item.scientific ? `<p class="az-scientific">Scientific name: <em>${escapeHTML(item.scientific)}</em></p>` : ''}

            <!-- Rating row -->
            ${starsHTML ? `<div class="az-rating-row">${starsHTML}</div>` : ''}

            <div class="az-divider"></div>

            <!-- Price block -->
            <div class="az-price-block">
                <span class="az-price-label">Price:</span>
                <span class="az-price-main">₹${(item.price||0).toFixed(item.quantityType==='g'?2:0)}</span>
                <span class="az-price-unit">per ${item.quantityType||'unit'}</span>
                ${isOOS ? '<span class="az-oos-chip">Out of Stock</span>' : ''}
                ${!isOOS && item.stock && parseInt(item.stock) <= 10 && parseInt(item.stock) > 0
                    ? `<span class="az-low-stock-chip"><i class="fas fa-fire"></i> Only ${item.stock} left!</span>`
                    : ''}
            </div>

            <!-- Free delivery note -->
            ${!isOOS ? `<div class="az-delivery-note">
                <i class="fas fa-truck"></i>
                <span>FREE delivery on orders above ₹499 &nbsp;·&nbsp; Same-day dispatch before 2 PM</span>
            </div>` : ''}

            <div class="az-divider"></div>

            <!-- CTA -->
            <div class="az-cta-wrap">${ctaHTML}</div>

            <div class="az-divider"></div>

            <!-- EDD -->
            <div class="az-edd">
                <i class="fas fa-map-marker-alt" style="color:#059669"></i>
                <div>
                    <div class="az-edd-label">Check delivery date</div>
                    <div class="az-edd-row">
                        <input class="az-edd-input" id="eddPinInput_${item.id}" type="tel" maxlength="6" inputmode="numeric" placeholder="Enter pincode"
                            oninput="if(this.value.length===6) checkEDD(this.value,'pdpEddResult_${item.id}')">
                        <button class="az-edd-btn" onclick="checkEDD(document.getElementById('eddPinInput_${item.id}').value,'pdpEddResult_${item.id}')">Check</button>
                    </div>
                    <div id="pdpEddResult_${item.id}" class="az-edd-result"></div>
                </div>
            </div>

            <!-- Description -->
            ${item.description ? `<div class="az-info-section">
                <div class="az-info-title">About this product</div>
                <p class="az-info-text">${escapeHTML(item.description)}</p>
            </div>` : ''}

            <!-- Benefits -->
            ${usesList ? `<div class="az-info-section">
                <div class="az-info-title">Key Benefits</div>
                <ul class="az-uses-list">${usesList}</ul>
            </div>` : ''}

            <!-- Trust badges -->
            <div class="az-trust-grid">
                <div class="az-trust-item"><i class="fas fa-leaf"></i><span>100% Pure</span></div>
                <div class="az-trust-item"><i class="fas fa-truck"></i><span>Fast Delivery</span></div>
                <div class="az-trust-item"><i class="fas fa-hand-holding-usd"></i><span>COD Available</span></div>
                <div class="az-trust-item"><i class="fas fa-undo"></i><span>Easy Returns</span></div>
                <div class="az-trust-item"><i class="fas fa-certificate"></i><span>FSSAI Licensed</span></div>
                <div class="az-trust-item"><i class="fas fa-map-marker-alt"></i><span>Farm Sourced, Telangana</span></div>
            </div>

            <!-- Medical disclaimer (required for herbal/wellness products) -->
            <div class="az-disclaimer">
                <i class="fas fa-exclamation-triangle az-disclaimer-icon"></i>
                <div>
                    <strong>Important:</strong> This product is a food-grade herbal supplement for general wellness only.
                    It is <strong>not a medicine</strong> and is not intended to diagnose, treat, cure, or prevent any disease.
                    Results may vary. Consult a healthcare professional before use if you are pregnant, breastfeeding,
                    or have a medical condition.
                    <button onclick="openPolicy('disclaimer')" class="az-disclaimer-link">Full Disclaimer →</button>
                </div>
            </div>
        </div>
    </div>

    <!-- ── RECOMMENDATIONS ── -->
    <div class="az-recs-wrap">
        ${fbtHTML}
        ${relatedHTML}
    </div>
    `;

    document.getElementById('itemModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('itemModal').scrollTop = 0;
    updateMetaForProduct(item);

    window._pdpGallery = { idx: 0, total: gallery.length, itemId: String(item.id) };
    _initPdpSwipe(item.id, gallery.length);
};


// ===== GALLERY HELPERS =====
window.pdpGoTo = function(idx, itemId) {
    const g = window._pdpGallery;
    if (!g || g.itemId !== String(itemId)) return;
    g.idx = Math.max(0, Math.min(idx, g.total - 1));
    _pdpUpdateGallery(itemId);
};

window.pdpNav = function(dir, itemId) {
    const g = window._pdpGallery;
    if (!g || g.itemId !== String(itemId)) return;
    g.idx = Math.max(0, Math.min(g.idx + dir, g.total - 1));
    _pdpUpdateGallery(itemId);
};

function _pdpUpdateGallery(itemId) {
    const g = window._pdpGallery;
    if (!g) return;
    const track = document.getElementById('pdpTrack_' + itemId);
    // Support both old (.pdp-img-dot) and new (.az-dot) selectors
    const dots   = document.querySelectorAll('#pdpDots_'  + itemId + ' .az-dot, #pdpDots_'  + itemId + ' .pdp-img-dot');
    const thumbs = document.querySelectorAll('#azThumbs_' + itemId + ' .az-thumb, #pdpThumbs_' + itemId + ' .pdp-img-thumb');
    const prevBtn = document.getElementById('pdpPrev_' + itemId);
    const nextBtn = document.getElementById('pdpNext_' + itemId);
    if (track) track.style.transform = `translateX(-${g.idx * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === g.idx));
    thumbs.forEach((t, i) => {
        t.classList.toggle('active', i === g.idx);
        if (i === g.idx) t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    if (prevBtn) prevBtn.classList.toggle('hidden-arrow', g.idx === 0);
    if (nextBtn) nextBtn.classList.toggle('hidden-arrow', g.idx === g.total - 1);
}

function _initPdpSwipe(itemId, total) {
    if (total <= 1) return;
    const wrap = document.getElementById('pdpGallery_' + itemId);
    if (!wrap) return;
    let startX = 0, startY = 0, isDragging = false;
    wrap.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
    }, { passive: true });
    wrap.addEventListener('touchend', e => {
        if (!isDragging) return;
        isDragging = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
            pdpNav(dx < 0 ? 1 : -1, itemId);
        }
    }, { passive: true });
    // Mouse drag support for desktop
    let mouseStartX = 0, mouseDown = false;
    wrap.addEventListener('mousedown', e => { mouseStartX = e.clientX; mouseDown = true; });
    wrap.addEventListener('mouseup', e => {
        if (!mouseDown) return;
        mouseDown = false;
        const dx = e.clientX - mouseStartX;
        if (Math.abs(dx) > 40) pdpNav(dx < 0 ? 1 : -1, itemId);
    });
    wrap.addEventListener('mouseleave', () => { mouseDown = false; });
}

// ===== PDP CATEGORY FILTER =====
window.pdpFilterCategory = function(type, btn) {
    // Update active chip
    const strip = document.getElementById('pdpCatStrip');
    if (strip) {
        strip.querySelectorAll('.pdp-cat-chip').forEach(c => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        // Scroll clicked chip into view
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    // Find first product in that category and open it
    const catalog = window.appState.catalogData || [];
    let match;
    if (type === 'all') {
        // "All" just goes to the first product in catalog
        match = catalog[0];
    } else {
        match = catalog.find(p => p.type === type);
    }
    if (match) {
        window.openModalById(match.id);
        // After re-opening, re-highlight the correct chip
        setTimeout(() => {
            const newStrip = document.getElementById('pdpCatStrip');
            if (newStrip) {
                newStrip.querySelectorAll('.pdp-cat-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.type === type);
                });
            }
        }, 50);
    }
};

window.closeItemModal = function() {
    document.getElementById('itemModal').classList.add('hidden');
    document.body.style.overflow = '';
    resetMeta();
};

// Modal quantity state — keyed by string ID to handle Firestore string IDs
window._modalQty = {};
window.modalQtyChange = function(id, dir) {
    const sid = String(id);
    const item = window.appState.catalogData.find(i => String(i.id) === sid);
    if (!item) return;
    const qt = item.quantityType || 'bunch';
    const step = parseFloat(item.step) || 1;
    const minQty = parseFloat(item.minQty) || 1;
    if (window._modalQty[sid] === undefined) window._modalQty[sid] = minQty;
    let newQty = Math.round((window._modalQty[sid] + dir * step) * 1000) / 1000;
    if (newQty < minQty) newQty = minQty;
    window._modalQty[sid] = newQty;
    const label = qt === 'bunch' ? (newQty === 1 ? 'bunch' : 'bunches') : qt;
    const dispQty = Number.isInteger(newQty) ? newQty : newQty.toFixed(1);
    const el = document.getElementById('modalQtyVal_' + sid);
    if (el) el.textContent = dispQty + ' ' + label;
    const sub = document.getElementById('modalSubtotal_' + sid);
    if (sub) sub.textContent = '₹' + (item.price * newQty).toFixed(0);
};

window.addToCartFromModal = function(id) {
    const sid = String(id);
    const item = window.appState.catalogData.find(i => String(i.id) === sid);
    if (!item) return;
    const qty = window._modalQty[sid] || parseFloat(item.minQty) || 1;
    const existing = window.appState.cart.find(c => String(c.id) === sid);
    if (existing) existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
    else window.appState.cart.push({ id: sid, qty });
    delete window._modalQty[sid];
    persistCart();
    updateCartBadge();
    renderCartItems();
    renderItems(getFilteredData());
    updatePlaceOrderButton();
    showToast("✅ Added to cart");
};



// ===== FAVORITES =====
window.toggleFav = function(e, id) {
    e.stopPropagation();
    const sid = String(id);
    const favs = window.appState.favorites.map(String);
    window.appState.favorites = favs.includes(sid) ? favs.filter(i => i !== sid) : [...favs, sid];
    localStorage.setItem('favorites', JSON.stringify(window.appState.favorites));
    renderItems(getFilteredData());
};

// ===== FILTER & SEARCH =====
;

window.handleMobileFilterChip = function(val, el) {
    if (val === 'orders') { openOrders(); return; }
    // Update aria-pressed on all chips
    document.querySelectorAll('#mobileFilterChips .mf-chip').forEach(btn => {
        btn.setAttribute('aria-pressed', btn === el ? 'true' : 'false');
    });
    filterItems(val);
};

let searchDebounce;
document.getElementById('searchInput').oninput = (e) => {
    clearTimeout(searchDebounce);
    const term = e.target.value;
    searchDebounce = setTimeout(() => {
        if (typeof _sf !== 'undefined') sfApply(); else renderItems(getFilteredData());
        showSuggestions(term);
    }, 220);
};
document.getElementById('searchInput').onfocus = (e) => {
    if (e.target.value.length >= 2) showSuggestions(e.target.value);
};

// ===== THEME =====
window.toggleTheme = function() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    document.getElementById('themeIcon').className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};



// ===== AI CHATBOT =====
let chatHistory = [];
let chatOpen = false;

function toggleChat() {
    chatOpen = !chatOpen;
    const win = document.getElementById('chatWindow');
    win.classList.toggle('open', chatOpen);
    if (chatOpen && chatHistory.length === 0) {
            addChatMessage('bot', "Namaste! 🌿 I'm <strong>Vaidya</strong>, your Herbal Wellness Guide at Nature's Heal.<br><br>Ask me about any herb, health concern, or product — I'm here to help!<br><br>Try: <em>\"which fruit is good for hair?\"</em> or <em>\"herbs for diabetes\"</em> 😊", true);
}}
window.toggleChat = toggleChat;

function addChatMessage(role, text, isHtml = false) {
    const messages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-msg ' + role;
    const avatar = role === 'bot' ? '🌿' : '👤';
    const rendered = isHtml ? text.replace(/\n/g, '<br>') : escapeHTML(text).replace(/\n/g, '<br>');
    div.innerHTML = `
        <div class="chat-msg-avatar">${avatar}</div>
        <div class="chat-bubble">${rendered}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    chatHistory.push({ role: role === 'bot' ? 'assistant' : 'user', content: typeof text === 'string' ? text.replace(/<[^>]+>/g,'') : text });
}

function showChatTyping() {
    const messages = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'chat-typing'; div.id = 'chatTyping';
    div.innerHTML = `
        <div class="chat-msg-avatar" style="background:#d1fae5;color:#059669;width:1.75rem;height:1.75rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;flex-shrink:0">🌿</div>
        <div class="chat-bubble">
            <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}
function hideChatTyping() { document.getElementById('chatTyping')?.remove(); }

// ===== LOCAL RULE-BASED CHATBOT (no API key needed) =====
const CHAT_KB = [
    // ── HAIR ──
    { k: ['hair fall','hair loss','hairfall','thinning hair','bald','baldness','hair growth'],
      a: `🌿 <strong>Best herbs for hair fall & growth:</strong><br><br>
▸ <strong>Amla (Indian Gooseberry)</strong> – Rich in Vitamin C & antioxidants. Mix amla powder with water or coconut oil and apply to roots 30 mins before washing. Also drink 1 tsp in warm water daily.<br>
▸ <strong>Bhringraj</strong> – Called the "king of hair herbs". Apply bhringraj powder paste to scalp twice a week to reduce shedding.<br>
▸ <strong>Curry Leaves</strong> – Prevent premature greying and strengthen follicles. Boil a handful in coconut oil and massage into scalp.<br>
▸ <strong>Brahmi</strong> – Strengthens hair roots and reduces stress-related hair loss. Take 1 tsp powder with warm milk at bedtime.<br><br>
💡 <em>All these herbs are available at Nature's Heal. Note: herbs support wellness but don't replace a doctor's advice if hair loss is severe.</em>` },

    { k: ['amla','gooseberry','indian gooseberry','amalaki'],
      a: `🌿 <strong>Amla (Indian Gooseberry)</strong> – Nature's richest source of Vitamin C!<br><br>
▸ <strong>For Hair:</strong> Apply amla powder paste to scalp — prevents greying, boosts growth, strengthens roots.<br>
▸ <strong>For Immunity:</strong> 1 tsp amla powder in warm water every morning on an empty stomach.<br>
▸ <strong>For Skin:</strong> High antioxidants fight free radicals, giving skin a natural glow.<br>
▸ <strong>For Digestion:</strong> Stimulates digestive enzymes; great taken after meals.<br>
▸ <strong>For Eyes:</strong> Rich in Vitamin A; supports vision health.<br><br>
📌 <em>Amla is one of three fruits in the famous Triphala blend. Available at Nature's Heal!</em>` },

    { k: ['bhringraj'],
      a: `🌿 <strong>Bhringraj</strong> – The "King of Hair Herbs" in Ayurveda!<br><br>
▸ Promotes hair regrowth by improving blood circulation to scalp follicles.<br>
▸ Apply as a paste (powder + water or oil) to scalp for 45 mins, 2–3 times a week.<br>
▸ Internally: 1 tsp powder with warm water helps liver health and reduces stress (a major hair-fall trigger).<br>
▸ Mix with amla powder for a powerful hair mask.<br><br>
💡 Consistency is key — expect visible results in 8–12 weeks of regular use.` },

    { k: ['curry leaves','kadi patta'],
      a: `🌿 <strong>Curry Leaves</strong> – A kitchen herb with incredible health powers!<br><br>
▸ <strong>Hair:</strong> Reverses premature greying; boil 15–20 leaves in 4 tbsp coconut oil for 5 min, cool and massage scalp.<br>
▸ <strong>Anaemia:</strong> Rich in iron and folic acid — great for women with low haemoglobin.<br>
▸ <strong>Diabetes:</strong> Helps regulate blood sugar levels when consumed regularly.<br>
▸ <strong>Digestion:</strong> Add to meals daily or chew 8–10 fresh leaves on an empty stomach every morning.<br><br>
📌 <em>Best consumed fresh, but dried curry leaf powder from Nature's Heal works great too!</em>` },

    // ── SKIN ──
    { k: ['skin','glow','acne','pimple','dark spot','fairness','complexion','skin care'],
      a: `🌿 <strong>Best herbs for healthy glowing skin:</strong><br><br>
▸ <strong>Neem</strong> – Natural antibiotic; fights acne, bacteria, and inflammation. Apply neem powder paste as a face mask twice a week.<br>
▸ <strong>Turmeric</strong> – Curcumin brightens skin, reduces dark spots. Mix a pinch in warm milk or use as a face pack with honey.<br>
▸ <strong>Amla</strong> – Vitamin C powerhouse that boosts collagen for plump, youthful skin.<br>
▸ <strong>Flaxseeds</strong> – Omega-3 keeps skin hydrated and reduces inflammation from inside. Eat 1 tbsp daily.<br>
▸ <strong>Sandalwood powder</strong> – Natural cooling agent; reduces tan and gives natural glow.<br><br>
💡 <em>Inner nourishment matters as much as outer care — drink 2–3 litres of water daily alongside herbal remedies.</em>` },

    { k: ['neem'],
      a: `🌿 <strong>Neem</strong> – The ultimate natural antibiotic!<br><br>
▸ <strong>Skin:</strong> Apply neem powder paste to acne, pimples, or rashes; its antibacterial action clears them fast.<br>
▸ <strong>Blood Purifier:</strong> Drink neem leaf decoction (boil 10 leaves in 2 cups water, strain, drink warm) to detox blood.<br>
▸ <strong>Immunity:</strong> Regular use helps the body fight infections naturally.<br>
▸ <strong>Scalp:</strong> Anti-fungal; controls dandruff when massaged as a paste into scalp.<br><br>
⚠️ <em>Neem is bitter and potent — start with small amounts. Avoid during pregnancy.</em>` },

    // ── IMMUNITY ──
    { k: ['immunity','immune','cold','flu','fever','infection','fall sick','sick','weak'],
      a: `🌿 <strong>Boost your immunity naturally:</strong><br><br>
▸ <strong>Tulsi (Holy Basil)</strong> – Chew 5–7 leaves every morning or drink tulsi tea. Fights colds, stress, and respiratory infections.<br>
▸ <strong>Giloy (Guduchi)</strong> – Known as "Amrita" (nectar of immortality). Excellent for fever, dengue recovery, and chronic infections.<br>
▸ <strong>Amla</strong> – 1 tsp powder in warm water daily gives you 20x the Vitamin C of an orange!<br>
▸ <strong>Ashwagandha</strong> – Adaptogen that reduces cortisol and strengthens the immune response.<br>
▸ <strong>Kalonji (Black Seeds)</strong> – "A cure for everything except death" (ancient saying). Add ½ tsp to honey daily.<br><br>
💡 <em>The golden trio for immunity: Tulsi + Giloy + Amla taken together is highly effective.</em>` },

    { k: ['tulsi','holy basil'],
      a: `🌿 <strong>Tulsi (Holy Basil)</strong> – Queen of Herbs!<br><br>
▸ Chew 5 fresh leaves every morning to boost immunity and purify blood.<br>
▸ Tulsi tea (boil leaves in water with ginger): instant relief from cold, sore throat, cough.<br>
▸ Anti-stress: adaptogen that lowers cortisol — drink 1 cup tulsi tea when anxious.<br>
▸ Respiratory health: inhale steam from tulsi + ginger water for blocked nose.<br>
▸ Skin: apply fresh tulsi juice to pimples overnight for quick relief.<br><br>
📌 <em>Tulsi is sacred in Indian culture for a reason — it truly is a full-body healer!</em>` },

    { k: ['giloy','guduchi'],
      a: `🌿 <strong>Giloy (Guduchi / Amrita)</strong> – The Immunity Powerhouse!<br><br>
▸ Best for: chronic fever, dengue, chikungunya recovery, boosting platelet count.<br>
▸ How to use: Boil 1 tsp giloy powder in 2 cups water, reduce to 1 cup, drink warm twice daily.<br>
▸ Also available as giloy juice or tablets for convenience.<br>
▸ Anti-inflammatory: helps with arthritis and joint pain when used regularly.<br>
▸ Detoxifies liver and kidneys naturally.<br><br>
💡 <em>During seasonal flu outbreaks, giloy + tulsi + ginger tea is your best natural defence.</em>` },

    { k: ['ashwagandha','withania'],
      a: `🌿 <strong>Ashwagandha</strong> – The Stress Buster & Energy Booster!<br><br>
▸ <strong>Stress & Anxiety:</strong> Reduces cortisol by 30% with regular use (1 tsp powder + warm milk at bedtime).<br>
▸ <strong>Energy & Stamina:</strong> Ancient warriors used it for strength — great for gym-goers and working professionals.<br>
▸ <strong>Sleep:</strong> Ashwagandha milk at night (ashwagandha + warm milk + honey) promotes deep sleep.<br>
▸ <strong>Thyroid:</strong> Supports both hypo- and hyperthyroid conditions (consult doctor first).<br>
▸ <strong>Immunity:</strong> Improves white blood cell count and body's defence mechanism.<br><br>
💡 <em>Best results in 4–8 weeks of daily use. Pair with a nutritious diet for maximum benefit.</em>` },

    // ── DIABETES ──
    { k: ['diabetes','blood sugar','sugar','diabetic','insulin'],
      a: `🌿 <strong>Natural support for blood sugar management:</strong><br><br>
▸ <strong>Methi (Fenugreek)</strong> – Soak 1 tsp overnight, drink the water and eat the seeds every morning. Slows sugar absorption.<br>
▸ <strong>Karela (Bitter Gourd)</strong> – Drink 30ml karela juice on empty stomach; contains plant-based insulin-like compounds.<br>
▸ <strong>Jamun Seeds</strong> – Dry and powder them. ½ tsp with water twice daily controls post-meal blood sugar spikes.<br>
▸ <strong>Giloy</strong> – Helps in insulin production and sensitivity.<br>
▸ <strong>Curry Leaves</strong> – Add to every meal; reduces glycaemic index naturally.<br><br>
⚠️ <em>These herbs complement medical treatment but do NOT replace prescribed medications. Always inform your doctor.</em>` },

    { k: ['methi','fenugreek'],
      a: `🌿 <strong>Methi (Fenugreek)</strong> – The Blood Sugar & Cholesterol Fighter!<br><br>
▸ <strong>Diabetes:</strong> Soak 1 tsp seeds overnight → eat seeds and drink water next morning. Contains galactomannan which slows sugar absorption.<br>
▸ <strong>Cholesterol:</strong> Regular use reduces LDL ("bad") cholesterol significantly.<br>
▸ <strong>Hair:</strong> Apply methi paste to scalp → strengthens hair, reduces dandruff.<br>
▸ <strong>Lactation:</strong> Boosts breast milk production in new mothers.<br>
▸ <strong>Joint Pain:</strong> Methi powder with warm water reduces inflammation.<br><br>
📌 <em>Methi is bitter — mix in curries, parathas, or just swallow with water. Your taste buds will adjust!</em>` },

    // ── DIGESTION ──
    { k: ['digestion','digestive','gas','bloating','constipation','acidity','stomach','bowel','ibs'],
      a: `🌿 <strong>Natural remedies for digestion & gut health:</strong><br><br>
▸ <strong>Ajwain (Carom Seeds)</strong> – Instant relief from gas and acidity. Chew ½ tsp with a pinch of salt and warm water after meals.<br>
▸ <strong>Jeera (Cumin)</strong> – Boil 1 tsp in a cup of water, drink warm — classic remedy for bloating and indigestion.<br>
▸ <strong>Fennel Seeds (Saunf)</strong> – Chew a pinch after every meal to prevent bloating and freshen breath.<br>
▸ <strong>Triphala</strong> – Gentle overnight laxative for chronic constipation. 1 tsp with warm water before bed.<br>
▸ <strong>Curry Leaves</strong> – Stimulate digestive enzymes; add to every meal.<br><br>
💡 <em>The golden rule: eat slowly, chew thoroughly, avoid cold water with meals — herbs work even better with good habits!</em>` },

    { k: ['triphala'],
      a: `🌿 <strong>Triphala</strong> – Ayurveda's Most Famous Formula!<br><br>
Triphala = <strong>Amla + Haritaki + Bibhitaki</strong> (three powerful fruits combined).<br><br>
▸ <strong>Constipation:</strong> 1 tsp in warm water before bed — gentle, non-habit-forming laxative.<br>
▸ <strong>Detox:</strong> Cleanses the colon and removes toxins (ama) accumulated over time.<br>
▸ <strong>Eyes:</strong> Wash eyes with cold triphala water (strain well) to reduce strain and redness.<br>
▸ <strong>Weight Loss:</strong> Improves metabolism and reduces fat accumulation over 3 months.<br>
▸ <strong>Skin:</strong> Internal detox leads to clearer, brighter skin.<br><br>
⏰ <em>Best taken at bedtime or early morning. Results are gradual but lasting — be consistent for 3 months.</em>` },

    { k: ['ajwain','carom'],
      a: `🌿 <strong>Ajwain (Carom Seeds)</strong> – Instant Gas & Acidity Buster!<br><br>
▸ Chew ½ tsp with a pinch of black salt and sip warm water → relieves gas in 10 minutes.<br>
▸ Ajwain water: boil 1 tsp in 2 cups water, strain and drink warm for acidity and bloating.<br>
▸ For babies: ajwain water (very diluted) relieves infant colic safely.<br>
▸ Cold & cough: inhale steam with ajwain added to boiling water.<br>
▸ Arthritis: ajwain seed paste with warm mustard oil gives pain relief when applied.<br><br>
📌 <em>Keep ajwain on your dinner table! A pinch after every meal prevents digestive issues naturally.</em>` },

    { k: ['jeera','cumin'],
      a: `🌿 <strong>Jeera (Cumin)</strong> – The Digestive Hero!<br><br>
▸ Jeera water: Boil 1 tsp in 1.5 cups water, strain and drink warm first thing in morning — fights bloating, kick-starts metabolism.<br>
▸ Sprinkle roasted jeera powder on raita, buttermilk, and curries for easy digestion.<br>
▸ Rich in iron — helpful for anaemia, especially in women.<br>
▸ Reduces LDL cholesterol and supports heart health.<br>
▸ Jeera + ajwain + fennel mixed equally = powerful digestive blend to keep at home.<br><br>
💡 <em>Try jeera water every morning for 30 days — most people notice flatter stomach and more energy!</em>` },

    // ── WEIGHT LOSS ──
    { k: ['weight loss','obesity','fat','slim','overweight','weight management'],
      a: `🌿 <strong>Natural support for healthy weight management:</strong><br><br>
▸ <strong>Triphala</strong> – Detoxes gut, improves metabolism. 1 tsp in warm water at bedtime for 3 months.<br>
▸ <strong>Methi Seeds</strong> – High fibre keeps you full longer. Soak overnight and eat in morning.<br>
▸ <strong>Jeera Water</strong> – Boosts metabolism by 2–3x. Drink first thing in morning.<br>
▸ <strong>Sabja Seeds (Basil Seeds)</strong> – Soak 1 tsp in water for 10 mins; they expand 30x! Drink before meals to curb appetite.<br>
▸ <strong>Ashwagandha</strong> – Reduces stress-related binge eating by lowering cortisol.<br><br>
💡 <em>No herb is a magic pill! Combine these with a 30-minute daily walk and reduced sugar intake for real results.</em>` },

    { k: ['sabja','basil seeds','tukmaria'],
      a: `🌿 <strong>Sabja Seeds (Sweet Basil Seeds / Tukmaria)</strong> – The Cooling Superfood!<br><br>
▸ Soak 1 tsp in a glass of water for 10–15 minutes — they swell into jelly-like balls (30x their size!).<br>
▸ <strong>Weight Loss:</strong> The swollen seeds fill your stomach — drink before meals to eat less naturally.<br>
▸ <strong>Cooling:</strong> Excellent in summer — mix in sharbat, lemonade, or coconut water to prevent heat stroke.<br>
▸ <strong>Blood Sugar:</strong> Slows digestion and glucose absorption.<br>
▸ <strong>Constipation:</strong> High fibre content acts as a gentle natural laxative.<br><br>
🥤 <em>Sabja + rose water + sugar = classic Indian "Falooda" base. Delicious and healthy!</em>` },

    // ── STRESS / SLEEP ──
    { k: ['stress','anxiety','tension','mental health','sleep','insomnia','relax'],
      a: `🌿 <strong>Natural herbs for stress, anxiety & better sleep:</strong><br><br>
▸ <strong>Ashwagandha</strong> – #1 Ayurvedic adaptogen. 1 tsp in warm milk with honey at bedtime. Reduces cortisol (stress hormone) significantly.<br>
▸ <strong>Brahmi</strong> – "Brain herb" — improves focus, reduces anxiety, supports memory. 1 tsp powder with warm water or ghee.<br>
▸ <strong>Tulsi Tea</strong> – A cup of tulsi tea in the evening calms the nervous system and eases anxiety.<br>
▸ <strong>Jatamansi</strong> – Powerful nerve tonic for insomnia and chronic stress; take ½ tsp before bed.<br><br>
🧘 <em>Herbs + 20 minutes of daily meditation + phone-free 30 mins before sleep = life-changing combination for mental wellness.</em>` },

    { k: ['brahmi','bacopa'],
      a: `🌿 <strong>Brahmi</strong> – The Memory & Brain Herb!<br><br>
▸ <strong>Memory & Focus:</strong> Students and professionals swear by brahmi. 1 tsp powder with warm milk before study/work.<br>
▸ <strong>Stress:</strong> Calms hyperactive mind; natural anti-anxiety without making you drowsy.<br>
▸ <strong>Hair:</strong> Brahmi oil or paste strengthens hair roots and promotes thickness.<br>
▸ <strong>Children:</strong> Small dose brahmi powder in warm milk helps with attention and learning (ADHD support).<br><br>
📌 <em>Brahmi ghee (brahmi cooked in clarified butter) is an ancient Ayurvedic super-food for the brain — try it!</em>` },

    // ── MORINGA ──
    { k: ['moringa','drumstick','sahjan'],
      a: `🌿 <strong>Moringa (Drumstick / Miracle Tree)</strong> – Called the World's Most Nutritious Plant!<br><br>
▸ Contains 7x Vitamin C of oranges, 4x calcium of milk, 4x Vitamin A of carrots, 3x potassium of bananas!<br>
▸ <strong>Daily nutrition:</strong> Add 1 tsp moringa powder to smoothies, dals, or warm water every morning.<br>
▸ <strong>Energy:</strong> Natural energy booster — better than caffeine, no crash.<br>
▸ <strong>Lactation:</strong> Boosts breast milk production dramatically.<br>
▸ <strong>Blood Sugar:</strong> Isothiocyanates in moringa help regulate glucose levels.<br><br>
🌟 <em>If you could only choose ONE herb, moringa might be it — it genuinely is a superfood.</em>` },

    // ── FLAXSEEDS ──
    { k: ['flaxseed','flax','alsi','linseed'],
      a: `🌿 <strong>Flaxseeds (Alsi)</strong> – Plant-Based Omega-3 Powerhouse!<br><br>
▸ <strong>Heart Health:</strong> Reduces LDL cholesterol and blood pressure. 1 tbsp ground flaxseed daily in your diet.<br>
▸ <strong>Skin & Hair:</strong> Omega-3 from inside gives natural moisture to skin and reduces hair breakage.<br>
▸ <strong>Hormones:</strong> Lignans in flaxseeds balance estrogen levels — helpful for PCOS and menopause.<br>
▸ <strong>Constipation:</strong> High fibre — mix 1 tbsp in water or add to food daily.<br>
▸ <strong>Diabetes:</strong> Slows sugar absorption after meals.<br><br>
💡 <em>Always grind flaxseeds before eating — whole seeds pass through undigested. Store ground powder in fridge!</em>` },

    // ── KALONJI ──
    { k: ['kalonji','black seed','nigella','black cumin'],
      a: `🌿 <strong>Kalonji (Black Seeds / Nigella Sativa)</strong> – "A cure for everything except death"!<br><br>
▸ <strong>Immunity:</strong> ½ tsp with a teaspoon of honey every morning on empty stomach for 3 months.<br>
▸ <strong>Hair:</strong> Kalonji oil massaged into scalp 2x a week — reduces hair fall, promotes growth.<br>
▸ <strong>Respiratory:</strong> Thymoquinone in kalonji is a natural bronchodilator — great for asthma and allergies.<br>
▸ <strong>Diabetes & BP:</strong> Regular use significantly improves both conditions in clinical studies.<br><br>
📌 <em>Kalonji seeds are slightly bitter. Mix in honey or black seed oil for a better experience!</em>` },

    // ── STORE INFO ──
    { k: ['delivery','shipping','order','cod','cash on delivery','price','cost','how to order'],
      a: `🛒 <strong>Nature's Heal — Store Information:</strong><br><br>
▸ <strong>Free Delivery:</strong> On all orders above ₹499!<br>
▸ <strong>Cash on Delivery (COD):</strong> Available — pay when you receive your order.<br>
▸ <strong>Delivery Time:</strong> Hyderabad: 1–2 days | Other cities: 3–5 days.<br>
▸ <strong>WhatsApp Orders:</strong> Chat with us on <strong>+91 89190 11159</strong> for custom orders, bulk pricing, or queries.<br>
▸ <strong>Quality Promise:</strong> 100% natural, no chemicals, no artificial colours.<br><br>
💬 <em>For fastest service, WhatsApp us — we usually reply within minutes!</em>` },

    { k: ['whatsapp','contact','phone','number','call','reach'],
      a: `📞 <strong>Reach Nature's Heal:</strong><br><br>
▸ <strong>WhatsApp:</strong> <a href="https://wa.me/918919011159" target="_blank" rel="noopener noreferrer" style="color:#25D366;font-weight:700"><i class="fab fa-whatsapp"></i> +91 89190 11159</a><br>
▸ <strong>Location:</strong> Hyderabad, Telangana, India<br>
▸ <strong>Hours:</strong> Mon–Sat, 9 AM – 9 PM IST<br><br>
We'd love to help you find the right herbs for your needs! Feel free to WhatsApp for personalised recommendations.` },

    // ── GENERAL GREETINGS ──
    { k: ['hello','hi','hey','namaste','namaskar','hii','helo'],
      a: `Namaste! 🌿 I'm <strong>Vaidya</strong>, your herbal wellness guide at Nature's Heal!<br><br>
I can help you with:<br>
▸ Which herb is good for hair, skin, digestion, immunity, diabetes, stress...<br>
▸ How to use any herb (dosage, timing, combinations)<br>
▸ Product info and store details<br><br>
What health concern can I help you with today? 😊` },

    { k: ['thanks','thank you','thank','tysm','ty'],
      a: `🌿 You're most welcome! Remember, nature has a remedy for almost everything — it just takes patience and consistency.<br><br>
Feel free to ask anything else anytime. Stay healthy! 🙏` },

    { k: ['bye','goodbye','see you','cya','ok bye'],
      a: `Take care! 🌿 Wishing you vibrant health. Come back anytime you need herbal guidance. Namaste! 🙏` },
];

function localChatReply(text) {
    const q = text.toLowerCase().replace(/[^\w\s]/g,' ');
    // Try to match keywords
    for (const entry of CHAT_KB) {
        if (entry.k.some(kw => q.includes(kw))) {
            return entry.a;
        }
    }
    // Fuzzy: partial matches
    for (const entry of CHAT_KB) {
        if (entry.k.some(kw => kw.split(' ').some(w => w.length > 3 && q.includes(w)))) {
            return entry.a;
        }
    }
    // Check catalog
    const catalog = window.appState?.catalogData || [];
    const matched = catalog.find(p => p.name && q.includes(p.name.toLowerCase().split(' ')[0]));
    if (matched) {
        return `🌿 <strong>${matched.name}</strong><br><br>${matched.uses || matched.description || 'A wonderful natural product available at Nature\'s Heal.'}<br><br>💰 Price: ₹${matched.price} per ${matched.quantityType||'unit'}<br><br>🛒 Add it to your cart or <a href="https://wa.me/918919011159" target="_blank" rel="noopener noreferrer" style="color:#25D366;font-weight:700">WhatsApp us</a> to order!`;
    }
    // Default
    return `🌿 I'm not sure about that specific query yet, but I'd love to help!<br><br>You can ask me about:<br>
▸ Hair fall, hair growth<br>
▸ Skin glow, acne, dark spots<br>
▸ Immunity boosters<br>
▸ Diabetes, blood sugar<br>
▸ Digestion, gas, bloating<br>
▸ Stress, sleep, anxiety<br>
▸ Weight loss, energy<br>
▸ Specific herbs: amla, ashwagandha, triphala, neem, tulsi…<br><br>
Or <a href="https://wa.me/918919011159" target="_blank" rel="noopener noreferrer" style="color:#25D366;font-weight:700"><i class="fab fa-whatsapp"></i> WhatsApp us</a> for personalised guidance! 🙏`;
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; input.style.height = 'auto';
    document.getElementById('chatSuggestions').style.display = 'none';

    addChatMessage('user', text);
    showChatTyping();

    // Simulate a brief thinking delay for natural feel
    await new Promise(r => setTimeout(r, 650 + Math.random() * 500));
    hideChatTyping();

    const reply = localChatReply(text);
    addChatMessage('bot', reply, true);
}
window.sendChat = sendChat;

window.sendChatSuggestion = function(text) {
    document.getElementById('chatInput').value = text;
    sendChat();
};

// ===== DAILY HEALTH TIPS =====
const HEALTH_TIPS = [
    "💧 Drink warm water with lemon + honey every morning to boost digestion and immunity.",
    "🌿 Add 1 tsp Amla powder to your diet daily — it has 20× more Vitamin C than oranges!",
    "🫧 Chewing 5 Tulsi leaves on empty stomach strengthens your respiratory system.",
    "🌱 Ashwagandha + warm milk at night = deep sleep and stress relief within 2 weeks.",
    "🫙 Triphala taken before bed gently cleanses the gut without side effects.",
    "☀️ Moringa leaves powder in the morning provides iron, calcium and all 9 essential amino acids.",
    "🌿 Curry leaves every morning can reduce hair fall by 40% within a month.",
    "🫚 Flaxseeds soaked overnight improve Omega-3 absorption by 3× vs dry consumption.",
    "🌸 Hibiscus tea (2 cups/day) can lower blood pressure as effectively as some medications.",
    "🧴 Neem paste on skin for 15 min/week keeps acne and fungal infections at bay.",
];
let _tipIdx = 0;
function initHealthTip() {
    _tipIdx = Math.floor(Math.random() * HEALTH_TIPS.length);
    const el = document.getElementById('healthTipText');
    if (el) el.textContent = HEALTH_TIPS[_tipIdx];
}
window.rotateHealthTip = function() {
    _tipIdx = (_tipIdx + 1) % HEALTH_TIPS.length;
    const el = document.getElementById('healthTipText');
    if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        el.style.transition = 'all 0.2s';
        setTimeout(() => {
            el.textContent = HEALTH_TIPS[_tipIdx];
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, 200);
    }
};

// ===== NOTIFY ME =====
let _notifyProductName = '';

window.notifyMe = function(productName) {
    _notifyProductName = productName;
    const modal = document.getElementById('notifyModal');
    const nameEl = document.getElementById('notifyModalProductName');
    const input  = document.getElementById('notifyPhoneInput');
    const errEl  = document.getElementById('notifyModalError');
    if (nameEl) nameEl.textContent = `Notify me when "${productName}" is back in stock.`;
    if (input)  input.value = '';
    if (errEl)  errEl.textContent = '';
    if (modal)  { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
    setTimeout(() => { if (input) input.focus(); }, 100);
};

window.closeNotifyModal = function() {
    const modal = document.getElementById('notifyModal');
    if (modal) { modal.style.display = 'none'; modal.classList.add('hidden'); }
};

window.submitNotifyMe = async function() {
    const input  = document.getElementById('notifyPhoneInput');
    const errEl  = document.getElementById('notifyModalError');
    const btn    = document.getElementById('notifyModalSubmitBtn');
    const trimmed = (input?.value || '').trim();

    if (!/^[6-9]\d{9}$/.test(trimmed)) {
        if (errEl) errEl.textContent = 'Please enter a valid 10-digit Indian mobile number.';
        input?.focus();
        return;
    }
    if (errEl) errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

    // Save notification request to Firestore
    try {
        await window.fbAddDoc(window.fbCollection(window.db, "stock_notifications"), {
            product_name: _notifyProductName,
            whatsapp: '+91' + trimmed,
            user_uid: localStorage.getItem('user_uid') || null,
            created_at: window.fbServerTimestamp(),
            notified: false
        });
    } catch(e) { console.warn("Notify save failed:", e.message); }

    window.closeNotifyModal();
    // Open WhatsApp to confirm with store owner
    const msg = `Hi! Please notify me when *${_notifyProductName}* is back in stock at Nature's Heal. My WhatsApp: +91${trimmed}`;
    window.open(`https://wa.me/918919011159?text=${encodeURIComponent(msg)}`, '_blank');
    showToast("✅ We'll WhatsApp you when it's back!");
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fab fa-whatsapp"></i> Notify Me'; }
};

// ===== PRE-ORDER =====
window.preOrderWhatsApp = function(productName) {
    const msg = `Hi! I'd like to *pre-order* "${productName}" from Nature's Heal. Please let me know when it will be available and the price.`;
    window.open(`https://wa.me/918919011159?text=${encodeURIComponent(msg)}`, '_blank');
};

// ===== ADD COMBO TO CART =====
window.addComboToCart = function(keywords) {
    const catalog = window.appState.catalogData || [];
    let added = 0;
    keywords.forEach(kw => {
        const prod = catalog.find(p => (p.name || '').toLowerCase().includes(kw.toLowerCase()));
        if (prod && prod.stock !== '0') {
            addToCartSimple(prod.id);
            added++;
        }
    });
    if (added > 0) {
        showToast(`🎁 Combo added! ${added} items in cart`);
        openCartSidebar();
    } else {
        const msg = `Hi! I want to order the *Combo Pack* (${keywords.join(' + ')}) from Nature's Heal. Please share the details!`;
        window.open(`https://wa.me/918919011159?text=${encodeURIComponent(msg)}`, '_blank');
    }
};


// Render dynamic combos on main page from Firestore
function renderDynamicCombos(combos) {
    const grid = document.querySelector('.combo-grid');
    if (!grid || !combos || !combos.length) return;
    const active = combos.filter(c => !c._deleted);
    if (!active.length) return;
    grid.innerHTML = active.map(c => {
        const kwArr = c.keywords || [];
        const kwJson = JSON.stringify(kwArr).replace(/"/g, '&quot;');
        const saveLabel = c.save > 0 ? `<span class="combo-save">Save ${c.save}%</span>` : '';
        return `<div class="combo-card" onclick="addComboToCart(${JSON.stringify(kwArr).replace(/"/g,'&quot;')})">
            <div class="combo-emojis">${escapeHTML(c.emojis||'🎁')}</div>
            <div class="combo-info">
                <div class="combo-name">${escapeHTML(c.name)}</div>
                <div class="combo-desc">${escapeHTML(c.desc||'')}</div>
                <div class="combo-pricing">
                    <span class="combo-price">₹${c.price}</span>
                    ${c.original && c.original > c.price ? `<span class="combo-original">₹${c.original}</span>` : ''}
                    ${saveLabel}
                </div>
            </div>
            <button class="combo-add-btn" onclick="event.stopPropagation();addComboToCart(${JSON.stringify(kwArr).replace(/"/g,'&quot;')})">+ Cart</button>
        </div>`;
    }).join('');
}

// Load combos from Firestore on page init
async function loadCombosFromFirestore() {
    try {
        const snap = await window.fbGetDocs(window.fbCollection(window.db, "combos"));
        const combos = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() })).filter(c => !c._deleted);
        if (combos.length) renderDynamicCombos(combos);
    } catch(e) { /* Keep static combos if Firestore fails */ }
}

// ===== INIT =====
window.onload = function() {
    // Theme
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
        document.getElementById('themeIcon').className = 'fas fa-sun';
    }
    // Restore filter
    const _savedFilter = localStorage.getItem('selectedFilter') || 'all';
    _sf.category = _savedFilter;
    document.querySelectorAll('.sf-chip[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === _savedFilter));
    // Show skeletons immediately so first-visit feels fast, then load
    showCatalogSkeleton();
    loadCatalogFromFirestore();
    // Auth state
    updateUserUI(null);
    // Cart
    updateCartBadge();
    updatePlaceOrderButton();
    // Daily health tip
    initHealthTip();
    // Load combos from Firestore (overrides static combos if any exist)
    setTimeout(loadCombosFromFirestore, 1200);

    // Auto-refresh catalog every 60s but ONLY when not scrolling (reduces lag)
    let _scrollTimeout;
    let _isScrolling = false;
    window.addEventListener('scroll', () => {
        _isScrolling = true;
        clearTimeout(_scrollTimeout);
        _scrollTimeout = setTimeout(() => { _isScrolling = false; }, 1500);
    }, { passive: true });
    setInterval(() => {
        if (!_isScrolling && !document.hidden) loadCatalogFromFirestore(true);
    }, 60000);
};
// ===================================================================
//  SIDEBAR FILTER FUNCTIONS  (Amazon-style left panel)
// ===================================================================

// ── Sidebar open/close (mobile) ────────────────────────────────────
window.openSidebar = function() {
    document.getElementById('filterSidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
};
window.closeSidebar = function() {
    document.getElementById('filterSidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
    document.body.style.overflow = '';
};

// ── Sidebar state ───────────────────────────────────────────────────
const _sf = {
    category: 'all',
    concern:  null,
    avail:    'all',
    sort:     'default',
};

// ── Apply all sidebar filters + re-render ──────────────────────────
function sfApply() {
    const data = getSidebarFiltered();
    renderItems(data);
    updateActiveFilterPills();
    // Show/hide clear button
    const anyActive = _sf.category !== 'all' || _sf.concern || _sf.avail !== 'all'
                      || window._priceMin !== null || window._priceMax !== null;
    document.getElementById('sfClearBtn').classList.toggle('visible', anyActive);
}

function getSidebarFiltered() {
    const catalog = window.appState.catalogData || [];
    const term = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const pMin = window._priceMin;
    const pMax = window._priceMax;
    const concernKw = _sf.concern ? (CONCERN_KEYWORDS[_sf.concern] || []) : null;

    let data = catalog.filter(item => {
        // Category
        const matchCat = _sf.category === 'all' || item.type === _sf.category ||
            (_sf.category === 'favorites' && (window.appState.favorites||[]).map(String).includes(String(item.id)));
        // Health concern
        const matchConcern = !concernKw || concernKw.some(kw => {
            const hay = ((item.name||'') + ' ' + (item.uses||'') + ' ' + (item.description||'')).toLowerCase();
            return hay.includes(kw);
        });
        // Availability
        const isOOS = item.stock === '0' || item.stock === 'out';
        const isBest = item.bestseller === '1' || item.bestseller === 'true';
        const matchAvail = _sf.avail === 'all'
            || (_sf.avail === 'instock' && !isOOS)
            || (_sf.avail === 'bestseller' && isBest);
        // Search
        const matchSearch = !term || (
            (item.name||'').toLowerCase().includes(term) ||
            (item.uses||'').toLowerCase().includes(term) ||
            (item.description||'').toLowerCase().includes(term)
        );
        // Price
        const matchPrice = (pMin === null || item.price >= pMin) && (pMax === null || item.price <= pMax);

        return matchCat && matchConcern && matchAvail && matchSearch && matchPrice;
    });

    // Sort
    if (_sf.sort === 'price_asc')   data = [...data].sort((a,b) => a.price - b.price);
    if (_sf.sort === 'price_desc')  data = [...data].sort((a,b) => b.price - a.price);
    if (_sf.sort === 'name_asc')    data = [...data].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    if (_sf.sort === 'bestseller')  data = [...data].sort((a,b) => {
        const ba = a.bestseller === '1' || a.bestseller === 'true' ? 0 : 1;
        const bb = b.bestseller === '1' || b.bestseller === 'true' ? 0 : 1;
        return ba - bb;
    });

    return data;
}

// ── Individual filter handlers ─────────────────────────────────────
window.sfFilter = function(val, btn) {
    _sf.category = val;
    // Sync old nav-links too
    localStorage.setItem('selectedFilter', val);
    document.querySelectorAll('.sf-chip[data-filter]').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === val));
    document.querySelectorAll('.nav-links button[data-filter]').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === val));
    sfApply();
};

window.sfConcern = function(val, btn) {
    if (_sf.concern === val) {
        _sf.concern = null;
        document.querySelectorAll('.sf-concern-item').forEach(b => b.classList.remove('active'));
    } else {
        _sf.concern = val;
        document.querySelectorAll('.sf-concern-item').forEach(b =>
            b.classList.toggle('active', b.dataset.concern === val));
    }
    sfApply();
};

window.sfAvail = function(val, btn) {
    _sf.avail = val;
    document.querySelectorAll('.sf-chip[data-avail]').forEach(b =>
        b.classList.toggle('active', b.dataset.avail === val));
    sfApply();
};

window.sfClearAll = function() {
    _sf.category = 'all'; _sf.concern = null; _sf.avail = 'all'; _sf.sort = 'default';
    window._priceMin = null; window._priceMax = null;
    document.querySelectorAll('.sf-chip[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    document.querySelectorAll('.sf-chip[data-avail]').forEach(b => b.classList.toggle('active', b.dataset.avail === 'all'));
    document.querySelectorAll('.sf-concern-item').forEach(b => b.classList.remove('active'));
    const pMin = document.getElementById('priceMin'); if (pMin) pMin.value = '';
    const pMax = document.getElementById('priceMax'); if (pMax) pMax.value = '';
    const sortSel = document.getElementById('sortSelect'); if (sortSel) sortSel.value = 'default';
    sfApply();
};

window.applySortOrder = function() {
    const sel = document.getElementById('sortSelect');
    _sf.sort = sel ? sel.value : 'default';
    sfApply();
};

// ── Active filter pills (results bar) ─────────────────────────────
function updateActiveFilterPills() {
    const el = document.getElementById('activeFilterPills');
    if (!el) return;
    const pills = [];
    if (_sf.category !== 'all') {
        const labels = {leaf:'Leaves',fruit:'Fruits',wild_fruit:'Wild Fruits',seed:'Seeds',
                        vegetable:'Veg',dry_fruit:'Dry Fruits',flower:'Flowers',favorites:'Saved'};
        pills.push({ label: labels[_sf.category] || _sf.category, remove: () => sfFilter('all') });
    }
    if (_sf.concern) {
        pills.push({ label: _sf.concern.charAt(0).toUpperCase() + _sf.concern.slice(1), remove: () => sfConcern(_sf.concern) });
    }
    if (_sf.avail !== 'all') {
        const al = {instock:'In Stock',bestseller:'Bestsellers'};
        pills.push({ label: al[_sf.avail] || _sf.avail, remove: () => sfAvail('all') });
    }
    if (window._priceMin !== null) pills.push({ label: '₹'+window._priceMin+'+', remove: () => { window._priceMin=null; const el=document.getElementById('priceMin');if(el)el.value=''; sfApply(); }});
    if (window._priceMax !== null) pills.push({ label: '≤₹'+window._priceMax, remove: () => { window._priceMax=null; const el=document.getElementById('priceMax');if(el)el.value=''; sfApply(); }});

    el.innerHTML = pills.map((p,i) =>
        `<span class="af-pill">${escapeHTML(p.label)}<button onclick="(${p.remove.toString()})()">✕</button></span>`
    ).join('');
}

// ── Override getFilteredData so existing catalog code uses sidebar state ──
// (sfApply already calls renderItems directly; this keeps existing code compatible)
window._sfApply = sfApply;

// Override old filterItems to sync with sidebar
const _origFilterItems = window.filterItems;
window.filterItems = function(type) {
    if (type === 'orders') { openOrders(); return; }
    sfFilter(type);
};

// Override old filterByConcern to sync with sidebar  
window.filterByConcern = function(concern, el) {
    sfConcern(concern);
    // scroll to grid
    document.getElementById('gridContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── Override applyPriceFilter to use sfApply ──────────────────────
window.applyPriceFilter = function() {
    const minEl = document.getElementById('priceMin');
    const maxEl = document.getElementById('priceMax');
    window._priceMin = minEl && minEl.value !== '' ? parseFloat(minEl.value) : null;
    window._priceMax = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : null;
    sfApply();
};

// ── On catalog load, use sfApply instead of old renderItems ───────
const _origLoadCatalog = window.loadProductsFromFirestore;