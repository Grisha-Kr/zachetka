/// <reference path="../pb_data/types.d.ts" />

// Доступ на срок: у пользователя дата «доступ до» и ручная пауза.
// Когда срок прошёл или стоит пауза, человек может только смотреть и скачивать свои данные.
// В приглашении можно задать срок для новых пользователей. История продлений в access_log.
// Фото профиля: стандартное поле avatar, только растровые картинки до 2 МБ.

const PROTECT = " && @request.body.access_until:isset = false && @request.body.suspended:isset = false";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("access_until")) users.fields.add(new TextField({ name: "access_until", max: 10 }));
  if (!users.fields.getByName("suspended")) users.fields.add(new BoolField({ name: "suspended" }));
  // менять срок и паузу может только сервер по команде администратора
  if (users.updateRule.indexOf("access_until") < 0) users.updateRule += PROTECT;
  const avatar = users.fields.getByName("avatar");
  if (avatar) {
    avatar.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    avatar.maxSize = 2 * 1024 * 1024;
    avatar.thumbs = ["96x96"];
  }
  app.save(users);

  const invites = app.findCollectionByNameOrId("invites");
  if (!invites.fields.getByName("access_period")) invites.fields.add(new TextField({ name: "access_period", max: 10 }));
  app.save(invites);

  app.save(new Collection({
    type: "base",
    name: "access_log",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
      { type: "text", name: "by_name", max: 300 },
      { type: "text", name: "action", max: 30 },
      { type: "text", name: "until_before", max: 10 },
      { type: "text", name: "until_after", max: 10 },
      { type: "text", name: "note", max: 1000 },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_access_log_user ON access_log (user)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("access_log")); } catch (_) {}
  const invites = app.findCollectionByNameOrId("invites");
  invites.fields.removeByName("access_period");
  app.save(invites);
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = users.updateRule.replace(PROTECT, "");
  users.fields.removeByName("access_until");
  users.fields.removeByName("suspended");
  app.save(users);
});
