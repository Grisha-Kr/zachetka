/// <reference path="../pb_data/types.d.ts" />

// Подключение нейросетей (ChatGPT, Claude, Perplexity) через MCP и OAuth.
// ai_clients — зарегистрированные приложения нейросетей,
// ai_codes   — одноразовые коды входа (живут 10 минут),
// ai_grants  — выданные доступы: пользователь видит свои и может отключить.
// С ai_clients и ai_codes работает только сервер (правила null).

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const txt = (name, max, extra) => Object.assign({ type: "text", name, max: max || 500 }, extra || {});
  const num = (name, extra) => Object.assign({ type: "number", name }, extra || {});
  const created = { type: "autodate", name: "created", onCreate: true };

  app.save(new Collection({
    type: "base",
    name: "ai_clients",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      txt("client_id", 2000, { required: true }), txt("secret_hash", 100), txt("name", 200),
      { type: "json", name: "redirect_uris", maxSize: 20000 },
      num("last_used"), created,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ai_clients_cid ON ai_clients (client_id)"],
  }));

  app.save(new Collection({
    type: "base",
    name: "ai_codes",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      txt("code_hash", 100, { required: true }),
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      txt("client_id", 2000), txt("client_name", 200), txt("redirect_uri", 2000), txt("challenge", 200), txt("scope", 500), txt("resource", 500),
      num("expires"), created,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ai_codes_hash ON ai_codes (code_hash)"],
  }));

  app.save(new Collection({
    type: "base",
    name: "ai_grants",
    listRule: "user = @request.auth.id", viewRule: "user = @request.auth.id",
    createRule: null, updateRule: null, deleteRule: "user = @request.auth.id",
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      txt("client_id", 2000, { hidden: true }), txt("client_name", 200), txt("redirect_host", 300),
      txt("access_hash", 100, { hidden: true }), num("access_exp", { hidden: true }),
      txt("refresh_hash", 100, { hidden: true }), num("refresh_exp", { hidden: true }),
      num("last_used"), created,
    ],
    indexes: [
      "CREATE INDEX idx_ai_grants_user ON ai_grants (user)",
      "CREATE INDEX idx_ai_grants_access ON ai_grants (access_hash)",
      "CREATE INDEX idx_ai_grants_refresh ON ai_grants (refresh_hash)",
    ],
  }));
}, (app) => {
  for (const name of ["ai_grants", "ai_codes", "ai_clients"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
