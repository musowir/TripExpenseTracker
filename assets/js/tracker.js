"use strict";

// ── Constants & state ─────────────────────────────────────────────────────
const LS_TRIP_KEY = "exptracker_activeTripId_v1";
const LS_SETTLE_CAP_KEY = "exptracker_settleCapEnabled_v1";
const LS_TRIP_LOCK_KEY = "exptracker_tripLock_v1";
const LS_ACTIVE_TAB_KEY = "exptracker_activeTab_v1";
const MAX_NAME = 80;
const MAX_DESC = 255;
const MAX_AMOUNT = 10_000_000;
const RESERVED = "me";

const CURRENCY_SYMBOLS = {
    INR: "₹",
    USD: "$",
    EUR: "€",
    AED: "د.إ",
    GBP: "£",
    SGD: "S$",
    AUD: "A$",
    JPY: "¥",
    CAD: "C$",
    THB: "฿"
};

let globalCachedData = {
    expenses: [],
    categories: [],
    currency: "INR",
    budget: null,
};
let globalTripsList = [];
let globalPeopleList = [];
let currentTripId = _safeLoadTripId();
let currentCurrency = "INR";
let currentBudget = null;

function _safeLoadTripId() {
    const n = parseInt(localStorage.getItem(LS_TRIP_KEY), 10);
    return (Number.isFinite(n) && n > 0) ? n: 1;
}
function _saveTripId(id) {
    const n = parseInt(id, 10);
    if (Number.isFinite(n) && n > 0) {
        currentTripId = n; localStorage.setItem(LS_TRIP_KEY, String(n));
    }
}

function isSettleCapEnabled() {
    const val = localStorage.getItem(LS_SETTLE_CAP_KEY);
    return val === null ? true: val === "true";
}
function setSettleCap(val) {
    localStorage.setItem(LS_SETTLE_CAP_KEY, val ? "true": "false");
}

// ── Trip lock ─────────────────────────────────────────────────────────────
function _tripLockKey(id) {
    return `${LS_TRIP_LOCK_KEY}_${id || currentTripId}`;
}
function isTripLocked(id) {
    return localStorage.getItem(_tripLockKey(id)) === "true";
}
function setTripLock(val) {
    localStorage.setItem(_tripLockKey(), val ? "true" : "false");
}
function applyTripLock(locked) {
    document.body.classList.toggle("trip-locked", locked);
    const toggle = document.getElementById("tripLockToggle");
    if (toggle) toggle.checked = locked;
    // Update sync badge to show locked state persistently when locked
    const badge = document.getElementById("syncBadge");
    const text = document.getElementById("syncStatusText");
    if (badge && text && locked) {
        badge.className = "sync-status-pill locked";
        text.textContent = "Trip Locked";
    }
}

// ── Currency helper ───────────────────────────────────────────────────────
function fmt(amount) {
    const sym = CURRENCY_SYMBOLS[currentCurrency] || currentCurrency + " ";
    return `${sym}${parseFloat(amount || 0).toFixed(2)}`;
}

// ── Toast + sync badge ────────────────────────────────────────────────────
let _toastTimer = null;
let _badgeRestore = null;

function showToast(msg, type = "info") {
    let t = document.getElementById("_appToast");
    if (!t) {
        t = document.createElement("div");
        t.id = "_appToast";
        t.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;max-width:320px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.45);transition:opacity .3s;pointer-events:none";
        document.body.appendChild(t);
    }
    const palettes = {
        info: ["#1e293b", "#f1f5f9"],
        error: ["#7f1d1d", "#fca5a5"],
        success: ["#064e3b", "#6ee7b7"],
        warn: ["#78350f", "#fde68a"]
    };
    const [bg, fg] = palettes[type] || palettes.info;
    t.style.cssText += `;background:${bg};color:${fg}`;
    t.textContent = msg;
    t.style.opacity = "1";

    const badge = document.getElementById("syncBadge");
    const text = document.getElementById("syncStatusText");
    if (badge && text) {
        const prevClass = badge.className;
        const prevText = text.textContent;
        badge.className = "sync-status-pill " + (type === "error" ? "error": type === "success" ? "synced": "syncing");
        text.textContent = msg.length > 22 ? msg.slice(0, 22) + "…": msg;
        clearTimeout(_badgeRestore);
        _badgeRestore = setTimeout(() => {
            badge.className = prevClass;
            text.textContent = prevText;
        }, 3500);
    }

    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
        t.style.opacity = "0";
    }, 3500);
}

function updateSyncBadge(status, message) {
    const badge = document.getElementById("syncBadge");
    const text = document.getElementById("syncStatusText");
    if (!badge || !text) return;
    // Don't overwrite the locked state (unless we're explicitly restoring)
    if (isTripLocked() && status !== "locked" && badge.classList.contains("locked")) return;
    badge.className = "sync-status-pill " + status;
    text.textContent = message;
}

// ── Loader helpers ────────────────────────────────────────────────────────
function showLoader(label = "Fetching data") {
    const loader = document.getElementById("loader");
    const loaderLabel = document.getElementById("loaderLabel");
    if (loader) {
        if (loaderLabel) {
            // Update the label text while preserving the animated dots span
            loaderLabel.innerHTML = `${label}<span>...</span>`;
        }
        loader.classList.remove("loader-hidden");
    }
}

function hideLoader() {
    const loader = document.getElementById("loader");
    if (loader) {
        loader.classList.add("loader-hidden");
    }
}

// ── Context-aware API fetch ───────────────────────────────────────────────
async function apiFetch(url, payload = null, contextLabel = null) {
    // Auto-detect context from URL if no explicit label provided
    if (!contextLabel) {
        contextLabel = _inferContextFromUrl(url, payload);
    }
    showLoader(contextLabel);
    try {
        const opts = payload
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }: {
            method: "GET"
        };
        const res = await fetch(url, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(data?.error || `Server error (${res.status})`, "error");
            return null;
        }
        updateSyncBadge("synced", "SQLite Connected");
        return data;
    } catch {
        updateSyncBadge("error", "DB Offline");
        showToast("Network error — check server.", "error");
        return null;
    } finally {
        hideLoader();
    }
}

// ── Infer context from URL and payload ────────────────────────────────────
function _inferContextFromUrl(url, payload) {
    // Data pulls
    if (url.includes('/api/data'))           return "Loading trip data";
    if (url.includes('/api/analytics/daily')) return "Crunching daily stats";
    
    // Trip operations
    if (url.includes('/api/trips/add'))      return "Creating trip";
    if (url.includes('/api/trips/update'))   return "Saving trip settings";
    if (url.includes('/api/trips/delete'))   return "Deleting trip";
    if (url.includes('/api/trips'))          return "Loading trips";
    
    // People operations
    if (url.includes('/api/people/add'))     return "Adding member";
    if (url.includes('/api/people/delete'))  return "Removing member";
    if (url.includes('/api/people'))         return "Loading members";
    
    // Expense operations
    if (url.includes('/api/expense/add'))    return "Logging expense";
    if (url.includes('/api/expense/edit'))   return "Updating expense";
    if (url.includes('/api/expense/delete')) return "Removing expense";
    if (url.includes('/api/expense'))        return "Loading expenses";
    
    // Settlement operations
    if (url.includes('/api/pre-allocation-settlement/add'))    return "Recording settlement";
    if (url.includes('/api/pre-allocation-settlement/delete')) return "Removing settlement";
    if (url.includes('/api/pre-allocation-settlement'))        return "Loading settlements";
    
    // Category operations
    if (url.includes('/api/category/add_main'))    return "Adding category";
    if (url.includes('/api/category/add_sub'))     return "Adding sub-category";
    if (url.includes('/api/category/delete_main')) return "Deleting category";
    if (url.includes('/api/category/delete_sub'))  return "Deleting sub-category";
    if (url.includes('/api/category'))             return "Loading categories";
    
    // Clear/wipe
    if (url.includes('/api/clear'))           return "Wiping logs";
    
    // Fallback
    if (payload) return "Saving changes";
    return "Fetching data";
}

// ── Validation ────────────────────────────────────────────────────────────
const _SAFE = /^[\w\s\-'\.,&\(\)/]{1,80}$/;
function validName(v) {
    return !!(v && typeof v === "string" && _SAFE.test(v.trim()));
}
function validAmount(v) {
    const n = parseFloat(v); return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
}
function validDesc(v) {
    const s = String(v ?? "").trim(); return s.length > 0 && s.length <= MAX_DESC;
}

// ── Init ──────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
    initAppEngine();
    applyTripLock(isTripLocked());

    // Restore last active tab
    const savedTab = localStorage.getItem(LS_ACTIVE_TAB_KEY) || "view-home";
    const savedNavBtn = document.querySelector(`.nav-item[data-target="${savedTab}"]`);
    if (savedNavBtn) savedNavBtn.click();

    setDefaultDateTime();
    try {
        await pullTripsList(true);
    } catch (e) {
        console.error("Init error:", e);
        showToast("Failed to load — check server is running.", "error");
    } finally {
        hideLoader();
    }
});

