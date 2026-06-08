/* ============================================================
   BuildReceipt — Save/Load Integration
   Connects the receipt form to BuildAuth for persistence.
   
   Requires: build-ecosystem-auth.js loaded first
   ============================================================ */
(function () {
  "use strict";

  // Wait for BuildAuth to exist
  function waitForAuth(cb) {
    if (window.BuildAuth) { cb(); return; }
    var t = setInterval(function () {
      if (window.BuildAuth) { clearInterval(t); cb(); }
    }, 200);
  }

  waitForAuth(function () { init(); });

  /* ── Autocomplete CSS ─────────────────────────────────────── */
  var acStyle = document.createElement("style");
  acStyle.textContent = `
    .brc-ac-wrap { position: relative; }
    .brc-ac-list {
      position: absolute; top: 100%; left: 0; right: 0; z-index: 500;
      background: #1e1214; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px; margin-top: 4px; max-height: 200px;
      overflow-y: auto; display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .brc-ac-list.open { display: block; }
    .brc-ac-item {
      padding: 10px 14px; cursor: pointer; transition: background 0.12s;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .brc-ac-item:last-child { border-bottom: none; }
    .brc-ac-item:hover, .brc-ac-item.active { background: rgba(244,63,94,0.1); }
    .brc-ac-name { font-size: 0.9rem; font-weight: 600; color: rgba(255,255,255,0.85); }
    .brc-ac-detail { font-size: 0.75rem; color: rgba(255,255,255,0.35); margin-top: 1px; }
    .brc-ac-badge {
      display: inline-block; font-size: 0.65rem; padding: 1px 6px;
      background: rgba(244,63,94,0.15); color: #fb7185;
      border-radius: 4px; margin-left: 6px; vertical-align: middle;
    }
  `;
  document.head.appendChild(acStyle);

  /* ── Read form state from DOM ─────────────────────────────── */

  function readFormData() {
    var items = [];
    document.querySelectorAll("#lineItems .line-item-row").forEach(function (row) {
      var desc = row.querySelector(".li-desc");
      var qty  = row.querySelector(".li-qty");
      var rate = row.querySelector(".li-rate");
      if (desc) {
        items.push({
          description: desc.value || "",
          quantity: parseFloat(qty?.value) || 1,
          rate: parseFloat(rate?.value) || 0,
        });
      }
    });

    return {
      from_name:        v("fromName"),
      from_email:       v("fromEmail"),
      from_street:      v("fromStreet"),
      from_city:        v("fromCity"),
      from_state:       v("fromState"),
      from_phone:       v("fromPhone"),
      to_name:          v("toName"),
      to_email:         v("toEmail"),
      to_street:        v("toStreet"),
      to_city:          v("toCity"),
      to_state:         v("toState"),
      receipt_number:   v("receiptNumber"),
      receipt_date:     v("receiptDate"),
      currency:         v("currency"),
      accent_color:     v("accentColor"),
      payment_method:   v("paymentMethod"),
      reference_number: v("referenceNumber"),
      tax_rate:         parseFloat(v("taxRate")) || 0,
      discount:         parseFloat(v("discount")) || 0,
      notes:            v("notes"),
      line_items:       items,
    };
  }

  function v(id) { var el = document.getElementById(id); return el ? el.value : ""; }

  /* ── Write form state to DOM ──────────────────────────────── */

  function loadFormData(data) {
    setVal("fromName",        data.from_name);
    setVal("fromEmail",       data.from_email);
    setVal("fromStreet",      data.from_street);
    setVal("fromCity",        data.from_city);
    setVal("fromState",       data.from_state);
    setVal("fromPhone",       data.from_phone);
    setVal("toName",          data.to_name);
    setVal("toEmail",         data.to_email);
    setVal("toStreet",        data.to_street);
    setVal("toCity",          data.to_city);
    setVal("toState",         data.to_state);
    setVal("receiptNumber",   data.receipt_number);
    setVal("receiptDate",     data.receipt_date);
    setVal("currency",        data.currency);
    setVal("paymentMethod",   data.payment_method);
    setVal("referenceNumber", data.reference_number);
    setVal("taxRate",         data.tax_rate);
    setVal("discount",        data.discount);
    setVal("notes",           data.notes);

    if (data.accent_color) {
      setVal("accentColor", data.accent_color);
      setVal("accentColorHex", data.accent_color);
      if (window.accentColor !== undefined) window.accentColor = data.accent_color;
    }

    // Rebuild line items
    if (data.line_items && data.line_items.length > 0) {
      if (window.lineItems !== undefined) {
        window.lineItems = data.line_items.map(function (it) {
          return { description: it.description || "", quantity: it.quantity || 1, rate: it.rate || 0 };
        });
      }
      if (typeof window.renderLineItems === "function") {
        window.renderLineItems();
      }
      if (typeof window.calcTotals === "function") {
        window.calcTotals();
      }
    }
  }

  function setVal(id, val) {
    var el = document.getElementById(id);
    if (el && val !== undefined && val !== null) {
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /* ── Build title from form data ───────────────────────────── */

  function buildTitle(data) {
    var parts = [];
    if (data.receipt_number) parts.push(data.receipt_number);
    if (data.from_name) parts.push("from " + data.from_name);
    return parts.join(" ") || "Untitled Receipt";
  }

  /* ── Compute total from line items ────────────────────────── */

  function computeTotal(data) {
    var sub = 0;
    (data.line_items || []).forEach(function (it) { sub += (it.quantity || 0) * (it.rate || 0); });
    var tax = sub * ((data.tax_rate || 0) / 100);
    return sub + tax - (data.discount || 0);
  }

  /* ── Inject UI ────────────────────────────────────────────── */

  function init() {
    injectSaveButton();
    injectSavedPanel();
    initClientAutocomplete();

    BuildAuth.onAuthChange(function (user) {
      var panel = document.getElementById("brc-saved-panel");
      var saveBtn = document.getElementById("brc-save-btn");
      var hint = document.getElementById("brc-save-hint");

      if (user) {
        if (saveBtn) saveBtn.style.display = "";
        if (hint) hint.style.display = "none";
        if (panel) { panel.style.display = ""; loadSavedReceipts(); }
      } else {
        if (saveBtn) saveBtn.style.display = "none";
        if (hint) hint.style.display = "";
        if (panel) panel.style.display = "none";
      }
    });
  }

  function injectSaveButton() {
    var btnRow = document.getElementById("btnDownload")?.parentElement;
    if (!btnRow) return;

    // Save button (hidden until signed in)
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.id = "brc-save-btn";
    saveBtn.style.cssText = "display:none;background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);color:#fb7185;padding:0.75rem 1.25rem;border-radius:12px;font-weight:600;font-size:0.95rem;cursor:pointer;transition:all 0.2s;white-space:nowrap;font-family:inherit;";
    saveBtn.textContent = "💾 Save";
    saveBtn.title = "Save this receipt to your account";
    saveBtn.addEventListener("mouseenter", function () { saveBtn.style.background = "rgba(244,63,94,0.25)"; });
    saveBtn.addEventListener("mouseleave", function () { saveBtn.style.background = "rgba(244,63,94,0.15)"; });
    saveBtn.addEventListener("click", handleSave);
    btnRow.appendChild(saveBtn);

    // "Sign in to save" hint (shown when signed out)
    var hint = document.createElement("button");
    hint.type = "button";
    hint.id = "brc-save-hint";
    hint.className = "bea-save-hint";
    hint.textContent = "💾 Sign in to save your receipts";
    hint.style.marginTop = "0.75rem";
    hint.addEventListener("click", function () { BuildAuth.showSignIn(); });
    btnRow.parentElement.appendChild(hint);
  }

  async function handleSave() {
    var btn = document.getElementById("brc-save-btn");
    btn.textContent = "Saving...";
    btn.disabled = true;

    var data = readFormData();
    var title = buildTitle(data);
    var total = computeTotal(data);

    // Also save client to shared clients collection
    if (data.to_name) {
      BuildAuth.saveClient({
        name: data.to_name,
        email: data.to_email || "",
        phone: "",
        address: [data.to_street, data.to_city, data.to_state].filter(Boolean).join(", "),
      });
    }

    var docId = await BuildAuth.saveDocument("receipt", title, data, {
      clientName: data.to_name,
      total: total,
      status: "paid",
    });

    if (docId) {
      btn.textContent = "✓ Saved";
      setTimeout(function () { btn.textContent = "💾 Save"; btn.disabled = false; }, 2000);
      loadSavedReceipts();
    } else {
      btn.textContent = "✗ Error";
      setTimeout(function () { btn.textContent = "💾 Save"; btn.disabled = false; }, 2000);
    }
  }

  /* ── Saved Receipts Panel ───────────────────────────────────── */

  function injectSavedPanel() {
    var form = document.querySelector(".form-card, .receipt-form, #receiptForm");
    if (!form) {
      form = document.querySelector("main") || document.querySelector(".container");
    }
    if (!form) return;

    var panel = document.createElement("div");
    panel.id = "brc-saved-panel";
    panel.style.cssText = "display:none;margin-bottom:2rem;background:rgba(244,63,94,0.04);border:1px solid rgba(244,63,94,0.12);border-radius:16px;padding:1.5rem;";
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">' +
        '<h3 style="margin:0;font-size:1rem;font-weight:700;color:rgba(255,255,255,0.85);">🧾 Your Saved Receipts</h3>' +
        '<button id="brc-refresh" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:0.85rem;">↻ Refresh</button>' +
      '</div>' +
      '<div id="brc-list" style="display:flex;flex-direction:column;gap:0.5rem;"></div>';

    form.parentElement.insertBefore(panel, form);

    document.getElementById("brc-refresh")?.addEventListener("click", loadSavedReceipts);
  }

  async function loadSavedReceipts() {
    var list = document.getElementById("brc-list");
    if (!list) return;

    list.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:0.85rem;">Loading...</div>';

    var docs = await BuildAuth.loadDocuments("receipt");

    if (docs.length === 0) {
      list.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:0.85rem;">No saved receipts yet. Create a receipt and click 💾 Save.</div>';
      return;
    }

    list.innerHTML = "";
    docs.forEach(function (doc) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;cursor:pointer;transition:all 0.15s;";
      row.addEventListener("mouseenter", function () { row.style.background = "rgba(255,255,255,0.06)"; });
      row.addEventListener("mouseleave", function () { row.style.background = "rgba(255,255,255,0.03)"; });

      var info = document.createElement("div");
      info.innerHTML =
        '<div style="font-size:0.9rem;font-weight:600;color:rgba(255,255,255,0.8);">' + escHtml(doc.title) + '</div>' +
        '<div style="font-size:0.75rem;color:rgba(255,255,255,0.35);margin-top:2px;">' +
          (doc.clientName ? escHtml(doc.clientName) + " · " : "") +
          (doc.total ? "$" + doc.total.toFixed(2) + " · " : "") +
          formatDate(doc.createdAt) +
        '</div>';

      var actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:6px;flex-shrink:0;";

      var loadBtn = document.createElement("button");
      loadBtn.style.cssText = "background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.25);color:#fb7185;padding:5px 12px;border-radius:8px;font-size:0.8rem;cursor:pointer;font-family:inherit;";
      loadBtn.textContent = "Load";
      loadBtn.addEventListener("click", function (e) { e.stopPropagation(); loadReceipt(doc.id); });

      var delBtn = document.createElement("button");
      delBtn.style.cssText = "background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;padding:5px 10px;border-radius:8px;font-size:0.8rem;cursor:pointer;font-family:inherit;";
      delBtn.textContent = "✕";
      delBtn.title = "Delete";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (confirm("Delete this saved receipt?")) {
          BuildAuth.deleteDocument(doc.id).then(function () { loadSavedReceipts(); });
        }
      });

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  async function loadReceipt(docId) {
    var doc = await BuildAuth.getDocument(docId);
    if (!doc || !doc.formData) { alert("Could not load receipt."); return; }
    loadFormData(doc.formData);
    var form = document.querySelector(".form-card, .receipt-form, #receiptForm, main");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── Client Autocomplete ───────────────────────────────────── */

  var cachedClients = [];
  var acList = null;
  var acActiveIdx = -1;

  function initClientAutocomplete() {
    var nameInput = document.getElementById("toName");
    if (!nameInput) return;

    var parent = nameInput.parentElement;
    parent.style.position = "relative";

    acList = document.createElement("div");
    acList.className = "brc-ac-list";
    acList.id = "brc-ac-list";
    parent.appendChild(acList);

    nameInput.addEventListener("input", function () {
      if (!BuildAuth.getUser()) return;
      var query = nameInput.value.trim().toLowerCase();
      if (query.length < 1) { closeAc(); return; }
      showMatches(query);
    });

    nameInput.addEventListener("focus", function () {
      if (!BuildAuth.getUser()) return;
      var query = nameInput.value.trim().toLowerCase();
      if (query.length >= 1) showMatches(query);
    });

    nameInput.addEventListener("keydown", function (e) {
      if (!acList.classList.contains("open")) return;
      var items = acList.querySelectorAll(".brc-ac-item");
      if (e.key === "ArrowDown") { e.preventDefault(); acActiveIdx = Math.min(acActiveIdx + 1, items.length - 1); highlightAc(items); }
      else if (e.key === "ArrowUp") { e.preventDefault(); acActiveIdx = Math.max(acActiveIdx - 1, 0); highlightAc(items); }
      else if (e.key === "Enter" && acActiveIdx >= 0) { e.preventDefault(); items[acActiveIdx]?.click(); }
      else if (e.key === "Escape") { closeAc(); }
    });

    document.addEventListener("click", function (e) {
      if (!acList.contains(e.target) && e.target !== nameInput) closeAc();
    });

    BuildAuth.onAuthChange(function (user) {
      if (user) refreshClients();
      else { cachedClients = []; closeAc(); }
    });
  }

  async function refreshClients() {
    cachedClients = await BuildAuth.loadClients();
  }

  function showMatches(query) {
    var matches = cachedClients.filter(function (c) {
      return (c.name || "").toLowerCase().indexOf(query) !== -1;
    }).slice(0, 6);

    if (matches.length === 0) { closeAc(); return; }

    acActiveIdx = -1;
    acList.innerHTML = "";
    matches.forEach(function (client, idx) {
      var item = document.createElement("div");
      item.className = "brc-ac-item";
      var products = (client.usedIn || []).map(function (p) {
        return '<span class="brc-ac-badge">' + escHtml(p) + '</span>';
      }).join("");
      item.innerHTML =
        '<div class="brc-ac-name">' + escHtml(client.name) + products + '</div>' +
        (client.email ? '<div class="brc-ac-detail">' + escHtml(client.email) + (client.address ? ' · ' + escHtml(client.address) : '') + '</div>' : '');

      item.addEventListener("click", function () { selectClient(client); });
      acList.appendChild(item);
    });
    acList.classList.add("open");
  }

  function selectClient(client) {
    setVal("toName", client.name);
    if (client.email) setVal("toEmail", client.email);
    if (client.address) {
      var parts = client.address.split(", ");
      if (parts[0]) setVal("toStreet", parts[0]);
      if (parts[1]) setVal("toCity", parts[1]);
      if (parts[2]) setVal("toState", parts[2]);
    }
    closeAc();
  }

  function highlightAc(items) {
    items.forEach(function (it, i) {
      it.classList.toggle("active", i === acActiveIdx);
    });
  }

  function closeAc() {
    if (acList) { acList.classList.remove("open"); acList.innerHTML = ""; }
    acActiveIdx = -1;
  }

  /* ── Helpers ──────────────────────────────────────────────── */

  function escHtml(str) {
    var d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
})();
