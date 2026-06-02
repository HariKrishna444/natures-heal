// =============================================================
//  firebase.js — Firebase SDK init (type="module" — keep as ES module)
// =============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
import {

    getFirestore, collection, addDoc, serverTimestamp,
    getDocs, query, where, doc, updateDoc, orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut,
    RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

// ─── FIREBASE CLIENT CONFIG ──────────────────────────────────────────────────
// These values are PUBLIC identifiers — they tell the Firebase SDK which
// project to connect to. They are NOT secrets and cannot be used to read or
// write data on their own.
//
// Security is enforced entirely by Firestore Security Rules (firestore.rules):
//   • Only authenticated users can write orders
//   • Only the admin UID can read all orders / write products
//   • Rules are deployed server-side and cannot be bypassed from the browser
//
// Reference: https://firebase.google.com/docs/projects/api-keys
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyD5qUEW8YRcGU6zwmmr271lLeBHcu0Vjh4",
    authDomain: "naturesheal.firebaseapp.com",
    projectId: "naturesheal",
    storageBucket: "naturesheal.firebasestorage.app",
    messagingSenderId: "429407436276",
    appId: "1:429407436276:web:2cb0470eecbf9ed349cda1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Expose to global
window.db = db;
window.fbCollection = collection;
window.fbAddDoc = addDoc;
window.fbServerTimestamp = serverTimestamp;
window.fbGetDocs = getDocs;
window.fbQuery = query;
window.fbWhere = where;
window.fbDoc = doc;
window.fbUpdateDoc = updateDoc;
window.fbOrderBy = orderBy;

// ===== GOOGLE SIGN IN =====
window.signInWithGoogle = async function() {
    try {
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        window.currentUser = user;
        if (window.onLoginSuccess) window.onLoginSuccess(user.uid, user.displayName, user.email, user.photoURL);

        // Close whichever modal triggered sign-in
        closeAuthModal();
        const adminLoginModal = document.getElementById('adminLoginModal');
        if (adminLoginModal && !adminLoginModal.classList.contains('hidden')) {
            adminLoginModal.classList.add('hidden');
            document.body.style.overflow = '';
        }

        // If admin email — open panel immediately
        if (user.email === ADMIN_EMAIL) {
            showToast("✅ Admin login successful!");
            setTimeout(() => showAdminPanel(), 300);
        } else {
            showToast("✅ Logged in as " + user.displayName);
        }
    } catch(e) {
        const code = e.code || '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
            return; // user dismissed — not an error
        }
        // Map Firebase error codes to human-readable messages
        const msgs = {
            'auth/internal-error':            'Login failed — make sure this domain is added to Firebase Auth → Authorised Domains.',
            'auth/unauthorized-domain':       'This domain is not authorised in Firebase. Go to Firebase Console → Authentication → Settings → Authorised Domains and add naturesheal.web.app',
            'auth/popup-blocked':             'Popup was blocked by your browser. Allow popups for this site and try again.',
            'auth/network-request-failed':    'Network error. Check your internet connection.',
            'auth/too-many-requests':         'Too many login attempts. Please wait a few minutes.',
            'auth/user-disabled':             'This account has been disabled.',
            'auth/operation-not-allowed':     'Google login is not enabled. Enable it in Firebase Console → Authentication → Sign-in methods.',
        };
        const msg = msgs[code] || ('Google login failed: ' + (e.message || code));
        showToast(msg, true);
        console.error('signInWithGoogle error:', code, e.message);
    }
};

// ===== PHONE OTP =====

// ── OTP rate-limiting (client-side guard — Firebase also throttles server-side)
// These counters reset on page reload; the real throttle is Firebase Auth.
const _otp = {
    sendCount: {},      // { phone: count } — how many times OTP sent per number
    sendTime:  {},      // { phone: timestamp } — last send time per number
    verifyFails: 0,     // wrong-OTP attempts for the current session
    MAX_SENDS:   3,     // max OTP sends per phone per session
    COOLDOWN_MS: 60000, // 60s between sends for the same number
    MAX_VERIFY:  5,     // lock after this many wrong attempts
};