function setDefaultDateTime() {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const el = document.getElementById("expDateTime");
    if (el) el.value = now.toISOString().slice(0, 16);
    const psdt = document.getElementById("pasSettleDateTime");
    if (psdt) psdt.value = now.toISOString().slice(0, 16);
}

// ── Load data helper ──────────────────────────────────────────────────────────
async function loadData() {
    await pullDatabaseState();
}

// ── Data pull ─────────────────────────────────────────────────────────────
async function pullDatabaseState() {
    try {
        const data = await apiFetch(`/api/data?trip_id=${currentTripId}`);
        if (!data) {
            showToast("Failed to load data — check server connection.", "error");
            return;
        }
        globalCachedData = data;
        currentCurrency = data.currency || "INR";
        currentBudget = data.budget || null;
        await pullPeopleList();
        renderUI();
        renderBudgetBar();
        renderDailyAnalytics();
        applyTripLock(isTripLocked());
    } catch (e) {
        console.error("pullDatabaseState error:", e);
        showToast("Error loading data", "error");
    }
}

async function pullTripsList(shouldLoad = false) {
    const data = await apiFetch("/api/trips");
    if (!data) return;
    globalTripsList = Array.isArray(data) ? data: [];
    if (globalTripsList.length > 0 && !globalTripsList.some(t => t.id === currentTripId)) {
        _saveTripId(globalTripsList[0].id);
    }
    if (globalTripsList.length === 0) {
        renderTripSelectors();
        renderTripDashboard();
        showToast("No trips found. Create one in Setup.", "warn");
        return;
    }
    renderTripSelectors();
    renderTripDashboard();
    if (shouldLoad) await pullDatabaseState();
}

async function pullPeopleList() {
    const data = await apiFetch(`/api/people?trip_id=${currentTripId}`);
    if (!data) return;
    globalPeopleList = Array.isArray(data) ? data: [];
    if (!globalPeopleList.some(p => p.name === RESERVED)) {
        globalPeopleList.unshift({ id: 0, name: RESERVED, is_active: 1 });
    }
    renderPeopleSelectors();
}


// ── Render UI ─────────────────────────────────────────────────────────────
function renderUI() {
    const expCatSel = document.getElementById("expCategory");
    const targetMainSel = document.getElementById("targetMainSelect");
    const deleteCatSel = document.getElementById("deleteMainSelect");
    if (!expCatSel || !targetMainSel) return;

    const prev = expCatSel.value;
    [expCatSel,
        targetMainSel].forEach(s => s.innerHTML = "");
    if (deleteCatSel) deleteCatSel.innerHTML = "";

    (globalCachedData?.categories || [])
    .sort((a, b) => (a.mainCat || "").localeCompare(b.mainCat || ""))
    .forEach(item => {
        if (!item.mainCat) return;
        [expCatSel,
            targetMainSel,
            deleteCatSel].forEach(sel => {
                if (!sel) return;
                const o = document.createElement("option");
                o.value = item.mainCat; o.textContent = item.mainCat;
                sel.appendChild(o);
            });
    });

    if (prev && Array.from(expCatSel.options).some(o => o.value === prev)) expCatSel.value = prev;
    if (expCatSel.value) populateSubDropdown(expCatSel.value);
    if (deleteCatSel?.value) populateDeleteSubDropdown(deleteCatSel.value);

    renderTripSelectors();
    renderLogsAndAnalytics();
    renderTripDashboard();
    setupCustomDropdownInterceptors();
}

function renderBudgetBar() {
    const card = document.getElementById("budgetCard");
    if (!card) return;
    if (!currentBudget) {
        card.style.display = "none"; return;
    }
    card.style.display = "block";

    const total = (globalCachedData?.expenses || []).reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const pct = Math.min((total / currentBudget) * 100, 100).toFixed(1);
    const over = total > currentBudget;
    const remain = currentBudget - total;

    document.getElementById("budgetTotal").textContent = fmt(currentBudget);
    document.getElementById("budgetSpent").textContent = fmt(total);
    document.getElementById("budgetRemain").textContent = over ? `Over by ${fmt(Math.abs(remain))}`: fmt(remain);
    document.getElementById("budgetPct").textContent = `${pct}%`;
    const bar = document.getElementById("budgetBarFill");
    if (bar) {
        bar.style.width = `${pct}%`;
        bar.style.background = over ? "var(--danger-muted)": pct > 80 ? "#f59e0b": "var(--accent-glow)";
    }
    const alert = document.getElementById("budgetAlert");
    if (alert) {
        alert.style.display = over ? "block": "none";
        if (over) alert.textContent = `⚠ Budget exceeded by ${fmt(Math.abs(remain))}`;
    }
}

async function renderDailyAnalytics() {
    const container = document.getElementById("dailyAnalyticsList");
    const card = document.getElementById("dailyAnalyticsCard");
    if (!container || !card) return;

    const data = await apiFetch(`/api/analytics/daily?trip_id=${currentTripId}`);
    if (!data || !data.days?.length) {
        card.style.display = "none"; return;
    }
    card.style.display = "block";
    container.innerHTML = "";

    const maxDay = Math.max(...data.days.map(d => d.total));

    document.getElementById("dailyAvg").textContent = fmt(data.average_daily);
    document.getElementById("dailyHighDay").textContent = data.highest_day?.day || "—";
    document.getElementById("dailyHighAmt").textContent = fmt(data.highest_day?.total);

    data.days.forEach(d => {
        const pct = maxDay > 0 ? ((d.total / maxDay) * 100).toFixed(0): 0;
        const isHigh = d.day === data.highest_day?.day;
        const row = document.createElement("div");
        row.style.cssText = "margin-bottom:8px";
        row.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);margin-bottom:3px">
        <span style="color:${isHigh ? "var(--accent-glow)": "var(--text-pure)"};font-weight:${isHigh ? "600": "400"}">${d.day}</span>
        <span style="color:var(--text-pure);font-weight:500">${fmt(d.total)} <span style="color:var(--text-dim)">(${d.count} entries)</span></span>
        </div>
        <div style="background:var(--bg-deep);border-radius:4px;height:6px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${isHigh ? "var(--accent-glow)": "var(--border-line)"};border-radius:4px;transition:width .4s"></div>
        </div>`;
        container.appendChild(row);
    });
}

function renderTripDashboard() {
    const grid = document.getElementById("tripDashboardGrid");
    if (!grid) return;
    grid.innerHTML = "";

    globalTripsList.forEach(trip => {
        const isActive = trip.id === currentTripId;
        const sym = CURRENCY_SYMBOLS[trip.currency] || trip.currency;
        const spend = parseFloat(trip.total_spend || 0);
        const budPct = trip.budget ? Math.min((spend / trip.budget) * 100, 100).toFixed(0): null;

        if (trip.id === currentTripId) {
            const nameEl = document.getElementById("editTripName");
            const curEl = document.getElementById("editTripCurrency");
            const budEl = document.getElementById("editTripBudget");
            if (nameEl) nameEl.value = trip.name || "";
            if (curEl) curEl.value = trip.currency || "INR";
            if (budEl) budEl.value = trip.budget || "";
        }

        const card = document.createElement("div");
        card.className = "trip-dash-card" + (isActive ? " active": "");
        card.style.position = "relative";
        card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
        <div style="font-weight:600;font-size:13px;color:var(--text-pure)">${escapeHtml(trip.name)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px">${trip.currency} · ${trip.created_at?.slice(0, 10) || ""}</div>
        </div>
        ${isActive ? `<span style="font-size:10px;padding:2px 7px;background:var(--accent-glow);color:#000;border-radius:10px;font-weight:700">Active</span>`: ""}
        </div>
        <div style="font-size:20px;font-weight:700;color:var(--accent-glow);margin-bottom:4px">${sym}${spend.toFixed(2)}</div>
        ${trip.budget ? `
        <div style="font-size:10px;color:var(--text-dim);margin-bottom:4px">Budget: ${sym}${parseFloat(trip.budget).toFixed(2)}</div>
        <div style="background:var(--bg-deep);border-radius:3px;height:4px;overflow:hidden">
        <div style="height:100%;width:${budPct}%;background:${budPct >= 100 ? "var(--danger-muted)": "var(--accent-glow)"};border-radius:3px"></div>
        </div>`: `<div style="font-size:10px;color:var(--text-dim)">No budget set</div>`}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        ${!isActive ? `<span style="font-size:11px;color:var(--accent-glow);cursor:pointer" data-switch="${trip.id}">Switch →</span>`: `<div></div>`}
        ${!isTripLocked(trip.id) ? `<span style="color:var(--danger-muted);font-size:11px;cursor:pointer;font-weight:500" class="trip-del-btn" data-id="${trip.id}">Delete</span>` : `<span style="font-size:11px;color:var(--text-dim)">Locked</span>`}
        </div>
        `;
        grid.appendChild(card);
    });

    grid.querySelectorAll("[data-switch]").forEach(el => {
        el.addEventListener("click", function () {
            _saveTripId(this.dataset.switch);
            document.getElementById("globalTripSelector").value = currentTripId;
            pullDatabaseState().then(() => {
                pullTripsList();
            });
        });
    });
    grid.querySelectorAll(".trip-del-btn").forEach(el => {
        el.addEventListener("click", () => deleteTripInstance(parseInt(el.dataset.id)));
    });

}

