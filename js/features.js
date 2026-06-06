// =============================================================
//  NATURE'S HEAL — TIER 1 + TIER 2 ADVANCED FEATURES
//  1. AI Herb Advisor (Claude API)
//  2. Customer Dashboard (orders, health profile, wishlist)
//  3. Smart Notifications (Firebase push + in-app)
//  4. Subscription Herb Box (Razorpay recurring)
//  5. Health Profile Engine (personalised catalog)
//  6. Admin Analytics Upgrade (charts, heatmap)
//  7. Inventory Management (stock tracking, alerts)
// =============================================================

// ─────────────────────────────────────────────────────────────
//  FEATURE 1 — AI HERB ADVISOR
// ─────────────────────────────────────────────────────────────
const _haSelected = new Set();

window.openHerbAdvisor = function() {
    document.getElementById('herbAdvisorModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    haShowStep1();
};
window.closeHerbAdvisor = function() {
    document.getElementById('herbAdvisorModal').classList.add('hidden');
    document.body.style.overflow = '';
};

window.haToggleSym = function(btn) {
    const sym = btn.dataset.sym;
    if (_haSelected.has(sym)) { _haSelected.delete(sym); btn.classList.remove('active'); }
    else { _haSelected.add(sym); btn.classList.add('active'); }
};
window.haShowStep1 = function() {
    document.getElementById('haStep1').classList.remove('hidden');
    document.getElementById('haStep2').classList.add('hidden');
};

window.haGetRecommendations = async function() {
    if (_haSelected.size === 0) {
        showToast('⚠️ Please select at least one concern'); return;
    }
    document.getElementById('haStep1').classList.add('hidden');
    document.getElementById('haStep2').classList.remove('hidden');
    document.getElementById('haLoading').classList.remove('hidden');
    document.getElementById('haResults').innerHTML = '';

    const symptoms  = [..._haSelected].join(', ');
    const age       = document.getElementById('haAge').value;
    const custom    = document.getElementById('haCustom').value.trim();
    const catalog   = (window.appState?.catalogData || [])
        .filter(p => p.stock !== '0' && p.stock !== 'out')
        .map(p => `${p.name} (₹${p.price}/${p.quantityType||'unit'}): ${p.uses||p.description||''}`)
        .join('\n');

    const prompt = `You are Vaidya, an expert Ayurvedic herb advisor for Nature's Heal, a herbal e-commerce store in India.

User health concerns: ${symptoms}
${age ? `Age group: ${age}` : ''}
${custom ? `Additional info: ${custom}` : ''}

Available products at Nature's Heal:
${catalog}

Respond ONLY with a JSON object (no markdown, no backticks) in this exact format:
{
  "summary": "2-sentence personalised wellness summary for this user",
  "recommendations": [
    {
      "herb": "Exact product name from the list above",
      "why": "Why this herb helps their specific concern (2 sentences)",
      "how": "How to use it — dosage, timing, preparation method",
      "concern": "which concern this addresses"
    }
  ],
  "lifestyle": ["tip 1", "tip 2", "tip 3"],
  "warning": "Any important caution for this combination"
}

Recommend 3-5 herbs. Only recommend herbs that exist in the Available products list. Be specific and practical.`;

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        const data = await res.json();
        const raw  = data.content?.[0]?.text || '';
        let parsed;
        try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
        catch { throw new Error('Parse failed: ' + raw.slice(0, 200)); }
        haRenderResults(parsed);
    } catch (err) {
        document.getElementById('haResults').innerHTML = `
            <div class="ha-error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Could not connect to AI. Showing general recommendations instead.</p>
                ${haFallbackRecommendations(symptoms)}
            </div>`;
    } finally {
        document.getElementById('haLoading').classList.add('hidden');
    }
};

