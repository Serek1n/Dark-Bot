process.env.DATABASE_PATH = './data/test_stress2.sqlite';
const { makeInteraction, makeUser } = require('./mock');

async function main() {
  const { init, Warning } = require('../db');
  await init();

  for (let i = 0; i < 60; i++) {
    await Warning.create({ guildId: 'guild1', userId: 'user2', moderatorId: 'mod1', reason: `Нарушение номер ${i} — подробное описание причины бана за флуд и оскорбления` });
  }

  const moderationCmd = require('../bot/commands/moderation/moderation');
  try {
    await moderationCmd.execute(makeInteraction({ subcommand: 'warnings', options: { 'пользователь': makeUser('user2') } }));
    console.log('OK');
  } catch (err) {
    console.log('ПОЛНАЯ ОШИБКА:');
    console.log(err);
    if (err.errors) {
      for (const e of err.errors) console.log(' - вложенная:', e.message);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
