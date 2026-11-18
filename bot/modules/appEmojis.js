// The bot's own icons (application emojis): line icons in DARK's colour for panels like the room control panel.
// They are uploaded once to the bot's application (Discord allows an application up to 2000 emojis, usable on every server
// without being on it) from bot/assets/emoji/*.png and found again by name on the next start. Until they are ready (or if
// Discord refuses), panels fall back to ordinary emojis — nothing breaks.
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DIR = path.join(__dirname, '..', 'assets', 'emoji');
const PREFIX = 'dark_';
const ready = new Map(); // icon name -> { id, name }
let loading = null;

const files = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)) : []);

/** Makes sure every icon from the assets is an emoji of the application. Safe to call more than once. */
function ensureAppEmojis(client) {
  if (loading) return loading;
  loading = (async () => {
    const app = client?.application;
    if (!app?.emojis) return ready;
    const have = await app.emojis.fetch().catch((err) => { logger.warn(`App emojis: ${err.message}`); return null; });
    if (!have) return ready;
    const byName = new Map([...have.values()].map((e) => [e.name, e]));
    for (const icon of files()) {
      const name = `${PREFIX}${icon}`;
      let e = byName.get(name);
      if (!e) {
        e = await app.emojis.create({ attachment: path.join(DIR, `${icon}.png`), name }).catch((err) => { logger.warn(`App emoji ${name}: ${err.message}`); return null; });
      }
      if (e) ready.set(icon, { id: e.id, name: e.name });
    }
    if (ready.size) logger.info(`App emojis ready: ${ready.size}`);
    return ready;
  })().finally(() => { if (!ready.size) loading = null; }); // nothing came: try again next time
  return loading;
}

/** For a button: { id, name } of the icon, or the fallback ordinary emoji. */
const emoji = (icon, fallback) => ready.get(icon) || fallback;
/** For a text: <:dark_x:id>, or the fallback. */
const inline = (icon, fallback) => { const e = ready.get(icon); return e ? `<:${e.name}:${e.id}>` : fallback; };

module.exports = { ensureAppEmojis, emoji, inline, ready, _set: (icon, e) => ready.set(icon, e) };