function haRenderResults(data) {
    const catalog = window.appState?.catalogData || [];
    const recCards = (data.recommendations || []).map(r => {
        const prod = catalog.find(p => p.name?.toLowerCase() === r.herb?.toLowerCase())
                  || catalog.find(p => (p.name||'').toLowerCase().includes((r.herb||'').toLowerCase().split(' ')[0]));
        const cartBtn = prod && prod.stock !== '0'
            ? `<button class="ha-card-add" onclick="window.addToCartSimple('${prod.id}');window.showToast('✅ ${prod.name} added')">
                   <i class="fas fa-cart-plus"></i> Add to Cart
               </button>`
            : `<span class="ha-card-oos">Out of stock</span>`;
        const price = prod ? `₹${prod.price}/${prod.quantityType||'unit'}` : '';
        return `
        <div class="ha-rec-card">
            <div class="ha-rec-top">
                ${prod?.image ? `<img src="${prod.image}" class="ha-rec-img" onclick="prod && openModalById('${prod?.id}')" onerror="this.style.display='none'">` : '<div class="ha-rec-img-placeholder">🌿</div>'}
                <div class="ha-rec-meta">
                    <div class="ha-rec-name">${r.herb}</div>
                    <div class="ha-rec-concern"><i class="fas fa-tag"></i> ${r.concern}</div>
                    ${price ? `<div class="ha-rec-price">${price}</div>` : ''}
                </div>
            </div>
            <div class="ha-rec-why"><i class="fas fa-info-circle"></i> ${r.why}</div>
            <div class="ha-rec-how"><i class="fas fa-mortar-pestle"></i> <strong>How to use:</strong> ${r.how}</div>
            <div class="ha-rec-actions">${cartBtn}</div>
        </div>`;
    }).join('');

    const lifestyleTips = (data.lifestyle || []).map(t =>
        `<li><i class="fas fa-check"></i> ${t}</li>`).join('');

    document.getElementById('haResults').innerHTML = `
        <div class="ha-summary">${data.summary}</div>
        <h3 class="ha-section-title">🌿 Recommended for You</h3>
        <div class="ha-rec-grid">${recCards}</div>
        ${lifestyleTips ? `
        <div class="ha-lifestyle">
            <h3 class="ha-section-title">💡 Lifestyle Tips</h3>
            <ul class="ha-tips-list">${lifestyleTips}</ul>
        </div>` : ''}
        ${data.warning ? `<div class="ha-warning"><i class="fas fa-exclamation-triangle"></i> ${data.warning}</div>` : ''}
        <p class="ha-disclaimer-note" style="margin-top:1rem">⚕️ This is AI-generated herbal guidance, not medical advice. Consult a qualified practitioner for medical conditions.</p>
        <button class="ha-btn-secondary" onclick="haShowStep1()"><i class="fas fa-redo"></i> Try Different Symptoms</button>
    `;
}

function haFallbackRecommendations(symptoms) {
    const lower = symptoms.toLowerCase();
    const fallbacks = [];
    if (lower.includes('hair')) fallbacks.push('Bhringraj, Amla, Curry Leaves');
    if (lower.includes('immun')) fallbacks.push('Tulsi, Giloy, Turmeric');
    if (lower.includes('stress') || lower.includes('sleep')) fallbacks.push('Ashwagandha, Brahmi, Chamomile');
    if (lower.includes('digest')) fallbacks.push('Ginger, Fennel, Ajwain');
    if (lower.includes('sugar') || lower.includes('diabet')) fallbacks.push('Karela, Fenugreek, Cinnamon');
    return fallbacks.length ? `<p>For your concerns, consider: <strong>${fallbacks.join(' · ')}</strong></p>` : '';
}

// ─────────────────────────────────────────────────────────────
//  FEATURE 2 — CUSTOMER DASHBOARD
// ─────────────────────────────────────────────────────────────
window.openDashboard = async function() {
    if (!window.currentUser) { handleAuthAction(); return; }
    document.getElementById('customerDashboard').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const u = window.currentUser;
    document.getElementById('cdName').textContent = u.displayName || u.phoneNumber || 'My Account';
    document.getElementById('cdEmail').textContent = u.email || '';
    document.getElementById('cdAvatar').textContent = u.displayName?.[0]?.toUpperCase() || '👤';
    cdSwitch('orders', document.querySelector('.cd-tab'));
};
window.closeDashboard = function() {
    document.getElementById('customerDashboard').classList.add('hidden');
    document.body.style.overflow = '';
};

window.cdSwitch = async function(tab, btn) {
    document.querySelectorAll('.cd-tab').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
    const body = document.getElementById('cdBody');
    body.innerHTML = '<div class="cd-loading"><div class="ha-spinner"></div><p>Loading…</p></div>';

    if (tab === 'orders')       await cdLoadOrders(body);
    if (tab === 'health')       cdLoadHealthProfile(body);
    if (tab === 'wishlist')     cdLoadWishlist(body);
    if (tab === 'subscription') cdLoadSubscription(body);
};

