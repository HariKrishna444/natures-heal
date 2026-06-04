// =============================================================
//  auth.js — Auth state, user UI, AppStore, utilities
// =============================================================
// ─── RAZORPAY PUBLISHABLE KEY ────────────────────────────────────────────────
// This is Razorpay's *publishable* key — it is intentionally client-side
// visible (similar to Stripe's pk_live_*). It cannot be used to initiate
// charges or access your dashboard. All actual money movement is protected
// by your Razorpay secret key, which lives ONLY on the server
// (Firebase Cloud Function createOrder / verifyAndSaveOrder).
//
// ✅ Safe to keep here: publishable key  ← this one
// ❌ Never put here:   secret key (rzp_live_secret_*)
//
// Reference: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
// ─────────────────────────────────────────────────────────────────────────────
// ─── RAZORPAY PUBLISHABLE KEY ───────────────────────────────────────────────
// This is Razorpay's *publishable* key — safe to be in client JS, just like
// Stripe's pk_live_* key. It identifies your account to the Razorpay SDK but
// cannot move money or access your dashboard.
//
//  ✅ Safe here : publishable key  (rzp_live_Sn8EI3i6AlL3ti)
//  ❌ Never here: secret key       (rzp_live_<secret>)  → stays only on server
//
// All actual payment creation and signature verification run in Firebase
// Cloud Functions (createOrder, verifyAndSaveOrder) — the secret key is set
// as a Cloud Function environment variable, never in this file.
// ────────────────────────────────────────────────────────────────────────────
const RAZORPAY_KEY = "rzp_live_Sn8EI3i6AlL3ti";
const WHATSAPP_NUMBER = "918919011159";
// ─── ADMIN EMAIL ─────────────────────────────────────────────────────────────
// Used for client-side UI gating (show/hide admin button). This alone is NOT
// sufficient security — the actual admin enforcement happens in two places:
//
//  1. Firestore Security Rules: products/orders write access requires
//     request.auth.token.email == ADMIN_EMAIL  (server-enforced, unbypassable)
//
//  2. Cloud Functions: createOrder / verifyAndSaveOrder verify the Firebase
//     ID token and re-check admin status server-side before any mutation.
//
//  The client check below is a UX convenience only (hide/show buttons).
//  Even if someone bypasses it in DevTools, Firestore Rules will block writes.
// ─────────────────────────────────────────────────────────────────────────────
const ADMIN_EMAIL = "harikrishnarock444@gmail.com";
// Google Sheets dependency removed — catalog is now fully Firestore-based

// ===== ADMIN AUTH CHECK (uses Firebase Auth, not password) =====
function isAdmin() {
    return window.currentUser && window.currentUser.email === ADMIN_EMAIL;
}

// ===== APP STORE — replaces window.* globals =====
// A minimal reactive state container with typed subscriptions.
// Usage:  AppStore.set('cart', [...]);
//         AppStore.subscribe('cart', newCart => { ... });
//         AppStore.get('cart');
const AppStore = (() => {
    const _state = {
        catalogData: [],
        catalogCache: null,
        catalogLastFetch: 0,
        favorites: (() => {
            try { return JSON.parse(localStorage.getItem('favorites')) || []; } catch { return []; }
        })(),
        cart: (() => {
            try {
                return (JSON.parse(localStorage.getItem('cart')) || []).map(i =>
                    typeof i === 'number' ? { id: i, qty: 1 } : i
                );
            } catch { return []; }
        })(),
        selectedPayment: 'razorpay',
        adminUnlockClicks: 0,
        isAdmin: false,
    };
    const _listeners = {};

    return {
        get(key) { return _state[key]; },
        set(key, value) {
            _state[key] = value;
            (_listeners[key] || []).forEach(fn => { try { fn(value); } catch(e) { console.error('AppStore listener error', key, e); } });
        },
        update(key, fn) { this.set(key, fn(_state[key])); },
        subscribe(key, fn) {
            if (!_listeners[key]) _listeners[key] = [];
            _listeners[key].push(fn);
            return () => { _listeners[key] = _listeners[key].filter(f => f !== fn); };
        },
    };
})();

// Legacy shim — keeps existing code working while we migrate
// New code should use AppStore directly; old window.appState references
// are proxied here so nothing breaks during the transition.
window.appState = new Proxy({}, {
    get(_, key) { return AppStore.get(key); },
    set(_, key, value) { AppStore.set(key, value); return true; },
});

