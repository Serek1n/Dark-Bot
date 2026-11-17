// Temporary rooms, second version: what owners may change, automatic hand-over, remembered settings of each owner, limits
// against spam; voice roles can be limited to temporary rooms or to ordinary channels and skip some channels.
async function up({ sequelize }) {
  const addTo = async (table, name, def) => {
    const [cols] = await sequelize.query(`PRAGMA table_info(${table});`);
    if (cols.some((c) => c.name === name)) return;
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${def};`).catch((err) => {
      if (!/duplicate column/i.test(String(err.message))) throw err;
    });
  };
  await addTo('guild_settings', 'tempVoiceOwnerPerms', "TEXT DEFAULT '{}'");
  await addTo('guild_settings', 'tempVoiceAutoTransfer', 'TINYINT(1) DEFAULT 1');
  await addTo('guild_settings', 'tempVoiceRemember', 'TINYINT(1) DEFAULT 1');
  await addTo('guild_settings', 'tempVoiceCooldownSec', 'INTEGER DEFAULT 15');
  await addTo('guild_settings', 'tempVoiceMaxRooms', 'INTEGER DEFAULT 0');
  await addTo('guild_settings', 'tempVoiceBitrate', 'INTEGER DEFAULT 0');
  await addTo('guild_settings', 'tempVoiceDefaultAccess', "VARCHAR(255) DEFAULT 'open'");
  await addTo('guild_settings', 'voiceRolesExclude', "TEXT DEFAULT '[]'");
  await addTo('voice_roles', 'scope', "VARCHAR(255) DEFAULT 'any'");
}

module.exports = { name: '0024_voice_rooms_v2', up };