async function cdLoadOrders(body) {
    try {
        const uid = window.currentUser?.uid;
        const snap = await window.fbGetDocs(
            window.fbQuery(window.fbCollection(window.db, 'orders'),
                window.fbWhere('uid', '==', uid),
                window.fbOrderBy('createdAt', 'desc'))
        );
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!orders.length) {
            body.innerHTML = `<div class="cd-empty"><i class="fas fa-box-open"></i><p>No orders yet.</p>
                <button class="ha-btn-primary" onclick="closeDashboard()">Start Shopping</button></div>`;
            return;
        }
        body.innerHTML = orders.map(o => {
            const date = o.createdAt?.toDate?.()?.toLocaleDateString('en-IN') || 'N/A';
            const items = (o.items || []).map(i => `${i.name} × ${i.qty}`).join(', ');
            const status = o.status || 'Processing';
            const statusColor = { Processing:'#f59e0b', Dispatched:'#3b82f6', Delivered:'#059669', Cancelled:'#ef4444' }[status] || '#6b7280';
            return `<div class="cd-order-card">
                <div class="cd-order-top">
                    <div>
                        <div class="cd-order-id">Order #${o.orderId || o.id.slice(-6).toUpperCase()}</div>
                        <div class="cd-order-date">${date} · ₹${o.total || 0}</div>
                    </div>
                    <span class="cd-order-status" style="color:${statusColor};border-color:${statusColor}">${status}</span>
                </div>
                <div class="cd-order-items">${items}</div>
                <div class="cd-order-addr"><i class="fas fa-map-marker-alt"></i> ${o.address || ''}</div>
                <button class="cd-reorder-btn" onclick="cdReorder(${JSON.stringify(o.items||[])})">
                    <i class="fas fa-redo"></i> Reorder
                </button>
            </div>`;
        }).join('');
    } catch (e) {
        body.innerHTML = `<div class="cd-empty"><p>Could not load orders. ${e.message}</p></div>`;
    }
}

window.cdReorder = function(items) {
    items.forEach(item => {
        const prod = window.appState?.catalogData?.find(p => String(p.id) === String(item.id));
        if (prod && prod.stock !== '0') window.addToCartSimple(String(item.id));
    });
    closeDashboard();
    window.openCartSidebar?.();
    showToast('✅ Items added to cart');
};

function cdLoadHealthProfile(body) {
    const saved = JSON.parse(localStorage.getItem('nh_health_profile') || '{}');
    const concerns = ['immunity','digestion','skin','diabetes','hair','weight','heart','stress',
                      'joint pain','energy','eye health','liver detox'];
    const checked = c => saved.concerns?.includes(c) ? 'checked' : '';
    body.innerHTML = `
        <div class="cd-section-title">Your Health Profile</div>
        <p class="cd-section-sub">We use this to personalise your herb recommendations and catalog.</p>
        <div class="hp-concern-grid">
            ${concerns.map(c => `
            <label class="hp-concern-chip">
                <input type="checkbox" value="${c}" ${checked(c)} onchange="hpSaveConcerns()">
                ${c.charAt(0).toUpperCase() + c.slice(1)}
            </label>`).join('')}
        </div>
        <div class="hp-field-row" style="margin-top:1rem">
            <div class="ha-extra-field">
                <label class="ha-label">Age group</label>
                <select class="ha-select" id="hpAge" onchange="hpSaveConcerns()">
                    <option ${saved.age===''?'selected':''}>Select age</option>
                    ${['Under 18','18–30','31–45','46–60','60+'].map(a =>
                        `<option ${saved.age===a?'selected':''}>${a}</option>`).join('')}
                </select>
            </div>
            <div class="ha-extra-field" style="flex:2">
                <label class="ha-label">Medical notes (optional)</label>
                <input class="ha-input" id="hpNotes" value="${saved.notes||''}" placeholder="e.g. thyroid, pregnancy…" oninput="hpSaveConcerns()">
            </div>
        </div>
        <button class="ha-btn-primary" style="margin-top:1rem" onclick="openHerbAdvisor();closeDashboard()">
            <i class="fas fa-magic"></i> Get AI Recommendations Based on Profile
        </button>`;
}