// ===== UTILITY =====
const escapeHTML = str => String(str || "").replace(/[&<>"']/g, t =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[t])
);
const safeURL = url => {
    try {
        const u = new URL(url);
        return u.protocol === "https:" ? u.href : "https://via.placeholder.com/300x200?text=No+Image";
    } catch { return "https://via.placeholder.com/300x200?text=No+Image"; }
};
const sanitize = str => str.replace(/[<>`"'%;()&+]/g, "").trim();

window.showToast = function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#ef4444' : '#10b981';
    t.classList.add('active');
    setTimeout(() => t.classList.remove('active'), isError ? 2500 : 3000);
}

// ===== AUTH UI =====
function onLoginSuccess(uid, name, email, photo) {
    localStorage.setItem('user_uid', uid);
    localStorage.setItem('user_name', name);
    localStorage.setItem('user_email', email || '');
    localStorage.setItem('user_photo', photo || 'https://i.pravatar.cc/40?u=' + uid);
    updateUserUI({ uid, name, email, photo });

    // Pre-fill shipping
    if (uid) {
        loadShippingDetails(uid).then(data => {
            if (data) {
                if (data.name) document.getElementById('sh_name').value = data.name;
                if (data.phone) document.getElementById('sh_phone').value = data.phone;
                if (data.email) document.getElementById('sh_email').value = data.email;
                if (data.address) document.getElementById('sh_address').value = data.address;
            }
        });
    }
}
window.onLoginSuccess = onLoginSuccess;

function updateUserUI(user) {
    const name = user?.name || localStorage.getItem('user_name');
    const photo = user?.photo || localStorage.getItem('user_photo');
    const email = user?.email || localStorage.getItem('user_email') || '';
    const logoutBtn = document.querySelector('.logout-btn');
    const nameEl = document.getElementById('userNameDisplay');
    const imgEl = document.getElementById('userImg');
    const adminBtn = document.getElementById('adminDashboardBtn');

    if (name && name !== 'Guest' && localStorage.getItem('user_uid')) {
        if (nameEl) nameEl.textContent = name.split(' ')[0];
        if (imgEl) imgEl.src = photo || 'https://i.pravatar.cc/40';
        if (logoutBtn) { logoutBtn.textContent = 'LOGOUT'; logoutBtn.onclick = () => logout(); }
        document.getElementById('ordersTabBtn')?.classList.remove('hidden');

        // Show admin button only for admin email
        if (adminBtn) {
            if (email === ADMIN_EMAIL) {
                adminBtn.style.display = 'flex';
            } else {
                adminBtn.style.display = 'none';
            }
        }
    } else {
        if (nameEl) nameEl.textContent = 'Guest';
        if (imgEl) imgEl.src = 'https://i.pravatar.cc/40';
        if (logoutBtn) { logoutBtn.textContent = 'LOGIN'; logoutBtn.onclick = () => openAuthModal(); }
        document.getElementById('ordersTabBtn')?.classList.add('hidden');
        if (adminBtn) adminBtn.style.display = 'none';
    }
}

window.handleAuthAction = function() {
    if (localStorage.getItem('user_uid')) {
        logout();
    } else {
        openAuthModal();
    }
};

// ===== AUTH MODAL =====
window.openAuthModal = function() {
    document.getElementById('authModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};
window.closeAuthModal = function() {
    document.getElementById('authModal').classList.add('hidden');
    document.body.style.overflow = '';
};
window.switchAuthTab = function(tab) {
    document.getElementById('phoneTab').style.display = tab === 'phone' ? 'block' : 'none';
    document.getElementById('googleTab').style.display = tab === 'google' ? 'block' : 'none';
    document.getElementById('phoneTabBtn').classList.toggle('active', tab === 'phone');
    document.getElementById('googleTabBtn').classList.toggle('active', tab === 'google');
};

// ===== FIREBASE READY GUARD =====
// The Firebase SDK loads as type="module" (deferred/async). window.onload in a
// classic <script> can fire before the module assigns window.fb* globals.
// This polls until window.fbCollection is ready, then resolves.
function waitForFirebase(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        if (typeof window.fbCollection === 'function') { resolve(); return; }
        const start = Date.now();
        const interval = setInterval(() => {
            if (typeof window.fbCollection === 'function') {
                clearInterval(interval);
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                reject(new Error('Firebase SDK did not initialise in time. Check your internet connection.'));
            }
        }, 50);
    });
}