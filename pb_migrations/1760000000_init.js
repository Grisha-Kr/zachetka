/// <reference path="../pb_data/types.d.ts" />

// Начальная схема «Моей зачётки»: коллекции, поля и правила доступа.
// Каждый пользователь видит и меняет только свои записи (поле owner).

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  // --- пользователи: роль (обычный / администратор) ---
  if (!users.fields.getByName("role")) {
    users.fields.add(new SelectField({ name: "role", values: ["user", "admin"], maxSelect: 1 }));
  }
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.createRule = "";
  // роль менять через API нельзя, только из панели администратора
  users.updateRule = "id = @request.auth.id && @request.body.role:isset = false";
  users.deleteRule = "id = @request.auth.id";
  app.save(users);

  const OWN_LIST = "owner = @request.auth.id";
  const OWN_CREATE = '@request.auth.id != "" && @request.body.owner = @request.auth.id';
  const OWN_UPDATE = "owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)";

  // связь с записью другой коллекции разрешена, только если та запись тоже ваша
  const relCreate = (field) => ` && (@request.body.${field} = "" || @request.body.${field}.owner = @request.auth.id)`;
  const relUpdate = (field) => ` && (@request.body.${field}:isset = false || @request.body.${field} = "" || @request.body.${field}.owner = @request.auth.id)`;

  const ownerField = () => ({ type: "relation", name: "owner", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 });
  const txt = (name, max, required) => ({ type: "text", name, max: max || 500, required: !!required });
  const num = (name) => ({ type: "number", name });
  const rel = (name, collection, cascade) => ({ type: "relation", name, collectionId: collection.id, cascadeDelete: !!cascade, maxSelect: 1 });

  function owned(name, fields, rels) {
    rels = rels || [];
    const c = new Collection({
      type: "base",
      name,
      listRule: OWN_LIST,
      viewRule: OWN_LIST,
      createRule: OWN_CREATE + rels.map(relCreate).join(""),
      updateRule: OWN_UPDATE + rels.map(relUpdate).join(""),
      deleteRule: OWN_LIST,
      fields: [ownerField(), ...fields, num("createdAt"), num("order"),
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true }],
      indexes: [`CREATE INDEX idx_${name}_owner ON ${name} (owner)`],
    });
    app.save(c);
    return c;
  }

  const institutions = owned("institutions", [txt("name", 200, true), txt("color", 20)]);

  const subjects = owned("subjects", [
    rel("instId", institutions),
    txt("name", 300, true), txt("control", 100), txt("status", 20), txt("date", 10),
    txt("grade", 100), txt("teacher", 300), txt("notes", 20000),
  ], ["instId"]);

  const tasks = owned("tasks", [
    rel("subjectId", subjects, true),
    txt("title", 500, true), txt("body", 20000), txt("issued", 10), txt("due", 10),
    txt("status", 20), txt("notes", 20000),
  ], ["subjectId"]);

  owned("sessions", [
    rel("instId", institutions),
    txt("title", 300, true), txt("start", 10), txt("end", 10),
    { type: "json", name: "exams", maxSize: 200000 },
  ], ["instId"]);

  const theses = owned("theses", [
    rel("instId", institutions),
    txt("topic", 2000), txt("advisor", 300), txt("submit", 10), txt("defense", 10),
  ], ["instId"]);

  owned("stages", [
    rel("thesisId", theses, true),
    txt("title", 500, true), txt("due", 10), txt("status", 20),
  ], ["thesisId"]);

  owned("notes", [
    rel("thesisId", theses, true),
    txt("text", 50000, true), txt("chapter", 300), txt("date", 10),
  ], ["thesisId"]);

  owned("attachments", [
    rel("taskId", tasks, true),
    rel("thesisId", theses, true),
    { type: "file", name: "file", required: true, maxSelect: 1, maxSize: 20 * 1024 * 1024, protected: true },
    txt("name", 300), txt("ext", 10), txt("caption", 1000), num("size"),
  ], ["taskId", "thesisId"]);

  // --- приглашения: видит и создаёт только администратор приложения ---
  const ADMIN = '@request.auth.role = "admin"';
  app.save(new Collection({
    type: "base",
    name: "invites",
    listRule: ADMIN, viewRule: ADMIN, createRule: ADMIN, updateRule: ADMIN, deleteRule: ADMIN,
    fields: [
      txt("code", 40, true), txt("note", 300), num("max_uses"), num("uses"), txt("expires", 10),
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_invites_code ON invites (code)"],
  }));

  // --- настройки: имя приложения и ежедневные резервные копии в 3:00, храним 14 ---
  const s = app.settings();
  s.meta.appName = "Моя зачётка";
  s.backups.cron = "0 3 * * *";
  s.backups.cronMaxKeep = 14;
  app.save(s);
}, (app) => {
  for (const name of ["invites", "attachments", "notes", "stages", "theses", "sessions", "tasks", "subjects", "institutions"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
