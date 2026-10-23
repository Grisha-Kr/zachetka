// Доступ на срок и пауза. Подключается через require() внутри обработчиков
// (access.pb.js, main.pb.js, ai_lib.js).
// Правило: администратор всегда с доступом. Остальные с доступом, если нет паузы
// и дата access_until пустая (бессрочно) или ещё не прошла (последний день включительно).
// Без доступа можно смотреть и скачивать свои данные, менять ничего нельзя.

function today() {
  const off = parseFloat($os.getenv("APP_TZ_OFFSET"));
  return new Date(Date.now() + (isNaN(off) ? 10 : off) * 3600 * 1000).toISOString().slice(0, 10);
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(new Date(v + "T00:00:00Z").getTime());
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Прибавить месяцы: 31 января + 1 месяц = 28 (29) февраля
function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}
// Срок из приглашения: "" бессрочно, "7d", "14d", "1m", "3m"
const PERIODS = { "": "бессрочно", "7d": "7 дней", "14d": "14 дней", "1m": "1 месяц", "3m": "3 месяца" };
function untilFor(period) {
  const m = /^(\d+)([dm])$/.exec(String(period || ""));
  if (!m) return "";
  return m[2] === "d" ? addDays(today(), +m[1]) : addMonths(today(), +m[1]);
}

function state(user) {
  const admin = user.getString("role") === "admin";
  const until = user.getString("access_until");
  const suspended = user.getBool("suspended");
  const t = today();
  let reason = "";
  if (!admin && suspended) reason = "suspended";
  else if (!admin && until && until < t) reason = "expired";
  return { admin, until, suspended, active: !reason, reason, today: t };
}
function contact() { return $os.getenv("CONTACT_EMAIL") || "администратору"; }
function message() {
  return "Доступ приостановлен: можно смотреть и скачивать записи, а добавлять и менять нельзя. Чтобы продлить доступ, напишите: " + contact() + ".";
}
// Для обработчиков создания, изменения и удаления записей
function guard(e) {
  if (e.hasSuperuserAuth() || !e.auth || e.auth.collection().name !== "users") return;
  if (!state(e.auth).active) throw new ForbiddenError(message());
}

/* ---------- Раздел «Пользователи» для администратора ---------- */
function requireAdmin(e) {
  if (!e.auth || e.auth.collection().name !== "users" || e.auth.getString("role") !== "admin") throw new ForbiddenError("Только для администратора.");
}
function userOut(u, sizes, logs) {
  const st = state(u);
  return {
    id: u.id, name: u.getString("name"), email: u.getString("email"), avatar: u.getString("avatar"),
    created: u.getString("created"), role: u.getString("role") || "user",
    access_until: st.until, suspended: st.suspended, active: st.active, reason: st.reason,
    files_size: sizes[u.id] || 0,
    log: (logs[u.id] || []).slice(0, 20),
  };
}
function adminUsers(e) {
  requireAdmin(e);
  const sizes = {};
  const rows = arrayOf(new DynamicModel({ owner: "", total: 0 }));
  $app.db().select("owner", "COALESCE(SUM(size), 0) as total").from("attachments").groupBy("owner").all(rows);
  for (const r of rows) sizes[r.owner] = r.total;
  const logs = {};
  for (const l of $app.findRecordsByFilter("access_log", "id != ''", "-created", 2000, 0)) {
    const u = l.getString("user");
    (logs[u] = logs[u] || []).push({
      created: l.getString("created"), by: l.getString("by_name"), action: l.getString("action"),
      until_before: l.getString("until_before"), until_after: l.getString("until_after"), note: l.getString("note"),
    });
  }
  const users = $app.findAllRecords("users").map((u) => userOut(u, sizes, logs));
  return e.json(200, { today: today(), contact: contact(), users });
}
function adminAccess(e) {
  requireAdmin(e);
  const b = e.requestInfo().body || {};
  let u;
  try { u = $app.findRecordById("users", String(b.user || "")); } catch (_) { throw new NotFoundError("Пользователь не найден."); }
  const note = String(b.note || "").trim().slice(0, 1000);
  const before = u.getString("access_until");
  const t = today();
  const action = String(b.action || "");
  if (u.getString("role") === "admin" && action !== "note") throw new BadRequestError("У администратора доступ всегда бессрочный.");
  switch (action) {
    case "extend": {
      const months = parseInt(b.months, 10);
      if (!(months >= 1 && months <= 24)) throw new BadRequestError("Продлить можно на 1–24 месяца.");
      // продление считается от даты окончания, если она ещё не прошла, иначе от сегодня
      const from = before && before >= t ? before : t;
      u.set("access_until", addMonths(from, months));
      u.set("suspended", false);
      break;
    }
    case "set": {
      if (!isDate(b.date)) throw new BadRequestError("Укажите дату.");
      u.set("access_until", String(b.date));
      u.set("suspended", false);
      break;
    }
    case "unlimited": u.set("access_until", ""); u.set("suspended", false); break;
    case "suspend": u.set("suspended", true); break;
    case "resume": u.set("suspended", false); break;
    case "note": if (!note) throw new BadRequestError("Заметка пустая."); break;
    default: throw new BadRequestError("Неизвестное действие.");
  }
  if (action !== "note") $app.save(u);
  const log = new Record($app.findCollectionByNameOrId("access_log"));
  log.set("user", u.id);
  log.set("by_name", e.auth.getString("name") || e.auth.getString("email"));
  log.set("action", action + (action === "extend" ? ":" + parseInt(b.months, 10) : ""));
  log.set("until_before", before);
  log.set("until_after", u.getString("access_until"));
  log.set("note", note);
  $app.save(log);
  return e.json(200, { ok: true });
}

// Своё состояние доступа для приложения
function myAccess(e) {
  const st = state(e.auth);
  return e.json(200, { active: st.active, reason: st.reason, until: st.until, suspended: st.suspended, admin: st.admin, today: st.today, contact: contact() });
}

module.exports = { today, state, guard, message, untilFor, PERIODS, adminUsers, adminAccess, myAccess };
