<p align="center">
  <img src="./assets/banner.png" alt="Dark" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20%2B-e3a857?style=flat-square" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/discord.js-v14-e3a857?style=flat-square" alt="discord.js v14" />
  <img src="https://img.shields.io/badge/SQLite-Sequelize-e3a857?style=flat-square" alt="SQLite" />
  <img src="https://img.shields.io/badge/license-MIT-e3a857?style=flat-square" alt="MIT" />
</p>

# Dark

Discord-бот с веб-панелью. Команд мало, возможностей много: всё спрятано в подкоманды,
а то же самое можно настроить в браузере после входа через Discord.

- **Профиль-карточка и таблица лидеров** — красивые изображения: уровень, место на сервере, обе валюты, время в голосовых; в топе переключатель Общий / Голос
- **Один уровень** от сообщений и времени в голосе: у чата и голоса свои настройки, голосовой опыт ведёт отдельный рейтинг. **Роли за уровни** настраиваются в панели
- **Объявление о новом уровне в чате голосового канала:** если участник сидит в голосовом канале, поздравление приходит в чат этого канала (не в AFK-канал); если у бота нет прав или чат закрыт, сообщение уходит в обычный канал объявлений. Включается переключателем в «Уровнях»; боту нужны права «Просмотр канала» и «Отправлять сообщения» в голосовых каналах
- **Две валюты:** монеты (за сообщения, минуты в голосе, ежедневную награду) и кристаллы (за новые уровни); названия и награды настраиваются в панели
- **Экономика** — ежедневная награда, переводы
- **Ручное изменение уровня** — в веб-панели («Уровни» → «Изменить уровень участника», или нажмите на уровень участника в лидерборде): добавить, убавить или задать точный уровень; роли за уровни обновляются сразу
- **Функции** — страница «Функции» в веб-панели: любую часть бота (уровни, экономику, магазин, музыку, автомодерацию, приветствие, роли по реакциям, свои команды, временные голосовые, оповещения, жалобы) можно включить и выключить; настройки и данные при этом сохраняются
- **Музыка** — YouTube, SoundCloud (треки, плейлисты, поиск `sc: название`; работает через yt-dlp), ссылки Spotify (через поиск на YouTube); бот сам выходит из голосового после 5 минут простоя
- **Модерация и автомодерация** (в духе YAGPDB) — дела с номерами, предупреждения с автоматическим наказанием (3 предупреждения → мут, 5 → бан и т. д.) и сроком действия, мут и бан на срок (`30m`, `2h`, `7d`; временный бан снимается сам), личные уведомления участнику, заметки и история, `clear` по участнику, `slowmode` и `lock`; автомодерация: запрещённые слова, приглашения и любые ссылки (с белым списком сайтов), упоминания, заглавные буквы, эмодзи, повторы и спам, с наказанием (удалить / предупредить / замутить) и исключениями по каналам и ролям; журнал, жалобы на сообщения
- **Логи сервера** — форум с темами по видам событий (сообщения, участники, наказания, голосовые, файлы, сервер, роли, каналы); создаётся одной кнопкой в панели («Логи сервера»), записи идут через вебхук с аватаркой бота; по журналу аудита показывается, кто сделал изменение (нужно право «Просмотр журнала аудита» — оно есть в ссылке-приглашении), в том числе кто выгнал участника
- **Резерв на 14 дней** — если бота убрали с сервера (например, случайно), все настройки, уровни, магазин и предупреждения хранятся 14 дней; добавьте бота обратно — всё продолжит работать. Через 14 дней данные сервера удаляются. После возврата зайдите на «Логи сервера» и нажмите «Сохранить»: бот создаст новый вебхук и использует прежние темы
- **Сервер** — роли по реакциям, автороль, приветствия, временные голосовые каналы, свои команды
- **Оповещения** о видео на YouTube и стримах Twitch
- **Веб-панель** — тёмная тема, вход через Discord, HTTPS

## Команды

Всего 6 команд. Наберите `/`, и Discord покажет подкоманды.

**Для участников**

