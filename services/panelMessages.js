// A control panel the bot keeps in one channel (temporary rooms, webhooks): posted anew, the older copy removed, and
// where it now lives remembered in the settings. One place for the panel pages, so they post and replace the same way.
const { botApi } = require('../web/discordApi');

/**
 * @param {object} settings  GuildSettings row (saved here)
 * @param {string} channelId where to post
 * @param {object} payload   { embeds, components } built by discord.js builders
 * @param {{ channel: string, message: string }} keys  names of the settings fields that keep the place
 * @param {(body: object) => object} [localize] turns the body into the server's language
 */
async function postPanel(settings, channelId, payload, keys, localize = (b) => b) {
  // a classic panel (embeds + rows of buttons) or a components-v2 one (flags + framed containers, no embeds)
  const body = localize(payload.embeds
    ? { embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } }
    : { flags: payload.flags, components: payload.components.map((c) => c.toJSON()), allowed_mentions: { parse: [] } });
  const { data } = await botApi.post(`/channels/${channelId}/messages`, body);
  const oldChannel = settings[keys.channel]; const oldMessage = settings[keys.message];
  if (oldChannel && oldMessage && !(oldChannel === channelId && oldMessage === data.id)) {
    await botApi.delete(`/channels/${oldChannel}/messages/${oldMessage}`).catch(() => {}); // the older panel is replaced, not left next to the new one
  }
  settings[keys.channel] = channelId;
  settings[keys.message] = data.id;
  await settings.save();
  return data.id;
}

/** The posted panel gets a new look in place (nothing new is posted). False when there is none or it can't be edited. */
async function editPanel(settings, payload, keys, localize = (b) => b) {
  const channelId = settings[keys.channel]; const messageId = settings[keys.message];
  if (!channelId || !messageId) return false;
  const body = localize(payload.embeds
    ? { embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } }
    : { flags: payload.flags, components: payload.components.map((c) => c.toJSON()), allowed_mentions: { parse: [] } });
  return botApi.patch(`/channels/${channelId}/messages/${messageId}`, body).then(() => true).catch(() => false);
}

module.exports = { postPanel, editPanel };