window.hpSaveConcerns = function() {
    const concerns = [...document.querySelectorAll('.hp-concern-chip input:checked')].map(i => i.value);
    const age   = document.getElementById('hpAge')?.value || '';
    const notes = document.getElementById('hpNotes')?.value || '';
    const profile = { concerns, age, notes };
    localStorage.setItem('nh_health_profile', JSON.stringify(profile));
    // Personalise catalog sort — bestsellers matching profile concerns shown first
    if (concerns.length && window._sf) {
        const savedConcern = concerns[0];
        window._sf.concern = savedConcern;
        window.sfApply?.();
    }
    showToast('✅ Profile saved');
};

function cdLoadWishlist(body) {
    const favIds = AppStore.get('favorites') || [];
    const catalog = window.appState?.catalogData || [];
    const favItems = favIds.map(id => catalog.find(p => String(p.id) === String(id))).filter(Boolean);
    if (!favItems.length) {
        body.innerHTML = `<div class="cd-empty"><i class="fas fa-heart"></i><p>No saved items yet.</p>
            <button class="ha-btn-primary" onclick="closeDashboard()">Browse Products</button></div>`;
        return;
    }
    body.innerHTML = `<div class="cd-wishlist-grid">${favItems.map(p => `
        <div class="cd-wish-card" onclick="openModalById('${p.id}');closeDashboard()">
            <img src="${p.image||''}" alt="${p.name}" onerror="this.style.display='none'">
            <div class="cd-wish-name">${p.name}</div>
            <div class="cd-wish-price">₹${p.price}/${p.quantityType||'unit'}</div>
            <button class="cd-wish-add" onclick="event.stopPropagation();window.addToCartSimple('${p.id}');showToast('✅ Added')">
                <i class="fas fa-cart-plus"></i> Add to Cart
            </button>
        </div>`).join('')}</div>`;
}

function cdLoadSubscription(body) {
    const sub = JSON.parse(localStorage.getItem('nh_subscription') || 'null');
    if (sub) {
        body.innerHTML = `<div class="cd-sub-active">
            <i class="fas fa-check-circle" style="color:#059669;font-size:2rem"></i>
            <h3>You're subscribed! 🎉</h3>
            <p><strong>Plan:</strong> ${sub.plan}</p>
            <p><strong>Amount:</strong> ₹${sub.amount}/month</p>
            <p><strong>Started:</strong> ${new Date(sub.date).toLocaleDateString('en-IN')}</p>
            <p class="cd-section-sub">Your next box will be dispatched on the 1st of next month.</p>
            <button class="ha-btn-secondary" onclick="cancelSubscription()">Cancel Subscription</button>
        </div>`;
    } else {
        body.innerHTML = `<div class="cd-empty">
            <i class="fas fa-box" style="font-size:2rem;color:#059669"></i>
            <p>You don't have an active subscription.</p>
            <button class="ha-btn-primary" onclick="closeDashboard();openSubscription()">
                <i class="fas fa-sync"></i> Subscribe to Herb Box
            </button>
        </div>`;
    }
}

// ─────────────────────────────────────────────────────────────
//  FEATURE 3 — SMART NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
const NOTIF_KEY = 'nh_notif_permission';

function initNotifications() {
    if (localStorage.getItem(NOTIF_KEY) === 'granted') return;
    if (localStorage.getItem(NOTIF_KEY) === 'denied') return;
    // Show prompt after 30 seconds on site
    setTimeout(() => {
        if (!document.getElementById('notifPrompt').classList.contains('hidden')) return;
        document.getElementById('notifPrompt').classList.remove('hidden');
    }, 30000);
}

window.enableNotifications = async function() {
    dismissNotifPrompt();
    if (!('Notification' in window)) { showToast('Notifications not supported in this browser'); return; }
    const perm = await Notification.requestPermission();
    localStorage.setItem(NOTIF_KEY, perm);
    if (perm === 'granted') {
        showToast('🔔 Notifications enabled! You\'ll get order updates & restock alerts.');
        scheduleHealthTipNotification();
    }
};

