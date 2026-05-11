// functions/verifyAdmin.js
// ════════════════════════════════════════════════════════════════════════════
//  Nature's Heal — verifyAdmin Cloud Function
//
//  Called by openAdminPanel() in index.html before showing the admin UI.
//  Verifies the Firebase ID token server-side and confirms the caller is
//  the designated admin. Returns 200 OK or 403 Forbidden.
//
//  This is the server-side enforcement layer that the client cannot bypass.
//
//  Deploy:
//    firebase deploy --only functions:verifyAdmin
//
//  Local test:
//    firebase emulators:start --only functions,auth
// ════════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin     = require("firebase-admin");

// Admin SDK is initialised once in index.js — don't call initializeApp() here
// unless this file is standalone.

const ADMIN_EMAIL = "harikrishnarock444@gmail.com";

/**
 * POST /verifyAdmin
 * Authorization: Bearer <Firebase ID Token>
 *
 * Returns:
 *   200 { ok: true }   — caller is the verified admin
 *   401 { error }      — missing or invalid token
 *   403 { error }      — valid token but not the admin account
 *   405                — wrong HTTP method
 */
exports.verifyAdmin = functions
  .region("us-central1")
  .https.onRequest(async (req, res) => {

    // ── CORS ────────────────────────────────────────────────────────────────
    res.set("Access-Control-Allow-Origin", "https://naturesheal.web.app");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // ── Token extraction ─────────────────────────────────────────────────────
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    const idToken = authHeader.slice(7); // remove "Bearer "

    // ── Token verification (cryptographic — cannot be forged) ─────────────────
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken, /* checkRevoked= */ true);
    } catch (err) {
      console.error("verifyAdmin: token verification failed", err.code);
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // ── Admin check ──────────────────────────────────────────────────────────
    const isAdmin = decoded.email === ADMIN_EMAIL
                 && decoded.email_verified === true;

    if (!isAdmin) {
      console.warn("verifyAdmin: access denied for", decoded.email);
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    // ── Success ──────────────────────────────────────────────────────────────
    console.info("verifyAdmin: access granted for", decoded.email);
    res.status(200).json({ ok: true });
  });
