import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET is not set: everyone is signed out whenever the server restarts.");
const sign = p => crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const makeToken = uid => { const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 30 * 864e5 })).toString("base64url"); return `${p}.${sign(p)}`; };
function readToken(t) {
    const [p, s] = String(t || "").split(".");
    if (!p || !s || !same(s, sign(p))) return null;
    try { const d = JSON.parse(Buffer.from(p, "base64url")); return d.exp > Date.now() ? d.uid : null; } catch { return null; }
}
const scrypt = (pw, salt) => new Promise((ok, bad) => crypto.scrypt(pw, salt, 64, (e, k) => e ? bad(e) : ok(k.toString("hex"))));
const hashPw = async pw => { const salt = crypto.randomBytes(16).toString("hex"); return `${salt}:${await scrypt(pw, salt)}`; };
const checkPw = async (pw, stored) => { const [salt, h] = stored.split(":"); return same(h, await scrypt(pw, salt)); };
const cookies = req => Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split(/=(.*)/s)).filter(a => a[0]).map(a => [a[0], a[1] || ""]));
const cleanAllergies = v => Array.isArray(v) ? v.map(a => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 20) : [];

export function setupAuth(app, pool, langCodes) {
    const fails = new Map();
    const limited = key => { const now = Date.now(); const r = (fails.get(key) || []).filter(t => now - t < 15 * 60_000); fails.set(key, r); return r.length >= 10; };
    const setCookie = (req, res, token, maxAge) =>
        res.setHeader("Set-Cookie", `sp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.secure ? "; Secure" : ""}`);
    const clean = u => ({ email: u.email, allergies: u.allergies || [], lang: u.lang || "en" });
    const needDb = (req, res, next) => pool ? next() : res.status(503).json({ error: "Accounts are not turned on for this site yet." });

    if (pool) pool.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
        allergies JSONB NOT NULL DEFAULT '[]', lang TEXT NOT NULL DEFAULT 'en', created_at TIMESTAMPTZ DEFAULT now())`
    ).catch(e => console.error("users table:", e.message));

    app.post("/api/auth/signup", needDb, async (req, res) => {
        try {
            const { email = "", password = "", lang = "en", allergies } = req.body || {};
            const e = String(email).trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 120) return res.status(400).json({ error: "Enter a valid email address." });
            if (typeof password !== "string" || password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be 8 to 128 characters." });
            const r = await pool.query(
                "INSERT INTO users (email, password_hash, allergies, lang) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT (email) DO NOTHING RETURNING id, email, allergies, lang",
                [e, await hashPw(password), JSON.stringify(cleanAllergies(allergies)), langCodes.includes(lang) ? lang : "en"]);
            if (!r.rows[0]) return res.status(409).json({ error: "This email already has an account. Please sign in." });
            setCookie(req, res, makeToken(r.rows[0].id), 30 * 86400);
            res.json({ user: clean(r.rows[0]) });
        } catch (err) { console.error("signup:", err.message); res.status(500).json({ error: "Could not create the account." }); }
    });

    app.post("/api/auth/login", needDb, async (req, res) => {
        try {
            const e = String(req.body?.email || "").trim().toLowerCase(), pw = String(req.body?.password || "").slice(0, 128);
            const key = `${req.ip}|${e}`;
            if (limited(key)) return res.status(429).json({ error: "Too many tries. Please wait 15 minutes." });
            const row = (await pool.query("SELECT id, email, password_hash, allergies, lang FROM users WHERE email=$1", [e])).rows[0];
            const ok = row ? await checkPw(pw, row.password_hash) : (await scrypt(pw, "0".repeat(32)), false);
            if (!ok) { fails.get(key).push(Date.now()); return res.status(401).json({ error: "Wrong email or password." }); }
            setCookie(req, res, makeToken(row.id), 30 * 86400);
            res.json({ user: clean(row) });
        } catch (err) { console.error("login:", err.message); res.status(500).json({ error: "Could not sign in." }); }
    });

    app.post("/api/auth/logout", (req, res) => { setCookie(req, res, "", 0); res.json({ ok: true }); });

    app.get("/api/me", async (req, res) => {
        try {
            const uid = readToken(cookies(req).sp_session);
            const u = uid && pool ? (await pool.query("SELECT email, allergies, lang FROM users WHERE id=$1", [uid])).rows[0] : null;
            res.json({ accounts: Boolean(pool), user: u ? clean(u) : null });
        } catch { res.json({ accounts: Boolean(pool), user: null }); }
    });

    app.put("/api/me", needDb, async (req, res) => {
        try {
            const uid = readToken(cookies(req).sp_session);
            if (!uid) return res.status(401).json({ error: "Please sign in." });
            const { allergies, lang } = req.body || {};
            const r = await pool.query(
                "UPDATE users SET allergies = COALESCE($2::jsonb, allergies), lang = COALESCE($3, lang) WHERE id=$1 RETURNING email, allergies, lang",
                [uid, allergies === undefined ? null : JSON.stringify(cleanAllergies(allergies)), langCodes.includes(lang) ? lang : null]);
            if (!r.rows[0]) return res.status(401).json({ error: "Please sign in." });
            res.json({ user: clean(r.rows[0]) });
        } catch (err) { console.error("update me:", err.message); res.status(500).json({ error: "Could not save." }); }
    });
}
