/* ============================================================
   receipt-app.js — Consumer site logic for BuildReceipt
   Manages form state, live preview, and PDF download
   ============================================================ */

// ── Guest API key ─────────────────────────────────────────────
const GUEST_KEY_STORAGE = "brct_guest_key";
const API_BASE = "/api/v1";

async function getOrCreateGuestKey() {
  let key = localStorage.getItem(GUEST_KEY_STORAGE);
  if (key && key.startsWith("brct_")) return key;

  const email = `guest_${Date.now()}_${Math.random().toString(36).slice(2)}@buildreceipt.co`;
  try {
    const res  = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.success && data.api_key) {
      localStorage.setItem(GUEST_KEY_STORAGE, data.api_key);
      return data.api_key;
    }
  } catch (e) { console.warn("Guest key registration failed:", e); }
  return null;
}

// ── State ─────────────────────────────────────────────────────
let lineItems = [{ description: "", quantity: 1, rate: 0 }];
let accentColor = "#f43f5e";
let isGenerating = false;

// ── DOM refs ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Set default date to today
  const today = new Date();
  $("receiptDate").value = today.toISOString().split("T")[0];

  renderLineItems();
  bindEvents();
  updatePreview();
  getOrCreateGuestKey();
});

function bindEvents() {
  // Color picker
  $("accentColor").addEventListener("input", (e) => {
    accentColor = e.target.value;
    $("accentColorHex").value = e.target.value;
    updatePreview();
  });
  $("accentColorHex").addEventListener("input", (e) => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
      accentColor = e.target.value;
      $("accentColor").value = e.target.value;
      updatePreview();
    }
  });

  // Add line item
  $("btnAddItem").addEventListener("click", () => {
    lineItems.push({ description: "", quantity: 1, rate: 0 });
    renderLineItems();
    updateTotals();
    updatePreview();
  });

  // Download
  $("btnDownload").addEventListener("click", downloadReceipt);

  // Listen to all form inputs for live preview
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("input", () => { updateTotals(); updatePreview(); });
  });

  // Toast close
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("toast")) e.target.classList.remove("show");
  });
}

// ── Line Items ────────────────────────────────────────────────
function renderLineItems() {
  const container = $("lineItems");
  container.innerHTML = "";

  lineItems.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "line-item-row";
    row.innerHTML = `
      <input type="text"   class="li-desc"  placeholder="Description"  value="${escHtml(item.description)}" data-idx="${i}" data-field="description">
      <input type="number" class="li-qty"   placeholder="Qty"  value="${item.quantity}"  min="0" step="1"    data-idx="${i}" data-field="quantity">
      <input type="number" class="li-rate"  placeholder="Rate" value="${item.rate}"      min="0" step="0.01" data-idx="${i}" data-field="rate">
      <span class="li-amount">${fmtCurrency((item.quantity || 1) * (item.rate || 0))}</span>
      <button class="btn-remove-item" data-idx="${i}" title="Remove">✕</button>
    `;
    container.appendChild(row);
  });

  // Bind row events
  container.querySelectorAll("input").forEach((el) => {
    el.addEventListener("input", (e) => {
      const idx   = +e.target.dataset.idx;
      const field = e.target.dataset.field;
      lineItems[idx][field] = field === "description" ? e.target.value : parseFloat(e.target.value) || 0;
      // Update amount display
      const row    = e.target.closest(".line-item-row");
      const amount = (lineItems[idx].quantity || 1) * (lineItems[idx].rate || 0);
      row.querySelector(".li-amount").textContent = fmtCurrency(amount);
      updateTotals();
      updatePreview();
    });
  });

  container.querySelectorAll(".btn-remove-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = +e.target.dataset.idx;
      if (lineItems.length > 1) {
        lineItems.splice(idx, 1);
        renderLineItems();
        updateTotals();
        updatePreview();
      }
    });
  });
}

// ── Totals ────────────────────────────────────────────────────
function calcTotals() {
  const subtotal = lineItems.reduce((s, i) => s + (i.quantity || 1) * (i.rate || 0), 0);
  const taxRate  = parseFloat($("taxRate").value)  || 0;
  const discount = parseFloat($("discount").value) || 0;
  const tax      = subtotal * (taxRate / 100);
  const total    = Math.max(0, subtotal + tax - discount);
  return { subtotal, tax, discount, total, taxRate };
}

function updateTotals() {
  const { subtotal, tax, discount, total } = calcTotals();
  $("dispSubtotal").textContent = fmtCurrency(subtotal);
  $("dispTax").textContent      = fmtCurrency(tax);
  $("dispDiscount").textContent = `-${fmtCurrency(discount)}`;
  $("dispTotal").textContent    = fmtCurrency(total);
}

