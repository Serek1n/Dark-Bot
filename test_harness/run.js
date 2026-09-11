process.env.DATABASE_PATH = './data/test_harness.sqlite';
const { makeInteraction, makeUser, makeMember, makeChannel } = require('./mock');

async function main() {
  const { init } = require('../db');
  await init();

  const results = [];
  async function run(label, fn) {
    try {
      await fn();
      results.push({ label, ok: true });
    } catch (err) {
      results.push({ label, ok: false, error: err.message, stack: err.stack });
    }
  }

  const settingsCmd = require('../bot/commands/config/settings');
  const automodCmd = require('../bot/commands/config/automod');
  const manageCmd = require('../bot/commands/config/manage');
  const economyCmd = require('../bot/commands/economy/economy');
  const profileCmd = require('../bot/commands/leveling/profile');
  const moderationCmd = require('../bot/commands/moderation/moderation');
  const musicCmd = require('../bot/commands/music/music');
  const helpCmd = require('../bot/commands/utility/help');
  const reportCmd = require('../bot/commands/moderation/report');

  // ===== settings =====
  await run('settings logchannel', () => settingsCmd.execute(makeInteraction({ subcommand: 'logchannel', options: { 'канал': makeChannel('c1') } })));
  await run('settings reportchannel', () => settingsCmd.execute(makeInteraction({ subcommand: 'reportchannel', options: { 'канал': makeChannel('c1') } })));
  await run('settings levelupchannel', () => settingsCmd.execute(makeInteraction({ subcommand: 'levelupchannel', options: { 'канал': makeChannel('c1') } })));
  await run('settings welcome', () => settingsCmd.execute(makeInteraction({ subcommand: 'welcome', options: { 'канал': makeChannel('c1'), 'сообщение': 'Привет {user} на {server}' } })));
  await run('settings autorole', () => settingsCmd.execute(makeInteraction({ subcommand: 'autorole', options: { 'роль': { id: 'role1', name: 'R' } } })));
  await run('settings prefix', () => settingsCmd.execute(makeInteraction({ subcommand: 'prefix', options: { 'префикс': '!' } })));
  await run('settings currency', () => settingsCmd.execute(makeInteraction({ subcommand: 'currency', options: { 'название': 'монеты' } })));

  // ===== automod =====
  await run('automod toggle', () => automodCmd.execute(makeInteraction({ subcommand: 'toggle', options: { 'включено': true } })));
  await run('automod addword', () => automodCmd.execute(makeInteraction({ subcommand: 'addword', options: { 'слово': 'спам' } })));
  await run('automod listwords', () => automodCmd.execute(makeInteraction({ subcommand: 'listwords' })));
  await run('automod removeword', () => automodCmd.execute(makeInteraction({ subcommand: 'removeword', options: { 'слово': 'спам' } })));
  await run('automod invites', () => automodCmd.execute(makeInteraction({ subcommand: 'invites', options: { 'включено': true } })));
  await run('automod antispam', () => automodCmd.execute(makeInteraction({ subcommand: 'antispam', options: { 'включено': true, 'сообщений': 5, 'секунд': 7 } })));

  // ===== manage: custom commands =====
  await run('manage command add', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'command', subcommand: 'add', options: { 'триггер': 'rules', 'ответ': 'Правила тут' } })));
  await run('manage command list', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'command', subcommand: 'list' })));
  await run('manage command remove', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'command', subcommand: 'remove', options: { 'триггер': 'rules' } })));

  // ===== manage: reaction roles (message not found case, since mock channel.messages.fetch returns null) =====
  await run('manage reactionrole add (no message)', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'reactionrole', subcommand: 'add', options: { 'id_сообщения': '123', 'эмодзи': '😀', 'роль': { id: 'role1' } } })));
  await run('manage reactionrole remove', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'reactionrole', subcommand: 'remove', options: { 'id_сообщения': '123', 'эмодзи': '😀' } })));

  // ===== manage: tempvoice =====
  await run('manage tempvoice setup', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'tempvoice', subcommand: 'setup', options: { 'канал': makeChannel('vc1'), 'категория': null, 'шаблон_имени': null } })));
  await run('manage tempvoice disable', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'tempvoice', subcommand: 'disable' })));

  // ===== manage: alerts (no API keys configured -> expect graceful error reply, not crash) =====
  await run('manage alert youtube (no key)', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'alert', subcommand: 'youtube', options: { 'id_канала': 'UC1', 'куда_постить': makeChannel('c1') } })));
  await run('manage alert list', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'alert', subcommand: 'list' })));
  await run('manage alert remove', () => manageCmd.execute(makeInteraction({ subcommandGroup: 'alert', subcommand: 'remove', options: { 'id': 1 } })));

  // ===== economy =====
  await run('economy daily', () => economyCmd.execute(makeInteraction({ subcommand: 'daily' })));
  await run('economy pay', () => economyCmd.execute(makeInteraction({ subcommand: 'pay', options: { 'пользователь': makeUser('user2'), 'сумма': 10 } })));

  // ===== profile =====
  await run('profile view', () => profileCmd.execute(makeInteraction({ subcommand: 'view' })));
  await run('profile top', () => profileCmd.execute(makeInteraction({ subcommand: 'top' })));

  // ===== moderation =====
  await run('moderation warn', () => moderationCmd.execute(makeInteraction({ subcommand: 'warn', options: { 'пользователь': makeUser('user2'), 'причина': 'test' } })));
  await run('moderation warnings', () => moderationCmd.execute(makeInteraction({ subcommand: 'warnings', options: { 'пользователь': makeUser('user2') } })));
  await run('moderation unwarn (none exists)', () => moderationCmd.execute(makeInteraction({ subcommand: 'unwarn', options: { 'номер': 999 } })));
  await run('moderation mute', () => moderationCmd.execute(makeInteraction({ subcommand: 'mute', options: { 'пользователь': makeUser('user2'), 'минуты': 10, 'причина': 'test' } })));
  await run('moderation unmute', () => moderationCmd.execute(makeInteraction({ subcommand: 'unmute', options: { 'пользователь': makeUser('user2') } })));
  await run('moderation kick', () => moderationCmd.execute(makeInteraction({ subcommand: 'kick', options: { 'пользователь': makeUser('user2'), 'причина': 'test' } })));
  await run('moderation ban', () => moderationCmd.execute(makeInteraction({ subcommand: 'ban', options: { 'пользователь': makeUser('user2'), 'причина': 'test', 'дней_удалить': 0 } })));
  await run('moderation unban', () => moderationCmd.execute(makeInteraction({ subcommand: 'unban', options: { 'id': '123456' }, guild: undefined })));
  await run('moderation clear', () => moderationCmd.execute(makeInteraction({ subcommand: 'clear', options: { 'количество': 10 } })));

  // ===== music (play requires voice channel; test both no-voice-channel and no-active-queue paths) =====
  await run('music play (not in voice)', () => musicCmd.execute(makeInteraction({ subcommand: 'play', options: { 'запрос': 'test song' }, member: makeMember('user1', { voice: { channel: null } }) })));
  await run('music skip (no queue)', () => musicCmd.execute(makeInteraction({ subcommand: 'skip' })));
  await run('music queue (no queue)', () => musicCmd.execute(makeInteraction({ subcommand: 'queue' })));

  // ===== help =====
  const fakeClient = { commands: new Map([
    ['settings', settingsCmd], ['automod', automodCmd], ['manage', manageCmd],
    ['economy', economyCmd], ['profile', profileCmd], ['moderation', moderationCmd],
    ['music', musicCmd], ['help', helpCmd], ['Пожаловаться на сообщение', reportCmd]
  ])};
  [settingsCmd,automodCmd,manageCmd,economyCmd,profileCmd,moderationCmd,musicCmd,helpCmd].forEach(c => c.category = c.category || 'test');
  settingsCmd.category='config'; automodCmd.category='config'; manageCmd.category='config';
  economyCmd.category='economy'; profileCmd.category='leveling'; moderationCmd.category='moderation';
  musicCmd.category='music'; helpCmd.category='utility'; reportCmd.category='moderation';
  await run('help', () => {
    const interaction = makeInteraction({});
    interaction.client = fakeClient;
    return helpCmd.execute(interaction);
  });

  // ===== report context menu =====
  await run('report (no report channel configured)', () => {
    const interaction = makeInteraction({});
    interaction.targetMessage = { author: makeUser('user2'), content: 'bad message', channelId: 'c1', url: 'http://x' };
    return reportCmd.execute(interaction);
  });

  console.log('\n=== РЕЗУЛЬТАТЫ ===');
  let failCount = 0;
  for (const r of results) {
    if (r.ok) {
      console.log('✅', r.label);
    } else {
      failCount++;
      console.log('❌', r.label, '->', r.error);
      console.log('   ', r.stack.split('\n').slice(0, 3).join('\n    '));
    }
  }
  console.log(`\nИтого: ${results.length - failCount}/${results.length} прошли успешно`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
