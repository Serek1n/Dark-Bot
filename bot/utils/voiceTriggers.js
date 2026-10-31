// "Join to create" voice channels: the main one (tempVoiceJoinChannelId + category, name, limit) and up to MAX_EXTRA more, each
// with its own category, room name and user limit (settings.tempVoiceTriggers, JSON). E.g. "Создать комнату для игр" → category
// "Игры", name "🎮 {user}", limit 5; "Создать дуо" → limit 2.
const MAX_EXTRA = 5;
const SNOWFLAKE = /^\d{15,25}$/;

function extraTriggers(settings) {
  let list = [];
  try { list = JSON.parse(settings?.tempVoiceTriggers || '[]'); } catch { list = []; }
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && SNOWFLAKE.test(String(t.channelId)))
    .slice(0, MAX_EXTRA)
    .map((t) => ({
      channelId: String(t.channelId),
      categoryId: SNOWFLAKE.test(String(t.categoryId || '')) ? String(t.categoryId) : null,
      name: String(t.name || '').slice(0, 90),
      limit: Math.max(0, Math.min(99, Math.trunc(Number(t.limit) || 0)))
    }));
}

/** The trigger this channel is, with everything filled in (empty name/limit of an extra one fall back to the main settings), or null. */
function triggerFor(settings, channelId) {
  if (!settings || !channelId) return null;
  const main = { channelId: settings.tempVoiceJoinChannelId, categoryId: settings.tempVoiceCategoryId || null, name: settings.tempVoiceNameTemplate || 'Комната {user}', limit: Math.max(0, Math.min(99, Number(settings.tempVoiceUserLimit) || 0)) };
  if (main.channelId && main.channelId === channelId) return main;
  const extra = extraTriggers(settings).find((t) => t.channelId === channelId);
  if (!extra) return null;
  return { channelId, categoryId: extra.categoryId, name: extra.name || main.name, limit: extra.limit };
}

/** Is there any trigger at all? (cheap check before work) */
const hasTriggers = (settings) => Boolean(settings?.tempVoiceJoinChannelId) || extraTriggers(settings).length > 0;

module.exports = { extraTriggers, triggerFor, hasTriggers, MAX_EXTRA };