function renderTripSelectors() {
    const headerSel = document.getElementById("globalTripSelector");
    const settingsList = document.getElementById("tripDashboardGrid");
    if (!headerSel || !settingsList) return;

    headerSel.innerHTML = "";
    settingsList.innerHTML = "";

    globalTripsList.forEach(trip => {
        const opt = document.createElement("option");
        opt.value = trip.id; opt.textContent = trip.name;
        if (trip.id === currentTripId) opt.selected = true;
        headerSel.appendChild(opt);

        const row = document.createElement("div");
        row.className = "list-item-row";
        const isActive = trip.id === currentTripId;
        row.innerHTML = `
        <span style="font-size:13px;font-weight:${isActive?"700": "400"};color:${isActive?"var(--accent-glow)": "var(--text-pure)"}">
        ${escapeHtml(trip.name)} ${isActive ? "(Active)": ""}
        <span style="font-size:10px;color:var(--text-dim);margin-left:4px">${trip.currency}</span>
        </span>
        ${globalTripsList.length > 1 ? `<span style="color:var(--danger-muted);font-size:11px;cursor:pointer" class="del-trip-btn" data-id="${trip.id}">Delete</span>`: ""}
        `;
        settingsList.appendChild(row);
    });

    settingsList.querySelectorAll(".del-trip-btn").forEach(el => {
        el.addEventListener("click", () => deleteTripInstance(parseInt(el.dataset.id)));
    });
}

function renderPeopleSelectors() {
    const paidByDrop = document.getElementById("expPaidBy");
    const splitGrid = document.getElementById("splitConsumersContainer");
    const settingsList = document.getElementById("settingsPeopleManagementList");
    const settlePersonDrop = document.getElementById("pasPersonName");
    const settleFromDrop = document.getElementById("pasSettleFrom");
    const settleToDrop = document.getElementById("pasSettleTo");

    // Only guard the essentials; settlement dropdowns may not exist on all views
    if (!paidByDrop || !splitGrid || !settingsList) return;

    paidByDrop.innerHTML = "";
    splitGrid.innerHTML = "";
    settingsList.innerHTML = "";
    if (settlePersonDrop) settlePersonDrop.innerHTML = "";
    if (settleFromDrop) settleFromDrop.innerHTML = "";
    if (settleToDrop) settleToDrop.innerHTML = "";

    const active = globalPeopleList.filter(p => (p?.name === RESERVED || p?.is_active));
    const inactive = globalPeopleList.filter(p => p?.name !== RESERVED && !p?.is_active);
    const ordered = [{
        id: 0,
        name: RESERVED,
        is_active: 1
    },
        ...active.filter(p => p.name !== RESERVED).sort((a, b) => a.name.localeCompare(b.name))
    ];

    ordered.forEach(person => {
        // ── paidByDrop — own element ──────────────────────────────────────
        const paidOpt = document.createElement("option");
        paidOpt.value = person.name; paidOpt.textContent = person.name;
        paidByDrop.appendChild(paidOpt);

        // ── settlePersonDrop — own element ────────────────────────────────
        if (settlePersonDrop) {
            const spo = document.createElement("option");
            spo.value = person.name; spo.textContent = person.name;
            settlePersonDrop.appendChild(spo);
        }

        // ── settleFromDrop ────────────────────────────────────────────────
        if (settleFromDrop) {
            const sfo = document.createElement("option");
            sfo.value = person.name; sfo.textContent = person.name;
            settleFromDrop.appendChild(sfo);
        }

        // ── settleToDrop ──────────────────────────────────────────────────
        if (settleToDrop) {
            const sto = document.createElement("option");
            sto.value = person.name; sto.textContent = person.name;
            settleToDrop.appendChild(sto);
        }

        // ── split checkboxes ──────────────────────────────────────────────
        const lbl = document.createElement("label");
        lbl.className = "checkbox-pill-item";
        lbl.innerHTML = `<input type="checkbox" class="expense-split-checkbox" value="${escapeHtml(person.name)}" checked><span>${escapeHtml(person.name)}</span>`;
        splitGrid.appendChild(lbl);


        const hasSpend = (globalCachedData?.expenses || []).some(exp =>
            exp.paid_by === person.name || (Array.isArray(exp.split_with) && exp.split_with.includes(person.name))
        );

        const row = document.createElement("div");
        row.className = "list-item-row";
        let actionHtml;
        if (person.name === RESERVED) {
            actionHtml = `<span style="color:var(--text-dim);font-size:11px">Locked</span>`;
        } else if (hasSpend) {
            actionHtml = `<span style="color:var(--text-dim);font-size:11px" title="Has expense history on this trip">Has expenses</span>`;
        } else {
            actionHtml = `<span style="color:var(--danger-muted);font-size:11px;cursor:pointer" class="rm-person-btn" data-id="${person.id}">Remove</span>`;
        }
        row.innerHTML = `
        <span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-pure)">
        <span class="ui-icon icon-person" style="width:14px;height:14px"></span>${escapeHtml(person.name)}
        </span>
        ${actionHtml}
        `;
        settingsList.appendChild(row);
    });

    // Show soft-deleted members as greyed out
    if (inactive.length > 0) {
        const lbl = document.createElement("div");
        lbl.style.cssText = "font-size:10px;color:var(--text-dim);padding:8px 10px 2px";
        lbl.textContent = "Inactive (historical references preserved)";
        settingsList.appendChild(lbl);
        inactive.forEach(person => {
            const row = document.createElement("div");
            row.className = "list-item-row";
            row.innerHTML = `
            <span style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-dim)">
            <span class="ui-icon icon-person" style="width:14px;height:14px"></span>${escapeHtml(person.name)}
            </span>
            `;
            settingsList.appendChild(row);
        });
    }

    // Setup custom dropdown interceptors AFTER populating options
    setupCustomDropdownInterceptors();

    // Sync form previews now that dropdowns have values
    _refreshSettlementPreviews();

    // Add remove person button handlers
    document.querySelectorAll(".rm-person-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const id = parseInt(btn.dataset.id, 10);
            const person = globalPeopleList.find(p => p.id === id);
            if (!person || person.name === RESERVED) return;
            const ok = await showCustomConfirm("Remove Person", `Remove '${escapeHtml(person.name)}' from this trip?`);
            if (ok) {
                const result = await apiFetch("/api/people/delete", {
                    id, trip_id: currentTripId
                });
                if (result?.success) {
                    showToast("Person removed.", "success");
                    loadData();
                }
            }
        });
    });
}

function populateSubDropdown(mainCatName) {
    const sub = document.getElementById("expSubCategory");
    if (!sub) return;
    sub.innerHTML = "";
    const record = (globalCachedData?.categories || []).find(c => c.mainCat === mainCatName);
    if (record?.subs) {
        [...record.subs].sort().forEach(s => {
            const o = document.createElement("option"); o.value = s; o.textContent = s;
            sub.appendChild(o);
        });
    }
}

function populateDeleteSubDropdown(mainCatName) {
    const sub = document.getElementById("deleteSubSelect");
    if (!sub) return;
    sub.innerHTML = `<option value="">— select sub-category —</option>`;
    const record = (globalCachedData?.categories || []).find(c => c.mainCat === mainCatName);
    if (record?.subs) {
        [...record.subs].sort().forEach(s => {
            const o = document.createElement("option"); o.value = s; o.textContent = s;
            sub.appendChild(o);
        });
    }
}