| Команда | Действие |
|---|---|
| `/profile` · `/top` | Карточка профиля и таблица лидеров (изображения) |
| `/daily` · `/balance` · `/pay` | Награда раз в сутки (растёт при серии дней подряд), баланс и перевод монет или кристаллов |
| `/shop` | Магазин сервера: роли и предметы за монеты или кристаллы; товары правятся в веб-панели |
| `/play` | Музыка в голосовом канале. Всё остальное кнопками на панели: назад, пауза, пропуск, очередь, стоп, громкость |
| `/help` | Список команд |
| Меню сообщения → **Report message** | Жалоба модераторам |

**Для администрации**

| Команда | Действие |
|---|---|
| `/mod` | `warn` `unwarn` `warnings` `clearwarns` `mute` `unmute` `kick` `ban` `unban` `clear` `note` `case` `history` `reason` `slowmode` `lock` `unlock` |

Всё остальное настраивается в веб-панели, команд для этого нет: каналы логов и жалоб, приветствие и автороль,
уровни и валюта, автомодерация, роли по реакциям, свои команды и префикс, временные голосовые, оповещения.

## Быстрый старт

### 1. Приложение в Discord

1. [Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** → **Reset Token** → это `DISCORD_TOKEN`.
3. В **Privileged Gateway Intents** включите **Server Members** и **Message Content**.
   Без них бот не запустится (`Used disallowed intents`).
4. **OAuth2** → скопируйте **Client ID** и **Client Secret**.
5. **OAuth2 → Redirects** → добавьте `https://ВАШ_ДОМЕН:8843/auth/callback`.
6. Пригласите бота (scopes `bot` и `applications.commands`):
   ```
   https://discord.com/oauth2/authorize?client_id=ВАШ_CLIENT_ID&scope=bot%20applications.commands&permissions=1100336983254
   ```

Бот просит только нужные права (не «Администратор»): просмотр и отправка сообщений, вложения, управление сообщениями, ролями, каналами и вебхуками, кик, бан, тайм-аут, голосовые каналы. Та же ссылка стоит на кнопке приглашения в веб-панели. Чтобы кнопка «Добавить приложение» в профиле бота давала те же права, укажите их в Developer Portal → **Installation** → **Default Install Settings** (scopes `bot`, `applications.commands`, те же права).

Роль бота должна стоять выше ролей, которыми он управляет.

Для форума логов боту нужны права «Управлять каналами», «Управлять вебхуками» и «Просмотр журнала аудита» (они уже есть в ссылке-приглашении). Если бот был добавлен раньше — выдайте их его роли вручную.

### 2. Сервер (Ubuntu)

```bash
sudo apt update
sudo apt install -y git ffmpeg python3 build-essential nginx certbot
```

Node.js 20 или новее:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

yt-dlp (нужен для музыки):

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

Проект:

```bash
cd /opt
git clone git@github.com:ВАШ_АККАУНТ/ВАШ_РЕПОЗИТОРИЙ.git dark-bot
cd dark-bot
npm install
cp .env.example .env
nano .env
npm run deploy-commands
```

Запуск:

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 3. Файл `.env`

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# ID вашего сервера: deploy-commands очистит на нём старые серверные копии команд.
DEV_GUILD_ID=

WEB_PORT=3000
WEB_BASE_URL=https://ВАШ_ДОМЕН:8843
SESSION_SECRET=      # openssl rand -hex 32
BOT_OWNER_IDS=       # ваш Discord ID

DATABASE_PATH=./data/dark.sqlite

# необязательно
YOUTUBE_API_KEY=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
ALERT_POLL_INTERVAL_MINUTES=5
```

- `WEB_PORT` — внутренний порт панели. Не ставьте туда 8843 или 8880: их занимает nginx.
- `WEB_BASE_URL` должен начинаться с `https://`, иначе вход через Discord не сохранит сессию.
- После правки `.env`: `pm2 restart all --update-env`.

### 4. HTTPS на нестандартных портах

Порты 80 и 443 не нужны: **8843** отдаёт HTTPS, **8880** перенаправляет на него.

```
Браузер → https:8843 → nginx → панель (localhost:3000)
```

<details>
<summary>Сертификат Let's Encrypt через DNS (DuckDNS или другой домен)</summary>

```bash
sudo certbot certonly --manual --preferred-challenges dns -d ВАШ_ДОМЕН
```

Сертификат ляжет в `/etc/letsencrypt/live/ВАШ_ДОМЕН/`. Для DuckDNS TXT-запись ставится запросом
`https://www.duckdns.org/update?domains=ИМЯ&token=ТОКЕН&txt=ЗНАЧЕНИЕ` — его можно вынести в
`--manual-auth-hook` и `--manual-cleanup-hook`, тогда продление пройдёт без участия человека.
Токен DuckDNS секретный: если он попал в чат или скриншот, перевыпустите его на сайте.

</details>

<details>
<summary>Конфиг nginx</summary>

Файл `/etc/nginx/conf.d/dark-bot.conf`:

```nginx
server {
    listen 8880;
    server_name ВАШ_ДОМЕН;
    return 301 https://$host:8843$request_uri;
}

server {
    listen 8843 ssl;
    server_name ВАШ_ДОМЕН;

    ssl_certificate     /etc/letsencrypt/live/ВАШ_ДОМЕН/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ВАШ_ДОМЕН/privkey.pem;

    client_max_body_size 25m;   # для импорта уровней

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl restart nginx
sudo ufw allow 8880/tcp    # если включён ufw
sudo ufw allow 8843/tcp
```

</details>

Панель: **https://ВАШ_ДОМЕН:8843**

## Обновление через GitHub

Код попадает на сервер только через GitHub.

1. В GitHub Desktop проверьте, что в списке изменений есть все файлы (в том числе `package.json`).
2. **Commit to main**, затем отдельно **Push origin**.
3. Убедитесь на github.com, что файлы обновились.
4. На сервере:

```bash
cd /opt/dark-bot
git pull
npm install
pm2 restart dark-bot dark-web
```

`npm run deploy-commands` нужен только если менялся набор команд или подкоманд.

Если `git pull` отказывается из-за `package.json` или `package-lock.json`:

```bash
git checkout -- package.json
rm -f package-lock.json
git pull
```

Чтобы это не повторялось, добавьте `package-lock.json` в `.gitignore`.

## Веб-панель

Вход через Discord. Видны серверы, где у вас есть право управления.

Разделы: обзор, уровни (настройки чата и голоса отдельно, с импортом и экспортом), экономика (валюты), роли за уровни, лидерборд, модерация, автомодерация, приветствие и автороль,
роли по реакциям, свои команды, временные голосовые, оповещения, логи сервера.

Панель и бот используют одну базу SQLite, поэтому настройки применяются сразу, без перезапуска.

## Оповещения YouTube и Twitch

- YouTube: ключ YouTube Data API v3 из Google Cloud Console → `YOUTUBE_API_KEY`. Канал указывается по ID вида `UCxxxxxxxxxxxxxxxxxxxxxx` (регистр важен). Проверка идёт через список загрузок канала и почти не расходует дневную квоту.
- Twitch: приложение на dev.twitch.tv/console → `TWITCH_CLIENT_ID` и `TWITCH_CLIENT_SECRET`.

Без ключей раздел «Оповещения» в панели сообщит, что интеграция не настроена. Остальной бот работает.

## Если что-то не работает

| Симптом | Что делать |
|---|---|
| Бот не в сети, в логе `Used disallowed intents` | Включить Server Members и Message Content в Developer Portal, затем `pm2 restart dark-bot` |
| Команд нет в списке | `npm run deploy-commands`, перезапустить Discord (Ctrl+R), проверить scope `applications.commands` у приглашения |
| Команды задвоились или остались старые | `npm run deploy-commands`: он регистрирует команды глобально и чистит серверные копии. Затем Ctrl+R в Discord |
| Изменений нет на сервере | Закоммичено → Push origin → видно на github.com → `git pull` → `pm2 restart` |
| `Cannot find module …` или `X.init is not a function` | `pm2 stop all && rm -rf node_modules package-lock.json && npm install && pm2 restart all` |
| Музыка: «Не удалось воспроизвести … возрастное ограничение / 403 / не бот» | Бот пишет причину в чат. Для YouTube: `sudo yt-dlp -U`, в `.env` добавить `YTDLP_EXTRA_ARGS=--js-runtimes node`; для возрастных видео и проверки «не бот» — файл cookies и `YTDLP_COOKIES=/путь/cookies.txt` (см. `.env.example`), затем `pm2 restart dark-bot --update-env` |
| Музыка: «Не удалось воспроизвести» | Проверить `yt-dlp --version`, `ffmpeg -version`; в `package.json` должен быть `@discordjs/opus`; обновить `sudo yt-dlp -U`; смотреть `pm2 logs dark-bot --lines 60` |
| Панель не открывается | `sudo nginx -t`; `WEB_PORT` должен быть 3000; порты: `sudo ss -tlnp \| grep -E '8843\|8880\|3000'` |
| `redirect_uri` при входе | Redirect в Developer Portal должен точно совпадать с `WEB_BASE_URL` + `/auth/callback` |

## Ограничения

- Spotify и Яндекс.Музыка напрямую не играют: по ссылке Spotify бот берёт название трека и ищет звук на YouTube.
- Оповещения работают опросом раз в `ALERT_POLL_INTERVAL_MINUTES` минут.
- Опыт за голосовой канал не начисляется, если вы одни в канале, заглушены или сидите в AFK-канале.

## Проверка перед выпуском

В папке `test_harness/` лежат тесты на имитации Discord (без реального токена):

```bash
node test_harness/run.js           # команды
node test_harness/run_events.js    # события
node test_harness/run_music.js     # музыкальная панель
```

## Структура

```
assets/             баннер и логотип
bot/
  commands/         слэш-команды по категориям
  events/           события Discord
  modules/          уровни, automod, rankCard, музыка, оповещения
  utils/            эмбеды, права, журнал модерации
  assets/fonts/     шрифты для карточки профиля
db/                 модели Sequelize
web/                панель: routes, views (EJS), public
ecosystem.config.js
Dockerfile, docker-compose.yml
```

## Лицензия

MIT

## Бонусы каналов

В панели есть страница **«Бонусы каналов»**: в выбранных каналах (или во всей категории) опыт и монеты начисляются с множителем. Например, ×2 в канале общения, ×0,5 в флудилке и ×0 там, где начислять не нужно. Работает для текстовых и голосовых каналов, ветки форумов и тредов берут бонус родительского канала. Бонус категории действует на все её каналы, а свой бонус у канала важнее. Множитель считается от обычных значений со страницы «Уровни».

## Модерация подробнее

**Сроки.** Везде, где нужен срок, пишите `30m` (минуты), `2h` (часы), `7d` (дни), `1w` (недели) или по-русски `30м`, `2ч`, `7д`. Можно складывать: `1h30m`. Просто число — минуты. Мут — до 28 дней (ограничение Discord); бан можно на любой срок, через `/mod ban duration:7d`. Бот каждые 30 секунд проверяет, не пора ли снять бан.

**Предупреждения.** На странице «Модерация» → «Правила наказаний» задаётся, что бот делает при определённом числе действующих предупреждений, например: 3 → мут на 60 минут, 5 → бан на сутки. Здесь же можно включить сгорание предупреждений через N дней, обязательную причину и личные уведомления участнику.

**Дела.** Каждое наказание получает номер: `/mod case 12` покажет дело, `/mod history @участник` — всю историю с заметками, `/mod reason 12 текст` исправит причину. `/mod note` добавляет приватную заметку (участник о ней не узнает).

**Права бота.** Для мута, кика и бана боту нужны права «Исключение участников», «Блокировка участников» и «Модерировать участников», а его роль должна стоять выше ролей наказуемых. Для `lock` и `slowmode` нужно «Управление каналами».
