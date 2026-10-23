// Подключение нейросетей к «Моей зачётке»: OAuth 2.1 (вход и выдача доступа) и MCP-сервер.
// Модуль подключается через require() внутри обработчиков в ai.pb.js:
// в PocketBase каждый обработчик выполняется отдельно и не видит переменные верхнего уровня.

const ACCESS_TTL = 60 * 60 * 1000;             // токен доступа: 1 час
const REFRESH_TTL = 90 * 24 * 60 * 60 * 1000;  // токен обновления: 90 дней с последнего использования
const CODE_TTL = 10 * 60 * 1000;               // код входа: 10 минут
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SCOPE = "zachetka";

/* ---------- Общее ---------- */
function baseUrl(e) {
  const env = String($os.getenv("APP_URL") || "").replace(/\/+$/, "");
  if (env) return env;
  const proto = e.request.header.get("X-Forwarded-Proto") || (e.request.tls ? "https" : "http");
  return proto + "://" + e.request.host;
}
const hash = (s) => $security.sha256(String(s));
const newToken = (prefix) => prefix + $security.randomString(48);
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function hexToB64url(hex) {
  const b = [];
  for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "") + (i + 2 < b.length ? B64[n & 63] : "");
  }
  return out;
}
const pkceOk = (verifier, challenge) => !!verifier && !!challenge && hexToB64url(hash(verifier)) === challenge;
function find(coll, field, value) {
  if (!value) return null;
  try { return $app.findFirstRecordByData(coll, field, value); } catch (_) { return null; }
}
const jsonField = (r, f) => { try { return JSON.parse(r.getString(f) || "null"); } catch (_) { return null; } };
function hostOf(url) { const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || "")); return m ? m[1].replace(/^.*@/, "") : ""; }
function addQuery(url, params) {
  const q = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + q;
}
function htmlEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// Простое ограничение частоты в памяти процесса (сбрасывается при перезапуске)
function tooOften(key, max, windowMs) {
  const st = $app.store();
  const now = Date.now();
  let v = st.get(key);
  if (!v || now - v.t > windowMs) v = { t: now, n: 0 };
  v.n++;
  st.set(key, v);
  return v.n > max;
}

/* ---------- Описание сервера (well-known) ---------- */
function resourceMeta(e) {
  const b = baseUrl(e);
  return e.json(200, {
    resource: b + "/mcp",
    authorization_servers: [b],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Моя зачётка",
  });
}
function authServerMeta(e) {
  const b = baseUrl(e);
  return e.json(200, {
    issuer: b,
    authorization_endpoint: b + "/oauth/authorize",
    token_endpoint: b + "/oauth/token",
    registration_endpoint: b + "/oauth/register",
    revocation_endpoint: b + "/oauth/revoke",
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
  });
}