function populateEditSubDropdown(mainCatName, currentVal) {
    const sub = document.getElementById("editExpSubCat");
    if (!sub) return;
    sub.innerHTML = "";
    const record = (globalCachedData?.categories || []).find(c => c.mainCat === mainCatName);
    if (record?.subs) {
        [...record.subs].sort().forEach(s => {
            const o = document.createElement("option"); o.value = s; o.textContent = s;
            if (s === currentVal) o.selected = true;
            sub.appendChild(o);
        });
    }
}

function renderLogsAndAnalytics() {
    const historyList = document.getElementById("historyList");
    const analyticsList = document.getElementById("analyticsList");
    const totalText = document.getElementById("totalSpend");
    const debtsList = document.getElementById("groupDebtsList");
    const personSummList = document.getElementById("personTotalsSummaryList");
    const personSummCard = document.getElementById("personTotalsSummaryCard");
    const printBody = document.getElementById("printTableLogBody");
    const printAnalytics = document.getElementById("printAnalyticsSummary");
    const printPersonTotals = document.getElementById("printPersonTotalsSummary");
    const printGrandTotal = document.getElementById("printGrandTotal");

    if (!historyList || !analyticsList || !totalText) return;
    [historyList,
        analyticsList].forEach(el => el.innerHTML = "");
    if (debtsList) debtsList.innerHTML = "";
    if (personSummList) personSummList.innerHTML = "";
    if (printBody) printBody.innerHTML = "";
    if (printAnalytics) printAnalytics.innerHTML = "";
    if (printPersonTotals) printPersonTotals.innerHTML = "";

    let grandTotal = 0;
    let reportStructure = {};
    let balanceSheet = {};
    let personTotals = {};

    globalPeopleList.forEach(p => {
        if (p?.name) {
            balanceSheet[p.name] = 0; personTotals[p.name] = 0;
        }
    });
    (globalCachedData?.categories || []).forEach(item => {
        if (!item.mainCat) return;
        reportStructure[item.mainCat] = {
            total: 0,
            subs: {},
            personShares: {}
        };
        globalPeopleList.forEach(p => {
            if (p?.name) reportStructure[item.mainCat].personShares[p.name] = 0;
        });
        (item.subs || []).forEach(s => {
            reportStructure[item.mainCat].subs[s] = 0;
        });
    });

    (globalCachedData?.expenses || []).forEach(exp => {
        const amt = parseFloat(exp.amount || 0);
        const payer = exp.paid_by || "?";
        let consumers = Array.isArray(exp.split_with) && exp.split_with.length ? exp.split_with: [RESERVED];
        const share = amt / consumers.length;
        grandTotal += amt;

        if (!(payer in balanceSheet)) balanceSheet[payer] = 0;
        balanceSheet[payer] += amt;
        consumers.forEach(c => {
            if (!(c in balanceSheet)) balanceSheet[c] = 0;
            if (!(c in personTotals)) personTotals[c] = 0;
            balanceSheet[c] -= share;
            personTotals[c] += share;
        });

        const main = exp.main_cat || "Unassigned";
        const sub = exp.sub_cat || "Unassigned";
        if (!reportStructure[main]) reportStructure[main] = {
            total: 0,
            subs: {},
            personShares: {}
        };
        reportStructure[main].total += amt;
        reportStructure[main].subs[sub] = (reportStructure[main].subs[sub] || 0) + amt;
        consumers.forEach(c => {
            reportStructure[main].personShares[c] = (reportStructure[main].personShares[c] || 0) + share;
        });

        const dateObj = new Date(exp.timestamp);
        const dispTime = isNaN(dateObj) ? "N/A": `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit"
        })}`;
        const badges = consumers.map(c => `<span style="font-size:10px;padding:2px 5px;background:var(--bg-deep);border:1px solid var(--border-line);border-radius:4px;margin-right:2px">${escapeHtml(c)}</span>`).join("");

        const card = document.createElement("div");
        card.className = "log-item";
        card.innerHTML = `
        <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:14px">${escapeHtml(exp.description)}</div>
        <div class="log-meta" style="margin-bottom:6px">
        <span>Paid by <b>${escapeHtml(payer)}</b></span> &middot;
        <span>${dispTime}</span> &middot;
        <span class="tag-pill">${escapeHtml(main)} · ${escapeHtml(sub)}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:4px">
        <span style="font-size:10px;color:var(--text-dim);align-self:center;margin-right:4px">Split:</span>${badges}
        </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px">
        <div style="font-weight:600;color:var(--text-pure);font-size:14px;margin-bottom:4px">${fmt(amt)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
        <span style="color:var(--accent-glow);font-size:11px;cursor:pointer" class="edit-exp-btn" data-id="${exp.id}">Edit</span>
        <span style="color:var(--danger-muted);font-size:11px;cursor:pointer" class="del-exp-btn" data-id="${exp.id}">Delete</span>
        </div>
        </div>`;
        historyList.appendChild(card);

        if (printBody) {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${escapeHtml(dispTime)}</td><td style="font-weight:500">${escapeHtml(exp.description)}<br><small>Payer: ${escapeHtml(payer)}</small></td><td>${consumers.map(escapeHtml).join(", ")}</td><td class="print-amount">${fmt(amt)}</td>`;
            printBody.appendChild(tr);
        }
    });

    // Apply person-to-person settlements to balance sheet
    const settled = {};
    (globalCachedData?.preAllocationSettlements || []).forEach(entry => {
        if (entry.type === "settle_up") {
            const person = entry.from_person;
            const to = entry.to_person;
            const amount = parseFloat(entry.amount || 0);
            if (!(person in settled)) settled[person] = 0;
            if (!(to in settled)) settled[to] = 0;
            settled[person] += amount;
            settled[to] -= amount;
        }
    });

    // Apply person-to-person settlements
    Object.entries(settled).forEach(([person, delta]) => {
        if (!(person in balanceSheet)) balanceSheet[person] = 0;
        balanceSheet[person] += delta;
    });

    historyList.querySelectorAll(".del-exp-btn").forEach(el =>
        el.addEventListener("click", () => deleteExpenseEntry(parseInt(el.dataset.id)))
    );
    historyList.querySelectorAll(".edit-exp-btn").forEach(el =>
        el.addEventListener("click", () => openEditExpenseModal(parseInt(el.dataset.id)))
    );

    totalText.textContent = fmt(grandTotal);
    if (printGrandTotal) printGrandTotal.textContent = fmt(grandTotal);

    // Debt settlement
    if (debtsList) {
        const groupCard = document.getElementById("groupBreakdownCard");
        let debtors = [],
        creditors = [];

        Object.entries(balanceSheet).forEach(([name, bal]) => {
            if (bal < -0.01) debtors.push({
                name, balance: Math.abs(bal)
            });
            else if (bal > 0.01) creditors.push({
                name, balance: bal
            });
        });

        // Person-to-person debt settlement
        const dCopy = debtors.map(x => ({
            ...x
        }));
        const cCopy = creditors.map(x => ({
            ...x
        }));
        let d = 0, c = 0;
        while (d < dCopy.length && c < cCopy.length) {
            const settle = Math.min(dCopy[d].balance, cCopy[c].balance);
            dCopy[d].balance -= settle;
            cCopy[c].balance -= settle;
            const row = document.createElement("div");
            row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-line)";
            row.innerHTML = `<span><span class="ui-icon icon-arrow-right" style="color:var(--danger-muted);width:14px;height:14px"></span> <b>${escapeHtml(dCopy[d].name)}</b> owes <b>${escapeHtml(cCopy[c].name)}</b></span><span style="color:var(--danger-muted);font-weight:600">${fmt(settle)}</span>`;
            debtsList.appendChild(row);
            if (dCopy[d].balance <= 0.01) d++;
            if (cCopy[c].balance <= 0.01) c++;
        }

        if (!debtsList.children.length) debtsList.innerHTML = `<p style="color:var(--success-glow);text-align:center;font-size:12px;margin:4px 0">🎉 All squared up!</p>`;
        if (groupCard) groupCard.style.display = globalPeopleList.length > 0 ? "block": "none";
    }

    // Analytics
    Object.entries(reportStructure).forEach(([main, data]) => {
        if (data.total <= 0) return;
        const pct = grandTotal > 0 ? ((data.total / grandTotal) * 100).toFixed(0): 0;
        let subHtml = "",
        shareHtml = "";
        Object.entries(data.subs).forEach(([s, a]) => {
            if (a <= 0) return;
            const sp = ((a / data.total) * 100).toFixed(0);
            subHtml += `<div class="sub-metric-row"><span>↳ ${escapeHtml(s)} <span style="color:var(--text-dim);font-size:9px">(${sp}%)</span></span><span>${fmt(a)}</span></div>`;
        });
        Object.entries(data.personShares).forEach(([name, s]) => {
            if (s < 0.01) return;
            shareHtml += `<span class="person-spend-badge"><b>${escapeHtml(name)}</b>: ${fmt(s)}</span>`;
        });
        const div = document.createElement("div");
        div.className = "chart-row";
        div.innerHTML = `
        <div class="chart-labels">
        <span style="color:var(--text-pure);font-size:12px">${escapeHtml(main)} <span style="color:var(--text-dim);font-size:10px">${pct}%</span></span>
        <strong style="font-weight:500">${fmt(data.total)}</strong>
        </div>
        <div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%"></div></div>
        <div class="sub-metrics-list">${subHtml}</div>
        <div class="person-spend-badge-container">${shareHtml || `<span class="person-spend-badge" style="border:none;padding:0">No individual shares</span>`}</div>`;
        analyticsList.appendChild(div);

        // Also populate print analytics
        if (printAnalytics) {
            const printDiv = document.createElement("div");
            printDiv.className = "print-chart-row";
            let printSubHtml = "";
            Object.entries(data.subs).forEach(([s, a]) => {
                if (a <= 0) return;
                const sp = ((a / data.total) * 100).toFixed(0);
                printSubHtml += `<div class="print-sub-row"><span>↳ ${escapeHtml(s)} (${sp}%)</span><span>${fmt(a)}</span></div>`;
            });
            printDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <strong>${escapeHtml(main)} (${pct}%)</strong>
            <strong>${fmt(data.total)}</strong>
            </div>
            ${printSubHtml}`;
            printAnalytics.appendChild(printDiv);
        }
    });

    // Person totals
    if (personSummList && personSummCard) {
        const sorted = Object.keys(personTotals).filter(n => personTotals[n] > 0)
        .sort((a, b) => personTotals[b] - personTotals[a]);
        personSummCard.style.display = sorted.length ? "block": "none";
        sorted.forEach(name => {
            const row = document.createElement("div");
            row.className = "summary-total-row";
            row.innerHTML = `<span style="display:flex;align-items:center;gap:8px"><span class="ui-icon icon-person" style="width:14px;height:14px"></span><b>${escapeHtml(name)}</b></span><span style="color:var(--accent-glow);font-weight:600">${fmt(personTotals[name])}</span>`;
            personSummList.appendChild(row);
        });
    }

    // Print person totals
    if (printPersonTotals) {
        const sorted = Object.keys(personTotals).filter(n => personTotals[n] > 0)
        .sort((a, b) => personTotals[b] - personTotals[a]);
        sorted.forEach(name => {
            const row = document.createElement("div");
            row.className = "print-chart-row";
            row.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #e5e7eb">
            <span><strong>${escapeHtml(name)}</strong></span>
            <span style="font-weight:600">${fmt(personTotals[name])}</span>
            </div>`;
            printPersonTotals.appendChild(row);
        });
        if (!sorted.length) {
            printPersonTotals.innerHTML = `<p style="color:#9ca3af;font-size:12px;padding:8px 0">No individual spending recorded.</p>`;
        }
    }

    if (!globalCachedData?.expenses?.length) {
        historyList.innerHTML = `<p style="color:var(--text-dim);text-align:center;font-size:12px;padding:20px 0">No logs yet.</p>`;
        analyticsList.innerHTML = `<p style="color:var(--text-dim);text-align:center;font-size:12px;padding:16px 0">No metrics yet.</p>`;
        if (personSummCard) personSummCard.style.display = "none";
    }

    // Render pre-allocation and settlement log
    renderPreAllocSettlementLog();
}

// ── Render settlement log ──────────────────────────────────────────────────
function renderPreAllocSettlementLog() {
    const container = document.getElementById("preAllocSettleList");
    const card = document.getElementById("preAllocSettleCard");
    if (!container || !card) return;

    const entries = (globalCachedData?.preAllocationSettlements || []).filter(e => e.type === "settle_up");
    container.innerHTML = "";
    card.style.display = entries.length ? "block": "none";

    if (!entries.length) return;

    entries.forEach(entry => {
        const dateObj = new Date(entry.timestamp);
        const dispTime = isNaN(dateObj) ? "N/A": `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], {
            hour: "2-digit", minute: "2-digit"
        })}`;

        const div = document.createElement("div");
        div.className = "log-item";
        div.innerHTML = `
        <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:14px;display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="background:rgba(16,185,129,0.1);color:var(--success-glow);border:1px solid var(--success-glow);padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600">Settlement</span>
        <span>${escapeHtml(entry.from_person)}</span>
        <span style="color:var(--success-glow)">→</span>
        <span>${escapeHtml(entry.to_person)}</span>
        </div>
        <div class="log-meta" style="margin-bottom:4px">
        <span>${dispTime}</span>
        ${entry.notes ? `&middot; <span style="color:var(--text-dim);font-style:italic">${escapeHtml(entry.notes)}</span>`: ""}
        </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:8px">
        <div style="font-weight:600;color:var(--success-glow);font-size:14px;margin-bottom:4px">${fmt(entry.amount)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
        <span style="color:var(--danger-muted);font-size:11px;cursor:pointer" class="del-settlement-btn" data-id="${entry.id}">Delete</span>
        </div>
        </div>`;
        container.appendChild(div);
    });

    // Add event listeners
    container.querySelectorAll(".del-settlement-btn").forEach(el =>
        el.addEventListener("click", () => deletePreAllocSettlement(parseInt(el.dataset.id)))
    );
}


// ── Refresh settlement preview after dropdown repopulation ──────────────────
function _refreshSettlementPreviews() {
    // Settlement: show current from → to
    const fromSel = document.getElementById("pasSettleFrom");
    const toSel = document.getElementById("pasSettleTo");
    const settlePreview = document.getElementById("pasSettlePreview");
    const settleFrom = document.getElementById("pasSettleFromPreview");
    const settleTo = document.getElementById("pasSettleToPreview");
    if (fromSel && toSel && settlePreview && settleFrom && settleTo && fromSel.value && toSel.value) {
        settlePreview.style.display = 'flex';
        settleFrom.textContent = fromSel.options[fromSel.selectedIndex].text;
        settleTo.textContent = toSel.options[toSel.selectedIndex].text;
    }
}

// ── Pre-allocation & Settlement form ────────────────────────────────────────
function setupPreAllocSettleForm() {
    // Set current date/time
    const settleDateTime = document.getElementById("pasSettleDateTime");
    if (settleDateTime && !settleDateTime.value) {
        const now = new Date();
        settleDateTime.value = now.toISOString().slice(0, 16);
    }

    // SETTLEMENT FORM
    const settleForm = document.getElementById("preAllocSettleForm-settlement");
    if (settleForm) {

        function _computeOwedAmount(fromPerson, toPerson) {
            if (!fromPerson || !toPerson || fromPerson === toPerson) return 0;
            const balanceSheet = {};
            globalPeopleList.forEach(p => {
                if (p?.name) balanceSheet[p.name] = 0;
            });
            (globalCachedData?.expenses || []).forEach(exp => {
                const amt = parseFloat(exp.amount || 0);
                const payer = exp.paid_by || "?";
                const consumers = Array.isArray(exp.split_with) && exp.split_with.length ? exp.split_with: [RESERVED];
                const share = amt / consumers.length;
                if (!(payer in balanceSheet)) balanceSheet[payer] = 0;
                balanceSheet[payer] += amt;
                consumers.forEach(c => {
                    if (!(c in balanceSheet)) balanceSheet[c] = 0;
                    balanceSheet[c] -= share;
                });
            });
            (globalCachedData?.preAllocationSettlements || []).forEach(entry => {
                if (entry.type === "settle_up") {
                    const amt = parseFloat(entry.amount || 0);
                    if (!(entry.from_person in balanceSheet)) balanceSheet[entry.from_person] = 0;
                    if (!(entry.to_person in balanceSheet)) balanceSheet[entry.to_person] = 0;
                    balanceSheet[entry.from_person] += amt;
                    balanceSheet[entry.to_person] -= amt;
                }
            });
            let debtors = [], creditors = [];
            Object.entries(balanceSheet).forEach(([name, bal]) => {
                if (bal < -0.01) debtors.push({
                    name, balance: Math.abs(bal)
                });
                else if (bal > 0.01) creditors.push({
                    name, balance: bal
                });
            });
            const dCopy = debtors.map(x => ({
                ...x
            }));
            const cCopy = creditors.map(x => ({
                ...x
            }));
            let d = 0, c = 0;
            while (d < dCopy.length && c < cCopy.length) {
                const settle = Math.min(dCopy[d].balance, cCopy[c].balance);
                if (dCopy[d].name === fromPerson && cCopy[c].name === toPerson) {
                    return Math.round(settle * 100) / 100;
                }
                dCopy[d].balance -= settle;
                cCopy[c].balance -= settle;
                if (dCopy[d].balance <= 0.01) d++;
                if (cCopy[c].balance <= 0.01) c++;
            }
            return 0;
        }

        const updateSettlePreview = () => {
            const fromSel = document.getElementById("pasSettleFrom");
            const toSel = document.getElementById("pasSettleTo");
            const preview = document.getElementById("pasSettlePreview");
            const previewFrom = document.getElementById("pasSettleFromPreview");
            const previewTo = document.getElementById("pasSettleToPreview");
            const amountInput = document.getElementById("pasSettleAmount");
            if (!fromSel || !toSel || !preview || !previewFrom || !previewTo) return;

            if (fromSel.value && toSel.value) {
                preview.style.display = 'flex';
                previewFrom.textContent = fromSel.options[fromSel.selectedIndex].text;
                previewTo.textContent = toSel.options[toSel.selectedIndex].text;

                const owed = _computeOwedAmount(fromSel.value, toSel.value);
                if (amountInput) {
                    let hint = document.getElementById("_settleAmountHint");
                    if (!hint) {
                        hint = document.createElement("div");
                        hint.id = "_settleAmountHint";
                        hint.style.cssText = "font-size:11px;margin-top:4px";
                        amountInput.parentNode.appendChild(hint);
                    }
                    if (owed > 0) {
                        amountInput.value = owed.toFixed(2);
                        const cap = isSettleCapEnabled();
                        if (cap) {
                            amountInput.max = owed.toFixed(2);
                            hint.style.color = "var(--accent-glow)";
                            hint.textContent = `Max: ${fmt(owed)} (full amount owed)`;
                        } else {
                            amountInput.removeAttribute("max");
                            hint.style.color = "var(--text-dim)";
                            hint.textContent = `Suggested: ${fmt(owed)} (full amount owed)`;
                        }
                    } else {
                        amountInput.value = "";
                        amountInput.removeAttribute("max");
                        hint.style.color = "var(--text-dim)";
                        hint.textContent = fromSel.value === toSel.value ? "": `${fromSel.options[fromSel.selectedIndex].text} doesn't owe ${toSel.options[toSel.selectedIndex].text} anything.`;
                    }
                }
            } else {
                preview.style.display = 'none';
            }
        };

        document.getElementById("pasSettleFrom")?.addEventListener("change", updateSettlePreview);
        document.getElementById("pasSettleTo")?.addEventListener("change", updateSettlePreview);
        updateSettlePreview();

        settleForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const from_person = document.getElementById("pasSettleFrom").value;
            const to_person = document.getElementById("pasSettleTo").value;
            const amount = parseFloat(document.getElementById("pasSettleAmount").value);
            const timestamp = document.getElementById("pasSettleDateTime").value;
            const notes = document.getElementById("pasSettleNotes").value.trim() || null;

            if (!validName(from_person)) {
                showToast("Select payer.", "error"); return;
            }
            if (!validName(to_person)) {
                showToast("Select receiver.", "error"); return;
            }
            if (from_person === to_person) {
                showToast("Payer and receiver must be different.", "error"); return;
            }
            if (amount <= 0) {
                showToast("Enter a valid amount.", "error"); return;
            }

            if (isSettleCapEnabled()) {
                const maxOwed = _computeOwedAmount(from_person, to_person);
                if (maxOwed <= 0) {
                    showToast(`${from_person} doesn't owe ${to_person} anything.`, "error"); return;
                }
                if (amount > maxOwed + 0.005) {
                    showToast(`Can't settle more than ${fmt(maxOwed)} — that's all ${from_person} owes ${to_person}.`, "error"); return;
                }
            }

            const result = await apiFetch("/api/pre-allocation-settlement/add", {
                to_person: to_person,
                from_person: from_person,
                type: "settle_up",
                amount: amount,
                timestamp: timestamp,
                notes: notes,
                trip_id: currentTripId
            });

            if (result?.success) {
                // Trigger celebration animation
               if (typeof PartyFaceCelebration !== 'undefined') {
                    PartyFaceCelebration.celebrateFull(); 
                }
                
                showToast("Settlement recorded!", "success");
                settleForm.reset();
                const now = new Date();
                settleDateTime.value = now.toISOString().slice(0, 16);
                loadData();
            }
        });
    }
}

