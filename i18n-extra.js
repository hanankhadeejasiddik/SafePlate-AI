// SafePlate AI - full-page translation. Curated dictionary (page) first, Gemini translates everything else.
(function () {
    const API = location.protocol === "file:" ? (window.SAFEPLATE_API || "http://localhost:3000") : "";
    // Every message the app can show besides the page text. {0}, {1} are filled in by tr().
    const DYN = [
        "Note:", "yes", "no", "unclear", "Halal", "Vegan", "Vegetarian", "Dietary status unclear",
        "Uploaded \"{0}\". Extracting label text automatically...", "Scanning OCR...", "Scan Complete", "Camera Active",
        "Live camera ready. Align label and tap Capture.", "Camera permission unavailable — using Demo Scan mode.",
        "Extracting Frame...", "Captured & Analysed", "Frame captured! Click Explain when ready for simplified summary.", "Ready",
        "Extracted label cleared.", "Please scan, upload, or select a label first.", "Simplified explanation generated! Tap Play Voice & Text to listen.",
        "Please enter, scan, or select a sample label first.", "Audio playback is not supported in this browser.", "Audio speed set to {0}x",
        "Analysing with Gemini...", "Gemini unavailable ({0}). Showing basic offline analysis.", "Offline mode", "Reading packet with Gemini...",
        "Packet analysed. Tap Explain for the simple summary.", "Scan failed", "Scan failed: {0}", "Could not read this image. Try a JPG or PNG photo.",
        "Upload a photo of the packet first.", "Allergies saved. Re-run analysis to apply.", "Expiry date not found on this photo",
        "EXPIRED on {0} - do not consume", "Expires soon: {0} ({1} days left)", "Good until {0} ({1} days left)",
        "My allergies (comma separated, e.g. sesame, mustard, shellfish)", "Anything - not limited to common allergens",
        "{0} Allergens Detected", "{0} Allergen Detected", "0 Allergens", " (may contain)", " - YOUR ALLERGY", "{0} Decoded",
        "Sign in", "Create account", "Email", "Password", "At least 8 characters", "Sign out", "Save allergies", "Close",
        "Signed in as {0}", "My allergies (comma separated)", "Your allergies are saved to your account and follow you to any device.",
        "Accounts are not turned on for this site yet.", "Allergies saved to your account.", "Signed in.", "Signed out.", "Translating the page...",
        "Enter a valid email address.", "Password must be 8 to 128 characters.", "This email already has an account. Please sign in.",
        "Wrong email or password.", "Too many tries. Please wait 15 minutes.", "Could not create the account.", "Could not sign in.",
        "Please sign in.", "Could not save."
    ];
    const MORE = { ta: ["தமிழ் (Tamil)", "ta-IN"], te: ["తెలుగు (Telugu)", "te-IN"], ml: ["മലയാളം (Malayalam)", "ml-IN"], gu: ["ગુજરાતી (Gujarati)", "gu-IN"] };
    const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "OPTION"]);
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pats = DYN.filter(s => s.includes("{0}")).map(s => [new RegExp("^" + esc(s).replace(/\\\{\d\\\}/g, "(.+?)") + "$", "s"), s]);
    let MAP = {}, enSet = new Set(), rev = {}, seq = 0;

    window.tr = (s, ...v) => { let t = MAP[s] || s; v.forEach((x, i) => { t = t.split(`{${i}}`).join(x); }); return t; };
    window.trm = m => {
        if (MAP[m]) return MAP[m];
        for (const [re, tpl] of pats) { const g = String(m).match(re); if (g) return tr(tpl, ...g.slice(1)); }
        return m;
    };

    const walk = fn => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode());) {
            const p = n.parentElement;
            if (p && !SKIP.has(p.tagName) && !p.closest("#toast-container,#acct-modal") && n.data.trim()) fn(n, n.data.trim());
        }
    };
    function paint(lang) {
        walk((n, t) => {
            const k = enSet.has(t) ? t : rev[t];   // not English and not ours = the page's curated text, leave it
            if (!k) return;
            const out = lang === "en" ? k : (MAP[k] || k);
            if (out !== t) n.data = n.data.replace(t, () => out);
        });
        const s = document.querySelector("#ui-disclaimer strong"); if (s) s.textContent = tr("Note:");
        document.documentElement.lang = lang;
    }

    async function loadMap(lang) {
        const ck = "sp_tr_" + lang; let m = {};
        try { m = JSON.parse(localStorage.getItem(ck) || "{}"); } catch {}
        const need = [...new Set([...DYN, ...enSet])].filter(s => s.length > 1 && !m[s]);
        if (need.length) showToast("Translating the page...", "cyan");
        try {
            for (let i = 0; i < need.length; i += 40) {
                const chunk = need.slice(i, i + 40), strings = {};
                chunk.forEach((s, j) => strings["s" + j] = s);
                const r = await fetch(API + "/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, strings }) });
                if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
                const out = await r.json();
                chunk.forEach((s, j) => { const v = out["s" + j]; if (typeof v === "string" && v.trim()) m[s] = v; });
                try { localStorage.setItem(ck, JSON.stringify(m)); } catch {}
            }
        } catch (e) { showToast(`Translation unavailable (${e.message}). Some text stays in English.`, "amber"); }
        return m;
    }

    async function onLang(lang) {
        const my = ++seq;
        try { localStorage.setItem("safeplate_lang", lang); } catch {}
        if (lang === "en") MAP = {}; else MAP = await loadMap(lang);
        if (my !== seq) return;
        Object.entries(MAP).forEach(([k, v]) => rev[v] = k);
        paint(lang);
        window.dispatchEvent(new Event("sp-lang"));
    }

    function init() {
        const sel = document.getElementById("language-select");
        for (const [c, [name, speech]] of Object.entries(MORE)) {
            UI_TRANSLATIONS[c] = { ...UI_TRANSLATIONS.en, langName: name, speechCode: speech };
            const o = document.createElement("option"); o.value = c; o.textContent = name; o.className = "bg-slate-900 text-white"; sel.appendChild(o);
        }
        walk((n, t) => { if (/[A-Za-z]{2}/.test(t)) enSet.add(t); });
        const st = window.showToast, up = window.updateStatusPill;
        window.showToast = (m, t) => st(trm(m), t);
        window.updateStatusPill = (l, t) => up(trm(l), t);
        sel.addEventListener("change", () => onLang(sel.value));
        let saved = ""; try { saved = localStorage.getItem("safeplate_lang") || ""; } catch {}
        if (saved && saved !== "en" && [...sel.options].some(o => o.value === saved)) { sel.value = saved; sel.dispatchEvent(new Event("change")); }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
