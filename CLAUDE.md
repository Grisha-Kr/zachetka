# Моя зачётка — заметки для Claude

Веб-приложение для учёта учёбы. Владелец: Григорий (GitHub: Grisha-Kr). Учится в двух местах (ТОГУ и НББС), пишет два диплома. Приложение многопользовательское: другие люди регистрируются по приглашению.

## Общение с владельцем
- Только на русском. Английские слова и названия сопровождать переводом в скобках.
- Владелец не программист: объяснять простыми словами, команды давать готовыми к вставке, по одной задаче за раз.
- Без длинных тире, без эмодзи, без конструкций «не X, а Y», без пафоса и лишних повторов.

## Стек и почему
- **PocketBase 0.40.3** (одна программа: база SQLite, файлы, вход, панель администратора `/_/`, раздача статики). Выбран ради простоты обслуживания на дешёвом российском VPS без VPN и зарубежных оплат. Версия ещё не 1.0: перед обновлением читать заметки к выпуску; версия зафиксирована в `deploy/install.sh` (`PB_VERSION`).
- Фронтенд без сборки: `pb_public/index.html`, `app.css`, `app.js` (обычный JS, одна IIFE). Библиотеки лежат в `pb_public/vendor/` (PocketBase JS SDK 0.28.1, mammoth для просмотра .docx, JSZip для резервных копий). Шрифты локально в `pb_public/fonts/` (Golos Text, Literata, JetBrains Mono, кириллица + латиница). Внешних CDN нет намеренно.
- PWA: `manifest.webmanifest`, `sw.js` (кэширует только оболочку, `/api/` не трогает). При изменении `app.js`/`app.css` увеличивать `?v=` в `index.html` и `VERSION`/`SHELL` в `sw.js`.

## Данные (pb_migrations/1760000000_init.js)
Все коллекции, кроме `invites`, имеют поле `owner` (связь с users, каскадное удаление) и правила «видит и меняет только владелец». Связи на записи другой коллекции разрешены только на свои записи (`@request.body.X.owner = @request.auth.id`).
- `institutions` (name, color), `subjects` (instId, name, control, status prep/passed, date, grade, teacher, notes), `tasks` (subjectId каскадно, title, body, issued, due, status todo/started/finishing/done, notes), `sessions` (instId, title, start, end, exams JSON), `theses` (instId, topic, advisor, submit, defense), `stages` (thesisId каскадно, title, due, status), `notes` (thesisId каскадно, text, chapter, date), `attachments` (taskId или thesisId каскадно, file защищённый до 20 МБ, name, ext, caption, size).
- Даты хранятся строками `YYYY-MM-DD`. У всех записей есть `createdAt` и `order` (числа, ставит клиент).
- `invites` (code уникальный, note, max_uses, uses, expires): доступ только у `users.role = "admin"`.
- Изменения схемы делать **новой** миграцией в `pb_migrations/`, старую не править: на сервере она уже применена.

## Логика на сервере (pb_hooks/main.pb.js)
- Первый зарегистрированный пользователь получает `role=admin` без приглашения; остальные только с действующим кодом из `invites` (поле `invite` в теле запроса, регистр не важен), счётчик `uses` растёт.
- Роль через API не меняется (правило updateRule у users).
- Размер файла считает сервер; лимит на пользователя `USER_QUOTA_MB` (по умолчанию 500).
- `APP_URL` из окружения пишется в настройки (нужно для писем сброса пароля).
- `GET /api/zachetka/setup` → `{firstRun, owner, contact}` для экрана входа и `privacy.html`.

## Клиент (pb_public/app.js)
- Внутренние ключи состояния: `inst, subjects, tasks, sessions, theses, stages, notes, att` (см. `PBN`). Адаптер `col(key).doc(id).set/update/delete` поверх SDK, id 15 символов генерирует клиент (`newId`).
- Загрузка всего при входе (`loadAll`), живые обновления через `subscribe('*')`, перезагрузка при возврате на вкладку.
- Тема: `zach_theme` в localStorage (auto/light/dark), кнопка солнце/луна в шапке (`#theme-btn`) и блок «Оформление» в профиле; ранний inline-скрипт в `<head>` ставит `data-theme` до загрузки CSS.
- Файлы открываются по токену `pb.files.getToken()`; docx показывается через mammoth, PDF в новой вкладке.
- Резервная копия: zip с `data.json` + `files/`. Импорт пересоздаёт записи с новыми id и тем же форматом (подходит и для архива переноса со старого сайта-артефакта).

## Сервер и выкладка
- Сервер: AdminVPS, тариф Micro (2 ядра, 4 ГБ, 60 ГБ), Ubuntu 24.04. Домен `grishaweb.ru` куплен в Beget (DNS у Beget). Приложение: `https://zachetka.grishaweb.ru`.
- Схема на несколько приложений: Caddy (пакет из apt) слушает 80/443, сам получает сертификаты и проксирует по адресам. Главный файл `/etc/caddy/Caddyfile` импортирует `/etc/caddy/sites/*.caddy`.
- Каждое приложение: папка `/opt/ИМЯ` (код в `src`, данные в `pb_data`, настройки в `ИМЯ.env`), системный пользователь и служба systemd `ИМЯ`, PocketBase на `127.0.0.1:ПОРТ`, файл `/etc/caddy/sites/ИМЯ.caddy`. Порты: zachetka 8090, следующие 8091, 8092 и так далее. Новое приложение = такой же install.sh со своими `APP`, `PORT`, `REPO_URL` и A-запись поддомена в DNS Beget.
- В Caddy намеренно TLS только 1.2 (`protocols tls1.2 tls1.2` в каждом сайте) и HTTP/3 выключен (`servers { protocols h1 h2 }`): в части сетей РФ TLS 1.3 обрывается, так советует AdminVPS.
- Установка: `deploy/install.sh АДРЕС ПОЧТА "ИМЯ"` (адрес полный, например zachetka.grishaweb.ru). ufw: 22/80/443. `BEHIND_PROXY=1` в env включает доверие к X-Forwarded-For.
- Обновление: `bash /opt/zachetka/src/deploy/update.sh` (git pull + перезапуск, перед этим копия базы).
- Резервные копии PocketBase: ежедневно в 3:00, хранится 14. Хостинг делает еженедельную копию сервера. Владельцу советовать скачивать копии к себе.

## Проверка перед выкладкой
Локально: `./pocketbase serve --dir /tmp/pbtest --publicDir pb_public --hooksDir pb_hooks --migrationsDir pb_migrations`, затем проверить в браузере регистрацию владельца, приглашение, второго пользователя (не видит чужие записи), загрузку и открытие файла, резервную копию и её загрузку. `node --check pb_public/app.js` перед каждым коммитом.