window.sendOTP = async function() {
    const phone = document.getElementById('auth_phone').value.trim();
    if (!/^[6-9]\d{9}$/.test(phone)) {
        return showToast("Enter valid 10-digit mobile number", true);
    }

    // Rate-limit check: cooldown
    const now = Date.now();
    const lastSend = _otp.sendTime[phone] || 0;
    const elapsed = now - lastSend;
    if (elapsed < _otp.COOLDOWN_MS) {
        const wait = Math.ceil((_otp.COOLDOWN_MS - elapsed) / 1000);
        return showToast(`Please wait ${wait}s before requesting another OTP.`, true);
    }
    // Rate-limit check: max sends per phone
    const sends = (_otp.sendCount[phone] || 0);
    if (sends >= _otp.MAX_SENDS) {
        return showToast("Too many OTP requests for this number. Please try again later.", true);
    }

    const btn = document.getElementById('sendOtpBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

    try {
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'sendOtpBtn', {
                size: 'invisible',
                callback: () => {}
            });
        }
        const confirmationResult = await signInWithPhoneNumber(auth, '+91' + phone, window.recaptchaVerifier);
        window.otpConfirmationResult = confirmationResult;

        // Record successful send for rate limiting
        _otp.sendCount[phone] = (_otp.sendCount[phone] || 0) + 1;
        _otp.sendTime[phone] = Date.now();
        _otp.verifyFails = 0; // reset verify counter for fresh OTP

        document.getElementById('phoneInputView').style.display = 'none';
        document.getElementById('otpInputView').style.display = 'block';
        document.getElementById('otpSentTo').textContent = '+91 ' + phone;
        showToast("OTP sent to +91" + phone);
        _lastPhone = phone;
        startOTPTimer();

        // Web OTP API — auto-capture OTP from SMS on supported Android browsers
        if ('OTPCredential' in window) {
            try {
                const ac = new AbortController();
                window._otpAbortController = ac;
                const credential = await navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ac.signal });
                if (credential && credential.code) {
                    const otpInput = document.getElementById('auth_otp');
                    if (otpInput) {
                        otpInput.value = credential.code;
                        showToast("✅ OTP auto-filled!");
                        // Auto verify
                        setTimeout(() => window.verifyOTP(), 400);
                    }
                }
            } catch(otpErr) {
                // Silently ignore if user dismissed or not supported
            }
        }
    } catch(e) {
        showToast("OTP send failed: " + (e.message || e.code), true);
        btn.disabled = false; btn.innerHTML = 'Send OTP';
    }
};

