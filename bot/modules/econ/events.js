// Posting the economy's events (bot/modules/botEvents.js has the list, the switches and the channels — the "События бота"
// module). A required event (a goal card, a vote) is posted while the module is on and has a channel; the others also
// need their own switch on.
const embeds = require('../../utils/embeds');
const config = require('./config');
const logger = require('../../utils/logger');

const botEvents = require('../botEvents');
const client = () => require('../../../web/botBridge').getClient?.() || null;

/** The channel an event goes to (its own or the common one), or null: no channel, module off, or this event switched off. */
async function channelOf(settings, c = client(), type = null) {
  if (type && !botEvents.isOn(settings, type)) return null;
  if (!type && !botEvents.read(settings).enabled) return null;
  const id = type ? botEvents.channelIdFor(settings, type) : settings?.economyEventsChannelId;
  if (!id || !c) return null;
  const ch = c.channels?.cache?.get(id) || (await c.channels?.fetch?.(id).catch(() => null));
  return ch && typeof ch.send === 'function' ? ch : null;
}

/** Posts an embed (or a payload) as the event `type`. Returns the message, or null when it is not posted. */
async function post(settings, payload, c, type = null) {
  const ch = await channelOf(settings, c || client(), type);
  if (!ch) return null;
  const body = payload && payload.data ? { embeds: [payload] } : payload;
  return ch.send({ allowedMentions: { parse: [] }, ...body }).catch((err) => { logger.warn?.(`Bot event not posted: ${err.message}`); return null; });
}

const summaryEmbed = (settings, added) => embeds.baseEmbed(embeds.COLORS.neutral).setTitle('Что нового в экономике сервера')
  .setDescription(added.map((key) => `• ${config.announceText(settings, key)}`).join('\n\n'));
const sectionEmbed = (settings, key) => embeds.baseEmbed(embeds.COLORS.neutral).setTitle(`Новое в экономике: ${config.BY_KEY[key].title}`).setDescription(config.announceText(settings, key));

/** Announces the sections the admin has just switched on, the way he chose (summary, each, both in his order, or nothing). */
async function announceActivation(settings, added, c) {
  if (!added?.length || !botEvents.isOn(settings, 'activation')) return 0;
  const r = botEvents.read(settings);
  const queue = [];
  const each = () => { if (r.each) for (const key of added) queue.push(sectionEmbed(settings, key)); };
  if (r.order === 'each-first') each();
  if (r.summary) queue.push(summaryEmbed(settings, added));
  if (r.order !== 'each-first') each();
  let n = 0;
  for (const e of queue) if (await post(settings, e, c, 'activation')) n++;
  return n;
}

/** The panel's "Отправить пример": the example of an event, marked as an example, in the channel it would go to. */
async function sendExample(settings, type, c = client()) {
  const t = botEvents.BY_KEY[type];
  if (!t) return { error: 'type' };
  const id = botEvents.channelIdFor(settings, type);
  if (!id) return { error: 'channel' };
  const ch = c && (c.channels?.cache?.get(id) || (await c.channels?.fetch?.(id).catch(() => null)));
  if (!ch || typeof ch.send !== 'function') return { error: 'post' };
  const [title, ...rest] = t.example.split('\n');
  const msg = await ch.send({ allowedMentions: { parse: [] }, embeds: [embeds.baseEmbed(embeds.COLORS.neutral).setTitle(title).setDescription(rest.join('\n') || null).setFooter({ text: 'Пример события из панели — настоящие события выглядят так же' })] }).catch(() => null);
  return msg ? { ok: true } : { error: 'post' };
}

module.exports = { post, announceActivation, channelOf, sendExample };
