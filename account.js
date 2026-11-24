// SafePlate AI - sign in / sign up. Allergies and language are saved to the account.
(function () {
    const API = location.protocol === "file:" ? (window.SAFEPLATE_API || "http://localhost:3000") : "";
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const getLocal = () => { try { return JSON.parse(localStorage.getItem("safeplate_allergies") || "[]"); } catch { return []; } };
    const setLocal = a => { try { localStorage.setItem("safeplate_allergies", JSON.stringify(a)); } catch {} };
    const lang = () => $("language-select").value;
    const parse = v => v.split(",").map(s => s.trim()).filter(Boolean);
    let user = null, accounts = true, mode = "in";

    async function api(method, path, body) {
        const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
        return d;
    }

    const cls = "w-full rounded-xl p-2.5 text-sm glass-input mt-1";
    const btn = "w-full py-2.5 rounded-2xl font-bold text-sm bg-cyan-500 text-slate-900 hover:bg-cyan-400";
    const tab = on => `flex-1 py-2 rounded-xl text-xs font-bold border ${on ? "bg-cyan-500/30 border-cyan-400 text-white" : "border-white/20 text-slate-300"}`;

    function render() {
        const box = $("acct-box"), T = (s, ...v) => esc(tr(s, ...v));
        const close = `<button id="acct-close" class="mt-3 w-full text-xs text-slate-300 underline">${T("Close")}</button>`;
        if (!accounts) box.innerHTML = `<p class="text-sm text-slate-200">${T("Accounts are not turned on for this site yet.")}</p>${close}`;
        else if (user) box.innerHTML = `
            <h3 class="text-sm font-bold text-white break-all">${T("Signed in as {0}", user.email)}</h3>
            <label class="block text-[11px] text-slate-300 font-semibold mt-3">${T("My allergies (comma separated)")}</label>
            <input id="acct-allergies" class="${cls}" value="${esc((user.allergies || []).join(", "))}">
            <p class="text-[11px] text-slate-400 mt-1">${T("Your allergies are saved to your account and follow you to any device.")}</p>
            <button id="acct-save" class="${btn} mt-3">${T("Save allergies")}</button>
            <button id="acct-out" class="${btn} mt-2 !bg-white/10 !text-white">${T("Sign out")}</button>
            <p id="acct-msg" class="text-xs mt-2 text-emerald-300"></p>${close}`;
        else box.innerHTML = `
            <div class="flex gap-2 mb-3"><button id="tab-in" class="${tab(mode === "in")}">${T("Sign in")}</button><button id="tab-up" class="${tab(mode === "up")}">${T("Create account")}</button></div>
            <label class="block text-[11px] text-slate-300 font-semibold">${T("Email")}</label>
            <input id="acct-email" type="email" autocomplete="email" class="${cls}">
            <label class="block text-[11px] text-slate-300 font-semibold mt-3">${T("Password")}</label>
            <input id="acct-pass" type="password" autocomplete="${mode === "up" ? "new-password" : "current-password"}" placeholder="${T("At least 8 characters")}" class="${cls}">
            <button id="acct-go" class="${btn} mt-4">${T(mode === "up" ? "Create account" : "Sign in")}</button>
            <p id="acct-msg" class="text-xs mt-2 text-rose-300"></p>${close}`;
        const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
        on("acct-close", closeBox); on("tab-in", () => { mode = "in"; render(); }); on("tab-up", () => { mode = "up"; render(); });
        on("acct-go", submit); on("acct-save", saveAllergies); on("acct-out", signOut);
    }

    const msg = (t, good) => { const m = $("acct-msg"); if (m) { m.textContent = t; m.className = `text-xs mt-2 ${good ? "text-emerald-300" : "text-rose-300"}`; } };
    const paintBtn = () => { const b = $("acct-btn"); if (b) b.textContent = user ? "👤 " + user.email.split("@")[0].slice(0, 12) : tr("Sign in"); };
    const openBox = () => { $("acct-modal").classList.remove("hidden"); render(); };
    function closeBox() { $("acct-modal").classList.add("hidden"); }

    function setUser(u, applyLang) {
        user = u; paintBtn();
        if (!u) return;
        if (u.allergies.length) setLocal(u.allergies);
        else if (getLocal().length) api("PUT", "/api/me", { allergies: getLocal() }).catch(() => {});
        const inp = $("my-allergies"); if (inp) inp.value = getLocal().join(", ");
        if (applyLang && u.lang && u.lang !== lang() && [...$("language-select").options].some(o => o.value === u.lang)) {
            $("language-select").value = u.lang; $("language-select").dispatchEvent(new Event("change"));
        }
    }

    async function submit() {
        msg("");
        try {
            const d = await api("POST", mode === "up" ? "/api/auth/signup" : "/api/auth/login",
                { email: $("acct-email").value, password: $("acct-pass").value, lang: lang(), allergies: getLocal() });
            setUser(d.user, true); closeBox(); showToast("Signed in.");
        } catch (e) { msg(trm(e.message)); }
    }
    async function saveAllergies() {
        const list = parse($("acct-allergies").value);
        try { const d = await api("PUT", "/api/me", { allergies: list }); user = d.user; setLocal(user.allergies); msg(tr("Allergies saved to your account."), true); }
        catch (e) { msg(trm(e.message)); }
    }
    async function signOut() {
        await api("POST", "/api/auth/logout").catch(() => {});
        user = null; try { localStorage.removeItem("safeplate_allergies"); } catch {}
        const inp = $("my-allergies"); if (inp) inp.value = "";
        paintBtn(); closeBox(); showToast("Signed out.");
    }

    window.onAllergiesChanged = a => { if (user) api("PUT", "/api/me", { allergies: a }).then(d => { user = d.user; }).catch(() => {}); };

    function init() {
        const b = document.createElement("button");
        b.id = "acct-btn"; b.className = "inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold text-slate-200 hover:text-white glass-card shrink-0";
        b.onclick = openBox; $("ui-nav-guide").before(b);
        const m = document.createElement("div");
        m.id = "acct-modal"; m.className = "hidden fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60";
        m.innerHTML = `<div id="acct-box" class="glass-panel rounded-3xl p-5 w-full max-w-sm"></div>`;
        m.addEventListener("click", e => { if (e.target === m) closeBox(); });
        document.addEventListener("keydown", e => { if (e.key === "Escape") closeBox(); });
        document.body.appendChild(m);
        paintBtn();
        $("language-select").addEventListener("change", () => { if (user) api("PUT", "/api/me", { lang: lang() }).catch(() => {}); });
        window.addEventListener("sp-lang", () => { paintBtn(); if (!m.classList.contains("hidden")) render(); });
        api("GET", "/api/me").then(d => { accounts = d.accounts; setUser(d.user, true); }).catch(() => {});
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
