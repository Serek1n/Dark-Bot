// The web panel and the bot live in ONE process now. The panel asks the bot's own cache for channels, roles and servers (no requests to
// Discord, always current) and tells the bot at once when something it cares about was changed. When the panel is started alone
// (node web/index.js) there is no client, and discordApi falls back to the REST calls it always had.
let client = null;

function setClient(c) { client = c || null; }
/** The logged-in Discord client, or null when the panel runs without the bot. */
function getClient() { return client && (typeof client.isReady !== 'function' || client.isReady()) ? client : null; }

/** Tells the bot that a setting changed in the panel. Never throws: the panel must not fail because of the bot. */
function settingsChanged(guildId, area) {
  const c = getClient();
  if (!c) return;
  try {
    if (area === 'logs') {
      const logEvents = require('../bot/events/logEvents');
      Promise.resolve(logEvents.loadMembersForLogs(c)).catch(() => {});
    }
  } catch { /* the bot part is optional */ }
}

module.exports = { setClient, getClient, settingsChanged };
