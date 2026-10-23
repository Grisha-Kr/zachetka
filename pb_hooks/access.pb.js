/// <reference path="../pb_data/types.d.ts" />

// Доступ на срок: когда срок прошёл или стоит пауза, записи можно только смотреть.
// Логика в access_lib.js.

const DATA = ["institutions", "subjects", "tasks", "sessions", "theses", "stages", "notes", "attachments"];

onRecordCreateRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);
onRecordUpdateRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);
onRecordDeleteRequest((e) => { require(`${__hooks}/access_lib.js`).guard(e); e.next(); }, ...DATA);

routerAdd("GET", "/api/zachetka/access", (e) => require(`${__hooks}/access_lib.js`).myAccess(e), $apis.requireAuth("users"));
routerAdd("GET", "/api/zachetka/admin/users", (e) => require(`${__hooks}/access_lib.js`).adminUsers(e), $apis.requireAuth("users"));
routerAdd("POST", "/api/zachetka/admin/access", (e) => require(`${__hooks}/access_lib.js`).adminAccess(e), $apis.requireAuth("users"));
