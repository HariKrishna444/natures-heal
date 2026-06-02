// =============================================================
//  cart.js — Cart logic, order placement, payment flow
// =============================================================
// ===== CART =====
function addToCartSimple(id) {
    // Use == for type-coerced comparison since Firestore IDs may be strings or numbers
    const prod = window.appState.catalogData.find(p => p.id == id);
    const minQty = (prod && prod.minQty) ? prod.minQty : 1;
    const step   = (prod && prod.step)   ? prod.step   : minQty;
    const existing = window.appState.cart.find(i => i.id == id);
    if (existing) existing.qty = Math.round((existing.qty + step) * 1000) / 1000;
    else window.appState.cart.push({ id, qty: minQty });
    persistCart();
    updateCartBadge();
    renderCartItems();
    renderItems(getFilteredData());
    updatePlaceOrderButton();
    showToast("✅ Added to cart");
}
window.addToCartSimple = addToCartSimple;

window.updateQty = function(id, change) {
    const item = window.appState.cart.find(i => i.id == id);
    if (!item) return;
    const prod = window.appState.catalogData.find(p => p.id == id);
    const step = (prod && prod.step) ? prod.step : 1;
    const minQty = (prod && prod.minQty) ? prod.minQty : 1;
    item.qty = Math.round((item.qty + change * step) * 1000) / 1000;
    if (item.qty < minQty) window.appState.cart = window.appState.cart.filter(i => i.id != id);
    persistCart();
    renderCartItems();
    renderItems(getFilteredData());
    updateCartBadge();
    updatePlaceOrderButton();
};

function persistCart() {
    localStorage.setItem('cart', JSON.stringify(window.appState.cart));
}

function renderCartItems() {
    const list = document.getElementById('cartItemsList');
    const items = window.appState.cart.map(c => {
        const p = window.appState.catalogData.find(i => i.id == c.id);
        return p ? { ...p, qty: c.qty } : null;
    }).filter(Boolean);

    const total = items.reduce((s, i) => s + (i.price * i.qty), 0);
    document.getElementById('cartTotal').textContent = `₹${total.toFixed(2)}`;

    if (!items.length) {
        list.innerHTML = `<div style="text-align:center;padding:3rem 0;color:var(--text-muted)">
            <i class="fas fa-shopping-cart" style="font-size:2rem;display:block;margin-bottom:0.75rem;opacity:0.35"></i>
            <p style="font-weight:600">Your cart is empty</p>
            <p style="font-size:0.8rem;margin-top:0.25rem">Browse our catalog above</p>
        </div>`;
        return;
    }

    list.innerHTML = items.map(i => {
        const qt = i.quantityType || 'unit';
        return `
    <div class="cart-item">
        <img src="${safeURL(i.image)}" alt="${escapeHTML(i.name)}">
        <div class="cart-item-info">
            <div class="cart-item-name">${escapeHTML(i.name)}</div>
            <div class="cart-item-price">₹${i.price} / ${qt}</div>
            <div class="cart-qty">
                <button class="qty-btn qty-minus" onclick="updateQty(${i.id}, -1)">−</button>
                <span class="qty-val">${Number.isInteger(i.qty) ? i.qty : i.qty.toFixed(1)} ${qt}</span>
                <button class="qty-btn qty-plus" onclick="updateQty(${i.id}, 1)">+</button>
            </div>
        </div>
        <div class="cart-item-subtotal">₹${(i.price * i.qty).toFixed(0)}</div>
    </div>`;
    }).join('');
}

function updateCartBadge() {
    const b = document.getElementById('cartBadge');
    const count = window.appState.cart.length;
    b.textContent = count;
    b.style.display = count > 0 ? 'block' : 'none';

    // Update sticky cart button
    const stickyBtn = document.getElementById('stickyCartBtn');
    const stickyCount = document.getElementById('stickyCartCount');
    if (stickyBtn && stickyCount) {
        stickyCount.textContent = count;
        stickyBtn.classList.toggle('visible', count > 0);
    }
}

function updatePlaceOrderButton() {
    const btn = document.getElementById('placeOrderBtn');
    if (!btn) return;
    const has = window.appState.cart.length > 0;
    btn.disabled = !has;
    btn.style.opacity = has ? '1' : '0.5';
}