/* ---------- Регистрация приложения нейросети (RFC 7591) ---------- */
function redirectAllowed(u) {
  return /^https:\/\/[^\s/?#]+[^\s#]*$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[^\s#]*)?$/i.test(u);
}
function register(e) {
  if (tooOften("ai_reg:" + e.realIP(), 30, 60 * 60 * 1000)) {
    return e.json(429, { error: "invalid_request", error_description: "Too many registrations, try later" });
  }
  let body = {};
  try { body = JSON.parse(readerToString(e.request.body) || "{}"); } catch (_) {
    return e.json(400, { error: "invalid_client_metadata", error_description: "Body must be JSON" });
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 20 || !uris.every(redirectAllowed)) {
    return e.json(400, { error: "invalid_redirect_uri", error_description: "redirect_uris must be https URLs (or http://localhost)" });
  }
  const method = ["none", "client_secret_post", "client_secret_basic"].indexOf(body.token_endpoint_auth_method) >= 0
    ? body.token_endpoint_auth_method : "none";
  const name = String(body.client_name || "").slice(0, 200) || hostOf(uris[0]);
  const clientId = "zc_" + $security.randomString(32);
  const secret = method === "none" ? "" : "zs_" + $security.randomString(48);
  const r = new Record($app.findCollectionByNameOrId("ai_clients"));
  r.set("client_id", clientId);
  r.set("secret_hash", secret ? hash(secret) : "");
  r.set("name", name);
  r.set("redirect_uris", uris);
  r.set("last_used", Date.now());
  $app.save(r);
  const out = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
  if (secret) { out.client_secret = secret; out.client_secret_expires_at = 0; }
  e.response.header().set("Cache-Control", "no-store");
  return e.json(201, out);
}
function getClient(clientId) {
  const r = find("ai_clients", "client_id", String(clientId || ""));
  if (!r) return null;
  return { rec: r, id: r.getString("client_id"), name: r.getString("name"), uris: jsonField(r, "redirect_uris") || [], secretHash: r.getString("secret_hash") };
}

/* ---------- Страница разрешения доступа ---------- */
function errorPage(e, text) {
  e.response.header().set("X-Frame-Options", "DENY");
  return e.html(400, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Моя зачётка</title><link rel="stylesheet" href="/app.css"></head><body><section class="auth"><div class="auth-card"><div class="auth-brand"><h1>Моя зачётка</h1><p>Подключение нейросети</p></div><p class="form-err">${htmlEsc(text)}</p><p class="muted">Вернитесь в настройки нейросети и подключите зачётку заново.</p></div></section></body></html>`);
}
// Проверка запроса на вход. Возвращает {fail} при ошибке, которую нельзя отправить нейросети,
// {redirectError} при ошибке, о которой нейросеть узнаёт через redirect_uri, или {req, client}.
function checkAuthRequest(q) {
  const client = getClient(q.client_id);
  if (!client) return { fail: "Нейросеть не зарегистрирована в зачётке или регистрация устарела." };
  let redirect = String(q.redirect_uri || "");
  if (!redirect && client.uris.length === 1) redirect = client.uris[0];
  if (client.uris.indexOf(redirect) < 0) return { fail: "Адрес возврата не совпадает с тем, что нейросеть указала при регистрации." };
  const back = (err, desc) => ({ redirectError: addQuery(redirect, { error: err, error_description: desc, state: q.state }) });
  if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (!q.code_challenge || (q.code_challenge_method || "plain") !== "S256") return back("invalid_request", "PKCE with S256 is required");
  return {
    client,
    req: {
      client_id: client.id, redirect_uri: redirect, state: String(q.state || ""), code_challenge: String(q.code_challenge),
      scope: String(q.scope || SCOPE), resource: String(q.resource || ""),
    },
  };
}
function authorizePage(e) {
  const q = e.requestInfo().query || {};
  const c = checkAuthRequest(q);
  if (c.fail) return errorPage(e, c.fail);
  if (c.redirectError) return e.redirect(302, c.redirectError);
  let html = toString($os.readFile(__hooks + "/ai_consent.html"));
  const params = JSON.stringify({ req: c.req, client: c.client.name, host: hostOf(c.req.redirect_uri) }).replace(/</g, "\\u003c");
  html = html.replace("/*PARAMS*/null", params);
  e.response.header().set("X-Frame-Options", "DENY");
  e.response.header().set("Content-Security-Policy", "frame-ancestors 'none'");
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Referrer-Policy", "no-referrer");
  return e.html(200, html);
}
// Нажата кнопка «Разрешить» или «Отмена». Пользователь подтверждён токеном PocketBase.
function approve(e) {
  const body = e.requestInfo().body || {};
  const c = checkAuthRequest(Object.assign({}, body, { response_type: "code", code_challenge_method: "S256" }));
  if (c.fail) return e.json(400, { message: c.fail });
  if (c.redirectError) return e.json(200, { redirect: c.redirectError });
  if (body.deny) {
    return e.json(200, { redirect: addQuery(c.req.redirect_uri, { error: "access_denied", error_description: "User denied access", state: c.req.state }) });
  }
  if (!e.auth || e.auth.collection().name !== "users") return e.json(401, { message: "Войдите в зачётку." });
  const code = newToken("zcd_");
  const r = new Record($app.findCollectionByNameOrId("ai_codes"));
  r.set("code_hash", hash(code));
  r.set("user", e.auth.id);
  r.set("client_id", c.req.client_id);
  r.set("client_name", c.client.name);
  r.set("redirect_uri", c.req.redirect_uri);
  r.set("challenge", c.req.code_challenge);
  r.set("scope", c.req.scope);
  r.set("resource", c.req.resource);
  r.set("expires", Date.now() + CODE_TTL);
  $app.save(r);
  return e.json(200, { redirect: addQuery(c.req.redirect_uri, { code, state: c.req.state, iss: baseUrl(e) }) });
}

/* ---------- Выдача токенов ---------- */
function tokenError(e, status, err, desc) {
  e.response.header().set("Cache-Control", "no-store");
  return e.json(status, { error: err, error_description: desc });
}
// Данные клиента из заголовка Basic или из тела запроса
function clientCreds(e, body) {
  const h = e.request.header.get("Authorization") || "";
  if (/^Basic\s+/i.test(h)) {
    try {
      const dec = b64decode(h.replace(/^Basic\s+/i, ""));
      const i = dec.indexOf(":");
      if (i > 0) return { id: decodeURIComponent(dec.slice(0, i)), secret: decodeURIComponent(dec.slice(i + 1)) };
    } catch (_) {}
  }
  return { id: String(body.client_id || ""), secret: String(body.client_secret || "") };
}
function b64decode(s) {
  s = String(s).replace(/[^A-Za-z0-9+/=_-]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0, val = 0, out = "";
  for (const ch of s) {
    if (ch === "=") break;
    val = (val << 6) | abc.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((val >> bits) & 255); }
  }
  return out;
}
function issue(e, grant) {
  const access = newToken("zat_"), refresh = newToken("zrt_");
  grant.set("access_hash", hash(access));
  grant.set("access_exp", Date.now() + ACCESS_TTL);
  grant.set("refresh_hash", hash(refresh));
  grant.set("refresh_exp", Date.now() + REFRESH_TTL);
  $app.save(grant);
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Pragma", "no-cache");
  return e.json(200, { access_token: access, token_type: "Bearer", expires_in: Math.floor(ACCESS_TTL / 1000), refresh_token: refresh, scope: SCOPE });
}
function token(e) {
  const body = e.requestInfo().body || {};
  const cred = clientCreds(e, body);
  const client = getClient(cred.id);
  if (!client) return tokenError(e, 401, "invalid_client", "Unknown client");
  if (client.secretHash && !$security.equal(hash(cred.secret), client.secretHash)) return tokenError(e, 401, "invalid_client", "Bad client secret");
  client.rec.set("last_used", Date.now());
  $app.save(client.rec);

  if (body.grant_type === "authorization_code") {
    const code = find("ai_codes", "code_hash", hash(body.code || ""));
    if (!code) return tokenError(e, 400, "invalid_grant", "Unknown or used code");
    $app.delete(code); // код одноразовый
    if (code.getInt("expires") < Date.now()) return tokenError(e, 400, "invalid_grant", "Code expired");
    if (code.getString("client_id") !== client.id) return tokenError(e, 400, "invalid_grant", "Code was issued to another client");
    if (body.redirect_uri && body.redirect_uri !== code.getString("redirect_uri")) return tokenError(e, 400, "invalid_grant", "redirect_uri mismatch");
    if (!pkceOk(String(body.code_verifier || ""), code.getString("challenge"))) return tokenError(e, 400, "invalid_grant", "PKCE verification failed");
    const userId = code.getString("user");
    if (!find("users", "id", userId)) return tokenError(e, 400, "invalid_grant", "User not found");
    const host = hostOf(code.getString("redirect_uri"));
    // Повторное подключение той же нейросети заменяет старый доступ
    const old = $app.findRecordsByFilter("ai_grants", "user = {:u} && client_name = {:n} && redirect_host = {:h}", "", 0, 0, { u: userId, n: code.getString("client_name"), h: host });
    for (const g of old) $app.delete(g);
    const grant = new Record($app.findCollectionByNameOrId("ai_grants"));
    grant.set("user", userId);
    grant.set("client_id", client.id);
    grant.set("client_name", code.getString("client_name"));
    grant.set("redirect_host", host);
    grant.set("last_used", Date.now());
    return issue(e, grant);
  }
  if (body.grant_type === "refresh_token") {
    const grant = find("ai_grants", "refresh_hash", hash(body.refresh_token || ""));
    if (!grant || grant.getString("client_id") !== client.id) return tokenError(e, 400, "invalid_grant", "Unknown refresh token");
    if (grant.getInt("refresh_exp") < Date.now()) { $app.delete(grant); return tokenError(e, 400, "invalid_grant", "Refresh token expired"); }
    return issue(e, grant);
  }
  return tokenError(e, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
}
function revoke(e) {
  const body = e.requestInfo().body || {};
  const t = String(body.token || "");
  const g = find("ai_grants", "access_hash", hash(t)) || find("ai_grants", "refresh_hash", hash(t));
  if (g) $app.delete(g);
  return e.json(200, {});
}

/* ---------- Ежедневная уборка ---------- */
function cleanup() {
  const now = Date.now();
  $app.db().newQuery("DELETE FROM ai_codes WHERE expires < {:t}").bind({ t: now }).execute();
  $app.db().newQuery("DELETE FROM ai_grants WHERE refresh_exp < {:t}").bind({ t: now }).execute();
  // приложения, которые так и не получили доступ за неделю
  $app.db().newQuery("DELETE FROM ai_clients WHERE last_used < {:t} AND client_id NOT IN (SELECT client_id FROM ai_grants)")
    .bind({ t: now - 7 * 24 * 60 * 60 * 1000 }).execute();
}

/* ---------- MCP ---------- */
function unauthorized(e, desc) {
  e.response.header().set("WWW-Authenticate",
    `Bearer resource_metadata="${baseUrl(e)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${desc}"`);
  return e.json(401, { error: "invalid_token", error_description: desc });
}
function mcp(e) {
  const h = e.request.header.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) return unauthorized(e, "Authorization required");
  const grant = find("ai_grants", "access_hash", hash(m[1]));
  if (!grant || grant.getInt("access_exp") < Date.now()) return unauthorized(e, "Token is invalid or expired");
  const user = find("users", "id", grant.getString("user"));
  if (!user) return unauthorized(e, "User not found");
  if (Date.now() - grant.getInt("last_used") > 10 * 60 * 1000) {
    grant.set("last_used", Date.now());
    $app.save(grant);
  }

  let msg;
  try { msg = JSON.parse(readerToString(e.request.body) || ""); } catch (_) {
    return e.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const ctx = { uid: user.id, user };
  if (Array.isArray(msg)) {
    const out = msg.map((x) => rpc(ctx, x)).filter(Boolean);
    return out.length ? e.json(200, out) : e.noContent(202);
  }
  const res = rpc(ctx, msg);
  return res ? e.json(200, res) : e.noContent(202);
}
function rpc(ctx, msg) {
  if (!msg || typeof msg !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  const isNote = msg.id === undefined || msg.id === null;
  const ok = (result) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => (isNote ? null : { jsonrpc: "2.0", id: msg.id, error: { code, message } });
  if (msg.method === undefined) return null; // ответ клиента на наш запрос, нам не нужен
  switch (msg.method) {
    case "initialize": {
      const want = msg.params && msg.params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.indexOf(want) >= 0 ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "zachetka", title: "Моя зачётка", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
    case "tools/call": {
      const p = msg.params || {};
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return fail(-32602, "Unknown tool: " + p.name);
      // при приостановленном доступе нейросеть может только смотреть
      const access = require(`${__hooks}/access_lib.js`);
      if (!tool.annotations.readOnlyHint && !access.state(ctx.user).active) {
        return ok({ content: [{ type: "text", text: access.message() }], isError: true });
      }
      try {
        const data = tool.run(ctx, p.arguments || {});
        return ok({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }] });
      } catch (err) {
        const text = err && err.userMessage ? err.userMessage : "Ошибка: " + String((err && err.message) || err);
        return ok({ content: [{ type: "text", text }], isError: true });
      }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default:
      if (String(msg.method).indexOf("notifications/") === 0) return null;
      return fail(-32601, "Method not found: " + msg.method);
  }
}

/* ---------- Данные пользователя ---------- */
function UserError(text) { this.userMessage = text; }
const bad = (text) => { throw new UserError(text); };
const STATUS = { todo: "Не начинал", started: "Приступил", finishing: "Заканчиваю", done: "Сделал" };
const SUBJ_STATUS = { prep: "Готовлю", passed: "Сдал" };
const EXAM_KINDS = ["Экзамен", "Зачёт", "Дифференцированный зачёт", "Защита курсовой", "Консультация"];

function today() {
  const off = parseFloat($os.getenv("APP_TZ_OFFSET"));
  const d = new Date(Date.now() + (isNaN(off) ? 10 : off) * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function checkDate(v, field) {
  if (v === undefined || v === null) return undefined;
  v = String(v).trim();
  if (v === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + "T00:00:00Z").getTime())) bad(`Поле ${field}: дата должна быть в формате ГГГГ-ММ-ДД, например ${today()}.`);
  return v;
}
function own(coll, uid, filter, params, sort) {
  return $app.findRecordsByFilter(coll, "owner = {:uid}" + (filter ? " && (" + filter + ")" : ""), sort || "", 0, 0, Object.assign({ uid }, params || {}));
}
const g = (r, f) => r.getString(f);
function byId(coll, uid, id) {
  if (!id) return null;
  try { const r = $app.findRecordById(coll, String(id)); return r.getString("owner") === uid ? r : null; } catch (_) { return null; }
}
// Поиск записи по id или по названию (без учёта регистра)
function resolve(coll, uid, ref, field, what) {
  if (ref === undefined || ref === null || String(ref).trim() === "") bad(`Укажите ${what}.`);
  ref = String(ref).trim();
  const r = byId(coll, uid, ref);
  if (r) return r;
  const all = own(coll, uid);
  const low = ref.toLowerCase();
  let hits = all.filter((x) => g(x, field).toLowerCase() === low);
  if (!hits.length) hits = all.filter((x) => g(x, field).toLowerCase().indexOf(low) >= 0);
  if (hits.length === 1) return hits[0];
  const names = (hits.length ? hits : all).slice(0, 40).map((x) => `${g(x, field)} (id ${x.id})`).join("; ");
  if (hits.length > 1) bad(`Под «${ref}» подходит несколько записей (${what}): ${names}. Уточните id.`);
  bad(`Не нашёл ${what} «${ref}». Есть: ${names || "пока ничего"}.`);
}
function instMap(uid) { const m = {}; own("institutions", uid).forEach((i) => { m[i.id] = g(i, "name"); }); return m; }
function subjMap(uid) { const m = {}; own("subjects", uid).forEach((s) => { m[s.id] = s; }); return m; }
function setFields(r, args, map) {
  for (const k of Object.keys(map)) {
    if (args[k] === undefined) continue;
    const v = map[k](args[k]);
    if (v !== undefined) r.set(k, v);
  }
}
function newRec(coll, uid) {
  const r = new Record($app.findCollectionByNameOrId(coll));
  r.set("owner", uid);
  r.set("createdAt", Date.now());
  r.set("order", Date.now());
  return r;
}
function save(r) {
  try { $app.save(r); } catch (err) { bad("Не удалось сохранить: " + String((err && err.message) || err)); }
  return r;
}
const str = (max) => (v) => String(v).slice(0, max);
const oneOf = (list, field) => (v) => { v = String(v); if (list.indexOf(v) < 0) bad(`Поле ${field}: допустимо ${list.join(", ")}.`); return v; };

function taskOut(t, subs, insts) {
  const s = subs[g(t, "subjectId")];
  const files = $app.countRecords("attachments", $dbx.hashExp({ taskId: t.id }));
  return {
    id: t.id, title: g(t, "title"), status: g(t, "status") || "todo", status_label: STATUS[g(t, "status") || "todo"],
    subject: s ? g(s, "name") : "", subject_id: g(t, "subjectId"), institution: s ? insts[g(s, "instId")] || "" : "",
    issued: g(t, "issued"), due: g(t, "due"), body: g(t, "body"), notes: g(t, "notes"), files,
  };
}
function subjectOut(s, insts, tasks) {
  const list = tasks.filter((t) => g(t, "subjectId") === s.id);
  return {
    id: s.id, name: g(s, "name"), institution: insts[g(s, "instId")] || "", institution_id: g(s, "instId"),
    status: g(s, "status") || "prep", status_label: SUBJ_STATUS[g(s, "status") || "prep"],
    control: g(s, "control"), date: g(s, "date"), grade: g(s, "grade"), teacher: g(s, "teacher"),
    tasks_total: list.length, tasks_done: list.filter((t) => g(t, "status") === "done").length,
  };
}
function sessionOut(se, insts, subs) {
  const exams = (jsonField(se, "exams") || []).slice().sort((a, b) => ((a.date || "9999") + (a.time || "")).localeCompare((b.date || "9999") + (b.time || "")));
  return {
    id: se.id, title: g(se, "title"), institution: insts[g(se, "instId")] || "", start: g(se, "start"), end: g(se, "end"),
    exams: exams.map((x) => ({ id: x.id, subject: (subs[x.subjectId] && g(subs[x.subjectId], "name")) || x.subjectName || "", subject_id: x.subjectId || "", kind: x.kind || "", date: x.date || "", time: x.time || "", place: x.place || "" })),
  };
}
function thesisPick(uid, ref) {
  const all = own("theses", uid, "", {}, "createdAt");
  if (!all.length) bad("Дипломных работ пока нет. Их добавляют в приложении, раздел «Диплом».");
  if (ref === undefined || ref === null || ref === "") {
    if (all.length === 1) return all[0];
    const insts = instMap(uid);
    bad("Дипломов несколько, укажите thesis: " + all.map((t) => `${insts[g(t, "instId")] || g(t, "topic") || "диплом"} (id ${t.id})`).join("; "));
  }
  const r = byId("theses", uid, ref);
  if (r) return r;
  const insts = instMap(uid), low = String(ref).toLowerCase();
  const hits = all.filter((t) => (insts[g(t, "instId")] || "").toLowerCase().indexOf(low) >= 0 || g(t, "topic").toLowerCase().indexOf(low) >= 0);
  if (hits.length === 1) return hits[0];
  bad("Не понял, какой диплом. Есть: " + all.map((t) => `${insts[g(t, "instId")] || g(t, "topic") || "диплом"} (id ${t.id})`).join("; "));
}

const TASK_STATUSES = ["todo", "started", "finishing", "done"];
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DATE = { type: "string", description: "Дата в формате ГГГГ-ММ-ДД" };

const INSTRUCTIONS = "«Моя зачётка» — учёт учёбы пользователя: учебные заведения, предметы, задания со сроками, сессии с экзаменами, дипломные работы. " +
  "Начинайте с get_overview, если вопрос общий. Даты всегда в формате ГГГГ-ММ-ДД; «сегодня» берите из поля today ответа get_overview. " +
  "Предмет, заведение и диплом можно указывать по id или по названию. Удалять записи через этот сервер нельзя: удаление делается в самом приложении. " +
  "Статусы заданий: todo (не начинал), started (приступил), finishing (заканчиваю), done (сделал). Статусы предметов: prep (готовлю), passed (сдал).";

const TOOLS = [
  {
    name: "get_overview", title: "Обзор", annotations: RO,
    description: "Сводка на сегодня: просроченные задания, сроки на ближайший месяц, задания в работе, ближайшая или текущая сессия с экзаменами, дипломы со сроками. Начинайте с этого инструмента.",
    inputSchema: { type: "object", properties: {} },
    run(ctx) {
      const uid = ctx.uid, t = today(), soon = addDays(t, 31);
      const insts = instMap(uid), subs = subjMap(uid);
      const tasks = own("tasks", uid, "status != 'done'", {}, "due");
      const sessions = own("sessions", uid, "", {}, "start").filter((s) => !g(s, "start") || (g(s, "end") || g(s, "start")) >= t);
      const theses = own("theses", uid, "", {}, "createdAt");
      return {
        today: t,
        user: ctx.user.getString("name") || ctx.user.getString("email"),
        overdue: tasks.filter((x) => g(x, "due") && g(x, "due") < t).map((x) => taskOut(x, subs, insts)),
        due_next_31_days: tasks.filter((x) => g(x, "due") && g(x, "due") >= t && g(x, "due") <= soon).map((x) => taskOut(x, subs, insts)),
        in_progress_later: tasks.filter((x) => ["started", "finishing"].indexOf(g(x, "status")) >= 0 && (!g(x, "due") || g(x, "due") > soon)).map((x) => taskOut(x, subs, insts)),
        upcoming_sessions: sessions.slice(0, 3).map((s) => sessionOut(s, insts, subs)),
        theses: theses.map((th) => ({ id: th.id, institution: insts[g(th, "instId")] || "", topic: g(th, "topic"), submit: g(th, "submit"), defense: g(th, "defense") })),
        counts: { institutions: Object.keys(insts).length, subjects: Object.keys(subs).length, open_tasks: tasks.length },
        access: (() => {
          const st = require(`${__hooks}/access_lib.js`).state(ctx.user);
          return { active: st.active, until: st.until || "бессрочно", note: st.active ? "" : "Доступ приостановлен: можно только смотреть записи." };
        })(),
      };
    },
  },
  {
    name: "list_subjects", title: "Предметы", annotations: RO,
    description: "Список учебных заведений и предметов с формой контроля, датой сдачи, оценкой, преподавателем и числом заданий.",
    inputSchema: { type: "object", properties: {
      institution: { type: "string", description: "Заведение (id или название), необязательно" },
      status: { type: "string", enum: ["prep", "passed", "all"], description: "prep — готовлю, passed — сдал, all — все (по умолчанию)" },
    } },
    run(ctx, a) {
      const uid = ctx.uid, insts = instMap(uid), tasks = own("tasks", uid);
      const instFilter = a.institution ? resolve("institutions", uid, a.institution, "name", "заведение").id : "";
      const subs = own("subjects", uid, "", {}, "name")
        .filter((s) => !instFilter || g(s, "instId") === instFilter)
        .filter((s) => !a.status || a.status === "all" || (g(s, "status") || "prep") === a.status);
      return {
        institutions: Object.keys(insts).filter((id) => !instFilter || id === instFilter).map((id) => ({ id, name: insts[id] })),
        subjects: subs.map((s) => subjectOut(s, insts, tasks)),
      };
    },
  },
  {
    name: "get_subject", title: "Предмет подробно", annotations: RO,
    description: "Всё о предмете: данные, заметки, задания, экзамены в сессиях и прикреплённые файлы (только названия).",
    inputSchema: { type: "object", properties: { subject: { type: "string", description: "Предмет: id или название" } }, required: ["subject"] },
    run(ctx, a) {
      const uid = ctx.uid, insts = instMap(uid), subs = subjMap(uid);
      const s = resolve("subjects", uid, a.subject, "name", "предмет");
      const tasks = own("tasks", uid, "subjectId = {:s}", { s: s.id }, "due");
      const exams = [];
      own("sessions", uid).forEach((se) => (jsonField(se, "exams") || []).forEach((x) => {
        if (x.subjectId === s.id) exams.push({ session: g(se, "title"), session_id: se.id, exam_id: x.id, kind: x.kind || "", date: x.date || "", time: x.time || "", place: x.place || "" });
      }));
      const taskIds = tasks.map((t) => t.id);
      const files = own("attachments", uid).filter((f) => g(f, "subjectId") === s.id || taskIds.indexOf(g(f, "taskId")) >= 0)
        .map((f) => ({ name: g(f, "name"), caption: g(f, "caption"), task_id: g(f, "taskId") }));
      return Object.assign(subjectOut(s, insts, tasks), { notes: g(s, "notes"), tasks: tasks.map((t) => taskOut(t, subs, insts)), exams, files });
    },
  },
  {
    name: "list_tasks", title: "Задания", annotations: RO,
    description: "Задания с фильтрами. По умолчанию все несделанные. Сортировка по сроку.",
    inputSchema: { type: "object", properties: {
      status: { type: "string", enum: ["open", "overdue", "all", "todo", "started", "finishing", "done"], description: "open — все несделанные (по умолчанию), overdue — просроченные, all — все, либо конкретный статус" },
      subject: { type: "string", description: "Предмет: id или название, необязательно" },
      institution: { type: "string", description: "Заведение: id или название, необязательно" },
      due_from: DATE, due_to: DATE,
    } },
    run(ctx, a) {
      const uid = ctx.uid, insts = instMap(uid), subs = subjMap(uid), t = today();
      const st = a.status || "open";
      const subj = a.subject ? resolve("subjects", uid, a.subject, "name", "предмет").id : "";
      const inst = a.institution ? resolve("institutions", uid, a.institution, "name", "заведение").id : "";
      const from = checkDate(a.due_from, "due_from"), to = checkDate(a.due_to, "due_to");
      const list = own("tasks", uid, "", {}, "due").filter((x) => {
        const s = g(x, "status") || "todo", due = g(x, "due");
        if (st === "open" && s === "done") return false;
        if (st === "overdue" && (s === "done" || !due || due >= t)) return false;
        if (TASK_STATUSES.indexOf(st) >= 0 && s !== st) return false;
        if (subj && g(x, "subjectId") !== subj) return false;
        if (inst && !(subs[g(x, "subjectId")] && g(subs[g(x, "subjectId")], "instId") === inst)) return false;
        if (from && (!due || due < from)) return false;
        if (to && (!due || due > to)) return false;
        return true;
      });
      return { today: t, count: list.length, tasks: list.map((x) => taskOut(x, subs, insts)) };
    },
  },
  {
    name: "create_task", title: "Добавить задание", annotations: RW,
    description: "Добавить задание по предмету. Если срок не назван, оставьте due пустым. Дата выдачи по умолчанию сегодня.",
    inputSchema: { type: "object", properties: {
      subject: { type: "string", description: "Предмет: id или название" },
      title: { type: "string", description: "Коротко, что задано" },
      body: { type: "string", description: "Подробности задания, необязательно" },
      issued: DATE, due: DATE,
      status: { type: "string", enum: TASK_STATUSES, description: "По умолчанию todo" },
      notes: { type: "string" },
    }, required: ["subject", "title"] },
    run(ctx, a) {
      const uid = ctx.uid, s = resolve("subjects", uid, a.subject, "name", "предмет");
      if (!String(a.title || "").trim()) bad("Укажите название задания.");
      const r = newRec("tasks", uid);
      r.set("subjectId", s.id);
      r.set("status", "todo");
      r.set("issued", today());
      setFields(r, a, { title: str(500), body: str(20000), notes: str(20000), issued: (v) => checkDate(v, "issued"), due: (v) => checkDate(v, "due"), status: oneOf(TASK_STATUSES, "status") });
      save(r);
      return { created: taskOut(r, subjMap(uid), instMap(uid)) };
    },
  },
  {
    name: "update_task", title: "Изменить задание", annotations: RW,
    description: "Изменить задание: статус, срок, название, описание, заметки или предмет. Передавайте только то, что меняется. Чтобы убрать срок, передайте due пустой строкой.",
    inputSchema: { type: "object", properties: {
      task_id: { type: "string", description: "id задания (из list_tasks или get_overview)" },
      status: { type: "string", enum: TASK_STATUSES }, title: { type: "string" }, body: { type: "string" },
      issued: DATE, due: DATE, notes: { type: "string", description: "Заменяет заметки целиком" },
      notes_append: { type: "string", description: "Добавить строку в конец заметок" },
      subject: { type: "string", description: "Перенести в другой предмет: id или название" },
    }, required: ["task_id"] },
    run(ctx, a) {
      const uid = ctx.uid, r = byId("tasks", uid, a.task_id);
      if (!r) bad("Задание не найдено. Получите id через list_tasks.");
      if (a.subject) r.set("subjectId", resolve("subjects", uid, a.subject, "name", "предмет").id);
      if (a.title !== undefined && !String(a.title).trim()) bad("Название задания не может быть пустым.");
      setFields(r, a, { title: str(500), body: str(20000), notes: str(20000), issued: (v) => checkDate(v, "issued"), due: (v) => checkDate(v, "due"), status: oneOf(TASK_STATUSES, "status") });
      if (a.notes_append) r.set("notes", (g(r, "notes") ? g(r, "notes") + "\n" : "") + String(a.notes_append));
      save(r);
      return { updated: taskOut(r, subjMap(uid), instMap(uid)) };
    },
  },
  {
    name: "create_subject", title: "Добавить предмет", annotations: RW,
    description: "Добавить предмет в учебное заведение.",
    inputSchema: { type: "object", properties: {
      institution: { type: "string", description: "Заведение: id или название" },
      name: { type: "string" },
      control: { type: "string", description: "Форма контроля: Экзамен, Зачёт, Дифференцированный зачёт, Курсовая работа, Контрольная работа, Реферат" },
      date: Object.assign({}, DATE, { description: "Дата сдачи, ГГГГ-ММ-ДД" }),
      teacher: { type: "string" }, notes: { type: "string" },
    }, required: ["institution", "name"] },
    run(ctx, a) {
      const uid = ctx.uid, inst = resolve("institutions", uid, a.institution, "name", "заведение");
      if (!String(a.name || "").trim()) bad("Укажите название предмета.");
      const r = newRec("subjects", uid);
      r.set("instId", inst.id);
      r.set("status", "prep");
      setFields(r, a, { name: str(300), control: str(100), date: (v) => checkDate(v, "date"), teacher: str(300), notes: str(20000) });
      save(r);
      return { created: subjectOut(r, instMap(uid), []) };
    },
  },
  {
    name: "update_subject", title: "Изменить предмет", annotations: RW,
    description: "Изменить предмет: отметить сданным (status passed) с оценкой, поменять дату сдачи, преподавателя, форму контроля, заметки.",
    inputSchema: { type: "object", properties: {
      subject: { type: "string", description: "Предмет: id или название" },
      name: { type: "string" }, status: { type: "string", enum: ["prep", "passed"] }, grade: { type: "string", description: "Оценка, например «отлично» или «зачтено»" },
      control: { type: "string" }, date: DATE, teacher: { type: "string" },
      notes: { type: "string", description: "Заменяет заметки целиком" }, notes_append: { type: "string", description: "Добавить строку в конец заметок" },
    }, required: ["subject"] },
    run(ctx, a) {
      const uid = ctx.uid, r = resolve("subjects", uid, a.subject, "name", "предмет");
      if (a.name !== undefined && !String(a.name).trim()) bad("Название предмета не может быть пустым.");
      setFields(r, a, { name: str(300), status: oneOf(["prep", "passed"], "status"), grade: str(100), control: str(100), date: (v) => checkDate(v, "date"), teacher: str(300), notes: str(20000) });
      if (a.notes_append) r.set("notes", (g(r, "notes") ? g(r, "notes") + "\n" : "") + String(a.notes_append));
      save(r);
      return { updated: subjectOut(r, instMap(uid), own("tasks", uid, "subjectId = {:s}", { s: r.id })) };
    },
  },
  {
    name: "create_institution", title: "Добавить учебное заведение", annotations: RW,
    description: "Добавить учебное заведение (вуз, колледж, курсы).",
    inputSchema: { type: "object", properties: {
      name: { type: "string" },
      color: { type: "string", enum: ["blue", "wine", "green", "amber", "violet"], description: "Цвет метки, по умолчанию blue" },
    }, required: ["name"] },
    run(ctx, a) {
      if (!String(a.name || "").trim()) bad("Укажите название заведения.");
      const r = newRec("institutions", ctx.uid);
      r.set("color", "blue");
      setFields(r, a, { name: str(200), color: oneOf(["blue", "wine", "green", "amber", "violet"], "color") });
      save(r);
      return { created: { id: r.id, name: g(r, "name"), color: g(r, "color") } };
    },
  },
  {
    name: "list_sessions", title: "Сессии", annotations: RO,
    description: "Сессии с датами и списком экзаменов и зачётов. По умолчанию только текущие и будущие.",
    inputSchema: { type: "object", properties: { include_past: { type: "boolean", description: "Показать и прошедшие" } } },
    run(ctx, a) {
      const uid = ctx.uid, t = today(), insts = instMap(uid), subs = subjMap(uid);
      const list = own("sessions", uid, "", {}, "start").filter((s) => a.include_past || !g(s, "start") || (g(s, "end") || g(s, "start")) >= t);
      return { today: t, sessions: list.map((s) => sessionOut(s, insts, subs)) };
    },
  },
  {
    name: "create_session", title: "Добавить сессию", annotations: RW,
    description: "Добавить сессию в учебном заведении. Экзамены добавляются потом через add_exam.",
    inputSchema: { type: "object", properties: {
      institution: { type: "string", description: "Заведение: id или название" }, title: { type: "string", description: "Например «Зимняя сессия 2027»" },
      start: DATE, end: DATE,
    }, required: ["institution", "title"] },
    run(ctx, a) {
      const uid = ctx.uid, inst = resolve("institutions", uid, a.institution, "name", "заведение");
      if (!String(a.title || "").trim()) bad("Укажите название сессии.");
      const r = newRec("sessions", uid);
      r.set("instId", inst.id);
      r.set("exams", []);
      setFields(r, a, { title: str(300), start: (v) => checkDate(v, "start"), end: (v) => checkDate(v, "end") });
      save(r);
      return { created: sessionOut(r, instMap(uid), subjMap(uid)) };
    },
  },
  {
    name: "add_exam", title: "Добавить экзамен в сессию", annotations: RW,
    description: "Добавить экзамен, зачёт или консультацию в сессию.",
    inputSchema: { type: "object", properties: {
      session: { type: "string", description: "Сессия: id или название" },
      subject: { type: "string", description: "Предмет: id или название" },
      kind: { type: "string", enum: EXAM_KINDS, description: "По умолчанию Экзамен" },
      date: DATE, time: { type: "string", description: "Время ЧЧ:ММ, необязательно" }, place: { type: "string", description: "Аудитория или ссылка" },
    }, required: ["session", "subject", "date"] },
    run(ctx, a) {
      const uid = ctx.uid, se = resolve("sessions", uid, a.session, "title", "сессию"), s = resolve("subjects", uid, a.subject, "name", "предмет");
      const date = checkDate(a.date, "date");
      if (!date) bad("Укажите дату экзамена.");
      if (a.time && !/^\d{1,2}:\d{2}$/.test(String(a.time))) bad("Время в формате ЧЧ:ММ, например 09:30.");
      const exams = jsonField(se, "exams") || [];
      const x = { id: "e" + Date.now().toString(36), subjectId: s.id, kind: a.kind ? oneOf(EXAM_KINDS, "kind")(a.kind) : "Экзамен", date, time: String(a.time || ""), place: String(a.place || "").slice(0, 300) };
      exams.push(x);
      se.set("exams", exams);
      save(se);
      return { added: x, session: sessionOut(se, instMap(uid), subjMap(uid)) };
    },
  },
  {
    name: "update_exam", title: "Изменить экзамен", annotations: RW,
    description: "Изменить дату, время, место, вид или предмет экзамена в сессии.",
    inputSchema: { type: "object", properties: {
      session: { type: "string", description: "Сессия: id или название" }, exam_id: { type: "string", description: "id экзамена из list_sessions" },
      subject: { type: "string" }, kind: { type: "string", enum: EXAM_KINDS }, date: DATE, time: { type: "string" }, place: { type: "string" },
    }, required: ["session", "exam_id"] },
    run(ctx, a) {
      const uid = ctx.uid, se = resolve("sessions", uid, a.session, "title", "сессию");
      const exams = jsonField(se, "exams") || [];
      const x = exams.find((e) => e.id === a.exam_id);
      if (!x) bad("Экзамен не найден в этой сессии. Получите exam_id через list_sessions.");
      if (a.subject) x.subjectId = resolve("subjects", uid, a.subject, "name", "предмет").id;
      if (a.kind) x.kind = oneOf(EXAM_KINDS, "kind")(a.kind);
      if (a.date !== undefined) x.date = checkDate(a.date, "date");
      if (a.time !== undefined) { if (a.time && !/^\d{1,2}:\d{2}$/.test(String(a.time))) bad("Время в формате ЧЧ:ММ."); x.time = String(a.time); }
      if (a.place !== undefined) x.place = String(a.place).slice(0, 300);
      se.set("exams", exams);
      save(se);
      return { updated: x, session: sessionOut(se, instMap(uid), subjMap(uid)) };
    },
  },
  {
    name: "get_thesis", title: "Дипломная работа", annotations: RO,
    description: "Дипломная работа: тема, руководитель, сроки, план по этапам, записи (мысли и идеи) и файлы. Если дипломов несколько, без параметра вернутся все кратко.",
    inputSchema: { type: "object", properties: {
      thesis: { type: "string", description: "Диплом: id, название заведения или слово из темы" },
      notes_limit: { type: "integer", description: "Сколько последних записей вернуть, по умолчанию 30" },
    } },
    run(ctx, a) {
      const uid = ctx.uid, insts = instMap(uid);
      const all = own("theses", uid, "", {}, "createdAt");
      if (!all.length) return { theses: [], hint: "Дипломов пока нет." };
      const one = (th) => {
        const stages = own("stages", uid, "thesisId = {:t}", { t: th.id }, "due");
        const notes = own("notes", uid, "thesisId = {:t}", { t: th.id }, "-date,-createdAt").slice(0, Math.max(1, Math.min(200, a.notes_limit || 30)));
        return {
          id: th.id, institution: insts[g(th, "instId")] || "", topic: g(th, "topic"), advisor: g(th, "advisor"), submit: g(th, "submit"), defense: g(th, "defense"),
          stages: stages.map((s) => ({ id: s.id, title: g(s, "title"), due: g(s, "due"), status: g(s, "status") || "todo", status_label: STATUS[g(s, "status") || "todo"] })),
          notes: notes.map((n) => ({ id: n.id, date: g(n, "date"), chapter: g(n, "chapter"), text: g(n, "text") })),
          files: own("attachments", uid, "thesisId = {:t}", { t: th.id }).map((f) => ({ name: g(f, "name"), caption: g(f, "caption") })),
        };
      };
      if (!a.thesis && all.length > 1) return { theses: all.map(one) };
      return one(thesisPick(uid, a.thesis));
    },
  },
  {
    name: "add_thesis_note", title: "Записать мысль к диплому", annotations: RW,
    description: "Добавить запись (мысль, идею, цитату, вопрос руководителю) в раздел «Мысли и идеи» дипломной работы.",
    inputSchema: { type: "object", properties: {
      thesis: { type: "string", description: "Диплом, если их несколько" }, text: { type: "string" },
      chapter: { type: "string", description: "К какой главе или этапу, необязательно" },
    }, required: ["text"] },
    run(ctx, a) {
      const th = thesisPick(ctx.uid, a.thesis);
      if (!String(a.text || "").trim()) bad("Текст записи пустой.");
      const r = newRec("notes", ctx.uid);
      r.set("thesisId", th.id);
      r.set("date", today());
      setFields(r, a, { text: str(50000), chapter: str(300) });
      save(r);
      return { created: { id: r.id, date: g(r, "date"), chapter: g(r, "chapter"), text: g(r, "text") } };
    },
  },
  {
    name: "create_thesis_stage", title: "Добавить этап диплома", annotations: RW,
    description: "Добавить этап в план дипломной работы (например «Глава 1», «Предзащита»).",
    inputSchema: { type: "object", properties: {
      thesis: { type: "string", description: "Диплом, если их несколько" }, title: { type: "string" }, due: DATE,
      status: { type: "string", enum: TASK_STATUSES },
    }, required: ["title"] },
    run(ctx, a) {
      const th = thesisPick(ctx.uid, a.thesis);
      if (!String(a.title || "").trim()) bad("Укажите название этапа.");
      const r = newRec("stages", ctx.uid);
      r.set("thesisId", th.id);
      r.set("status", "todo");
      setFields(r, a, { title: str(500), due: (v) => checkDate(v, "due"), status: oneOf(TASK_STATUSES, "status") });
      save(r);
      return { created: { id: r.id, title: g(r, "title"), due: g(r, "due"), status: g(r, "status") } };
    },
  },
  {
    name: "update_thesis_stage", title: "Изменить этап диплома", annotations: RW,
    description: "Изменить этап плана дипломной работы: статус, срок, название.",
    inputSchema: { type: "object", properties: {
      stage_id: { type: "string", description: "id этапа из get_thesis" }, title: { type: "string" }, due: DATE,
      status: { type: "string", enum: TASK_STATUSES },
    }, required: ["stage_id"] },
    run(ctx, a) {
      const r = byId("stages", ctx.uid, a.stage_id);
      if (!r) bad("Этап не найден. Получите stage_id через get_thesis.");
      if (a.title !== undefined && !String(a.title).trim()) bad("Название этапа не может быть пустым.");
      setFields(r, a, { title: str(500), due: (v) => checkDate(v, "due"), status: oneOf(TASK_STATUSES, "status") });
      save(r);
      return { updated: { id: r.id, title: g(r, "title"), due: g(r, "due"), status: g(r, "status") } };
    },
  },
];

module.exports = { resourceMeta, authServerMeta, register, authorizePage, approve, token, revoke, mcp, cleanup, errorPage };