// ── Live Preview ──────────────────────────────────────────────
function updatePreview() {
  const data = collectFormData();
  $("previewBody").innerHTML = renderPreviewHTML(data);
}

function collectFormData() {
  const currency = $("currency").value || "$";
  return {
    from: {
      name:    $("fromName").value,
      email:   $("fromEmail").value,
      address: [$("fromStreet").value, $("fromCity").value, $("fromState").value].filter(Boolean).join(", "),
      phone:   $("fromPhone").value,
    },
    to: {
      name:    $("toName").value,
      email:   $("toEmail").value,
      address: [$("toStreet").value, $("toCity").value, $("toState").value].filter(Boolean).join(", "),
    },
    receipt: {
      number: $("receiptNumber").value || "RCT-001",
      date:   $("receiptDate").value,
    },
    paymentMethod:   $("paymentMethod").value,
    referenceNumber: $("referenceNumber").value,
    items:      lineItems,
    ...calcTotals(),
    notes:    $("notes").value,
    currency,
    color:    accentColor,
  };
}

function renderPreviewHTML(d) {
  const col  = d.color || "#f43f5e";
  const cur  = d.currency || "$";
  const fmt  = (n) => `${cur}${Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  const esc  = escHtml;

  // Payment method label
  const paymentLabels = {
    cash: "Cash", check: "Check", credit_card: "Credit Card", debit_card: "Debit Card",
    bank_transfer: "Bank Transfer", paypal: "PayPal", venmo: "Venmo", zelle: "Zelle", other: "Other"
  };
  const payLabel = paymentLabels[d.paymentMethod] || "—";

  return `
    <div style="font-family:Inter,sans-serif;font-size:12px;color:#1a202c;padding:24px;background:#fff;min-height:500px;position:relative;overflow:hidden;">
      <!-- PAID Watermark -->
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:900;color:rgba(16,185,129,0.08);letter-spacing:12px;pointer-events:none;z-index:0;">PAID</div>

      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;position:relative;z-index:1;">
        <div>
          <div style="font-size:18px;font-weight:800;color:#1a202c;">${esc(d.from.name) || "<span style='color:#aaa'>Your Business</span>"}</div>
          ${d.from.address ? `<div style="color:#718096;font-size:11px;margin-top:2px;">${esc(d.from.address)}</div>` : ""}
          ${d.from.email   ? `<div style="color:#718096;font-size:11px;">${esc(d.from.email)}</div>` : ""}
          ${d.from.phone   ? `<div style="color:#718096;font-size:11px;">${esc(d.from.phone)}</div>` : ""}
        </div>
        <div style="text-align:right;">
          <div style="font-size:9px;font-weight:700;color:#718096;letter-spacing:2px;">RECEIPT</div>
          <div style="font-size:20px;font-weight:800;color:${col};">#${esc(d.receipt.number)}</div>
          ${d.receipt.date ? `<div style="font-size:10px;color:#4a5568;">Date: ${d.receipt.date}</div>` : ""}
        </div>
      </div>

      <!-- Divider -->
      <div style="height:4px;background:${col};border-radius:2px;margin-bottom:16px;position:relative;z-index:1;"></div>

      <!-- From / To -->
      <div style="display:flex;justify-content:space-between;margin-bottom:16px;position:relative;z-index:1;">
        <div>
          <div style="font-size:8px;font-weight:700;color:${col};letter-spacing:1px;margin-bottom:4px;">RECEIVED FROM</div>
          <div style="font-weight:700;font-size:13px;">${esc(d.to.name) || "<span style='color:#aaa'>Customer Name</span>"}</div>
          ${d.to.address ? `<div style="color:#718096;font-size:10px;">${esc(d.to.address)}</div>` : ""}
          ${d.to.email   ? `<div style="color:#718096;font-size:10px;">${esc(d.to.email)}</div>` : ""}
        </div>
        <div style="text-align:right;">
          <div style="font-size:8px;font-weight:700;color:${col};letter-spacing:1px;margin-bottom:4px;">PAYMENT INFO</div>
          <div style="font-size:10px;color:#4a5568;">Method: <strong>${esc(payLabel)}</strong></div>
          ${d.referenceNumber ? `<div style="font-size:10px;color:#4a5568;">Ref: <strong>${esc(d.referenceNumber)}</strong></div>` : ""}
        </div>
      </div>

      <!-- Line Items -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px;position:relative;z-index:1;">
        <thead>
          <tr style="background:${col};color:#fff;">
            <th style="padding:6px 8px;text-align:left;font-size:9px;font-weight:700;">DESCRIPTION</th>
            <th style="padding:6px 8px;text-align:center;font-size:9px;font-weight:700;width:50px;">QTY</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;font-weight:700;width:80px;">UNIT PRICE</th>
            <th style="padding:6px 8px;text-align:right;font-size:9px;font-weight:700;width:80px;">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${d.items.map((item, i) => `
            <tr style="background:${i % 2 === 0 ? "#f9f9f9" : "#fff"};">
              <td style="padding:5px 8px;font-size:10px;">${esc(item.description) || "<em style='color:#aaa'>Description</em>"}</td>
              <td style="padding:5px 8px;text-align:center;font-size:10px;">${item.quantity || 1}</td>
              <td style="padding:5px 8px;text-align:right;font-size:10px;">${fmt(item.rate)}</td>
              <td style="padding:5px 8px;text-align:right;font-size:10px;">${fmt((item.quantity || 1) * (item.rate || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <!-- Totals -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:16px;position:relative;z-index:1;">
        <div style="width:220px;">
          <div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;"><span>Subtotal</span><span>${fmt(d.subtotal)}</span></div>
          ${d.taxRate > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;"><span>Tax (${d.taxRate}%)</span><span>${fmt(d.tax)}</span></div>` : ""}
          ${d.discount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0;"><span>Discount</span><span>-${fmt(d.discount)}</span></div>` : ""}
          <div style="border-top:2px solid ${col};margin:6px 0;"></div>
          <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;color:${col};"><span>AMOUNT RECEIVED</span><span>${fmt(d.total)}</span></div>
        </div>
      </div>

      <!-- Paid stamp -->
      <div style="display:inline-block;border:3px solid #22c55e;border-radius:8px;padding:4px 16px;color:#22c55e;font-weight:900;font-size:14px;letter-spacing:3px;transform:rotate(-3deg);margin-bottom:12px;position:relative;z-index:1;">✓ PAID</div>

      ${d.notes ? `<div style="margin-bottom:8px;position:relative;z-index:1;"><div style="font-size:8px;font-weight:700;color:${col};letter-spacing:1px;margin-bottom:3px;">NOTES</div><div style="font-size:10px;color:#4a5568;">${esc(d.notes)}</div></div>` : ""}

      <!-- Footer -->
      <div style="text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#a0aec0;position:relative;z-index:1;">Thank you for your business!</div>
    </div>
  `;
}

// ── Download ──────────────────────────────────────────────────
async function downloadReceipt() {
  if (isGenerating) return;

  const data = collectFormData();
  if (!data.from.name) { showToast("Enter your business name to generate a receipt.", "error"); return; }
  if (!data.to.name)   { showToast("Enter a customer name to generate a receipt.", "error"); return; }
  if (lineItems.every((i) => !i.description)) { showToast("Add at least one line item.", "error"); return; }

  isGenerating = true;
  const btn = $("btnDownload");
  btn.disabled = true;
  btn.textContent = "⏳ Generating PDF…";

  try {
    const apiKey = await getOrCreateGuestKey();
    const payload = {
      from:        data.from,
      to:          data.to,
      receipt:     data.receipt,
      payment_method:   data.paymentMethod,
      reference_number: data.referenceNumber,
      items:       lineItems.filter((i) => i.description),
      tax_rate:    data.taxRate,
      discount:    data.discount,
      notes:       data.notes,
      options: {
        color:           data.color,
        currency_symbol: data.currency,
        template:        "modern",
        pageSize:        "letter",
      },
    };

    const res  = await fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey || "guest" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();

    if (!result.success || !result.pdf) {
      showToast(result.error || "Failed to generate receipt. Please try again.", "error");
      return;
    }

    // Download
    const bytes  = atob(result.pdf);
    const arr    = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob   = new Blob([arr], { type: "application/pdf" });
    const url    = URL.createObjectURL(blob);
    const link   = document.createElement("a");
    link.href     = url;
    link.download = `receipt-${data.receipt.number || "001"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);

    showToast("✓ Receipt PDF downloaded!", "success");
  } catch (err) {
    console.error(err);
    showToast("Network error. Please try again.", "error");
  } finally {
    isGenerating = false;
    btn.disabled = false;
    btn.textContent = "⬇ Download Receipt PDF";
  }
}

// ── Helpers ───────────────────────────────────────────────────
function fmtCurrency(n) {
  const cur = $("currency")?.value || "$";
  return `${cur}${Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, type = "success") {
  const toast = $("toast");
  toast.textContent = msg;
  toast.className   = `toast toast--${type} show`;
  setTimeout(() => toast.classList.remove("show"), 4000);
}