// ── Delete pre-allocation/settlement ────────────────────────────────────────
async function deletePreAllocSettlement(id) {
    const ok = await showCustomConfirm("Delete Settlement",
        "Remove this settlement entry?");
    if (!ok) return;
    const result = await apiFetch("/api/pre-allocation-settlement/delete", {
        id
    });
    if (result?.success) {
        showToast("Entry deleted!", "success");
        loadData();
    }
}



// ── Edit expense modal ────────────────────────────────────────────────────
function openEditExpenseModal(expId) {
    const exp = globalCachedData?.expenses?.find(e => e.id === expId);
    if (!exp) return;

    const modal = document.getElementById("editExpenseModal");
    if (!modal) return;

    document.getElementById("editExpId").value = exp.id;
    document.getElementById("editExpDesc").value = exp.description;
    document.getElementById("editExpAmount").value = exp.amount;
    document.getElementById("editExpDateTime").value = exp.timestamp?.slice(0, 16) || "";

    // Populate payer dropdown
    const paidBySel = document.getElementById("editExpPaidBy");
    paidBySel.innerHTML = "";
    const people = [{
        name: RESERVED
    },
        ...globalPeopleList.filter(p => p.name !== RESERVED && p.is_active).sort((a, b) => a.name.localeCompare(b.name))
    ];
    people.forEach(p => {
        const o = document.createElement("option");
        o.value = p.name; o.textContent = p.name;
        if (p.name === exp.paid_by) o.selected = true;
        paidBySel.appendChild(o);
    });

    // Populate category
    const catSel = document.getElementById("editExpCat");
    catSel.innerHTML = "";
    (globalCachedData?.categories || []).forEach(c => {
        const o = document.createElement("option");
        o.value = c.mainCat; o.textContent = c.mainCat;
        if (c.mainCat === exp.main_cat) o.selected = true;
        catSel.appendChild(o);
    });
    populateEditSubDropdown(exp.main_cat,
        exp.sub_cat);

    // Populate split checkboxes
    const splitGrid = document.getElementById("editSplitGrid");
    splitGrid.innerHTML = "";
    people.forEach(p => {
        const lbl = document.createElement("label");
        lbl.className = "checkbox-pill-item";
        lbl.innerHTML = `<input type="checkbox" class="edit-split-cb" value="${escapeHtml(p.name)}" ${(exp.split_with || []).includes(p.name) ? "checked": ""}><span>${escapeHtml(p.name)}</span>`;
        splitGrid.appendChild(lbl);
    });

    modal.classList.add("active");
}

