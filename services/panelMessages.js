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
  const body = localize({ embeds: payload.embeds.map((e) => e.toJSON()), components: payload.components.map((r) => r.toJSON()), allowed_mentions: { parse: [] } });
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

module.exports = { postPanel };
