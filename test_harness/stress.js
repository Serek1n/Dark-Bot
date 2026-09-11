process.env.DATABASE_PATH = './data/test_stress.sqlite';
const { makeInteraction, makeUser } = require('./mock');

async function main() {
  const { init, Warning, CustomCommand } = require('../db');
  await init();

  // Create 60 warnings for one user (extreme but plausible over a long server lifetime)
  for (let i = 0; i < 60; i++) {
    await Warning.create({ guildId: 'guild1', userId: 'user2', moderatorId: 'mod1', reason: `Нарушение номер ${i} — подробное описание причины бана за флуд и оскорбления` });
  }

  const moderationCmd = require('../bot/commands/moderation/moderation');
  try {
    await moderationCmd.execute(makeInteraction({ subcommand: 'warnings', options: { 'пользователь': makeUser('user2') } }));
    console.log('✅ moderation warnings с 60 записями — OK');
  } catch (err) {
    console.log('❌ moderation warnings с 60 записями:', err.message);
  }

  // 40 custom commands
  for (let i = 0; i < 40; i++) {
    await CustomCommand.create({ guildId: 'guild1', trigger: `command_number_${i}`, response: 'x', createdBy: 'u1' });
  }
  const manageCmd = require('../bot/commands/config/manage');
  try {
    await manageCmd.execute(makeInteraction({ subcommandGroup: 'command', subcommand: 'list' }));
    console.log('✅ manage command list с 40 командами — OK');
  } catch (err) {
    console.log('❌ manage command list с 40 командами:', err.message);
  }

  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
