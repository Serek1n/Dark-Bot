# services

Logic that more than one entry point needs — a slash command and a panel page, or the panel and the bot's scheduler.
A function here takes plain values (ids, numbers), does the work and returns a result; it knows nothing about
Discord interactions or HTTP requests. Commands (`bot/commands`) and panel routes (`web/routes`) stay thin: they read
the input, check rights, call a service and answer.

- `levels.js` — change a member's level by hand (`/level`, «Изменить уровень участника»).
- `panelMessages.js` — post a control panel (rooms, webhooks) into a channel, replacing the older one.