function toggleCartSidebar() {
    const s = document.getElementById('cartSidebar');
    const o = document.getElementById('cartOverlay');
    if (s.classList.contains('active')) {
        s.classList.remove('active');
        o.style.display = 'none';
        document.body.style.overflow = '';
    } else {
        renderCartItems();
        s.classList.add('active');
        o.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}
window.toggleCartSidebar = toggleCartSidebar;
function openCartSidebar() {
    renderCartItems();
    document.getElementById('cartSidebar').classList.add('active');
    document.getElementById('cartOverlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
}
function closeCart() {
    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('cartOverlay').style.display = 'none';
    document.body.style.overflow = '';
}
window.closeCart = closeCart;

// ===== PLACE ORDER =====
window.placeOrder = function() {
    if (!localStorage.getItem('user_uid')) {
        showToast("Please login to place order", true);
        setTimeout(() => openAuthModal(), 800);
        return;
    }
    if (!window.appState?.cart?.length) {
        showToast("Cart is empty", true);
        return;
    }
    openShippingModal();
};

function openShippingModal() {
    const uid = localStorage.getItem('user_uid');
    if (uid) {
        const n = localStorage.getItem('user_name') || '';
        const e = localStorage.getItem('user_email') || '';
        // Pre-fill name/email from login
        if (n && document.getElementById('sh_name').value === '') document.getElementById('sh_name').value = n;
        if (e && document.getElementById('sh_email').value === '') document.getElementById('sh_email').value = e;

        // Load previous order details and pre-fill all fields (always refresh)
        loadShippingDetails(uid).then(async data => {
            if (data && data.phone) {
                // Fill from users_shipping collection
                const fields = { sh_name: data.name, sh_phone: data.phone, sh_email: data.email, sh_address: data.address, sh_pincode: data.pincode };
                for (const [id, val] of Object.entries(fields)) {
                    const el = document.getElementById(id);
                    if (el && val) el.value = val;
                }
            } else {
                // Fallback: pull from last order in Firestore
                try {
                    const orders = await loadUserOrders(uid);
                    if (orders && orders.length > 0) {
                        const last = orders[0];
                        const u = last.user || {};
                        if (u.name) document.getElementById('sh_name').value = u.name;
                        if (u.phone) document.getElementById('sh_phone').value = u.phone;
                        if (u.email) document.getElementById('sh_email').value = u.email;
                        if (u.address) document.getElementById('sh_address').value = u.address;
                        if (last.pincode) document.getElementById('sh_pincode').value = last.pincode;
                    }
                } catch(e) { /* ignore */ }
            }
        }).catch(() => {});
    }
    document.getElementById('shippingModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Dynamically disable COD if cart total < ₹499
    const cartItems = window.appState.cart.map(c => {
        const p = window.appState.catalogData.find(i => i.id == c.id);
        return p ? p.price * c.qty : 0;
    });
    const cartTotal = cartItems.reduce((s, v) => s + v, 0);
    const codOpt = document.getElementById('payOptCOD');
    if (codOpt) {
        if (cartTotal < 499) {
            codOpt.style.opacity = '0.45';
            codOpt.style.cursor = 'not-allowed';
            codOpt.title = 'COD available only on orders above ₹499';
            // If COD was previously selected, reset to razorpay
            if (window.appState.selectedPayment === 'cod') {
                window.appState.selectedPayment = 'razorpay';
                document.getElementById('payOptRazorpay').classList.add('selected');
                codOpt.classList.remove('selected');
                document.getElementById('codNote').style.display = 'none';
                document.getElementById('submitOrderBtn').innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online';
            }
        } else {
            codOpt.style.opacity = '';
            codOpt.style.cursor = '';
            codOpt.title = '';
        }
    }
}
function closeShippingModal() {
    _orderInFlight = false;  // reset debounce guard whenever modal closes
    document.getElementById('shippingModal').classList.add('hidden');
    document.body.style.overflow = '';
}
window.closeShippingModal = closeShippingModal;

// Payment selection
window.selectPayment = function(type) {
    // Check cart total for COD eligibility
    const items = window.appState.cart.map(c => {
        const p = window.appState.catalogData.find(i => i.id == c.id);
        return p ? p.price * c.qty : 0;
    });
    const total = items.reduce((s, v) => s + v, 0);

    if (type === 'cod' && total < 499) {
        showToast("COD is only available for orders above ₹499. Please choose Online Pay.", true);
        return;
    }

    window.appState.selectedPayment = type;
    document.getElementById('payOptRazorpay').classList.toggle('selected', type === 'razorpay');
    document.getElementById('payOptCOD').classList.toggle('selected', type === 'cod');
    document.getElementById('codNote').style.display = type === 'cod' ? 'block' : 'none';
    document.getElementById('submitOrderBtn').innerHTML = type === 'cod'
        ? '<i class="fas fa-motorcycle" style="font-size:0.8rem"></i> Confirm COD Order'
        : '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online';
};

// Module-level in-flight guard — prevents double-submission from
// rapid tapping, network retries, or Razorpay callback races.
// Reset on success, failure, or modal close (closeShippingModal).
let _orderInFlight = false;

window.submitOrder = async function(event) {
    const btn = event.target.closest ? event.target : document.getElementById('submitOrderBtn');
    if (btn.disabled || _orderInFlight) return;
    _orderInFlight = true;

    const uid = localStorage.getItem('user_uid');
    if (!uid) return showToast("Session expired. Please login.", true);

    const name = document.getElementById('sh_name').value.trim();
    const phone = document.getElementById('sh_phone').value.trim();
    const email = document.getElementById('sh_email').value.trim();
    const address = document.getElementById('sh_address').value.trim();
    const pincode = document.getElementById('sh_pincode').value.trim();

    if (!name || name.length < 3) return showToast("Enter valid full name (min 3 chars)", true);
    if (!address || address.length < 10) return showToast("Enter full delivery address (min 10 chars)", true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showToast("Invalid email address", true);
    if (!/^[6-9]\d{9}$/.test(phone)) return showToast("Invalid phone number (10 digits)", true);

    const safeName = sanitize(name);
    const safeAddress = sanitize(address);

    // Build map with string keys to avoid type mismatch (Firestore IDs are strings)
    const catalogMap = new Map(window.appState.catalogData.map(i => [String(i.id), i]));
    const items = window.appState.cart.map(c => {
        const p = catalogMap.get(String(c.id));
        if (!p) return null;
        // Ensure image is a valid https URL, else store empty string
        const imgUrl = p.image && p.image.startsWith('https://') ? p.image : '';
        return { name: p.name, price: p.price, qty: c.qty, id: p.id, image: imgUrl, quantityType: p.quantityType || 'unit' };
    }).filter(Boolean);

    if (!items.length) {
        console.error("Cart map failed. Cart:", window.appState.cart, "Catalog IDs:", window.appState.catalogData.map(i=>i.id));
        return showToast("Cart error. Please refresh and try again.", true);
    }

    const total = items.reduce((s, i) => s + (i.price * i.qty), 0);

    // Minimum order check: ₹150
    if (total < 150) {
        return showToast("Minimum order value is ₹150. Please add more items.", true);
    }

    // COD not available below ₹499
    if (window.appState.selectedPayment === 'cod' && total < 499) {
        showToast("COD is only available for orders above ₹499. Please choose Online Pay.", true);
        window.selectPayment('razorpay');
        return;
    }

    // Count user's previous orders for first-order-free delivery logic
    let previousOrderCount = 0;
    try {
        const prevQ = window.fbQuery(window.fbCollection(window.db, "orders"), window.fbWhere("user_uid", "==", uid));
        const prevSnap = await window.fbGetDocs(prevQ);
        previousOrderCount = prevSnap.size;
    } catch(e) { previousOrderCount = 0; }

    // Delivery charge:
    // 1st order: always free | 2nd+ order: free if ≥₹499, else ₹49
    const isFirstOrder = previousOrderCount === 0;
    const deliveryCharge = isFirstOrder ? 0 : (total >= 499 ? 0 : 49);
    const grandTotal = total + deliveryCharge;

    const orderData = {
        items, total: grandTotal, subtotal: total, deliveryCharge, isFirstOrder,
        user: { name: safeName, phone, email, address: safeAddress },
        pincode,
        user_uid: uid,
        user_email: email,
        payment_method: window.appState.selectedPayment
    };
    // Save shipping for next time
    if (uid) { saveShippingDetails(uid, { name: safeName, phone, email, address: safeAddress, pincode }).catch(()=>{}); }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    if (window.appState.selectedPayment === 'cod') {
        // COD Flow — prices re-verified server-side via Cloud Function
        try {
            document.getElementById('paymentLoader').classList.add('active');

            const idToken = window.currentUser ? await window.currentUser.getIdToken() : null;

            // Send only IDs + qty — server re-fetches prices from Firestore
            const secureItems = window.appState.cart.map(c => ({
                id: String(c.id),
                qty: c.qty
            }));

            const codRes = await fetch(
                "https://us-central1-naturesheal.cloudfunctions.net/saveCodOrder",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(idToken ? { "Authorization": "Bearer " + idToken } : {})
                    },
                    body: JSON.stringify({
                        items:      secureItems,
                        user:       orderData.user,
                        pincode:    orderData.pincode,
                        user_uid:   orderData.user_uid,
                        user_email: orderData.user_email
                    })
                }
            );

            document.getElementById('paymentLoader').classList.remove('active');

            if (!codRes.ok) {
                const errData = await codRes.json().catch(() => ({}));
                throw new Error(errData.error || "Order save failed");
            }

            const savedOrder = await codRes.json();
            // Use server-verified totals for WhatsApp message
            const verifiedTotal    = savedOrder.total;
            const verifiedSubtotal = savedOrder.subtotal;
            const verifiedDelivery = savedOrder.deliveryCharge;
            const verifiedFirst    = savedOrder.isFirstOrder;

            // Clear cart
            window.appState.cart = [];
            persistCart();
            renderCartItems();
            updateCartBadge();
            updatePlaceOrderButton();

            closeShippingModal();
            closeCart();

            showToast("🎉 COD Order placed! We'll confirm on WhatsApp.");

            // Send confirmation email
            sendOrderConfirmationEmail(orderData, savedOrder.orderId);

            // Open orders view so user can download invoice manually
            openOrders();

            // Send WhatsApp confirmation (use server-verified items/totals)
            const itemLines = items.map(i => {
                const imgLine = i.image ? `\nImage: ${i.image}` : '';
                return `• ${i.name} × ${i.qty} ${i.quantityType || 'unit'} = ₹${(i.price * i.qty).toFixed(0)}${imgLine}`;
            }).join('\n');
            const deliveryNote = verifiedFirst ? '🎉 FREE (First Order!)' : (verifiedDelivery === 0 ? 'FREE (Above ₹499)' : `₹${verifiedDelivery}`);
            const waMsg = `🌿 *New Order — Nature's Heal*\n\nName: ${safeName}\nPhone: ${phone}\nEmail: ${email}\n\n*Items:*\n${itemLines}\n\nSubtotal: ₹${verifiedSubtotal}\nDelivery: ${deliveryNote}\n*Grand Total: ₹${verifiedTotal}*\nAddress: ${safeAddress}\n\nPayment: Cash on Delivery\n\n_Order placed via naturesheal.web.app_`;
            setTimeout(() => {
                window.open(`https://wa.me/${918919011159}?text=${encodeURIComponent(waMsg)}`, '_blank');
            }, 800);

            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Submit Order';
        } catch(e) {
            document.getElementById('paymentLoader').classList.remove('active');
            showToast(e.message || "Order save failed. Try again.", true);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-motorcycle" style="font-size:0.8rem"></i> Confirm COD Order';
        }
    } else {
        // Razorpay Flow
        try {
            await payNow(grandTotal * 100, orderData, btn);
        } catch(e) {
            showToast("Payment setup failed", true);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online';
        }
    }
};

function payNow(totalAmount, orderData, btn) {
    document.getElementById('paymentLoader').classList.add('active');

    // Step 1: Create Razorpay order server-side (amount is set by server, not client)
    fetch("https://us-central1-naturesheal.cloudfunctions.net/createOrder", {
        method: "POST",
        body: JSON.stringify({ amount: totalAmount }),
        headers: { "Content-Type": "application/json" }
    })
    .then(res => { if (!res.ok) throw new Error("Payment server error. Try again."); return res.json(); })
    .then(order => {
        document.getElementById('paymentLoader').classList.remove('active');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online'; btn.dataset.loading = "false"; }

        const rzp = new Razorpay({
            key: RAZORPAY_KEY,
            amount: order.amount,
            currency: "INR",
            name: "Nature's Heal",
            description: "Herbal Product Order",
            order_id: order.id,
            handler: async function(response) {
                // Step 2: Send payment response + ONLY item IDs & quantities to server.
                // Server verifies Razorpay signature, re-fetches prices from Firestore,
                // recalculates total, and saves the order — client cannot tamper prices.
                try {
                    document.getElementById('paymentLoader').classList.add('active');

                    const idToken = window.currentUser
                        ? await window.currentUser.getIdToken()
                        : null;

                    // Send only IDs + qty (never prices) — server re-fetches from Firestore
                    const secureItems = orderData.items.map(i => ({
                        id: String(i.id),
                        qty: i.qty
                    }));

                    const verifyRes = await fetch(
                        "https://us-central1-naturesheal.cloudfunctions.net/verifyAndSaveOrder",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                ...(idToken ? { "Authorization": "Bearer " + idToken } : {})
                            },
                            body: JSON.stringify({
                                // Razorpay payment proof
                                razorpay_order_id:   response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature:  response.razorpay_signature,
                                // Order details (prices re-verified server-side)
                                items: secureItems,
                                user: orderData.user,
                                pincode: orderData.pincode,
                                user_uid: orderData.user_uid,
                                user_email: orderData.user_email,
                                isFirstOrder: orderData.isFirstOrder
                            })
                        }
                    );

                    document.getElementById('paymentLoader').classList.remove('active');

                    if (!verifyRes.ok) {
                        const errData = await verifyRes.json().catch(() => ({}));
                        throw new Error(errData.error || "Payment verification failed");
                    }

                    const savedOrder = await verifyRes.json();

                    window.appState.cart = [];
                    persistCart();
                    renderCartItems();
                    updateCartBadge();
                    closeShippingModal();
                    closeCart();
                    showToast("🎉 Payment Successful! Order placed.");
                    sendOrderConfirmationEmail(
                        { ...orderData, payment: { method: 'Online', id: response.razorpay_payment_id } },
                        savedOrder.orderId || response.razorpay_order_id
                    );
                    openOrders();

                } catch(e) {
                    document.getElementById('paymentLoader').classList.remove('active');
                    // Payment went through but verification failed — show specific message
                    if (e.message && e.message.toLowerCase().includes('verif')) {
                        showToast("⚠️ Payment received but verification failed. Contact us on WhatsApp with payment ID: " + response.razorpay_payment_id, true);
                    } else {
                        showToast("Payment done but order save failed. Contact us with ID: " + response.razorpay_payment_id, true);
                    }
                }
            },
            modal: {
                ondismiss: function() {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online'; }
                }
            },
            theme: { color: "#10b981" }
        });
        rzp.on("payment.failed", (failResp) => {
            showToast("Payment failed: " + (failResp.error?.description || "Please retry."), true);
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online'; }
        });
        rzp.open();
    })
    .catch(err => {
        document.getElementById('paymentLoader').classList.remove('active');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock" style="font-size:0.8rem"></i> Pay Securely Online'; }
        showToast("Payment setup failed: " + err.message, true);
    });
}

// ===== MY ORDERS =====
window.openOrders = async function() {
    const uid = localStorage.getItem('user_uid');
    if (!uid) { showToast("Please login to view orders", true); openAuthModal(); return; }

    document.getElementById('ordersModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const list = document.getElementById('ordersList');
    list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem"></i></div>`;

    const orders = await loadUserOrders(uid);
    renderOrdersList(orders);
};

window.closeOrders = function() {
    document.getElementById('ordersModal').classList.add('hidden');
    document.body.style.overflow = '';
};
