// =============================================================
//  admin.js — Admin panel, orders, products, combos, analytics
// =============================================================
// Declared at script scope so they persist across calls
var _adminClickCount = 0;
var _adminClickTimer = null;
var _adminTapFeedback = null;

window.handleAdminTrigger = function() {
    _adminClickCount++;
    clearTimeout(_adminClickTimer);

    // Show subtle tap-count feedback (footer text glows greener each tap)
    const footer = document.querySelector('.footer-copy');
    if (footer) {
        footer.style.color = 'rgba(16,185,129,' + (0.18 * _adminClickCount) + ')';
        footer.style.transition = 'color 0.2s';
        clearTimeout(_adminTapFeedback);
        _adminTapFeedback = setTimeout(() => { footer.style.color = ''; }, 1200);
    }

    if (_adminClickCount >= 5) {
        _adminClickCount = 0;
        if (footer) footer.style.color = '';
        openAdminLogin();
        return;
    }

    // Reset after 2 seconds of inactivity
    _adminClickTimer = setTimeout(() => {
        _adminClickCount = 0;
        const f = document.querySelector('.footer-copy');
        if (f) f.style.color = '';
    }, 2000);
};

window.openAdminLogin = function() {
    // If already logged in with Firebase Auth, check admin directly
    if (window.currentUser) {
        if (window.currentUser.email === ADMIN_EMAIL) {
            showAdminPanel();
        } else {
            showToast("Not authorized. Login with admin Google account.", true);
            // Show the admin login modal so they can switch accounts
            document.getElementById('adminLoginModal').classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
        return;
    }
    // Not logged in — set pending flag, show login modal
    window._pendingAdminOpen = true;
    document.getElementById('adminLoginModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};
window.closeAdminLogin = function() {
    document.getElementById('adminLoginModal').classList.add('hidden');
    document.body.style.overflow = '';
};

window.verifyAdmin = function() {
    // Legacy fallback — now handled by Firebase Auth in openAdminLogin
    if (isAdmin()) {
        closeAdminLogin();
        openAdminPanel();
    } else {
        showToast("Not authorized", true);
    }
};



// ── showAdminPanel() — single source of truth for opening the admin panel.
// Always call this instead of touching adminPanel.classList directly.
// It injects the HTML if not yet done (security: markup never in static HTML),
// then reveals the panel and loads data.
function showAdminPanel() {
    const panel = document.getElementById('adminPanel');
    if (!panel) return;
    if (!panel.dataset.injected) {
        panel.innerHTML = buildAdminHTML();
        panel.dataset.injected = '1';
    }
    panel.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadAdminOrders();
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL — HTML injected only after server auth verify passes.
// Public visitors downloading index.html see only the empty sentinel div.
// The full markup never ships in the initial HTML response.
// ══════════════════════════════════════════════════════════════════════════════
function buildAdminHTML() {
    return `
    <div class="admin-box">
        <div class="admin-header">
            <span class="admin-title"><i class="fas fa-shield-alt"></i> Admin Dashboard</span>
            <button onclick="closeAdminPanel()" aria-label="Close admin panel" style="color:rgba(255,255,255,0.7);font-size:0.85rem;padding:0.4rem 0.85rem;border-radius:0.5rem;background:rgba(255,255,255,0.1)">Close</button>
        </div>
        <div class="admin-tabs">
            <button class="admin-tab active" onclick="switchAdminTab('orders')">📦 Orders</button>
            <button class="admin-tab" onclick="switchAdminTab('products')">🌿 Products</button>
            <button class="admin-tab" onclick="switchAdminTab('combos')">🎁 Combos</button>
            <button class="admin-tab" onclick="switchAdminTab('analytics')">📊 Analytics</button>
            <button class="admin-tab" onclick="switchAdminTab('inventory')">📦 Inventory</button>
            <button class="admin-tab" onclick="switchAdminTab('add')">➕ Add Product</button>
        </div>
        <div class="admin-content">
            <div id="adminOrdersTab">
                <div id="adminOrdersList"><p style="color:var(--text-muted);font-size:0.875rem">Loading orders...</p></div>
            </div>
            <div id="adminProductsTab" style="display:none">
                <div id="adminProductsList"></div>
            </div>
            <div id="adminCombosTab" style="display:none">
                <div id="adminCombosList"></div>
                <div style="margin-top:1.5rem;padding:1rem;background:var(--bg-body);border-radius:1rem;border:1px solid var(--border-color)">
                    <h4 style="font-size:0.9rem;font-weight:700;color:#059669;margin-bottom:1rem">➕ Add New Combo Pack</h4>
                    <div class="form-group">
                        <input id="cb_name" class="form-input" placeholder="Combo Name (e.g. Hair &amp; Glow Combo)">
                        <input id="cb_emojis" class="form-input" placeholder="Emojis (e.g. 🌿+💆)">
                        <input id="cb_desc" class="form-input" placeholder="Description">
                        <input id="cb_price" class="form-input" type="number" placeholder="Combo Price (₹)">
                        <input id="cb_original" class="form-input" type="number" placeholder="Original Price (₹)">
                        <input id="cb_keywords" class="form-input" placeholder="Product keywords (comma separated)">
                        <p style="font-size:0.72rem;color:var(--text-muted);margin-top:-0.3rem">Keywords match product names to add to cart. Use 2–3 items.</p>
                        <button onclick="adminSaveCombo()" class="submit-btn" style="background:#059669;margin-top:0.5rem">
                            <i class="fas fa-save"></i> Save Combo to Firestore
                        </button>
                    </div>
                </div>
            </div>
            <div id="adminAnalyticsTab" style="display:none">
                <div id="adminAnalyticsContent"><p style="color:var(--text-muted);font-size:0.875rem">Loading analytics...</p></div>
                <div id="adminInventoryContent" class="hidden"></div>
            </div>
            <div id="adminAddTab" style="display:none">
                <div class="add-product-form">
                    <h4>➕ Add New Product</h4>
                    <div class="form-group">
                        <input id="ap_name" class="form-input" placeholder="Product Name (e.g. Curry Leaves)">
                        <input id="ap_scientific" class="form-input" placeholder="Scientific Name">
                        <select id="ap_type" class="form-input" onchange="autoFillQuantityType()">
                            <option value="leaf">🍃 Leaf / Powder</option>
                            <option value="fruit">🍎 Fruit</option>
                            <option value="wild_fruit">🫐 Wild Fruit</option>
                            <option value="seed">🌱 Seed</option>
                            <option value="vegetable">🥦 Vegetable</option>
                            <option value="dry_fruit">🥜 Dry Fruit</option>
                            <option value="flower">🌸 Flower</option>
                        </select>
                        <input id="ap_price" class="form-input" type="number" placeholder="Price (₹)" min="0.01" step="0.01">
                        <div style="display:flex;gap:0.5rem">
                            <div style="flex:1">
                                <label style="font-size:0.72rem;color:var(--text-muted);font-weight:600;display:block;margin-bottom:0.25rem">Quantity Type</label>
                                <select id="ap_quantityType" class="form-input">
                                    <option value="bunch">bunch (Leaves)</option>
                                    <option value="kg">kg (Fruits)</option>
                                    <option value="g">g (Seeds)</option>
                                </select>
                            </div>
                            <div style="flex:1">
                                <label style="font-size:0.72rem;color:var(--text-muted);font-weight:600;display:block;margin-bottom:0.25rem">Min Qty</label>
                                <input id="ap_minQty" class="form-input" type="number" placeholder="e.g. 1 or 0.5" min="0.01" step="0.01">
                            </div>
                            <div style="flex:1">
                                <label style="font-size:0.72rem;color:var(--text-muted);font-weight:600;display:block;margin-bottom:0.25rem">Step</label>
                                <input id="ap_step" class="form-input" type="number" placeholder="e.g. 1 or 50" min="0.01" step="0.01">
                            </div>
                        </div>
                        <input id="ap_image" class="form-input" placeholder="Main Image URL (https://...)">
                        <input id="ap_image2" class="form-input" placeholder="Extra Image 2 URL (optional)">
                        <input id="ap_image3" class="form-input" placeholder="Extra Image 3 URL (optional)">
                        <input id="ap_image4" class="form-input" placeholder="Extra Image 4 URL (optional)">
                        <textarea id="ap_description" class="form-input form-textarea" placeholder="Description"></textarea>
                        <textarea id="ap_uses" class="form-input" placeholder="Benefits / Uses (comma separated)" style="min-height:3.5rem"></textarea>
                        <button id="adminAddProductBtn" onclick="adminAddProduct()" class="submit-btn" style="background:#4f46e5">
                            <i class="fas fa-plus"></i> Add Product to Firestore
                        </button>
                        <p style="font-size:0.72rem;color:var(--text-muted);text-align:center">Product saved directly to Firestore.</p>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

window.openAdminPanel = async function() {
    // Step 1: quick client-side check (UX only — not a security boundary)
    if (!isAdmin()) {
        showToast("Not authorized", true);
        return;
    }

    // Step 2: verify with server — get a fresh ID token and send to Cloud Function.
    // This is the real security gate: the server checks the token cryptographically
    // and only returns 200 if the email matches ADMIN_EMAIL.
    try {
        const idToken = await window.currentUser.getIdToken(/* forceRefresh= */ true);
        const res = await fetch(
            "https://us-central1-naturesheal.cloudfunctions.net/verifyAdmin",
            {
                method: "POST",
                headers: { "Authorization": "Bearer " + idToken, "Content-Type": "application/json" }
            }
        );
        if (!res.ok) {
            showToast("Server authorization failed. Access denied.", true);
            return;
        }
    } catch(e) {
        // Network error — fall back gracefully but warn
        console.warn("Admin server verify failed (network?):", e.message);
        // Still allow if client check passed — Firestore rules are the backstop
    }

    // Delegate to showAdminPanel() which handles inject + reveal atomically.
    showAdminPanel();
};
window.closeAdminPanel = function() {
    document.getElementById('adminPanel').classList.add('hidden');
    document.body.style.overflow = '';
};

function switchAdminTab(tab) {
    const tabs = ['orders','products','combos','analytics','inventory','add'];
    tabs.forEach(t => {
        const el = document.getElementById('admin' + t.charAt(0).toUpperCase() + t.slice(1) + 'Tab');
        if (el) el.style.display = t === tab ? 'block' : 'none';
    });
    document.querySelectorAll('.admin-tab').forEach((btn, i) => {
        btn.classList.toggle('active', tabs[i] === tab);
    });
    if (tab === 'products') loadAdminProducts();
    if (tab === 'analytics') loadAdminAnalytics();
    if (tab === 'inventory') {
        document.getElementById('adminInventoryContent').classList.remove('hidden');
        window.loadInventoryPanel?.();
    }
    if (tab === 'inventory') loadAdminInventory();
    if (tab === 'combos') loadAdminCombos();
}
window.switchAdminTab = switchAdminTab;

async function loadAdminOrders() {
    const list = document.getElementById('adminOrdersList');
    list.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;color:var(--text-muted);font-size:0.875rem;padding:1rem 0">
        <i class="fas fa-spinner fa-spin" style="color:#059669"></i> Loading orders...
    </div>`;
    const orders = await loadAllOrders();
    // Cache for invoice lookup
    if (!window._orderCache) window._orderCache = {};
    orders.forEach(o => { window._orderCache[o.id] = o; });

    if (!orders.length) {
        list.innerHTML = `<p style="color:var(--text-muted)">No orders yet.</p>`;
        return;
    }

    const statuses = ['pending', 'shipped', 'delivered', 'cancelled'];
    const statusIcon = { pending: '🕒', shipped: '🚚', delivered: '✅', cancelled: '❌' };
    list.innerHTML = orders.map(o => {
        const date = o.created_at?.seconds ? new Date(o.created_at.seconds * 1000).toLocaleString('en-IN') : 'Unknown';
        const st = o.status || 'pending';
        const options = statuses.map(s => `<option value="${s}" ${st === s ? 'selected' : ''}>${statusIcon[s]} ${s}</option>`).join('');
        const itemsHTML = (o.items || []).map(i => `
            <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0">
                ${i.image ? `<img src="${safeURL(i.image)}" style="width:2rem;height:2rem;border-radius:0.35rem;object-fit:cover;flex-shrink:0" alt="">` : `<div style="width:2rem;height:2rem;border-radius:0.35rem;background:#d1fae5;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-leaf" style="color:#059669;font-size:0.65rem"></i></div>`}
                <span style="font-size:0.72rem;font-weight:600">${escapeHTML(i.name)}</span>
                <span style="font-size:0.68rem;color:var(--text-muted);margin-left:auto">${i.qty} ${i.quantityType || 'unit'} · ₹${((i.price||0)*(i.qty||1)).toFixed(0)}</span>
            </div>`).join('');
        return `<div class="admin-order-row">
            <div class="admin-order-top">
                <div>
                    <span class="admin-order-total">₹${o.total}</span>
                    <span class="admin-order-id"> · #${o.id.slice(0,8)}</span>
                    <span style="font-size:0.68rem;color:var(--text-muted);margin-left:0.4rem">${o.payment?.method === 'COD' ? '💵 COD' : '💳 Online'}</span>
                </div>
                <select class="admin-status-select" onchange="updateOrderStatus('${o.id}', this.value)">${options}</select>
            </div>
            <div class="admin-order-details">
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.35rem">
                    <span><i class="fas fa-user" style="color:#059669;margin-right:0.2rem"></i><strong>${escapeHTML(o.user?.name || 'N/A')}</strong></span>
                    <span><i class="fas fa-phone" style="color:#059669;margin-right:0.2rem"></i>${escapeHTML(o.user?.phone || 'N/A')}</span>
                    <span><i class="fas fa-envelope" style="color:#059669;margin-right:0.2rem"></i>${escapeHTML(o.user?.email || 'N/A')}</span>
                </div>
                <div style="font-size:0.7rem;margin-bottom:0.35rem"><i class="fas fa-map-marker-alt" style="color:#f43f5e;margin-right:0.3rem"></i>${escapeHTML(o.user?.address || 'N/A')}</div>
                <div style="border-top:1px solid var(--border-color);padding-top:0.35rem">${itemsHTML}</div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.4rem">
                    <span style="font-size:0.68rem;color:var(--text-muted)"><i class="fas fa-clock" style="margin-right:0.2rem"></i>${date}</span>
                    <button onclick="downloadInvoiceById('${o.id}')" style="font-size:0.67rem;font-weight:700;color:#4f46e5;background:#ede9fe;border:none;border-radius:0.4rem;padding:0.25rem 0.6rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem">
                        <i class="fas fa-file-invoice"></i> Invoice
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function loadAdminProducts() {
    const list = document.getElementById('adminProductsList');
    const prods = window.appState.catalogData;
    if (!prods.length) {
        list.innerHTML = `<p style="color:var(--text-muted)">Loading catalog...</p>`;
        return;
    }
    list.innerHTML = prods.map(p => `
    <div class="admin-product-row">
        <div style="flex:1;min-width:0">
            <div class="admin-product-name">${escapeHTML(p.name)}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">${String(p.type||'').replace('_',' ')} · ${p.quantityType || inferQuantityType(p.type)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem">
            <span style="font-size:0.78rem;color:var(--text-muted)">₹</span>
            <input class="admin-input-sm" type="number" value="${p.price}" id="price_${p.id}" min="0.01" step="0.01" onchange="adminUpdatePrice('${p.id}', this.value)">
            <span style="font-size:0.68rem;color:var(--text-muted)">/${p.quantityType || '?'}</span>
            <button onclick="editProduct('${p.id}')" style="font-size:0.7rem;padding:0.3rem 0.5rem;border-radius:0.4rem;background:#dbeafe;color:#1d4ed8;font-weight:700">Edit</button>
            <label class="admin-toggle">
                <span style="font-size:0.72rem;color:var(--text-muted)">${p.stock === '0' ? 'OOS' : 'In Stock'}</span>
                <label class="toggle-switch">
                    <input type="checkbox" ${p.stock !== '0' ? 'checked' : ''} onchange="adminToggleStock('${p.id}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </label>
        </div>
    </div>`).join('');
}

window.editProduct = async function(id) {
    const item = window.appState.catalogData.find(i => i.id === id || i.firestoreId === id);
    if (!item) return;
    const newPrice = prompt(`Edit price for "${item.name}" (current: ₹${item.price}/${item.quantityType || 'unit'}):`);
    if (!newPrice) return;
    const price = parseFloat(newPrice);
    if (!price || price <= 0) return showToast("Invalid price", true);
    const priceInput = document.getElementById('price_' + item.id);
    if (priceInput) priceInput.value = price;
    await window.adminUpdatePrice(item.id, price);
    loadAdminProducts();
    loadCatalogFromFirestore && loadCatalogFromFirestore(true);
};

window.adminUpdatePrice = async function(id, val) {
    const price = parseFloat(val);
    if (!price || price <= 0) return showToast("Invalid price", true);
    const item = window.appState.catalogData.find(i => i.id === id);
    if (!item) return showToast("Product not found", true);
    item.price = price;
    if (window.appState.catalogCache) {
        const cached = window.appState.catalogCache.find(i => i.id === id);
        if (cached) cached.price = price;
    }
    try {
        if (item.firestoreId) {
            await window.fbUpdateDoc(window.fbDoc(window.db, "products", item.firestoreId), { price });
        } else {
            await window.fbAddDoc(window.fbCollection(window.db, "products"), {
                sheet_id: id, name: item.name, price,
                type: item.type || '', is_price_override: true,
                updated_at: window.fbServerTimestamp()
            });
        }
        showToast("✅ Price updated in Firestore!");
        renderItems(getFilteredData());
    } catch(e) {
        console.error("adminUpdatePrice error:", e);
        showToast("Save failed: " + (e.message || "Check Firestore rules"), true);
    }
};
window.adminToggleStock = async function(id, inStock) {
    const item = window.appState.catalogData.find(i => i.id === id || i.firestoreId === id);
    if (!item) return;
    const newStock = inStock ? '10' : '0';
    item.stock = newStock;
    if (window.appState.catalogCache) {
        const cached = window.appState.catalogCache.find(i => i.id === id || i.firestoreId === id);
        if (cached) cached.stock = newStock;
    }
    try {
        const fsId = item.firestoreId || id;
        await window.fbUpdateDoc(window.fbDoc(window.db, "products", fsId), { stock: newStock });
        showToast(inStock ? "✅ Marked In Stock & saved" : "✅ Marked Out of Stock & saved");

        // If back in stock, notify waiting users via WhatsApp
        if (inStock) {
            try {
                const notifQ = window.fbQuery(
                    window.fbCollection(window.db, "stock_notifications"),
                    window.fbWhere("product_name", "==", item.name),
                    window.fbWhere("notified", "==", false)
                );
                const notifSnap = await window.fbGetDocs(notifQ);
                notifSnap.forEach(async (docSnap) => {
                    const data = docSnap.data();
                    if (data.whatsapp) {
                        const wa = data.whatsapp.replace('+', '');
                        const msg = `🌿 *Nature's Heal Update*\n\nGreat news! *${item.name}* is back in stock! 🎉\n\nOrder now at: https://naturesheal.web.app\n\nThank you for your patience! 🙏`;
                        window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`, '_blank');
                        // Mark as notified
                        await window.fbUpdateDoc(window.fbDoc(window.db, "stock_notifications", docSnap.id), { notified: true, notified_at: window.fbServerTimestamp() });
                    }
                });
                if (!notifSnap.empty) showToast(`✅ Notified ${notifSnap.size} user(s) via WhatsApp!`);
            } catch(e) { console.warn("Notification dispatch failed:", e.message); }
        }
    } catch(e) {
        showToast("Firestore save failed: " + (e.message || "Check rules"), true);
    }
    renderItems(getFilteredData());
    loadAdminProducts();
};

window.adminAddProduct = async function() {
    const name = document.getElementById('ap_name').value.trim();
    const scientific = document.getElementById('ap_scientific').value.trim();
    const type = document.getElementById('ap_type').value;
    const price = parseFloat(document.getElementById('ap_price').value);
    const quantityType = document.getElementById('ap_quantityType').value;
    const minQty = parseFloat(document.getElementById('ap_minQty').value) || 1;
    const step = parseFloat(document.getElementById('ap_step').value) || 1;
    const image = document.getElementById('ap_image').value.trim();
    const image2 = document.getElementById('ap_image2')?.value.trim() || '';
    const image3 = document.getElementById('ap_image3')?.value.trim() || '';
    const image4 = document.getElementById('ap_image4')?.value.trim() || '';
    const description = document.getElementById('ap_description').value.trim();
    const uses = document.getElementById('ap_uses').value.trim();

    if (!name || name.length < 3) return showToast("Product name must be at least 3 characters", true);
    if (!price || price <= 0) return showToast("Invalid price. Must be greater than ₹0", true);
    if (image && !image.startsWith('https://')) return showToast("Image URL must start with https://", true);
    [image2,image3,image4].filter(Boolean).forEach(u => {
        if (!u.startsWith('https://')) return showToast("Extra image URLs must start with https://", true);
    });

    const btn = document.getElementById('adminAddProductBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
        if (typeof window.adminSaveProduct !== 'function') throw new Error("Firebase not ready");
        const extraImages = [image2, image3, image4].filter(Boolean);
        await window.adminSaveProduct({ name, scientific, type, price, quantityType, minQty, step, image, image2, image3, image4, images: extraImages, description, uses });
        showToast("✅ Product added to Firestore!");
        ['ap_name','ap_scientific','ap_price','ap_image','ap_image2','ap_image3','ap_image4','ap_description','ap_uses','ap_minQty','ap_step'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('ap_type').value = 'leaf';
        document.getElementById('ap_quantityType').value = 'bunch';
        // Reload catalog
        loadCatalogFromFirestore(true);
    } catch(e) {
        console.error("adminAddProduct error:", e);
        showToast("Failed to save: " + (e.message || "Check Firestore rules"), true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '+ Add Product'; }
    }
};


window._activeConcern = null;
window._activeHealthFilter = 'all';
window._priceMin = null;
window._priceMax = null;
;
;
;

function updateFilterClearBtn() {
    const btn = document.getElementById('filterClearBtn');
    const hasFilters = window._activeHealthFilter !== 'all' || window._priceMin !== null || window._priceMax !== null;
    if (btn) btn.style.display = hasFilters ? 'block' : 'none';
}
;

// ===== SMART SEARCH SUGGESTIONS =====

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
;

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

function calcEDD(pincode) {
    if (!pincode || pincode.length !== 6) return null;
    const prefix3 = pincode.slice(0, 3);
    const days = EDD_ZONES[prefix3] || null;
    if (!days) return null;
    const d = new Date();
    d.setDate(d.getDate() + days + (new Date().getHours() >= 14 ? 1 : 0)); // cutoff 2pm
    return { days, date: d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }) };
}
;
;

// ===== OTP RESEND TIMER =====
let _otpTimer = null;
let _otpTimerSec = 30;
let _lastPhone = '';

function startOTPTimer() {
    _otpTimerSec = 30;
    const resendBtn = document.getElementById('resendOtpBtn');
    const timerEl = document.getElementById('otpTimerDisplay');
    if (resendBtn) resendBtn.disabled = true;
    clearInterval(_otpTimer);
    _otpTimer = setInterval(() => {
        _otpTimerSec--;
        if (timerEl) timerEl.textContent = _otpTimerSec + 's';
        if (_otpTimerSec <= 0) {
            clearInterval(_otpTimer);
            if (timerEl) timerEl.textContent = '';
            if (resendBtn) { resendBtn.disabled = false; resendBtn.textContent = '🔄 Resend OTP'; }
            const row = document.querySelector('.otp-resend-row span');
            if (row) row.style.display = 'none';
        }
    }, 1000);
}

window.resendOTP = async function() {
    const phone = _lastPhone || document.getElementById('auth_phone')?.value?.trim();
    if (!phone) return;
    const btn = document.getElementById('resendOtpBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'sendOtpBtn', { size: 'invisible', callback: () => {} });
        }
        const result = await signInWithPhoneNumber(auth, '+91' + phone, window.recaptchaVerifier);
        window.otpConfirmationResult = result;
        showToast("OTP resent to +91" + phone);
        startOTPTimer();
        const row = document.querySelector('.otp-resend-row span');
        if (row) row.style.display = '';
        const timerEl = document.getElementById('otpTimerDisplay');
        if (timerEl) timerEl.textContent = '30s';
    } catch(e) {
        showToast("Resend failed: " + (e.message || e.code), true);
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Resend OTP'; }
    }
};
window.cancelOrder = async function(orderId, btn) {
    const order = window._orderCache && window._orderCache[orderId];
    const isOnline = order && order.payment?.method !== 'COD';
    const refundMsg = isOnline
        ? '\n\nYour refund (if eligible) will be credited to your original payment account within 5–7 business days.'
        : '\n\nFor COD orders, no payment was taken — no refund needed.';
    if (!confirm("Cancel this order? This action cannot be undone." + refundMsg)) return;
    btn.disabled = true;
    btn.textContent = 'Cancelling...';
    try {
        await window.fbUpdateDoc(window.fbDoc(window.db, "orders", orderId), { status: 'cancelled', cancelled_at: window.fbServerTimestamp() });
        showToast("Order cancelled. " + (isOnline ? "Refund to original account in 5–7 days." : "No charge was made."));
        // Refresh orders list
        const uid = localStorage.getItem('user_uid');
        if (uid) {
            const orders = await window.loadUserOrders(uid);
            renderOrdersList(orders);
        }
    } catch(e) {
        showToast("Could not cancel order. Try again.", true);
        btn.disabled = false;
        btn.textContent = 'Cancel Order';
    }
};

// Order cache map so invoice buttons can look up by ID without inline JSON
window._orderCache = {};

// Helper: render orders (extracted so cancelOrder can refresh list)
function renderOrdersList(orders) {
    const list = document.getElementById('ordersList');
    // Store all orders in cache for invoice lookup
    orders.forEach(o => { window._orderCache[o.id] = o; });
    if (!orders.length) {
        list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)">
            <i class="fas fa-box-open" style="font-size:2rem;display:block;margin-bottom:0.75rem;opacity:0.4"></i>
            <p style="font-weight:600">No orders yet</p>
        </div>`;
        return;
    }
    const statusIcon = { pending: '🕒', shipped: '🚚', delivered: '✅', cancelled: '❌', cod_pending: '💰' };
    const statusClass = { pending: 'status-pending', shipped: 'status-shipped', delivered: 'status-delivered', cancelled: 'status-cancelled', cod_pending: 'status-cod' };
    const statusLabel = { pending: 'Pending', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', cod_pending: 'COD Pending' };

    list.innerHTML = orders.map(o => {
        const st = o.status || 'pending';
        const date = o.created_at?.seconds ? new Date(o.created_at.seconds * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
        const payMethod = o.payment?.method === 'COD' ? '💵 Cash on Delivery' : '💳 Online Payment';
        const canCancel = (st === 'pending' || st === 'cod_pending');
        const itemsHTML = (o.items || []).map(i => {
            const hasImg = i.image && String(i.image).startsWith('https://');
            return `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.55rem 0;border-bottom:1px solid var(--border-color)">
                <div style="position:relative;width:3.25rem;height:3.25rem;flex-shrink:0">
                    ${hasImg ? `<img src="${safeURL(i.image)}" style="width:3.25rem;height:3.25rem;border-radius:0.65rem;object-fit:cover;border:1.5px solid var(--border-color);position:absolute;inset:0" alt="${escapeHTML(i.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
                    <div style="width:3.25rem;height:3.25rem;border-radius:0.65rem;background:var(--bg-body);border:1.5px solid var(--border-color);display:${hasImg ? 'none' : 'flex'};align-items:center;justify-content:center;position:absolute;inset:0">
                        <i class="fas fa-leaf" style="color:#059669;font-size:1rem"></i>
                    </div>
                </div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:0.82rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(i.name)}</div>
                    <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.15rem">
                        <span style="background:var(--border-color);border-radius:0.3rem;padding:0.1rem 0.4rem;font-weight:600">Qty: ${i.qty} ${i.quantityType || 'unit'}</span>
                        <span style="margin-left:0.4rem">@ ₹${i.price || 0}/${i.quantityType || 'unit'}</span>
                    </div>
                </div>
                <div style="font-size:0.85rem;font-weight:800;color:#059669;flex-shrink:0">₹${((i.price || 0) * (i.qty || 1)).toFixed(0)}</div>
            </div>`;
        }).join('');

        return `<div class="order-card" style="cursor:pointer" onclick="toggleOrderDetails('${o.id}', event)">
            <div class="order-top">
                <div>
                    <div class="order-amount">₹${(o.total || 0).toFixed(2)}</div>
                    <div class="order-date"><i class="fas fa-clock" style="margin-right:0.2rem"></i>${date}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem">
                    <span class="order-status ${statusClass[st] || 'status-pending'}">${statusIcon[st] || '🕒'} ${statusLabel[st] || st}</span>
                    <span style="font-size:0.65rem;color:var(--text-muted)"><i class="fas fa-chevron-down" id="chevron_${o.id}" style="transition:transform 0.2s"></i> Tap for details</span>
                </div>
            </div>
            <div class="order-payment-badge"><i class="fas fa-credit-card"></i> ${payMethod}</div>

            <!-- Expandable Details -->
            <div id="orderDetails_${o.id}" style="display:none;margin-top:0.75rem">
                <!-- Delivery Address -->
                <div style="background:var(--bg-body);border:1px solid var(--border-color);border-radius:0.75rem;padding:0.75rem;margin-bottom:0.6rem">
                    <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#059669;margin-bottom:0.4rem"><i class="fas fa-map-marker-alt" style="margin-right:0.3rem"></i>Delivery Address</div>
                    <div style="font-size:0.82rem;font-weight:700;color:var(--text-main)">${escapeHTML(o.user?.name || 'N/A')}</div>
                    <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem">${escapeHTML(o.user?.address || 'N/A')}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.1rem"><i class="fas fa-phone" style="margin-right:0.2rem;color:#059669"></i>${escapeHTML(o.user?.phone || 'N/A')} &nbsp;|&nbsp; <i class="fas fa-envelope" style="margin-right:0.2rem;color:#059669"></i>${escapeHTML(o.user?.email || 'N/A')}</div>
                </div>
                <!-- Items -->
                <div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#059669;margin-bottom:0.4rem"><i class="fas fa-box" style="margin-right:0.3rem"></i>Order Items</div>
                <div class="order-items">${itemsHTML}</div>
                <!-- Order ID -->
                <div style="font-size:0.65rem;color:var(--text-muted);margin-top:0.4rem;font-family:monospace">Order ID: ${o.id}</div>
                <!-- Actions -->
                <div style="display:flex;gap:0.5rem;margin-top:0.6rem;flex-wrap:wrap">
                    <button onclick="event.stopPropagation();downloadInvoiceById('${o.id}')" style="font-size:0.68rem;font-weight:700;color:#4f46e5;background:#ede9fe;border:none;border-radius:0.4rem;padding:0.3rem 0.7rem;cursor:pointer;display:flex;align-items:center;gap:0.3rem;transition:all 0.2s" onmouseover="this.style.background='#4f46e5';this.style.color='white'" onmouseout="this.style.background='#ede9fe';this.style.color='#4f46e5'">
                        <i class="fas fa-download"></i> Download Invoice
                    </button>
                    ${canCancel ? `<button class="cancel-order-btn" style="margin-top:0" onclick="event.stopPropagation();cancelOrder('${o.id}', this)"><i class="fas fa-times-circle"></i> Cancel Order</button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}
window.renderOrdersList = renderOrdersList;

// Toggle order details on click
window.toggleOrderDetails = function(orderId, event) {
    const det = document.getElementById('orderDetails_' + orderId);
    const chev = document.getElementById('chevron_' + orderId);
    if (!det) return;
    const isOpen = det.style.display !== 'none';
    det.style.display = isOpen ? 'none' : 'block';
    if (chev) chev.style.transform = isOpen ? '' : 'rotate(180deg)';
};

// ===== SEO: Update dynamic meta tags & URL when product modal opens =====
function updateMetaForProduct(item) {
    const slug = (item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const url = `https://naturesheal.web.app/product/${slug}`;
    const title = `${item.name} — Nature's Heal`;
    const desc = item.description || `Buy ${item.name} — 100% natural. ₹${item.price}/${item.quantityType || 'unit'}. Free delivery above ₹499.`;
    const img = item.image && item.image.startsWith('https://') ? item.image : 'https://naturesheal.web.app/icon_192.png';

    document.title = title;
    document.getElementById('ogTitle') && (document.getElementById('ogTitle').content = title);
    document.getElementById('ogDesc') && (document.getElementById('ogDesc').content = desc);
    document.getElementById('ogUrl') && (document.getElementById('ogUrl').content = url);
    document.getElementById('ogImage') && (document.getElementById('ogImage').content = img);
    document.getElementById('twTitle') && (document.getElementById('twTitle').content = title);
    document.getElementById('twDesc') && (document.getElementById('twDesc').content = desc);
    document.getElementById('canonicalTag') && (document.getElementById('canonicalTag').href = url);

    // Update URL without full page reload (History API)
    try { history.pushState({ productId: item.id }, title, `/product/${slug}`); } catch(e) {}
}

function resetMeta() {
    const title = "Nature's Heal — Pure Herbal Products";
    const desc = "100% natural herbal powders, seeds & botanical products. Free delivery on orders above ₹499.";
    document.title = title;
    document.getElementById('ogTitle') && (document.getElementById('ogTitle').content = title);
    document.getElementById('ogDesc') && (document.getElementById('ogDesc').content = desc);
    document.getElementById('ogUrl') && (document.getElementById('ogUrl').content = 'https://naturesheal.web.app/');
    document.getElementById('canonicalTag') && (document.getElementById('canonicalTag').href = 'https://naturesheal.web.app/');
    try { history.pushState({}, title, '/'); } catch(e) {}
}

// Handle browser back button for product pages
window.addEventListener('popstate', (e) => {
    const modal = document.getElementById('itemModal');
    if (modal && !modal.classList.contains('hidden')) {
        closeItemModal();
    }
});

// ===== POLICY MODAL =====
const POLICIES = {
    terms: {
        title: '📋 Terms & Conditions',
        content: `
<h3>1. Acceptance of Terms</h3>
<p>By accessing and using Nature's Heal (<strong>naturesheal.web.app</strong>), you agree to be bound by these Terms & Conditions. If you disagree with any part, please do not use our service.</p>
<h3>2. Products & Pricing</h3>
<p>All products listed are natural/herbal and sold for general wellness purposes. Prices are in Indian Rupees (₹) and inclusive of applicable taxes. We reserve the right to modify prices without prior notice.</p>
<h3>3. Orders</h3>
<p>An order confirmation via WhatsApp or email constitutes acceptance of your order. We reserve the right to cancel any order due to stock unavailability or pricing errors.</p>
<h3>4. User Responsibilities</h3>
<ul>
<li>You must provide accurate delivery information.</li>
<li>You are responsible for the security of your login credentials.</li>
<li>Misuse of the platform may result in account suspension.</li>
</ul>
<h3>5. Disclaimer</h3>
<p>Our herbal products are not intended to diagnose, treat, cure, or prevent any disease. Please consult a healthcare professional before use.</p>
<h3>6. Governing Law</h3>
<p>These terms are governed by the laws of India. Any disputes shall be subject to the jurisdiction of courts in Hyderabad, Telangana.</p>
<h3>7. Contact</h3>
<p>For questions about these terms, WhatsApp us at <strong>+91 89190 11159</strong> or email harikrishnarock444@gmail.com.</p>`
    },
    privacy: {
        title: '🔒 Privacy Policy',
        content: `
<h3>1. Information We Collect</h3>
<p>We collect information you provide directly: name, phone number, email address, and delivery address when you place an order or sign up. We also collect usage data via Firebase Analytics.</p>
<h3>2. How We Use Your Information</h3>
<ul>
<li>To process and fulfill your orders.</li>
<li>To send order confirmations and delivery updates via WhatsApp.</li>
<li>To improve our products and services.</li>
<li>To comply with legal obligations.</li>
</ul>
<h3>3. Data Storage</h3>
<p>Your data is stored securely on <strong>Google Firebase (Firestore)</strong>, which complies with GDPR and Indian data protection standards. We do not sell your personal data to third parties.</p>
<h3>4. Payment Data</h3>
<p>Payments are processed by <strong>Razorpay</strong>. We do not store your card or UPI details. Please review Razorpay's privacy policy for payment data handling.</p>
<h3>5. Cookies & Local Storage</h3>
<p>We use browser local storage to remember your cart, preferences, and login session. No third-party advertising cookies are used.</p>
<h3>6. Your Rights</h3>
<p>You may request deletion of your account data by contacting us via WhatsApp. We will process requests within 30 days.</p>
<h3>7. Contact</h3>
<p>Privacy concerns: <strong>+91 89190 11159</strong> (WhatsApp) or harikrishnarock444@gmail.com</p>`
    },
    refund: {
        title: '↩️ Refund & Cancellation Policy',
        content: `
<h3>Cancellation Policy</h3>
<p>Orders can be cancelled <strong>within 2 hours</strong> of placement by tapping "Cancel Order" in the My Orders section, or by contacting us on WhatsApp at <strong>+91 89190 11159</strong>. Orders that have already been dispatched cannot be cancelled.</p>
<h3>Refund Eligibility</h3>
<p>You are eligible for a refund if:</p>
<ul>
<li>You received a wrong product.</li>
<li>The product was damaged during delivery.</li>
<li>The product was significantly different from the description.</li>
</ul>
<h3>Non-Refundable Items</h3>
<ul>
<li>Products that have been used or consumed.</li>
<li>Orders cancelled after dispatch.</li>
<li>Perishable products like fresh leaves after 24 hours of delivery.</li>
</ul>
<h3>Refund Process</h3>
<p>Approved refunds are always credited back to the <strong>original payment account</strong> used at the time of purchase:</p>
<ul>
<li><strong>Online payments (UPI / Card / NetBanking):</strong> Refunded to the original account within <strong>5–7 business days</strong>.</li>
<li><strong>COD orders:</strong> Refunded to your bank account or UPI ID (you'll need to share details via WhatsApp) within <strong>7 business days</strong>.</li>
</ul>
<p>Refunds are never issued as store credit or coupons unless you specifically request it.</p>
<h3>How to Raise a Refund Request</h3>
<p>WhatsApp us at <strong>+91 89190 11159</strong> with your order ID, photos of the issue, and your reason for the refund request within 48 hours of delivery.</p>`
    },
    about: {
        title: '🌿 About Us',
        content: `
<h3>Who We Are</h3>
<p><strong>Nature's Heal</strong> is a Hyderabad-based herbal wellness brand founded with a simple belief: the best medicine grows from the earth. We source, clean, and pack 100% pure herbal powders, seeds, and botanical products — no additives, no fillers, no shortcuts.</p>
<h3>What We Offer</h3>
<p>From Moringa and Ashwagandha to rare seed blends used in traditional Indian medicine, every product on our platform is hand-selected, lab-tested, and delivered fresh to your doorstep across Hyderabad and beyond.</p>
<h3>Our Promise</h3>
<p>We believe in radical transparency. Every product page tells you exactly what's inside, where it comes from, and how to use it. No hidden ingredients, no false claims.</p>
<h3>Contact Us</h3>
<p>📞 <strong>+91 89190 11159</strong> (WhatsApp) &nbsp;|&nbsp; ✉️ harikrishnarock444@gmail.com</p>`
    },
    story: {
        title: '📖 Our Story',
        content: `
<h3>How It All Started</h3>
<p>Nature's Heal was born out of a personal journey. After experiencing first-hand how traditional herbal remedies helped restore health naturally, our founder Hari Krishna set out to make these time-tested botanicals accessible to every household — without the guesswork or impurity risks of the open market.</p>
<h3>From Kitchen to Community</h3>
<p>What started as sharing small batches of hand-ground herbal powders with neighbours in Hyderabad quickly grew into a trusted local brand. Today we serve hundreds of families across Telangana and Andhra Pradesh, with orders placed through our website and fulfilled fresh every day.</p>
<h3>The Road Ahead</h3>
<p>We are expanding our product range, building deeper ties with organic farmers across South India, and working towards certifications that reflect the purity you already trust us for.</p>`
    },
    mission: {
        title: '🎯 Mission & Vision',
        content: `
<h3>Our Mission</h3>
<p>To make pure, authentic, and affordable herbal wellness products available to every Indian household — delivered with honesty, transparency, and care.</p>
<h3>Our Vision</h3>
<p>A world where families confidently turn to nature first — supported by science, rooted in tradition, and free from synthetic additives.</p>
<h3>Our Values</h3>
<ul>
<li>🌱 <strong>Purity</strong> — No additives, no fillers, no compromises.</li>
<li>🤝 <strong>Trust</strong> — Clear labelling and honest communication always.</li>
<li>🌍 <strong>Sustainability</strong> — Sourced responsibly, packed minimally.</li>
<li>❤️ <strong>Community</strong> — Supporting local farmers and traditional knowledge keepers.</li>
</ul>`
    },
    why: {
        title: '✅ Why Choose Us',
        content: `
<h3>100% Pure & Natural</h3>
<p>Every product is free from artificial colours, preservatives, and fillers. What's on the label is exactly what's in the pack.</p>
<h3>Freshly Packed</h3>
<p>We pack in small batches to ensure maximum potency and freshness — not sitting in a warehouse for months.</p>
<h3>Transparent Sourcing</h3>
<p>We work directly with farmers and reliable botanical suppliers, so you know exactly where your herbs come from.</p>
<h3>Fast Local Delivery</h3>
<p>Based in Hyderabad, we deliver across Telangana and Andhra Pradesh within 1–5 business days, often faster.</p>
<h3>Genuine Customer Support</h3>
<p>Reach us instantly on WhatsApp at <strong>+91 89190 11159</strong>. Real humans, real answers — no bots.</p>
<h3>Affordable Pricing</h3>
<p>We keep our margins lean so more families can afford quality herbal nutrition without compromise.</p>`
    },
    careers: {
        title: '💼 Careers',
        content: `
<h3>Join the Nature's Heal Family</h3>
<p>We're a small, passionate team building something meaningful. If you care about natural wellness, honest commerce, and community impact — we'd love to hear from you.</p>
<h3>Current Openings</h3>
<ul>
<li>🚚 <strong>Delivery Partner</strong> — Hyderabad (Freelance / Part-time)</li>
<li>📱 <strong>Social Media & Content Creator</strong> — Remote</li>
<li>🌿 <strong>Product Sourcing Coordinator</strong> — Hyderabad</li>
</ul>
<h3>How to Apply</h3>
<p>Send your name, the role you're interested in, and a brief note about yourself to <strong>harikrishnarock444@gmail.com</strong> or WhatsApp us at <strong>+91 89190 11159</strong>. No formal CV required — tell us your story.</p>`
    },
    help: {
        title: '🆘 Help Center',
        content: `
<h3>Placing an Order</h3>
<p>Browse products, add to cart, and checkout using UPI, Card, NetBanking, or Cash on Delivery (COD available on orders above ₹499). You'll receive a confirmation on WhatsApp within minutes.</p>
<h3>Tracking Your Order</h3>
<p>Go to <strong>My Orders</strong> (tap the profile icon → Orders) to view live order status. You'll also receive WhatsApp updates at each stage.</p>
<h3>Cancelling an Order</h3>
<p>You can cancel within <strong>2 hours</strong> of placing your order via My Orders, or by WhatsApp-ing us at <strong>+91 89190 11159</strong>.</p>
<h3>Damaged or Wrong Item</h3>
<p>Take a clear photo of the item and WhatsApp us within <strong>48 hours of delivery</strong>. We'll arrange a replacement or refund promptly.</p>
<h3>Still Need Help?</h3>
<p>📞 WhatsApp: <strong>+91 89190 11159</strong><br>✉️ Email: <strong>harikrishnarock444@gmail.com</strong><br>⏰ Available: Mon–Sat, 9 AM – 7 PM IST</p>`
    },
    faq: {
        title: '❓ FAQs',
        content: `
<h3>Are your products 100% natural?</h3>
<p>Yes. Every product is free from artificial colours, flavours, preservatives, and fillers. We source directly from farmers and trusted botanical suppliers.</p>
<h3>Do you ship outside Hyderabad?</h3>
<p>Yes — we deliver across Telangana (2–4 days) and Andhra Pradesh (3–5 days). We're expanding to more states soon.</p>
<h3>Is Cash on Delivery available?</h3>
<p>COD is available on orders above ₹499. For orders below ₹499, please use online payment (UPI / Card).</p>
<h3>How do I know if a product suits me?</h3>
<p>Each product page lists ingredients, benefits, and usage instructions. For personalised advice, WhatsApp us — we're happy to help.</p>
<h3>Can I return a product?</h3>
<p>Returns are accepted for wrong, damaged, or significantly misrepresented items within 48 hours of delivery. Used or consumed products are non-refundable.</p>
<h3>How long does delivery take?</h3>
<p>1–2 days within Hyderabad city, 2–4 days in Telangana, 3–5 days in Andhra Pradesh.</p>
<h3>How do I contact support?</h3>
<p>WhatsApp us at <strong>+91 89190 11159</strong> or email harikrishnarock444@gmail.com. We respond within a few hours on business days.</p>`
    },
    disclaimer: {
        title: '⚠️ Medical & Legal Disclaimer',
        content: `
<h3>Health & Medical Disclaimer</h3>
<p>All products sold by Nature's Heal are <strong>food-grade herbal products</strong> intended for general wellness and nutritional supplementation only. They are <strong>not medicines</strong> and are not intended to diagnose, treat, cure, or prevent any disease or medical condition.</p>
<h3>Consult a Professional</h3>
<p>If you have a medical condition, are pregnant, breastfeeding, or are on medication, please consult a qualified healthcare professional before using any herbal supplement.</p>
<h3>Individual Results</h3>
<p>Results may vary from person to person. Testimonials and product descriptions reflect general wellness benefits and are not guarantees of specific outcomes.</p>
<h3>Accuracy of Information</h3>
<p>While we strive to ensure all product information on our platform is accurate and up to date, we do not warrant that descriptions or other content are error-free. Prices and availability are subject to change without notice.</p>
<h3>External Links</h3>
<p>Our platform may contain links to third-party sites (e.g., Razorpay, WhatsApp). We are not responsible for their content or privacy practices.</p>
<h3>Governing Jurisdiction</h3>
<p>This disclaimer is governed by Indian law. Any disputes are subject to the jurisdiction of courts in <strong>Hyderabad, Telangana</strong>.</p>`
    },
    shipping: {
        title: '🚚 Shipping Policy',
        content: `
<h3>Delivery Area</h3>
<p>We currently deliver across <strong>Hyderabad, Telangana</strong> and select areas in Andhra Pradesh. We are expanding to more cities soon.</p>
<h3>Delivery Timelines</h3>
<ul>
<li><strong>Hyderabad (within city):</strong> 1–2 business days</li>
<li><strong>Telangana (other districts):</strong> 2–4 business days</li>
<li><strong>Andhra Pradesh:</strong> 3–5 business days</li>
</ul>
<h3>Shipping Charges</h3>
<p><strong>Free delivery</strong> on your first order (regardless of value). <strong>Free delivery</strong> on subsequent orders above ₹499. A flat shipping fee of ₹49 applies to orders below ₹499. Minimum order value is ₹150.</p>
<h3>Cash on Delivery (COD)</h3>
<p>COD is available for orders <strong>above ₹499</strong>. After placing a COD order, our team will confirm the order via WhatsApp within 2 hours before dispatch. For orders below ₹499, please use Online Payment (UPI / Card).</p>
<h3>Order Tracking</h3>
<p>Once your order is dispatched, you will receive a WhatsApp message with delivery updates. For real-time tracking, contact us at <strong>+91 89190 11159</strong>.</p>
<h3>Delays</h3>
<p>Delivery timelines may be affected by public holidays, extreme weather, or other unforeseen circumstances. We will proactively notify you of any delays via WhatsApp.</p>`
    }
};

window.openPolicy = function(tab) {
    switchPolicy(tab || 'terms');
    document.getElementById('policyModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};
window.closePolicyModal = function() {
    document.getElementById('policyModal').classList.add('hidden');
    document.body.style.overflow = '';
};
window.switchPolicy = function(tab) {
    const p = POLICIES[tab];
    if (!p) return;
    document.getElementById('policyContent').innerHTML = p.content;
    document.getElementById('policyModalTitle').textContent = p.title;
    document.querySelectorAll('.policy-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById('ptab_' + tab);
    if (activeTab) activeTab.classList.add('active');
};
let deferredPrompt;
// Hide install button by default; only reveal once browser confirms installable
(function() {
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'none';
    // Already installed as PWA — keep hidden
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    window.addEventListener("beforeinstallprompt", e => {
        e.preventDefault(); // prevent mini-infobar; we show our own button
        deferredPrompt = e;
        if (btn) btn.style.display = 'block';
    });
})();
window.installApp = function() {
    if (!deferredPrompt) { showToast("Open in browser to install the app", true); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
        deferredPrompt = null;
        const btn = document.getElementById("installBtn");
        if (btn) btn.style.display = "none";
        if (choice.outcome === "accepted") showToast("✅ App installed successfully!");
    });
};

// ===== SERVICE WORKER =====
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        // Register at root — matches Firebase Hosting deployment at /
        navigator.serviceWorker.register("/sw.js", { scope: "/" })
            .catch(err => console.warn("SW registration failed:", err));
    });
}

// ===== INVOICE PDF GENERATOR =====
window.downloadInvoiceById = function(orderId) {
    const order = window._orderCache && window._orderCache[orderId];
    if (!order) { showToast("Invoice data not found. Please reopen Orders.", true); return; }
    generateInvoicePDF(order);
};

function generateInvoicePDF(order) {
    const items = order.items || [];
    const subtotal = order.subtotal || order.total || items.reduce((s,i) => s + (i.price * i.qty), 0);
    const shipping = order.deliveryCharge !== undefined ? order.deliveryCharge : (subtotal >= 499 ? 0 : 49);
    const grandTotal = order.total || (subtotal + shipping);
    const isFirstOrder = order.isFirstOrder || false;
    const orderDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const orderId = (order.id || ('NH-' + Date.now())).slice(0, 14).toUpperCase();

    const html = `
    <html><head><meta charset="UTF-8">
    <style>
        body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;background:#fff;color:#0f172a}
        .page{max-width:680px;margin:0 auto;padding:2rem}
        .header{background:linear-gradient(135deg,#059669,#047857);color:white;padding:1.5rem 2rem;border-radius:0.75rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem}
        .header h1{font-size:1.5rem;font-weight:800;margin:0}
        .header p{font-size:0.75rem;opacity:0.8;margin:0.2rem 0 0}
        .invoice-meta{color:white;text-align:right;font-size:0.8rem}
        .invoice-meta strong{display:block;font-size:1rem}
        .section{background:#f0fdf4;border-radius:0.65rem;padding:1rem 1.25rem;margin-bottom:1rem;border:1px solid #d1fae5}
        .section-title{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#059669;margin-bottom:0.65rem}
        .info-row{display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:0.2rem}
        .info-label{color:#475569;font-weight:600}
        .info-val{color:#0f172a;font-weight:700;text-align:right;max-width:60%}
        table{width:100%;border-collapse:collapse;margin-bottom:1rem}
        thead tr{background:#059669;color:white}
        th{padding:0.55rem 0.75rem;font-size:0.72rem;font-weight:700;text-align:left}
        td{padding:0.55rem 0.75rem;font-size:0.8rem;border-bottom:1px solid #d1fae5}
        tbody tr:nth-child(even){background:#f0fdf4}
        .totals{background:#f0fdf4;border-radius:0.65rem;padding:1rem 1.25rem;border:1px solid #d1fae5}
        .total-row{display:flex;justify-content:space-between;font-size:0.85rem;padding:0.25rem 0}
        .grand-total{border-top:2px solid #059669;margin-top:0.5rem;padding-top:0.6rem;font-size:1rem;font-weight:800;color:#059669}
        .footer{text-align:center;margin-top:1.5rem;font-size:0.7rem;color:#94a3b8}
        .badge{display:inline-block;padding:0.2rem 0.6rem;border-radius:9999px;font-size:0.68rem;font-weight:700;background:#d1fae5;color:#065f46}
        @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head>
    <body><div class="page">
        <div class="header">
            <div>
                <h1>🌿 Nature's Heal</h1>
                <p>Pure Herbal Products · naturesheal.web.app</p>
                <p style="margin-top:0.35rem;font-size:0.7rem;opacity:0.75">+91 89190 11159 · harikrishnarock444@gmail.com</p>
            </div>
            <div class="invoice-meta">
                <strong>INVOICE</strong>
                <span>#${orderId}</span><br>
                <span style="margin-top:0.3rem;display:block">${orderDate}</span>
                <span class="badge" style="margin-top:0.4rem;background:rgba(255,255,255,0.2);color:white">${order.payment?.method === 'COD' ? '💵 Cash on Delivery' : '💳 Online Paid'}</span>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Bill To</div>
            <div class="info-row"><span class="info-label">Name</span><span class="info-val">${escapeHTML(order.user?.name || 'N/A')}</span></div>
            <div class="info-row"><span class="info-label">Phone</span><span class="info-val">${escapeHTML(order.user?.phone || 'N/A')}</span></div>
            <div class="info-row"><span class="info-label">Email</span><span class="info-val">${escapeHTML(order.user?.email || 'N/A')}</span></div>
            <div class="info-row"><span class="info-label">Address</span><span class="info-val">${escapeHTML(order.user?.address || 'N/A')}</span></div>
        </div>

        <table>
            <thead><tr>
                <th>#</th><th>Product</th><th>Qty</th><th>Rate</th><th style="text-align:right">Amount</th>
            </tr></thead>
            <tbody>
                ${items.map((item, idx) => `
                <tr>
                    <td>${idx + 1}</td>
                    <td><strong>${escapeHTML(item.name)}</strong></td>
                    <td>${item.qty} ${item.quantityType || 'unit'}</td>
                    <td>₹${item.price}/${item.quantityType || 'unit'}</td>
                    <td style="text-align:right;font-weight:700">₹${(item.price * item.qty).toFixed(0)}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <div class="totals">
            <div class="total-row"><span>Subtotal</span><span>₹${subtotal.toFixed(0)}</span></div>
            <div class="total-row"><span>Delivery${isFirstOrder ? ' 🎉 First Order' : ''}</span><span>${shipping === 0 ? '<span style="color:#059669">Free</span>' : '₹' + shipping}</span></div>
            <div class="total-row grand-total"><span>Grand Total</span><span>₹${grandTotal.toFixed(0)}</span></div>
        </div>

        <div class="footer">
            <p>Thank you for shopping with Nature's Heal! 🌿</p>
            <p>For support: WhatsApp +91 89190 11159 | naturesheal.web.app</p>
            <p style="margin-top:0.5rem">This is a computer-generated invoice and does not require a signature.</p>
        </div>
    </div></body></html>`;

    // Download as HTML file directly (no print dialog)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NaturesHeal_Invoice_${orderId}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("📄 Invoice downloaded!");
}
window.generateInvoicePDF = generateInvoicePDF;

// ===== SEND ORDER CONFIRMATION EMAIL VIA FIREBASE =====
async function sendOrderConfirmationEmail(orderData, orderId) {
    try {
        const email = orderData.user?.email || orderData.user_email;
        if (!email || !email.includes('@')) return;

        const items = orderData.items || [];
        const subtotal = orderData.subtotal || orderData.total;
        const deliveryCharge = orderData.deliveryCharge !== undefined ? orderData.deliveryCharge : 0;
        const grandTotal = orderData.total;
        const isFirstOrder = orderData.isFirstOrder || false;
        const deliveryNote = isFirstOrder ? '🎉 FREE (First Order!)' : (deliveryCharge === 0 ? 'FREE (Above ₹499)' : `₹${deliveryCharge}`);

        const itemsHTML = items.map((i, idx) => `
            <tr style="background:${idx%2===0?'#f0fdf4':'#ffffff'}">
                <td style="padding:8px 12px">${escapeHTML(i.name)}</td>
                <td style="padding:8px 12px;text-align:center">${i.qty} ${i.quantityType||'unit'}</td>
                <td style="padding:8px 12px;text-align:right">₹${((i.price||0)*(i.qty||1)).toFixed(0)}</td>
            </tr>`).join('');

        const htmlBody = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#f0fdf4;padding:20px">
            <div style="background:linear-gradient(135deg,#059669,#047857);padding:24px;border-radius:12px;margin-bottom:16px;color:white;text-align:center">
                <h1 style="margin:0;font-size:1.5rem">🌿 Nature's Heal</h1>
                <p style="margin:8px 0 0;opacity:0.85;font-size:0.9rem">Order Confirmed! Thank you for your purchase.</p>
            </div>
            <div style="background:white;border-radius:12px;padding:20px;margin-bottom:12px;border:1px solid #d1fae5">
                <p style="font-size:0.9rem;color:#374151">Dear <strong>${escapeHTML(orderData.user?.name||'Customer')}</strong>,</p>
                <p style="font-size:0.85rem;color:#6b7280">Your order <strong>#${(orderId||'').slice(0,12).toUpperCase()}</strong> has been placed successfully.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                    <thead><tr style="background:#059669;color:white">
                        <th style="padding:8px 12px;text-align:left;font-size:0.8rem">Product</th>
                        <th style="padding:8px 12px;text-align:center;font-size:0.8rem">Qty</th>
                        <th style="padding:8px 12px;text-align:right;font-size:0.8rem">Amount</th>
                    </tr></thead>
                    <tbody>${itemsHTML}</tbody>
                </table>
                <div style="border-top:2px solid #d1fae5;padding-top:12px">
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px"><span>Subtotal</span><span>₹${(subtotal||0).toFixed(0)}</span></div>
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:8px"><span>Delivery</span><span style="color:#059669">${deliveryNote}</span></div>
                    <div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:800;color:#059669"><span>Grand Total</span><span>₹${(grandTotal||0).toFixed(0)}</span></div>
                </div>
            </div>
            <div style="background:white;border-radius:12px;padding:16px;margin-bottom:12px;border:1px solid #d1fae5">
                <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;color:#059669;margin-bottom:8px">📍 Delivery Address</div>
                <p style="font-size:0.85rem;color:#374151;margin:0">${escapeHTML(orderData.user?.address||'N/A')}</p>
                <p style="font-size:0.8rem;color:#6b7280;margin:4px 0 0">Payment: ${orderData.payment?.method === 'COD' ? '💵 Cash on Delivery' : '💳 Online Payment'}</p>
            </div>
            <div style="text-align:center;font-size:0.78rem;color:#6b7280;padding:12px">
                <p>Questions? WhatsApp us: <a href="https://wa.me/918919011159" style="color:#059669">+91 89190 11159</a></p>
                <p style="margin-top:4px">Thank you for choosing Nature's Heal 🌿</p>
            </div>
        </div>`;

        // Save to 'mail' collection — Firebase "Trigger Email" extension reads this
        await window.fbAddDoc(window.fbCollection(window.db, "mail"), {
            to: [email],
            message: {
                subject: `✅ Order Confirmed — Nature's Heal #${(orderId||'').slice(0,8).toUpperCase()}`,
                html: htmlBody
            },
            created_at: window.fbServerTimestamp()
        });
    } catch(e) {
        console.warn("Email send failed (non-critical):", e.message);
    }
}


// ===== LOAD ALL ORDERS (used by analytics + orders tab) =====
window.loadAllOrders = async function() {
    try {
        const snap = await window.fbGetDocs(window.fbCollection(window.db, 'orders'));
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
            const at = a.created_at?.seconds || a.createdAt?.seconds || 0;
            const bt = b.created_at?.seconds || b.createdAt?.seconds || 0;
            return bt - at;
        });
        window._allOrders = orders;   // cache for features.js charts
        return orders;
    } catch(e) {
        console.error('loadAllOrders error:', e);
        return [];
    }
};

async function loadAdminAnalytics() {
    const el = document.getElementById('adminAnalyticsContent');
    if (!el) return;
    el.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;color:var(--text-muted);padding:2rem;justify-content:center"><i class="fas fa-spinner fa-spin" style="color:#059669;font-size:1.25rem"></i>&nbsp; Crunching numbers…</div>`;

    const orders = await loadAllOrders();
    if (!orders.length) { el.innerHTML = `<div class="analytics-empty"><i class="fas fa-chart-bar"></i><p>No order data yet. Place some orders first.</p></div>`; return; }

    const totalRevenue  = orders.reduce((s,o) => s + (parseFloat(o.total)||0), 0);
    const delivered     = orders.filter(o => o.status === 'delivered').length;
    const pending       = orders.filter(o => !o.status || o.status === 'pending' || o.status === 'placed').length;
    const cancelled     = orders.filter(o => o.status === 'cancelled').length;
    const codOrders     = orders.filter(o => o.payment?.method === 'COD').length;
    const onlineOrders  = orders.length - codOrders;
    const avgOrder      = totalRevenue / orders.length;

    // Monthly revenue (last 6 months)
    const monthRevenue = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
        monthRevenue[d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'})] = 0;
    }

    // Daily revenue (last 30 days)
    const dayRevenue = {};
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i*86400000);
        dayRevenue[d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})] = 0;
    }

    // Top products + city heatmap + customer repeat analysis
    const productSales = {}, cityOrders = {}, customerOrders = {};
    orders.forEach(o => {
        const ts = o.createdAt?.seconds ? o.createdAt.seconds*1000 : (o.created_at?.seconds ? o.created_at.seconds*1000 : Date.now());
        const d  = new Date(ts);
        const dayLabel   = d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
        const monthLabel = d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'});
        if (dayLabel   in dayRevenue)   dayRevenue[dayLabel]   += parseFloat(o.total)||0;
        if (monthLabel in monthRevenue) monthRevenue[monthLabel] += parseFloat(o.total)||0;

        (o.items||[]).forEach(item => {
            const k = item.name;
            if (!productSales[k]) productSales[k] = { name:k, qty:0, revenue:0, count:0 };
            productSales[k].qty     += (item.qty||0);
            productSales[k].revenue += ((item.price||0)*(item.qty||1));
            productSales[k].count++;
        });

        const city = (o.address||'').split(',').slice(-2,-1)[0]?.trim() || 'Unknown';
        cityOrders[city] = (cityOrders[city]||0) + 1;

        const uid = o.uid || o.phone;
        if (uid) customerOrders[uid] = (customerOrders[uid]||0) + 1;
    });

    const topProducts  = Object.values(productSales).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
    const topCities    = Object.entries(cityOrders).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const maxRev       = topProducts[0]?.revenue || 1;
    const maxDay       = Math.max(...Object.values(dayRevenue),1);
    const maxMonth     = Math.max(...Object.values(monthRevenue),1);
    const repeatCount  = Object.values(customerOrders).filter(c=>c>1).length;
    const repeatRate   = Math.round(repeatCount / Object.keys(customerOrders).length * 100) || 0;

    el.innerHTML = `
    <!-- ── KPI Cards ── -->
    <div class="analytics-kpi-grid">
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#d1fae5;color:#059669"><i class="fas fa-rupee-sign"></i></div>
            <div class="analytics-kpi-val">₹${totalRevenue>=1000?(totalRevenue/1000).toFixed(1)+'K':totalRevenue.toFixed(0)}</div>
            <div class="analytics-kpi-label">Total Revenue</div>
            <div class="analytics-kpi-sub">Avg ₹${avgOrder.toFixed(0)}/order</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#fef3c7;color:#d97706"><i class="fas fa-box"></i></div>
            <div class="analytics-kpi-val">${orders.length}</div>
            <div class="analytics-kpi-label">Total Orders</div>
            <div class="analytics-kpi-sub">${delivered} delivered</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#dbeafe;color:#3b82f6"><i class="fas fa-users"></i></div>
            <div class="analytics-kpi-val">${Object.keys(customerOrders).length}</div>
            <div class="analytics-kpi-label">Unique Customers</div>
            <div class="analytics-kpi-sub">${repeatRate}% repeat buyers</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#fce7f3;color:#db2777"><i class="fas fa-clock"></i></div>
            <div class="analytics-kpi-val">${pending}</div>
            <div class="analytics-kpi-label">Pending Orders</div>
            <div class="analytics-kpi-sub">${cancelled} cancelled</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#ede9fe;color:#7c3aed"><i class="fas fa-credit-card"></i></div>
            <div class="analytics-kpi-val">${Math.round(onlineOrders/orders.length*100)}%</div>
            <div class="analytics-kpi-label">Online Payments</div>
            <div class="analytics-kpi-sub">${codOrders} COD orders</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#fef9c3;color:#ca8a04"><i class="fas fa-redo"></i></div>
            <div class="analytics-kpi-val">${repeatRate}%</div>
            <div class="analytics-kpi-label">Repeat Rate</div>
            <div class="analytics-kpi-sub">${repeatCount} repeat customers</div>
        </div>
    </div>

    <!-- ── Revenue Chart — 30 Days ── -->
    <div class="analytics-chart-card">
        <div class="analytics-chart-title"><i class="fas fa-chart-line" style="color:#059669"></i> Revenue — Last 30 Days</div>
        <div class="analytics-bar-chart">
            ${Object.entries(dayRevenue).map(([day,rev],i) => `
            <div class="analytics-bar-col" title="${day}: ₹${rev.toFixed(0)}">
                <div class="analytics-bar-fill" style="height:${Math.round(rev/maxDay*100)}%;background:${rev>0?'#059669':'#e5e7eb'}"></div>
                ${i%5===0?`<div class="analytics-bar-label">${day}</div>`:''}
            </div>`).join('')}
        </div>
    </div>

    <!-- ── Monthly Revenue ── -->
    <div class="analytics-chart-card">
        <div class="analytics-chart-title"><i class="fas fa-calendar-alt" style="color:#7c3aed"></i> Monthly Revenue</div>
        ${Object.entries(monthRevenue).map(([m,rev]) => `
        <div class="revenue-bar-wrap">
            <div class="revenue-bar-label"><span>${m}</span><span style="font-weight:700;color:#059669">₹${rev.toFixed(0)}</span></div>
            <div class="revenue-bar-track"><div class="revenue-bar-fill" style="width:${Math.round(rev/maxMonth*100)}%"></div></div>
        </div>`).join('')}
    </div>

    <!-- ── Top Products ── -->
    <div class="analytics-chart-card">
        <div class="analytics-chart-title"><i class="fas fa-fire" style="color:#f59e0b"></i> Top Products by Revenue</div>
        ${topProducts.map((p,i) => `
        <div class="top-product-row">
            <span class="top-product-rank">${i+1}</span>
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:0.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(p.name)}</div>
                <div class="top-product-bar" style="width:${Math.round(p.revenue/maxRev*100)}%;margin-top:0.25rem"></div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:0.5rem">
                <div style="font-weight:800;font-size:0.82rem;color:#059669">₹${p.revenue.toFixed(0)}</div>
                <div style="font-size:0.65rem;color:var(--text-muted)">${p.qty} units · ${p.count} orders</div>
            </div>
        </div>`).join('')}
    </div>

    <!-- ── City Heatmap ── -->
    ${topCities.length>1 ? `
    <div class="analytics-chart-card">
        <div class="analytics-chart-title"><i class="fas fa-map-marker-alt" style="color:#ef4444"></i> Orders by City</div>
        ${topCities.map(([city,count]) => `
        <div class="revenue-bar-wrap">
            <div class="revenue-bar-label"><span>${city}</span><span>${count} orders</span></div>
            <div class="revenue-bar-track"><div class="revenue-bar-fill" style="width:${Math.round(count/(topCities[0][1]||1)*100)}%;background:#ef4444"></div></div>
        </div>`).join('')}
    </div>` : ''}`;
}


// ===== ADMIN: INVENTORY MANAGEMENT =====
async function loadAdminInventory() {
    const el = document.getElementById('adminInventoryContent');
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="font-size:1.25rem"></i></div>`;

    const catalog = window.appState?.catalogData || [];
    if (!catalog.length) { el.innerHTML = `<p style="color:var(--text-muted);padding:1rem">No products found.</p>`; return; }

    const lowStock  = catalog.filter(p => /^\d+$/.test(String(p.stock||'')) && parseInt(p.stock) <= 9 && parseInt(p.stock) > 0);
    const outStock  = catalog.filter(p => p.stock === '0' || p.stock === 'out');
    const inStock   = catalog.filter(p => !lowStock.includes(p) && !outStock.includes(p));

    el.innerHTML = `
    <div class="inv-summary">
        <div class="inv-kpi" style="border-left:4px solid #059669">
            <div class="inv-kpi-val" style="color:#059669">${inStock.length}</div>
            <div class="inv-kpi-label">In Stock</div>
        </div>
        <div class="inv-kpi" style="border-left:4px solid #f59e0b">
            <div class="inv-kpi-val" style="color:#f59e0b">${lowStock.length}</div>
            <div class="inv-kpi-label">Low Stock (≤9)</div>
        </div>
        <div class="inv-kpi" style="border-left:4px solid #ef4444">
            <div class="inv-kpi-val" style="color:#ef4444">${outStock.length}</div>
            <div class="inv-kpi-label">Out of Stock</div>
        </div>
        <div class="inv-kpi" style="border-left:4px solid #6366f1">
            <div class="inv-kpi-val">${catalog.length}</div>
            <div class="inv-kpi-label">Total Products</div>
        </div>
    </div>

    ${lowStock.length > 0 ? `
    <div class="inv-section-title" style="color:#f59e0b"><i class="fas fa-exclamation-triangle"></i> Low Stock Alerts</div>
    <div class="inv-table">
        <div class="inv-table-header">
            <span>Product</span><span>Type</span><span>Stock</span><span>Price</span><span>Action</span>
        </div>
        ${lowStock.map(p => `
        <div class="inv-table-row inv-row--low">
            <span class="inv-product-name">${escapeHTML(p.name)}</span>
            <span class="inv-type-badge">${p.type||'—'}</span>
            <span class="inv-stock-val inv-stock--low">⚠️ ${p.stock}</span>
            <span>₹${p.price||'—'}</span>
            <button class="inv-edit-btn" onclick="adminEditProduct('${p.id}')">Edit</button>
        </div>`).join('')}
    </div>` : ''}

    ${outStock.length > 0 ? `
    <div class="inv-section-title" style="color:#ef4444;margin-top:1rem"><i class="fas fa-times-circle"></i> Out of Stock</div>
    <div class="inv-table">
        <div class="inv-table-header">
            <span>Product</span><span>Type</span><span>Stock</span><span>Price</span><span>Action</span>
        </div>
        ${outStock.map(p => `
        <div class="inv-table-row inv-row--oos">
            <span class="inv-product-name">${escapeHTML(p.name)}</span>
            <span class="inv-type-badge">${p.type||'—'}</span>
            <span class="inv-stock-val inv-stock--oos">❌ Out</span>
            <span>₹${p.price||'—'}</span>
            <button class="inv-edit-btn" onclick="adminEditProduct('${p.id}')">Restock</button>
        </div>`).join('')}
    </div>` : ''}

    <div class="inv-section-title" style="margin-top:1rem"><i class="fas fa-boxes"></i> All Products</div>
    <div class="inv-search-row">
        <input class="inv-search" type="text" placeholder="Search products…" oninput="_filterInvTable(this.value)">
        <select class="inv-filter-sel" onchange="_filterInvByType(this.value)">
            <option value="">All Types</option>
            ${[...new Set(catalog.map(p=>p.type).filter(Boolean))].map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
    </div>
    <div class="inv-table" id="invAllTable">
        <div class="inv-table-header">
            <span>Product</span><span>Type</span><span>Stock</span><span>Price</span><span>Action</span>
        </div>
        ${catalog.map(p => `
        <div class="inv-table-row" data-name="${escapeHTML((p.name||'').toLowerCase())}" data-type="${p.type||''}">
            <span class="inv-product-name">${escapeHTML(p.name)}</span>
            <span class="inv-type-badge">${p.type||'—'}</span>
            <span class="inv-stock-val ${p.stock==='0'||p.stock==='out'?'inv-stock--oos':/^\d+$/.test(String(p.stock||''))&&parseInt(p.stock)<=9?'inv-stock--low':'inv-stock--ok'}">
                ${p.stock==='0'||p.stock==='out'?'❌ Out':/^\d+$/.test(String(p.stock||''))&&parseInt(p.stock)<=9?'⚠️ '+p.stock:'✅ OK'}
            </span>
            <span>₹${p.price||'—'}</span>
            <button class="inv-edit-btn" onclick="adminEditProduct('${p.id}')">Edit</button>
        </div>`).join('')}
    </div>`;
}

window.loadAdminInventory = loadAdminInventory;

window._filterInvTable = function(q) {
    document.querySelectorAll('#invAllTable .inv-table-row').forEach(row => {
        row.style.display = row.dataset.name?.includes(q.toLowerCase()) ? '' : 'none';
    });
};
window._filterInvByType = function(type) {
    document.querySelectorAll('#invAllTable .inv-table-row').forEach(row => {
        row.style.display = !type || row.dataset.type === type ? '' : 'none';
    });
};
window.adminEditProduct = function(id) {
    switchAdminTab('products');
    // Auto-scroll to product row
    setTimeout(() => {
        const row = document.querySelector(`[data-product-id="${id}"]`);
        row?.scrollIntoView({ behavior:'smooth', block:'center' });
        row?.classList.add('highlight-row');
        setTimeout(() => row?.classList.remove('highlight-row'), 2000);
    }, 500);
};


// ===== ADMIN COMBOS =====
async function loadAdminCombos() {
    const list = document.getElementById('adminCombosList');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.875rem;padding:0.5rem 0">Loading combos...</div>';
    try {
        const snap = await window.fbGetDocs(window.fbCollection(window.db, "combos"));
        const combos = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
        window._combosCache = combos;
        if (!combos.length) {
            list.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem">No combos yet. Add one below.</p>';
        } else {
            list.innerHTML = combos.map(c => `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;border:1px solid var(--border-color);border-radius:0.75rem;margin-bottom:0.6rem;background:var(--bg-card)">
                <span style="font-size:1.5rem">${escapeHTML(c.emojis||'🎁')}</span>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:700;font-size:0.85rem;color:#059669">${escapeHTML(c.name)}</div>
                    <div style="font-size:0.7rem;color:var(--text-muted)">${escapeHTML(c.desc||'')} · Keywords: ${escapeHTML((c.keywords||[]).join(', '))}</div>
                    <div style="font-size:0.75rem;font-weight:700;color:#059669">₹${c.price} <span style="text-decoration:line-through;color:var(--text-muted);font-weight:400">₹${c.original||''}</span></div>
                </div>
                <button onclick="window.adminDeleteCombo('${c.firestoreId}')" style="font-size:0.7rem;padding:0.3rem 0.6rem;border-radius:0.4rem;background:#fee2e2;color:#dc2626;font-weight:700;border:none;cursor:pointer">Delete</button>
            </div>`).join('');
        }
        if (typeof renderDynamicCombos === 'function') renderDynamicCombos(combos);
    } catch(e) {
        list.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:0.75rem;padding:1rem;font-size:0.82rem">
            <p style="color:#dc2626;font-weight:700;margin-bottom:0.35rem">⚠️ ${e.message.includes('permission')||e.message.includes('Missing') ? 'Firestore Permission Error' : 'Load Error'}</p>
            <p style="color:var(--text-muted);font-size:0.75rem">${e.message}</p>
        </div>`;
    }
}
window.loadAdminCombos = loadAdminCombos;

window.adminSaveCombo = async function() {
    const g = id => document.getElementById(id)?.value?.trim();
    const name = g('cb_name'), emojis = g('cb_emojis'), desc = g('cb_desc');
    const price = parseFloat(g('cb_price')), original = parseFloat(g('cb_original'));
    const kwStr = g('cb_keywords');
    if (!name || !price || !kwStr) return showToast('Fill name, price and keywords', true);
    const keywords = kwStr.split(',').map(k => k.trim()).filter(Boolean);
    const save = original > price ? Math.round(((original-price)/original)*100) : 0;
    try {
        await window.fbAddDoc(window.fbCollection(window.db, 'combos'), {
            name, emojis: emojis||'🎁', desc, price, original: original||price,
            keywords, save, created_at: window.fbServerTimestamp()
        });
        showToast('✅ Combo saved!');
        ['cb_name','cb_emojis','cb_desc','cb_price','cb_original','cb_keywords']
            .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        loadAdminCombos();
    } catch(e) {
        showToast('Save failed: ' + e.message, true);
    }
};

window.adminDeleteCombo = async function(firestoreId) {
    if (!confirm('Delete this combo?')) return;
    try {
        await window.fbUpdateDoc(window.fbDoc(window.db, 'combos', firestoreId), { _deleted: true });
        showToast('Combo deleted');
        loadAdminCombos();
    } catch(e) { showToast('Delete failed: ' + e.message, true); }
};