// ── App engine ────────────────────────────────────────────────────────────
function initAppEngine() {
    // Settings accordion
    document.querySelectorAll("[data-accordion] > .accordion-head").forEach(head => {
        head.addEventListener("click", () => {
            head.closest("[data-accordion]")?.classList.toggle("open");
        });
    });

    // Nav
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
            document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
            this.classList.add("active");
            const tid = this.getAttribute("data-target");
            document.getElementById(tid)?.classList.add("active");
            localStorage.setItem(LS_ACTIVE_TAB_KEY, tid);
            const labels = {
                "view-home": "Log", "view-group": "Splits", "view-history": "History", "view-analytics": "Analytics", "view-settings": "Setup"
            };
            const h = document.querySelector("header h1");
            if (h) h.textContent = labels[tid] || "";
            if (tid === "view-dashboard") renderTripDashboard();

            // Pre-fill "This Trip" form when settings tab is opened
            if (tid === "view-settings") {
                const trip = globalTripsList.find(t => t.id === currentTripId);
                if (trip) {
                    const nameEl = document.getElementById("editTripName");
                    const curEl = document.getElementById("editTripCurrency");
                    const budEl = document.getElementById("editTripBudget");
                    if (nameEl) nameEl.value = trip.name || "";
                    if (curEl) curEl.value = trip.currency || "INR";
                    if (budEl) budEl.value = trip.budget || "";
                }
            }
        });
    });

    // Trip selector
    document.getElementById("globalTripSelector")?.addEventListener("change", function () {
        _saveTripId(this.value);
        pullDatabaseState().then(() => {
            // Re-render dashboard if it's currently active
            if (document.getElementById("view-dashboard")?.classList.contains("active")) {
                renderTripDashboard();
            }
        });
    });

    // ── Settlement cap toggle ──────────────────────────────────────────────
    const settleCapToggle = document.getElementById("settleCapToggle");
    if (settleCapToggle) {
        settleCapToggle.checked = isSettleCapEnabled();
        settleCapToggle.addEventListener("change", function () {
            setSettleCap(this.checked);
            showToast(this.checked ? "Settlement cap enabled.": "Settlement cap disabled.", "info");
        });
    }

    // ── Trip lock toggle ───────────────────────────────────────────────────
    const tripLockToggle = document.getElementById("tripLockToggle");
    if (tripLockToggle) {
        applyTripLock(isTripLocked());
        tripLockToggle.addEventListener("change", function () {
            setTripLock(this.checked);
            applyTripLock(this.checked);
            if (!this.checked) {
                // Restore the badge to its normal connected state when unlocking
                updateSyncBadge("synced", "SQLite Connected");
            }
            showToast(
                this.checked
                    ? "Trip locked — all edits disabled."
                    : "Trip unlocked — edits re-enabled.",
                this.checked ? "warn" : "success"
            );
        });
    }

    // Category sub-dropdown chain
    document.getElementById("expCategory")?.addEventListener("change", function () {
        populateSubDropdown(this.value);
    });
    document.getElementById("deleteMainSelect")?.addEventListener("change", function () {
        populateDeleteSubDropdown(this.value);
    });
    document.getElementById("editExpCat")?.addEventListener("change", function () {
        populateEditSubDropdown(this.value,
            "");
    });

    // ── Add trip ───────────────────────────────────────────────────────────
    document.getElementById("addTripBtn")?.addEventListener("click", async () => {
        const nameInput = document.getElementById("newTripInput");
        const currency = document.getElementById("newTripCurrency")?.value || "INR";
        const budgetEl = document.getElementById("newTripBudget");
        const name = nameInput?.value.trim();
        const budget = budgetEl?.value ? parseFloat(budgetEl.value): null;

        if (!validName(name)) return showToast("Invalid trip name.", "error");
        if (budget !== null && !validAmount(budget)) return showToast("Invalid budget amount.", "error");

        const data = await apiFetch("/api/trips/add", {
            name, currency, budget
        });
        if (data?.id) {
            nameInput.value = ""; if (budgetEl) budgetEl.value = "";
            _saveTripId(data.id);
            await pullTripsList(true);
            showToast(`Trip "${name}" created.`, "success");
        }
    });

    // ── Edit trip (budget/currency) ────────────────────────────────────────
    document.getElementById("saveTripSettingsBtn")?.addEventListener("click",
        async () => {
            const trip = globalTripsList.find(t => t.id === currentTripId);
            if (!trip) return;
            const name = document.getElementById("editTripName")?.value.trim() || trip.name;
            const currency = document.getElementById("editTripCurrency")?.value || "INR";
            const budgetEl = document.getElementById("editTripBudget");
            const budget = budgetEl?.value ? parseFloat(budgetEl.value): null;

            if (!validName(name)) return showToast("Invalid trip name.", "error");
            const data = await apiFetch("/api/trips/update", {
                id: currentTripId, name, currency, budget
            });
            if (data) {
                await pullTripsList(true); showToast("Trip settings saved.", "success");
            }
        });

    // ── Add person ─────────────────────────────────────────────────────────
    document.getElementById("addPersonBtn")?.addEventListener("click",
        async () => {
            const input = document.getElementById("newPersonInput");
            const name = input?.value.trim();
            if (!validName(name)) return showToast("Invalid name.", "error");
            if (name.toLowerCase() === RESERVED) return showToast(`"${RESERVED}" is reserved.`, "error");
            const data = await apiFetch("/api/people/add", {
                trip_id: currentTripId, name
            });
            if (data) {
                input.value = ""; await pullPeopleList(); showToast(`${name} added.`, "success");
            }
        });

    // ── Expense form ───────────────────────────────────────────────────────
    document.getElementById("expenseForm")?.addEventListener("submit",
        async function (e) {
            e.preventDefault();
            const paidBy = document.getElementById("expPaidBy")?.value;
            const splitWith = Array.from(document.querySelectorAll(".expense-split-checkbox:checked")).map(cb => cb.value);
            const timestamp = document.getElementById("expDateTime")?.value;
            const desc = document.getElementById("expDesc")?.value.trim();
            const amount = document.getElementById("expAmount")?.value;
            const mainCat = document.getElementById("expCategory")?.value;
            const subCat = document.getElementById("expSubCategory")?.value;

            if (!validDesc(desc)) return showToast("Description required.", "error");
            if (!validAmount(amount)) return showToast("Invalid amount.", "error");
            if (!paidBy) return showToast("Select a payer.", "error");
            if (!mainCat || !subCat) return showToast("Select a category.", "error");

            const data = await apiFetch("/api/expense/add", {
                desc, amount, mainCat, subCat, timestamp, paidBy,
                trip_id: currentTripId, splitWith: splitWith.length ? splitWith: [RESERVED]
            });
            if (data) {
                document.getElementById("expDesc").value = "";
                document.getElementById("expAmount").value = "";
                setDefaultDateTime();
                await pullTripsList(true);
                showToast("Expense logged.", "success");
            }
        });

    // ── Edit expense form ──────────────────────────────────────────────────
    document.getElementById("editExpenseForm")?.addEventListener("submit",
        async function (e) {
            e.preventDefault();
            const expId = parseInt(document.getElementById("editExpId").value);
            const desc = document.getElementById("editExpDesc")?.value.trim();
            const amount = document.getElementById("editExpAmount")?.value;
            const timestamp = document.getElementById("editExpDateTime")?.value;
            const paidBy = document.getElementById("editExpPaidBy")?.value;
            const mainCat = document.getElementById("editExpCat")?.value;
            const subCat = document.getElementById("editExpSubCat")?.value;
            const splitWith = Array.from(document.querySelectorAll(".edit-split-cb:checked")).map(cb => cb.value);

            if (!validDesc(desc)) return showToast("Description required.", "error");
            if (!validAmount(amount)) return showToast("Invalid amount.", "error");
            if (!paidBy) return showToast("Select a payer.", "error");

            const data = await apiFetch("/api/expense/edit", {
                id: expId, desc, amount, mainCat, subCat, timestamp, paidBy,
                splitWith: splitWith.length ? splitWith: [RESERVED]
            });
            if (data) {
                document.getElementById("editExpenseModal")?.classList.remove("active");
                await pullTripsList(true);
                showToast("Expense updated.", "success");
            }
        });

    document.getElementById("cancelEditExpBtn")?.addEventListener("click",
        () => {
            document.getElementById("editExpenseModal")?.classList.remove("active");
        });

    document.getElementById("cancelEditExpBtn2")?.addEventListener("click",
        () => {
            document.getElementById("editExpenseModal")?.classList.remove("active");
        });

    // ── Categories ─────────────────────────────────────────────────────────
    document.getElementById("addMainBtn")?.addEventListener("click",
        async () => {
            const input = document.getElementById("newMainInput");
            const mainCat = input?.value.trim();
            if (!validName(mainCat)) return showToast("Invalid category name.", "error");
            const data = await apiFetch("/api/category/add_main", {
                mainCat
            });
            if (data) {
                input.value = ""; await pullDatabaseState(); showToast("Category added.", "success");
            }
        });

    document.getElementById("addSubBtn")?.addEventListener("click",
        async () => {
            const mainTarget = document.getElementById("targetMainSelect")?.value;
            const input = document.getElementById("newSubInput");
            const subName = input?.value.trim();
            if (!mainTarget) return showToast("Select a main category.", "error");
            if (!validName(subName)) return showToast("Invalid sub-category name.", "error");
            const data = await apiFetch("/api/category/add_sub", {
                mainCat: mainTarget, subCat: subName
            });
            if (data) {
                input.value = ""; await pullDatabaseState(); showToast("Sub-category added.", "success");
            }
        });

    document.getElementById("deleteMainCatBtn")?.addEventListener("click",
        async () => {
            const mainCat = document.getElementById("deleteMainSelect")?.value;
            if (!mainCat) return showToast("Select a category to delete.", "error");
            const ok = await showCustomConfirm("Delete Category", `Delete "${mainCat}" and all its sub-categories? Expenses using this category must be reassigned first.`);
            if (!ok) return;
            const data = await apiFetch("/api/category/delete_main", {
                mainCat
            });
            if (data) {
                await pullDatabaseState(); showToast(`"${mainCat}" deleted.`, "success");
            }
        });

    document.getElementById("deleteSubCatBtn")?.addEventListener("click",
        async () => {
            const mainCat = document.getElementById("deleteMainSelect")?.value;
            const subCat = document.getElementById("deleteSubSelect")?.value;
            if (!mainCat || !subCat) return showToast("Select a main and sub-category.", "error");
            const ok = await showCustomConfirm("Delete Sub-Category", `Delete "${subCat}" from "${mainCat}"?`);
            if (!ok) return;
            const data = await apiFetch("/api/category/delete_sub", {
                mainCat, subCat
            });
            if (data) {
                await pullDatabaseState(); showToast(`"${subCat}" deleted.`, "success");
            }
        });

    // ── PDF ────────────────────────────────────────────────────────────────
    document.getElementById("pdfBtn")?.addEventListener("click",
        () => {
            if (!globalCachedData?.expenses?.length) {
                showToast("No expenses to export. Add some expenses first.", "error");
                return;
            }

            const now = new Date();
            const sel = document.getElementById("globalTripSelector");
            const tripName = sel?.options[sel.selectedIndex]?.text || "Trip";
            const dateStr = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], {
                hour: "2-digit", minute: "2-digit"
            })}`;

            // Stamp title and date into the already-populated print container
            const titleEl = document.getElementById("printReportTitle");
            const dateEl = document.getElementById("printGenerationDate");
            if (titleEl) titleEl.textContent = `${tripName} — Trip Summary`;
            if (dateEl) dateEl.textContent = `Generated: ${dateStr}`;

            // Temporarily set document.title so browser uses it as the PDF filename
            const prevTitle = document.title;
            const dateSuffix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            document.title = `${tripName}_${dateSuffix}`;
            window.print();
            document.title = prevTitle;
        });

    // ── Export JSON ────────────────────────────────────────────────────────
    document.getElementById("exportBtn")?.addEventListener("click",
        () => {
            exportDataSnapshot();
        });

    // ── Pre-allocation & Settlement form (setup once on page load) ──────────
    setupPreAllocSettleForm();
}

// ── CRUD helpers ──────────────────────────────────────────────────────────
async function deleteTripInstance(id) {
    const ok = await showCustomConfirm("Delete Trip",
        "Permanently delete all logs for this trip?");
    if (!ok) return;
    const data = await apiFetch("/api/trips/delete", {
        id
    });
    if (data) {
        if (currentTripId === id) localStorage.removeItem(LS_TRIP_KEY);
        await pullTripsList(true);
        showToast("Trip deleted.", "success");
    }
}

async function deletePersonInstance(id) {
    const person = globalPeopleList.find(p => p.id === id);
    const name = person?.name;
    const hasSpend = name && (globalCachedData?.expenses || []).some(exp =>
        exp.paid_by === name || (Array.isArray(exp.split_with) && exp.split_with.includes(name))
    );
    if (hasSpend) {
        return showToast(`${name} has expenses on this trip — remove those first, or leave ${name} as a member.`, "error");
    }
    const ok = await showCustomConfirm("Remove Member", "Soft-remove this person? Their historical expenses are preserved.");
    if (!ok) return;
    const data = await apiFetch("/api/people/delete", {
        id
    });
    if (data) {
        await pullDatabaseState(); showToast("Member removed (historical data intact).", "success");
    }
}

async function restorePersonInstance(name) {
    const data = await apiFetch("/api/people/add", {
        trip_id: currentTripId, name
    });
    if (data) {
        await pullPeopleList(); showToast(`${name} restored.`, "success");
    }
}

async function deleteExpenseEntry(id) {
    const ok = await showCustomConfirm("Delete Expense", "Remove this expense entry?");
    if (!ok) return;
    const data = await apiFetch("/api/expense/delete", {
        id
    });
    if (data) {
        await pullTripsList(true); showToast("Entry deleted.", "success");
    }
}

async function clearAllDatabaseLogs() {
    const ok = await showCustomConfirm("Wipe Logs", "Delete ALL expense logs for this trip?");
    if (!ok) return;
    const data = await apiFetch("/api/clear", {
        trip_id: currentTripId
    });
    if (data) {
        await pullTripsList(true); showToast("Logs wiped.", "success");
    }
}

function exportDataSnapshot() {
    const sel = document.getElementById("globalTripSelector");
    const tripName = sel?.options[sel.selectedIndex]?.text || "trip";
    const trip = globalTripsList.find(t => t.id === currentTripId) || {};

    const payload = {
        _export_version: 1,
        _exported_at: new Date().toISOString(),

        trip: {
            id: currentTripId,
            name: trip.name || tripName,
            currency: trip.currency || globalCachedData.currency || "INR",
            budget: trip.budget ?? globalCachedData.budget ?? null,
            created_at: trip.created_at || null,
            total_spend: trip.total_spend ?? null,
        },

        people: globalPeopleList.map(p => ({
            id: p.id,
            name: p.name,
            is_active: p.is_active ?? 1,
        })),

        categories: (globalCachedData.categories || []).map(c => ({
            mainCat: c.mainCat,
            subs: c.subs || [],
        })),

        expenses: (globalCachedData.expenses || []).map(e => ({
            id: e.id,
            description: e.description,
            amount: e.amount,
            main_cat: e.main_cat,
            sub_cat: e.sub_cat,
            timestamp: e.timestamp,
            paid_by: e.paid_by,
            split_with: Array.isArray(e.split_with) ? e.split_with: [],
        })),
    };

    const now = new Date();
    const ds = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const filename = `${tripName.replace(/\s+/g, "_")}_${ds}.json`;

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Snapshot exported.", "success");
}

// ── Confirm modal ─────────────────────────────────────────────────────────
function showCustomConfirm(title, message) {
    return new Promise(resolve => {
        const modal = document.getElementById("customModal");
        const btnOk = document.getElementById("customModalConfirmBtn");
        const btnNo = document.getElementById("customModalCancelBtn");
        document.getElementById("customModalTitle").textContent = title;
        document.getElementById("customModalMessage").textContent = message;
        modal.classList.add("active");
        function done(val) {
            btnOk.removeEventListener("click", onOk);
            btnNo.removeEventListener("click", onNo);
            modal.classList.remove("active");
            resolve(val);
        }
        const onOk = () => done(true);
        const onNo = () => done(false);
        btnOk.addEventListener("click", onOk);
        btnNo.addEventListener("click", onNo);
    });
}

// ── Custom select drawer ──────────────────────────────────────────────────
function setupCustomDropdownInterceptors() {
    ["#globalTripSelector",
        "#expPaidBy",
        "#expCategory",
        "#expSubCategory",
        "#targetMainSelect",
        "#deleteMainSelect",
        "#deleteSubSelect",
        "#editExpPaidBy",
        "#editExpCat",
        "#editExpSubCat",
        "#pasSettleFrom",
        "#pasSettleTo"].forEach(sel => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.removeEventListener("mousedown", _onDropdown);
            el.addEventListener("mousedown", _onDropdown);
        });
}

function _onDropdown(e) {
    e.preventDefault(); this.blur(); _openDrawer(this);
}

function _openDrawer(sel) {
    const overlay = document.getElementById("customSelectModal");
    const container = document.getElementById("customSelectOptionsContainer");
    const labelEl = document.getElementById("customSelectTitle");
    const closeBtn = document.getElementById("customSelectClose");
    if (!overlay || !container) return;

    const fieldLabel = sel.closest(".form-group")?.querySelector("label")?.textContent || "Select";
    if (labelEl) labelEl.textContent = fieldLabel;
    container.innerHTML = "";

    Array.from(sel.options).forEach(opt => {
        const item = document.createElement("div");
        item.className = `drawer-option-item${opt.value === sel.value ? " selected": ""}`;
        item.textContent = opt.text;
        item.addEventListener("click", () => {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change"));
            close();
        });
        container.appendChild(item);
    });

    overlay.classList.add("active");
    function close() {
        overlay.classList.remove("active");
        closeBtn?.removeEventListener("click", close);
        overlay.removeEventListener("click", outside);
    }
    function outside(e) {
        if (e.target === overlay) close();
    }
    closeBtn?.addEventListener("click", close);
    overlay.addEventListener("click", outside);
}

// ── Utilities ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
        .then(r => console.log("SW:", r.scope))
        .catch(e => console.warn("SW failed:", e));
    });
}