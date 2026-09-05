# Dark — Discord-бот с веб-панелью

Многофункциональный Discord-бот **Dark**: уровни/экономика, модерация с автомодом,
роли по реакциям, временные голосовые каналы, кастомные команды, автороль и приветствия,
музыка (YouTube/SoundCloud/Spotify-ссылки) и оповещения о новых видео/стримах (YouTube/Twitch).
Всё это управляется как слэш-командами в Discord, так и через веб-панель с входом через Discord OAuth2.

## Стек

- **Discord.js v14** (Node.js) — сам бот
- **Express + EJS** — веб-панель (без сборки, серверный рендеринг)
- **SQLite (через Sequelize)** — база данных, один файл, не требует отдельного сервера БД
- **play-dl + @discordjs/voice** — музыка
- **passport-discord** — OAuth2-вход в панель

Бот и веб-панель — это два отдельных процесса (`bot/index.js` и `web/index.js`), которые
читают и пишут в одну и ту же SQLite-базу. Поэтому изменения из панели сразу видны боту и наоборот.

## 1. Создание приложения в Discord

1. Зайдите на https://discord.com/developers/applications → **New Application**.
2. Вкладка **Bot** → **Add Bot**. Скопируйте токен → это `DISCORD_TOKEN`.
   Включите **Message Content Intent**, **Server Members Intent** — они обязательны.
3. Вкладка **OAuth2 → General**: скопируйте **Client ID** (`DISCORD_CLIENT_ID`) и
   **Client Secret** (`DISCORD_CLIENT_SECRET`).
4. Там же в **Redirects** добавьте: `http://ВАШ_ДОМЕН_ИЛИ_IP:3000/auth/callback`
   (или `http://localhost:3000/auth/callback` для локального теста).
5. Чтобы пригласить бота на сервер, сформируйте ссылку в **OAuth2 → URL Generator**:
   scopes `bot` + `applications.commands`, права — как минимум Manage Roles, Manage Channels,
   Kick/Ban Members, Moderate Members, Manage Messages, Connect/Speak (для музыки).

## 2. Установка на VPS

Требуется Node.js 18+ (лучше 20+).

```bash
git clone <ваш-репозиторий-или-распакуйте-архив> dark-bot
cd dark-bot
npm install
cp .env.example .env
nano .env   # заполните DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, WEB_BASE_URL
```

Заполните `.env` — как минимум:
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `WEB_BASE_URL` — публичный адрес панели, например `http://ваш-ip:3000`
- `SESSION_SECRET` — любая длинная случайная строка
- `BOT_OWNER_IDS` — ваш Discord ID через запятую, если хотите иметь доступ ко всем серверам в панели

Зарегистрируйте слэш-команды (при каждом изменении команд запускать заново):

```bash
npm run deploy-commands
```

Запустите бота и панель. Проще всего через **pm2**, чтобы оба процесса рестартовали при падении и сервере:

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # настроит автозапуск pm2 при перезагрузке сервера
```

Панель будет доступна на `http://ваш-ip:3000`. Для продакшена рекомендуется поставить перед ней
nginx с HTTPS (Let's Encrypt) и проксировать на порт из `WEB_PORT`.

Логи: `pm2 logs dark-bot` / `pm2 logs dark-web`.

## 2b. Альтернатива — через Docker

```bash
cp .env.example .env   # заполнить так же, как выше
docker compose up -d --build
```

Один контейнер запускает и бота, и панель через pm2-runtime, база данных лежит в `./data`.

## 3. Дополнительные интеграции (необязательно)

- **Оповещения YouTube**: получите ключ на https://console.cloud.google.com (YouTube Data API v3),
  впишите в `YOUTUBE_API_KEY`.
- **Оповещения Twitch**: создайте приложение на https://dev.twitch.tv/console,
  впишите `TWITCH_CLIENT_ID` и `TWITCH_CLIENT_SECRET`.

Без этих ключей соответствующие подкоманды (`/manage alert youtube`, `/manage alert twitch`) просто ответят, что интеграция не настроена — остальной бот при этом работает нормально.

## Возможности

Команд специально мало — вся функциональность спрятана в подкомандах (наберите `/` и Discord подскажет варианты).

**Для всех участников:**

| Команда | Что делает |
|---|---|
| `/profile view [пользователь]` | Уровень, опыт, баланс, число сообщений |
| `/profile top` | Таблица лидеров сервера по опыту |
| `/economy daily` | Забрать ежедневную награду |
| `/economy pay <пользователь> <сумма>` | Перевести валюту другому участнику |
| `/music play/skip/stop/pause/resume/queue/volume` | Управление музыкой в голосовом канале |
| `/help` | Список всех команд с подкомандами |
| Контекстное меню "Пожаловаться на сообщение" | Отправить жалобу модераторам |

**Для администрации** (требуют соответствующих прав Discord):

| Команда | Что делает |
|---|---|
| `/moderation warn/unwarn/warnings/mute/unmute/kick/ban/unban/clear` | Вся модерация в одной команде |
| `/manage command add/remove/list` | Кастомные текстовые команды |
| `/manage reactionrole add/remove` | Роли по реакциям на сообщение |
| `/manage tempvoice setup/disable` | Временные голосовые каналы |
| `/manage alert youtube/twitch/remove/list` | Оповещения о новых видео/стримах |
| `/settings logchannel/reportchannel/levelupchannel/welcome/autorole/prefix/currency` | Общие настройки сервера |
| `/automod toggle/addword/removeword/listwords/invites/antispam` | Автомодерация |

Все те же настройки (кроме музыки) можно менять и через веб-панель — оба способа пишут в одну базу данных, изменения применяются мгновенно.

## Важные ограничения

- **Музыка**: полноценное воспроизведение из Spotify/Яндекс.Музыки как аудиопотока напрямую
  технически невозможно без нарушения условий их API — вместо этого Spotify-ссылки резолвятся
  в метаданные трека, а сам звук ищется и стримится с YouTube. YouTube, SoundCloud и прямые
  ссылки на аудио работают "напрямую".
- **Оповещения**: реализованы через периодический опрос (polling) публичных API YouTube/Twitch
  раз в несколько минут, а не через мгновенные webhooks — этого достаточно для большинства серверов,
  но не мгновенно секунда-в-секунду.
- Начисление опыта происходит только за текстовые сообщения (как большинство подобных ботов);
  войс-активность не учитывается, но легко добавляется в `bot/modules/leveling.js`.

## Структура проекта

```
dark-bot/
  bot/            — сам Discord-бот (discord.js)
    commands/     — слэш-команды по категориям
    events/       — обработчики событий Discord
    modules/      — бизнес-логика (уровни, automod, музыка, оповещения)
    utils/        — общие хелперы (эмбеды, права, логи, журнал модерации)
  db/             — модели Sequelize + инициализация SQLite
  web/            — Express-панель (EJS-шаблоны, OAuth2, роуты)
  ecosystem.config.js — конфиг PM2 для запуска обоих процессов
  docker-compose.yml / Dockerfile — опциональный запуск в контейнере
```

Дальнейшее развитие: добавляйте новые слэш-команды в `bot/commands/<категория>/`,
новые страницы панели — в `web/views/dashboard/` + маршрут в `web/routes/dashboard.js`.
Оба процесса используют общую базу `db/`, поэтому новые поля достаточно добавить в модель — Sequelize создаст колонку автоматически при следующем запуске (`sequelize.sync()`).
