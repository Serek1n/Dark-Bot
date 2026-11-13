// "События бота": what the economy announces in the channel the admin picked. Switching sections on is announced as he chose —
// each section in its own message, one message that lists in plain words what is now on, or nothing; the game events themselves
// (a goal opened, reached or failed, a season ended, a treasury vote) are always posted when a channel is set.
const embeds = require('../../utils/embeds');
const config = require('./config');
const logger = require('../../utils/logger');

const client = () => require('../../../web/botBridge').getClient?.() || null;

async function channelOf(settings, c = client()) {
  const id = settings?.economyEventsChannelId;
  if (!id || !c) return null;
  const ch = c.channels?.cache?.get(id) || (await c.channels?.fetch?.(id).catch(() => null));
  return ch && typeof ch.send === 'function' ? ch : null;
}

/** Posts an embed (or a payload) in the server's economy events channel. Returns the message, or null when there is none. */
async function post(settings, payload, c) {
  const ch = await channelOf(settings, c);
  if (!ch) return null;
  const body = payload && payload.data ? { embeds: [payload] } : payload;
  return ch.send({ allowedMentions: { parse: [] }, ...body }).catch((err) => { logger.warn?.(`Economy event not posted: ${err.message}`); return null; });
}

/** Announces the sections the admin has just switched on, the way he chose. Returns how many messages were sent. */
async function announceActivation(settings, added, c) {
  if (!added?.length || settings.economyEventsMode === 'quiet') return 0;
  if (settings.economyEventsMode === 'each') {
    let n = 0;
    for (const key of added) {
      const f = config.BY_KEY[key];
      if (await post(settings, embeds.baseEmbed(embeds.COLORS.neutral).setTitle(`Новое в экономике: ${f.title}`).setDescription(config.announceText(settings, key)), c)) n++;
    }
    return n;
  }
  const lines = added.map((key) => `• ${config.announceText(settings, key)}`);
  const sent = await post(settings, embeds.baseEmbed(embeds.COLORS.neutral).setTitle('Что нового в экономике сервера').setDescription(lines.join('\n\n')), c);
  return sent ? 1 : 0;
}

module.exports = { post, announceActivation, channelOf };