window.verifyOTP = async function() {
    const otp = document.getElementById('auth_otp').value.trim();
    if (otp.length !== 6) return showToast("Enter 6-digit OTP", true);
    if (!window.otpConfirmationResult) return showToast("Please request OTP first", true);

    const btn = document.getElementById('verifyOtpBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';

    try {
        const result = await window.otpConfirmationResult.confirm(otp);
        const user = result.user;
        const name = "User " + user.phoneNumber.slice(-4);
        if (window.onLoginSuccess) window.onLoginSuccess(user.uid, name, user.phoneNumber, null);
        closeAuthModal();
        showToast("✅ Login successful!");
    } catch(e) {
        _otp.verifyFails++;
        if (_otp.verifyFails >= _otp.MAX_VERIFY) {
            btn.disabled = true;
            btn.innerHTML = 'Too many attempts';
            showToast("Too many wrong attempts. Please request a new OTP.", true);
            // Reset so user can request a new OTP after cooldown
            window.otpConfirmationResult = null;
            setTimeout(() => {
                window.switchToPhoneInput();
                btn.disabled = false;
                btn.innerHTML = 'Verify & Login';
                _otp.verifyFails = 0;
            }, 3000);
        } else {
            const left = _otp.MAX_VERIFY - _otp.verifyFails;
            showToast(`Wrong OTP. ${left} attempt${left === 1 ? '' : 's'} remaining.`, true);
            btn.disabled = false; btn.innerHTML = 'Verify & Login';
        }
    }
};

window.switchToPhoneInput = function() {
    document.getElementById('phoneInputView').style.display = 'block';
    document.getElementById('otpInputView').style.display = 'none';
    // Cancel any pending Web OTP request
    if (window._otpAbortController) { try { window._otpAbortController.abort(); } catch(e) {} window._otpAbortController = null; }
};

// Auth state observer
onAuthStateChanged(auth, (user) => {
    window.currentUser = user || null;
    if (user) {
        const name = user.displayName || user.phoneNumber || 'User';
        const email = user.email || user.phoneNumber || '';
        const photo = user.photoURL || 'https://i.pravatar.cc/40?u=' + user.uid;
        if (window.onLoginSuccess) window.onLoginSuccess(user.uid, name, email, photo);

        // If admin is already logged in and tried to open admin panel, open it now
        if (user.email === ADMIN_EMAIL && window._pendingAdminOpen) {
            window._pendingAdminOpen = false;
            setTimeout(() => {
                document.getElementById('adminLoginModal')?.classList.add('hidden');
                showAdminPanel();
            }, 300);
        }
    }
});

// ===== LOGOUT =====
window.logout = async function() {
    try { await signOut(auth); } catch(e) {
        showToast("Logout error. Try again.", true);
    }
    window.currentUser = null;
    localStorage.removeItem('user_uid');
    localStorage.removeItem('user_name');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_photo');
    updateUserUI(null);
    showToast("Logged out successfully");
};

// ===== SAVE ORDER TO FIRESTORE =====
window.saveOrderToFirestore = async function(orderData) {
    // Wrap in try/catch so a network blip never silently drops a paid order.
    // The caller receives either the saved DocumentReference or a thrown Error
    // with a user-friendly message it can show via showToast().
    let retries = 2;
    while (retries >= 0) {
        try {
            const ref = await addDoc(collection(db, "orders"), {
                ...orderData,
                created_at: serverTimestamp(),
                status: 'pending'
            });
            return ref;
        } catch (err) {
            if (retries === 0) {
                console.error("saveOrderToFirestore: all retries exhausted", err);
                throw new Error(
                    "Your payment was received but we couldn’t save the order record. " +
                    "Please screenshot this and contact us on WhatsApp immediately."
                );
            }
            retries--;
            // Brief back-off before retry
            await new Promise(r => setTimeout(r, 1000));
        }
    }
};

// ===== LOAD USER ORDERS =====
window.loadUserOrders = async function(uid) {
    try {
        // Try with orderBy first, fallback to simple query if index missing
        let orders = [];
        try {
            const q = query(collection(db, "orders"), where("user_uid", "==", uid), orderBy("created_at", "desc"));
            const snap = await getDocs(q);
            orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch(e) {
            // Fallback: simple query without orderBy (no index needed)
            const q2 = query(collection(db, "orders"), where("user_uid", "==", uid));
            const snap2 = await getDocs(q2);
            orders = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort client-side
            orders.sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
        }
        return orders;
    } catch(e) {
        console.error("loadUserOrders error:", e);
        showToast("Could not load orders. Check Firestore rules.", true);
        return [];
    }
};

// ===== LOAD ALL ORDERS (ADMIN) =====
window.loadAllOrders = async function() {
    try {
        const snap = await getDocs(collection(db, "orders"));
        return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
            const at = a.created_at?.seconds || 0;
            const bt = b.created_at?.seconds || 0;
            return bt - at;
        });
    } catch(e) {
        console.error(e);
        return [];
    }
};

// ===== UPDATE ORDER STATUS (ADMIN) =====
window.updateOrderStatus = async function(orderId, newStatus) {
    try {
        await updateDoc(doc(db, "orders", orderId), { status: newStatus });
        showToast("✅ Status updated to: " + newStatus);
    } catch(e) {
        showToast("Failed to update status", true);
    }
};

// ===== LOAD SHIPPING =====
window.loadShippingDetails = async function(uid) {
    try {
        const q = query(collection(db, "users_shipping"), where("user_uid", "==", uid));
        const snap = await getDocs(q);
        if (!snap.empty) return snap.docs[0].data();
    } catch(e) {}
    return null;
};

// ===== SAVE SHIPPING =====
window.saveShippingDetails = async function(uid, data) {
    try {
        await addDoc(collection(db, "users_shipping"), { user_uid: uid, ...data, updated_at: serverTimestamp() });
    } catch(e) {}
};

// ===== ADMIN: SAVE NEW PRODUCT =====
window.adminSaveProduct = async function(productData) {
    // Save to Firestore only (Google Sheets dependency removed)
    const docRef = await addDoc(collection(db, "products"), {
        ...productData,
        created_at: serverTimestamp(),
        in_stock: true,
        stock: '10'
    });
    return docRef;
};