// Regression test: embed overflow when a guild accumulates many custom
// commands or many alert subscriptions (found and fixed on 2026-09-11).
process.env.DATABASE_PATH = './data/test_stress3.sqlite';
const { makeInteraction } = require('./mock');

async function main() {
  const { init, CustomCommand, Alert } = require('../db');
  await init();

  for (let i = 0; i < 300; i++) {
    await CustomCommand.create({ guildId: 'guild1', trigger: `command_number_${i}`, response: 'x', createdBy: 'u1' });
  }
  const manageCmd = require('../bot/commands/config/manage');
  try {
    await manageCmd.execute(makeInteraction({ subcommandGroup: 'command', subcommand: 'list' }));
    console.log('✅ manage command list с 300 командами — OK');
  } catch (err) {
    console.log('❌ manage command list с 300 командами:', err.message);
  }

  for (let i = 0; i < 80; i++) {
    await Alert.create({ guildId: 'guild1', channelId: `channel_id_${i}`, platform: i % 2 === 0 ? 'youtube' : 'twitch', targetId: `target_${i}`, targetName: `Очень Длинное Название Канала Номер ${i}` });
  }
  try {
    await manageCmd.execute(makeInteraction({ subcommandGroup: 'alert', subcommand: 'list' }));
    console.log('✅ manage alert list с 80 подписками — OK');
  } catch (err) {
    console.log('❌ manage alert list с 80 подписками:', err.message);
  }

  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
