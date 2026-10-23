/// <reference path="../pb_data/types.d.ts" />

// Подключение нейросетей (ChatGPT, Claude, Perplexity) по MCP.
// Адрес для подключения: https://АДРЕС/mcp. Вход через OAuth: нейросеть открывает
// страницу /oauth/authorize, пользователь входит в зачётку и нажимает «Разрешить».
// Логика лежит в ai_lib.js.

routerAdd("GET", "/.well-known/oauth-protected-resource", (e) => require(`${__hooks}/ai_lib.js`).resourceMeta(e));
routerAdd("GET", "/.well-known/oauth-protected-resource/mcp", (e) => require(`${__hooks}/ai_lib.js`).resourceMeta(e));
routerAdd("GET", "/.well-known/oauth-authorization-server", (e) => require(`${__hooks}/ai_lib.js`).authServerMeta(e));
routerAdd("GET", "/.well-known/oauth-authorization-server/mcp", (e) => require(`${__hooks}/ai_lib.js`).authServerMeta(e));
routerAdd("GET", "/.well-known/openid-configuration", (e) => require(`${__hooks}/ai_lib.js`).authServerMeta(e));

routerAdd("POST", "/oauth/register", (e) => require(`${__hooks}/ai_lib.js`).register(e));
routerAdd("GET", "/oauth/authorize", (e) => require(`${__hooks}/ai_lib.js`).authorizePage(e));
// «Отмена» работает без входа, «Разрешить» проверяет вход внутри approve()
routerAdd("POST", "/oauth/approve", (e) => require(`${__hooks}/ai_lib.js`).approve(e));
routerAdd("POST", "/oauth/token", (e) => require(`${__hooks}/ai_lib.js`).token(e));
routerAdd("POST", "/oauth/revoke", (e) => require(`${__hooks}/ai_lib.js`).revoke(e));

routerAdd("POST", "/mcp", (e) => require(`${__hooks}/ai_lib.js`).mcp(e));
// Поток событий от сервера не нужен: все ответы приходят сразу в ответ на POST
routerAdd("GET", "/mcp", (e) => e.json(405, { error: "Use POST" }));
routerAdd("DELETE", "/mcp", (e) => e.noContent(204));

// Каждую ночь убираем просроченные коды, доступы и неиспользованные регистрации
cronAdd("ai_cleanup", "17 4 * * *", () => require(`${__hooks}/ai_lib.js`).cleanup());
