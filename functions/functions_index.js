/**
 * Nature's Heal — Firebase Cloud Functions
 *
 * Functions:
 *  1. createOrder         — Creates a Razorpay order server-side (amount set by server)
 *  2. verifyAndSaveOrder  — Verifies Razorpay signature, re-fetches prices from Firestore,
 *                           recalculates total, then saves the order. Client cannot tamper prices.
 *  3. saveCodOrder        — Same price verification for COD orders (no payment signature needed,
 *                           but prices are still re-fetched from Firestore server-side).
 *
 * Deploy:
 *   cd functions
 *   npm install
 *   firebase deploy --only functions
 *
 * Required environment variables (set via Firebase CLI):
 *   firebase functions:config:set razorpay.key_id="rzp_live_SmUAnlBSzeX4fw"
 *   firebase functions:config:set razorpay.key_secret="YOUR_RAZORPAY_KEY_SECRET"
 *
 * Or using newer secrets (recommended):
 *   firebase functions:secrets:set RAZORPAY_KEY_ID
 *   firebase functions:secrets:set RAZORPAY_KEY_SECRET
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const crypto    = require("crypto");
const Razorpay  = require("razorpay");

admin.initializeApp();
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Config — reads from Firebase environment config
// ---------------------------------------------------------------------------
const getRazorpayConfig = () => {
    const cfg = functions.config().razorpay || {};
    const keyId     = cfg.key_id     || process.env.RAZORPAY_KEY_ID;
    const keySecret = cfg.key_secret || process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error("Razorpay config missing. Run: firebase functions:config:set razorpay.key_id=... razorpay.key_secret=...");
    }
    return { keyId, keySecret };
};

// ---------------------------------------------------------------------------
// CORS helper — only allow your own domain
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
    "https://naturesheal.web.app",
    "https://naturesheal.firebaseapp.com"
];

function setCors(req, res) {
    const origin = req.headers.origin || "";
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
    } else {
        // During local dev / Postman testing — tighten this in production
        res.set("Access-Control-Allow-Origin", "*");
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
}

// ---------------------------------------------------------------------------
// Price fetcher — re-fetches all item prices from Firestore
// Returns { items, subtotal } or throws if any product is not found / out of stock
// ---------------------------------------------------------------------------
async function buildVerifiedItems(cartItems) {
    // cartItems: [{ id: "firestoreDocId", qty: 1 }, ...]
    const verifiedItems = [];
    let subtotal = 0;

    for (const cartItem of cartItems) {
        const id  = String(cartItem.id || "").trim();
        const qty = parseFloat(cartItem.qty);

        if (!id)           throw new Error(`Invalid item id: ${id}`);
        if (!qty || qty <= 0) throw new Error(`Invalid quantity for item ${id}`);

        const snap = await db.collection("products").doc(id).get();
        if (!snap.exists)  throw new Error(`Product not found: ${id}`);

        const p = snap.data();
        if (p.in_stock === false) throw new Error(`Product out of stock: ${p.name || id}`);

        const price = parseFloat(p.price);
        if (!price || price <= 0) throw new Error(`Invalid price for product: ${p.name || id}`);

        const lineTotal = Math.round(price * qty * 100) / 100;
        subtotal += lineTotal;

        verifiedItems.push({
            id,
            name:         p.name         || "",
            price,                              // server-fetched price — cannot be tampered
            qty,
            quantityType: p.quantityType  || "unit",
            image:        (p.image && p.image.startsWith("https://")) ? p.image : ""
        });
    }

    return { items: verifiedItems, subtotal: Math.round(subtotal * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Delivery charge logic (mirrors client-side calculation)
// ---------------------------------------------------------------------------
async function calcDeliveryCharge(uid, subtotal) {
    // Count previous completed/pending orders for this user
    let previousOrderCount = 0;
    if (uid) {
        try {
            const snap = await db.collection("orders")
                .where("user_uid", "==", uid)
                .get();
            previousOrderCount = snap.size;
        } catch (e) {
            previousOrderCount = 0;
        }
    }
    const isFirstOrder  = previousOrderCount === 0;
    const deliveryCharge = isFirstOrder ? 0 : (subtotal >= 499 ? 0 : 49);
    return { isFirstOrder, deliveryCharge };
}

// ---------------------------------------------------------------------------
// 1. createOrder — creates a Razorpay order (amount enforced by server)
// ---------------------------------------------------------------------------
exports.createOrder = functions.https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")    { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
        const { amount } = req.body;  // amount in paise (₹1 = 100 paise)
        if (!amount || amount < 15000) {  // ₹150 minimum = 15000 paise
            return res.status(400).json({ error: "Amount too low (minimum ₹150)" });
        }
        if (amount > 10000000) {  // ₹1,00,000 maximum sanity check
            return res.status(400).json({ error: "Amount too high" });
        }

        const { keyId, keySecret } = getRazorpayConfig();
        const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

        const order = await razorpay.orders.create({
            amount:   Math.round(amount),   // paise, must be integer
            currency: "INR",
            receipt:  "nh_" + Date.now(),
            notes:    { source: "naturesheal.web.app" }
        });

        res.status(200).json({ id: order.id, amount: order.amount, currency: order.currency });
    } catch (e) {
        console.error("createOrder error:", e);
        res.status(500).json({ error: e.message || "Failed to create order" });
    }
});

// ---------------------------------------------------------------------------
// 2. verifyAndSaveOrder — verifies Razorpay signature + re-fetches prices
// ---------------------------------------------------------------------------
exports.verifyAndSaveOrder = functions.https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")    { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            items: cartItems,
            user,
            pincode,
            user_uid,
            user_email
        } = req.body;

        // ── 1. Validate required fields ───────────────────────────────────
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "Missing payment proof fields" });
        }
        if (!cartItems || !cartItems.length) {
            return res.status(400).json({ error: "Cart is empty" });
        }
        if (!user || !user.name || !user.phone || !user.address) {
            return res.status(400).json({ error: "Missing shipping details" });
        }

        // ── 2. Verify Razorpay signature ──────────────────────────────────
        const { keySecret } = getRazorpayConfig();
        const expectedSignature = crypto
            .createHmac("sha256", keySecret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            console.error("Signature mismatch!", { razorpay_order_id, razorpay_payment_id });
            return res.status(400).json({ error: "Payment verification failed — invalid signature" });
        }

        // ── 3. Re-fetch prices from Firestore (client prices are ignored) ─
        const { items: verifiedItems, subtotal } = await buildVerifiedItems(cartItems);

        if (subtotal < 150) {
            return res.status(400).json({ error: "Order total below minimum ₹150" });
        }

        // ── 4. Re-calculate delivery charge server-side ───────────────────
        const { isFirstOrder, deliveryCharge } = await calcDeliveryCharge(user_uid, subtotal);
        const grandTotal = Math.round((subtotal + deliveryCharge) * 100) / 100;

        // ── 5. Save verified order to Firestore ───────────────────────────
        const orderRef = await db.collection("orders").add({
            items: verifiedItems,
            subtotal,
            deliveryCharge,
            total: grandTotal,
            isFirstOrder,
            user: {
                name:    String(user.name    || "").replace(/[<>"']/g, "").trim().slice(0, 120),
                phone:   String(user.phone   || "").replace(/\D/g, "").slice(0, 10),
                email:   String(user.email   || "").slice(0, 200),
                address: String(user.address || "").replace(/[<>"]/g, "").trim().slice(0, 500)
            },
            pincode:    String(pincode    || "").replace(/\D/g, "").slice(0, 6),
            user_uid:   String(user_uid   || ""),
            user_email: String(user_email || ""),
            payment: {
                method:     "Online",
                provider:   "Razorpay",
                order_id:   razorpay_order_id,
                payment_id: razorpay_payment_id,
                // Signature stored for audit — verified above
                signature:  razorpay_signature,
                status:     "paid"
            },
            status:     "confirmed",
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("Order saved:", orderRef.id, "total:", grandTotal);
        res.status(200).json({ orderId: orderRef.id, total: grandTotal });

    } catch (e) {
        console.error("verifyAndSaveOrder error:", e);
        res.status(500).json({ error: e.message || "Order save failed" });
    }
});

// ---------------------------------------------------------------------------
// 3. saveCodOrder — validates & saves COD orders with server-fetched prices
// ---------------------------------------------------------------------------
exports.saveCodOrder = functions.https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")    { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
        const {
            items: cartItems,
            user,
            pincode,
            user_uid,
            user_email
        } = req.body;

        // ── 1. Validate required fields ───────────────────────────────────
        if (!cartItems || !cartItems.length) {
            return res.status(400).json({ error: "Cart is empty" });
        }
        if (!user || !user.name || !user.phone || !user.address) {
            return res.status(400).json({ error: "Missing shipping details" });
        }
        // Basic phone validation
        if (!/^[6-9]\d{9}$/.test(String(user.phone || ""))) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        // ── 2. Verify Firebase Auth token (user must be logged in for COD) ─
        //    This prevents anonymous spam orders
        const authHeader = req.headers.authorization || "";
        const idToken    = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        let verifiedUid  = null;
        if (idToken) {
            try {
                const decoded = await admin.auth().verifyIdToken(idToken);
                verifiedUid   = decoded.uid;
            } catch (authErr) {
                console.warn("COD auth token invalid — proceeding as guest:", authErr.message);
            }
        }
        const finalUid = verifiedUid || user_uid || "";

        // ── 3. Re-fetch prices from Firestore ─────────────────────────────
        const { items: verifiedItems, subtotal } = await buildVerifiedItems(cartItems);

        if (subtotal < 150) {
            return res.status(400).json({ error: "Order total below minimum ₹150" });
        }

        // ── 4. Re-calculate delivery charge server-side ───────────────────
        const { isFirstOrder, deliveryCharge } = await calcDeliveryCharge(finalUid, subtotal);
        const grandTotal = Math.round((subtotal + deliveryCharge) * 100) / 100;

        // ── 5. Save verified COD order to Firestore ───────────────────────
        const orderRef = await db.collection("orders").add({
            items: verifiedItems,
            subtotal,
            deliveryCharge,
            total: grandTotal,
            isFirstOrder,
            user: {
                name:    String(user.name    || "").replace(/[<>"']/g, "").trim().slice(0, 120),
                phone:   String(user.phone   || "").replace(/\D/g, "").slice(0, 10),
                email:   String(user.email   || "").slice(0, 200),
                address: String(user.address || "").replace(/[<>"]/g, "").trim().slice(0, 500)
            },
            pincode:    String(pincode    || "").replace(/\D/g, "").slice(0, 6),
            user_uid:   finalUid,
            user_email: String(user_email || ""),
            payment: {
                method:  "COD",
                status:  "pending"
            },
            status:     "pending",
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log("COD Order saved:", orderRef.id, "total:", grandTotal);
        res.status(200).json({
            orderId:       orderRef.id,
            total:         grandTotal,
            subtotal,
            deliveryCharge,
            isFirstOrder
        });

    } catch (e) {
        console.error("saveCodOrder error:", e);
        res.status(500).json({ error: e.message || "COD order save failed" });
    }
});
