// Encrypts the log webhook tokens that are still stored as plain text. Without a key (no SESSION_SECRET) nothing is changed.
const { encrypt, isEncrypted } = require('../crypto');

async function up({ sequelize }) {
  const [rows] = await sequelize.query("SELECT guildId, logWebhookToken FROM guild_settings WHERE logWebhookToken IS NOT NULL AND logWebhookToken != ''");
  for (const r of rows) {
    if (isEncrypted(r.logWebhookToken)) continue;
    const enc = encrypt(r.logWebhookToken);
    if (enc !== r.logWebhookToken) await sequelize.query('UPDATE guild_settings SET logWebhookToken = ? WHERE guildId = ?', { replacements: [enc, r.guildId] });
  }
}

module.exports = { name: '0005_encrypt_log_webhook_token', up };