window.dismissNotifPrompt = function() {
    document.getElementById('notifPrompt').classList.add('hidden');
    if (!localStorage.getItem(NOTIF_KEY)) localStorage.setItem(NOTIF_KEY, 'dismissed');
};

function scheduleHealthTipNotification() {
    if (Notification.permission !== 'granted') return;
    const tips = [
        'Did you know? Ashwagandha taken with warm milk at bedtime may improve sleep quality. 🌿',
        'Tip: Start your day with amla juice to boost immunity & digestion naturally! 🍃',
        'Turmeric + black pepper together increase curcumin absorption by 2000%. Try our turmeric powder! 💛',
        'Brahmi is known to support memory & focus. Great for students & professionals. 🧠'
    ];
    setTimeout(() => {
        const n = new Notification("Nature's Heal Daily Tip 🌿", {
            body: tips[Math.floor(Math.random() * tips.length)],
            icon: '/favicon.ico',
            badge: '/favicon.ico'
        });
        n.onclick = () => window.focus();
    }, 3600000); // 1 hour after enabling
}

window.sendOrderNotification = function(orderId, status) {
    if (Notification.permission !== 'granted') return;
    const messages = {
        Processing: `Order #${orderId} confirmed! We're preparing your herbs. 🌿`,
        Dispatched: `Order #${orderId} dispatched! Expected delivery in 2-3 days. 📦`,
        Delivered:  `Order #${orderId} delivered! Enjoy your herbs. Rate your experience? ⭐`
    };
    if (messages[status]) {
        new Notification("Nature's Heal — Order Update", {
            body: messages[status], icon: '/favicon.ico'
        });
    }
};

window.sendRestockNotification = function(productName) {
    if (Notification.permission !== 'granted') return;
    new Notification("Back in Stock! 🌿", {
        body: `${productName} is back in stock at Nature's Heal. Order now before it sells out!`,
        icon: '/favicon.ico'
    });
};

// ─────────────────────────────────────────────────────────────
//  FEATURE 4 — SUBSCRIPTION HERB BOX
// ─────────────────────────────────────────────────────────────
let _selectedSubPlan = null;

