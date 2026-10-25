// What the panel shows about the running build: versions of the bot and the panel, branch and commit, uptime,
// and whether the bot is connected to Discord right now.
const { versionInfo, formatUptime } = require('../../bot/utils/version');
const { getClient } = require('../botBridge');

function systemInfo() {
  const v = versionInfo();
  const client = getClient();
  const ping = client?.ws?.ping;
  return {
    ...v,
    uptime: formatUptime(v.uptimeSeconds),
    builtAt: v.date ? v.date.toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null,
    botOnline: Boolean(client),
    ping: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null,
    guildCount: client?.guilds?.cache?.size ?? null
  };
}

/** One line for tooltips: "release · main@abc1234 · запущен 3 ч 5 мин назад". */
function buildLine(i) {
  return [i.channel === 'beta' ? 'бета' : 'релиз', i.commit ? `${i.branch || 'commit'}@${i.commit}` : null, `работает ${i.uptime}`].filter(Boolean).join(' · ');
}

module.exports = { systemInfo, buildLine };