window.openSubscription = function() {
    document.getElementById('subscriptionModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};
window.closeSubscription = function() {
    document.getElementById('subscriptionModal').classList.add('hidden');
    document.body.style.overflow = '';
};
window.selectSubPlan = function(el, plan, amount) {
    document.querySelectorAll('.sub-plan').forEach(p => p.classList.remove('selected'));
    el.classList.add('selected');
    _selectedSubPlan = { plan, amount };
    document.getElementById('subForm').classList.remove('hidden');
};
window.startSubscription = function() {
    if (!_selectedSubPlan) return;
    const name    = document.getElementById('subName').value.trim();
    const phone   = document.getElementById('subPhone').value.trim();
    const address = document.getElementById('subAddress').value.trim();
    if (!name || !phone || !address) { showToast('⚠️ Please fill all fields'); return; }
    const { plan, amount } = _selectedSubPlan;
    // Razorpay recurring payment
    if (typeof Razorpay !== 'undefined') {
        const rzp = new Razorpay({
            key: window.RAZORPAY_KEY || 'rzp_live_Sn8EI3i6AlL3ti',
            amount: amount * 100,
            currency: 'INR',
            name: "Nature's Heal",
            description: `Monthly Herb Box — ${plan}`,
            prefill: { name, contact: phone },
            theme: { color: '#059669' },
            handler: function(response) {
                const sub = { plan, amount, name, phone, address, date: Date.now(), paymentId: response.razorpay_payment_id };
                localStorage.setItem('nh_subscription', JSON.stringify(sub));
                // Save to Firestore
                if (window.db && window.currentUser) {
                    window.fbAddDoc(window.fbCollection(window.db, 'subscriptions'), {
                        ...sub, uid: window.currentUser.uid, createdAt: new Date()
                    }).catch(console.error);
                }
                closeSubscription();
                showToast('🎉 Subscription activated! Your first box ships on the 1st.');
                sendOrderNotification('SUB-' + Date.now().toString(36).toUpperCase(), 'Processing');
                // WhatsApp confirmation
                const msg = `🌿 *Subscription Confirmed — Nature's Heal*\n\n`
                    + `Plan: ${plan} (₹${amount}/month)\n`
                    + `Name: ${name} | Phone: ${phone}\n`
                    + `Address: ${address}\n\n`
                    + `Payment ID: ${response.razorpay_payment_id}\n`
                    + `Your first box will be dispatched on the 1st of next month.\nThank you! 🙏`;
                setTimeout(() => window.open(`https://wa.me/918919011159?text=${encodeURIComponent(msg)}`, '_blank'), 1000);
            }
        });
        rzp.open();
    } else {
        // COD fallback for subscription
        const sub = { plan, amount, name, phone, address, date: Date.now() };
        localStorage.setItem('nh_subscription', JSON.stringify(sub));
        closeSubscription();
        showToast('🎉 Subscription request sent via WhatsApp!');
        const msg = `🌿 *Herb Box Subscription Request*\n\nPlan: ${plan} (₹${amount}/month)\nName: ${name}\nPhone: ${phone}\nAddress: ${address}\n\nPlease confirm my subscription. Thank you!`;
        setTimeout(() => window.open(`https://wa.me/918919011159?text=${encodeURIComponent(msg)}`, '_blank'), 500);
    }
};
window.cancelSubscription = function() {
    if (!confirm('Are you sure you want to cancel your subscription?')) return;
    localStorage.removeItem('nh_subscription');
    cdLoadSubscription(document.getElementById('cdBody'));
    showToast('Subscription cancelled.');
};

// ─────────────────────────────────────────────────────────────
//  FEATURE 5 — HEALTH PROFILE ENGINE (Personalised Catalog)
// ─────────────────────────────────────────────────────────────
function applyHealthProfileToSort() {
    const profile = JSON.parse(localStorage.getItem('nh_health_profile') || '{}');
    if (!profile.concerns?.length) return;
    const keywords = profile.concerns.flatMap(c => CONCERN_KEYWORDS[c] || []);
    // Re-score catalog items based on health profile match
    const catalog = window.appState?.catalogData || [];
    catalog.forEach(item => {
        const hay = ((item.name||'') + (item.uses||'') + (item.description||'')).toLowerCase();
        item._profileScore = keywords.filter(kw => hay.includes(kw)).length;
    });
    // Trigger re-render with profile scoring
    if (window.sfApply) window.sfApply();
}

// Inject profile scoring into getSidebarFiltered
const _origGetFiltered = window.getSidebarFiltered;
window.getSidebarFiltered = function() {
    let data = _origGetFiltered ? _origGetFiltered() : (window.appState?.catalogData || []);
    const profile = JSON.parse(localStorage.getItem('nh_health_profile') || '{}');
    if (profile.concerns?.length && window._sf?.sort === 'default') {
        data = [...data].sort((a, b) => (b._profileScore || 0) - (a._profileScore || 0));
    }
    return data;
};

// ─────────────────────────────────────────────────────────────
//  FEATURE 6 — ADMIN ANALYTICS UPGRADE
// ─────────────────────────────────────────────────────────────
window.renderAnalyticsCharts = function(orders) {
    const container = document.getElementById('adminAnalyticsContent');
    if (!container) return;

    // Process data
    const now = new Date();
    const monthly = {};
    const cityCount = {};
    const hourCount = {};
    let totalRevenue = 0, totalOrders = orders.length;

    orders.forEach(o => {
        const d = o.createdAt?.toDate?.() || new Date(o.createdAt || Date.now());
        const month = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const city = (o.address || '').split(',').slice(-2, -1)[0]?.trim() || 'Unknown';
        const hour = d.getHours();
        const amt = o.total || o.items?.reduce((s,i) => s + (i.price||0)*(i.qty||1), 0) || 0;
        totalRevenue += amt;
        monthly[month] = (monthly[month] || 0) + amt;
        cityCount[city] = (cityCount[city] || 0) + 1;
        hourCount[hour] = (hourCount[hour] || 0) + 1;
    });

    const months = Object.entries(monthly).sort().slice(-6);
    const maxM = Math.max(...months.map(m => m[1]), 1);
    const cities = Object.entries(cityCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const peakHour = Object.entries(hourCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || '?';
    const avgOrder = totalOrders ? (totalRevenue / totalOrders).toFixed(0) : 0;

    // Revenue trend bars
    const revBars = months.map(([m, v]) => {
        const pct = ((v / maxM) * 100).toFixed(1);
        const label = m.slice(5) + '/' + m.slice(2,4);
        return `<div class="ac-bar-wrap">
            <div class="ac-bar-fill" style="height:${pct}%" title="₹${v.toLocaleString('en-IN')}"></div>
            <div class="ac-bar-label">${label}</div>
            <div class="ac-bar-val">₹${(v/1000).toFixed(1)}k</div>
        </div>`;
    }).join('');

    // City breakdown
    const cityRows = cities.map(([city, cnt]) => `
        <div class="ac-city-row">
            <span class="ac-city-name"><i class="fas fa-map-marker-alt"></i> ${city}</span>
            <div class="ac-city-bar"><div style="width:${(cnt/cities[0][1]*100).toFixed(0)}%;background:#059669;height:100%;border-radius:9999px"></div></div>
            <span class="ac-city-cnt">${cnt} orders</span>
        </div>`).join('');

    container.innerHTML = `
    <div class="analytics-kpi-grid">
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#d1fae5;color:#059669"><i class="fas fa-rupee-sign"></i></div>
            <div class="analytics-kpi-val">₹${totalRevenue.toLocaleString('en-IN')}</div>
            <div class="analytics-kpi-label">Total Revenue</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#dbeafe;color:#2563eb"><i class="fas fa-box"></i></div>
            <div class="analytics-kpi-val">${totalOrders}</div>
            <div class="analytics-kpi-label">Total Orders</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#fef3c7;color:#d97706"><i class="fas fa-chart-line"></i></div>
            <div class="analytics-kpi-val">₹${avgOrder}</div>
            <div class="analytics-kpi-label">Avg Order Value</div>
        </div>
        <div class="analytics-kpi">
            <div class="analytics-kpi-icon" style="background:#ede9fe;color:#7c3aed"><i class="fas fa-clock"></i></div>
            <div class="analytics-kpi-val">${peakHour}:00</div>
            <div class="analytics-kpi-label">Peak Order Hour</div>
        </div>
    </div>

    <div class="ac-chart-section">
        <div class="ac-chart-title">📈 Monthly Revenue (Last 6 Months)</div>
        <div class="ac-bar-chart">${revBars}</div>
    </div>

    <div class="ac-chart-section">
        <div class="ac-chart-title">🗺️ Orders by City</div>
        ${cityRows || '<p style="color:var(--text-muted)">Not enough address data yet.</p>'}
    </div>
    `;
};

// Hook into existing loadAdminAnalytics
const _origLoadAnalytics = window.loadAdminAnalytics;
window.loadAdminAnalytics = async function() {
    if (_origLoadAnalytics) await _origLoadAnalytics();
    // After original loads, inject enhanced chart rendering
    setTimeout(async () => {
        try {
            const snap = await window.fbGetDocs(
                window.fbQuery(window.fbCollection(window.db, 'orders'),
                    window.fbOrderBy('createdAt', 'desc'))
            );
            const orders = snap.docs.map(d => d.data());
            window.renderAnalyticsCharts(orders);
        } catch(e) { console.warn('Analytics chart error:', e); }
    }, 500);
};

// ─────────────────────────────────────────────────────────────
//  FEATURE 7 — INVENTORY MANAGEMENT (Admin Panel Extension)
// ─────────────────────────────────────────────────────────────
window.loadInventoryPanel = async function() {
    const container = document.getElementById('adminInventoryContent');
    if (!container) return;
    container.innerHTML = '<div class="cd-loading"><div class="ha-spinner"></div><p>Loading inventory…</p></div>';

    try {
        const snap = await window.fbGetDocs(window.fbCollection(window.db, 'catalog'));
        const products = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

        const lowStock  = products.filter(p => p.stock && /^\d+$/.test(p.stock) && parseInt(p.stock) <= 9);
        const outStock  = products.filter(p => p.stock === '0' || p.stock === 'out');
        const inStock   = products.filter(p => !lowStock.includes(p) && !outStock.includes(p));

        container.innerHTML = `
        <div class="inv-kpi-row">
            <div class="inv-kpi inv-kpi--ok"><i class="fas fa-check-circle"></i><span>${inStock.length}</span><small>In Stock</small></div>
            <div class="inv-kpi inv-kpi--warn"><i class="fas fa-exclamation-triangle"></i><span>${lowStock.length}</span><small>Low Stock (≤9)</small></div>
            <div class="inv-kpi inv-kpi--danger"><i class="fas fa-times-circle"></i><span>${outStock.length}</span><small>Out of Stock</small></div>
        </div>

        ${lowStock.length ? `
        <div class="inv-section">
            <div class="inv-section-title">⚠️ Low Stock — Restock Soon</div>
            ${lowStock.map(p => invProductRow(p, 'warn')).join('')}
        </div>` : ''}

        ${outStock.length ? `
        <div class="inv-section">
            <div class="inv-section-title">🚫 Out of Stock</div>
            ${outStock.map(p => invProductRow(p, 'danger')).join('')}
        </div>` : ''}

        <div class="inv-section">
            <div class="inv-section-title">✅ All Products (${products.length})</div>
            <input class="ha-input" style="margin-bottom:0.75rem" placeholder="Search products…" oninput="invFilter(this.value)">
            <div id="invAllRows">
                ${products.map(p => invProductRow(p, '')).join('')}
            </div>
        </div>`;
    } catch(e) {
        container.innerHTML = `<p style="color:#ef4444">Error loading inventory: ${e.message}</p>`;
    }
};

function invProductRow(p, type) {
    const stockVal = p.stock || 'in';
    const stockClass = type === 'danger' ? 'inv-stock-danger' : type === 'warn' ? 'inv-stock-warn' : 'inv-stock-ok';
    return `<div class="inv-row" data-name="${(p.name||'').toLowerCase()}">
        <div class="inv-row-name">${p.name || 'Unnamed'}</div>
        <div class="inv-row-meta">₹${p.price||0} / ${p.type||'—'}</div>
        <div class="inv-row-stock ${stockClass}" title="Stock value">${stockVal}</div>
        <input class="inv-stock-input" type="text" value="${stockVal}" placeholder="stock"
            onblur="invUpdateStock('${p.firestoreId}','${p.id}',this.value,this)"
            onkeydown="if(event.key==='Enter')this.blur()">
    </div>`;
}

window.invFilter = function(term) {
    document.querySelectorAll('#invAllRows .inv-row').forEach(row => {
        row.style.display = row.dataset.name?.includes(term.toLowerCase()) ? '' : 'none';
    });
};

window.invUpdateStock = async function(firestoreId, productId, newStock, inputEl) {
    if (!firestoreId) return;
    try {
        await window.fbUpdateDoc(window.fbDoc(window.db, 'catalog', firestoreId), { stock: String(newStock) });
        inputEl.style.borderColor = '#059669';
        setTimeout(() => inputEl.style.borderColor = '', 2000);
        showToast('✅ Stock updated');
        // Check if back in stock — notify users
        const prev = inputEl.dataset.prevStock;
        if ((prev === '0' || prev === 'out') && newStock !== '0' && newStock !== 'out') {
            const prod = window.appState?.catalogData?.find(p => String(p.id) === String(productId));
            if (prod) sendRestockNotification(prod.name);
        }
        inputEl.dataset.prevStock = newStock;
        // Reload catalog to reflect changes
        if (window.loadCatalogFromFirestore) window.loadCatalogFromFirestore(true);
    } catch(e) {
        inputEl.style.borderColor = '#ef4444';
        showToast('❌ Update failed: ' + e.message);
    }
};

// ─────────────────────────────────────────────────────────────
//  INITIALISATION — wire everything together on page load
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    // Notifications prompt (after 30s)
    initNotifications();

    // Health profile — personalise catalog on load
    applyHealthProfileToSort();

    // Show dashboard button when user is logged in
    const origUpdateUserUI = window.updateUserUI;
    window.updateUserUI = function(user) {
        if (origUpdateUserUI) origUpdateUserUI(user);
        const dashBtn = document.getElementById('dashboardBtn');
        if (dashBtn) dashBtn.classList.toggle('hidden', !user);
    };

    // Expose fbQuery / fbWhere / fbOrderBy / fbDoc / fbUpdateDoc from firebase.js globals
    // (they're aliased in firebase.js — wire up any missing ones)
    if (!window.fbQuery && window.db) {
        // These are imported in firebase.js module — re-expose on window if not already
        console.info('[NH] fbQuery/fbWhere not yet exposed — inventory & dashboard need firebase.js update');
    }
});