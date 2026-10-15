process.env.DATABASE_PATH = './data/test_harness.sqlite';
require('fs').mkdirSync('./data',{recursive:true});['','-shm','-wal'].forEach((x)=>require('fs').rmSync(process.env.DATABASE_PATH+x,{force:true}));
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

  const economyCmd = require('../bot/commands/economy/economy');
  const profileCmd = require('../bot/commands/leveling/profile');
  const moderationCmd = require('../bot/commands/moderation/moderation');
  const musicCmd = require('../bot/commands/music/music');
  const helpCmd = require('../bot/commands/utility/help');
  const reportCmd = require('../bot/commands/moderation/report');

  // ===== settings =====

  // ===== automod =====

  // ===== manage: custom commands =====

  // ===== manage: reaction roles (message not found case, since mock channel.messages.fetch returns null) =====

  // ===== manage: tempvoice =====

  // ===== manage: alerts (no API keys configured -> expect graceful error reply, not crash) =====

  // ===== economy =====
  await run('economy daily', () => economyCmd.execute(makeInteraction({ subcommand: 'daily' })));
  await run('economy pay', () => economyCmd.execute(makeInteraction({ subcommand: 'pay', options: { 'user': makeUser('user2'), 'amount': 10 } })));

  // ===== profile =====
  await run('profile view', () => profileCmd.execute(makeInteraction({ subcommand: 'view' })));
  await run('profile top', () => profileCmd.execute(makeInteraction({ subcommand: 'top' })));
  await run('profile view -> PNG card with server rank', async () => {
    const i = makeInteraction({ subcommand: 'view' });
    await profileCmd.execute(i);
    const last = i._replies[i._replies.length - 1];
    if (!last.files?.length) throw new Error('rank card should be sent as an image attachment, got fallback embed');
  });
  await run('profile top -> PNG leaderboard', async () => {
    const i = makeInteraction({ subcommand: 'top' });
    i.client.users.fetch = async (id) => ({ id, username: `user_${id}`, globalName: null, displayAvatarURL: () => '' });
    await profileCmd.execute(i);
    const last = i._replies[i._replies.length - 1];
    if (!last.files?.length) throw new Error('leaderboard should be sent as an image attachment');
  });

  // help adapts to the asker's role: members < moderators < admins
  await run('help: member sees only member sections', async () => {
    const m = makeMember('plain', { rolePosition: 1 });
    m.permissions = { has: () => false };
    const i = makeInteraction({ member: m });
    await helpCmd.execute(i);
    const n = i._replies[0].embeds.length;
    if (n !== 4) throw new Error(`member should see 4 embeds, got ${n}`);
  });
  await run('help: moderator also sees moderation', async () => {
    const m = makeMember('mod', { rolePosition: 5 });
    m.permissions = { has: (f) => f === require('discord.js').PermissionsBitField.Flags.ModerateMembers };
    const i = makeInteraction({ member: m });
    await helpCmd.execute(i);
    const n = i._replies[0].embeds.length;
    if (n !== 5) throw new Error(`moderator should see 5 embeds, got ${n}`);
  });
  await run('help: admin sees everything', async () => {
    const i = makeInteraction({});
    await helpCmd.execute(i);
    const n = i._replies[0].embeds.length;
    if (n !== 6) throw new Error(`admin should see 6 embeds, got ${n}`);
  });

  // ===== moderation =====
  await run('moderation warn', () => moderationCmd.execute(makeInteraction({ subcommand: 'warn', options: { 'user': makeUser('user2'), 'reason': 'test' } })));
  await run('moderation warnings', () => moderationCmd.execute(makeInteraction({ subcommand: 'warnings', options: { 'user': makeUser('user2') } })));
  await run('moderation unwarn (none exists)', () => moderationCmd.execute(makeInteraction({ subcommand: 'unwarn', options: { 'number': 999 } })));
  await run('moderation mute', () => moderationCmd.execute(makeInteraction({ subcommand: 'mute', options: { 'user': makeUser('user2'), 'duration': '10m', 'reason': 'test' } })));
  await run('moderation unmute', () => moderationCmd.execute(makeInteraction({ subcommand: 'unmute', options: { 'user': makeUser('user2') } })));
  await run('moderation kick', () => moderationCmd.execute(makeInteraction({ subcommand: 'kick', options: { 'user': makeUser('user2'), 'reason': 'test' } })));
  await run('moderation ban', () => moderationCmd.execute(makeInteraction({ subcommand: 'ban', options: { 'user': makeUser('user2'), 'reason': 'test', 'delete_days': 0 } })));
  await run('moderation unban', () => moderationCmd.execute(makeInteraction({ subcommand: 'unban', options: { 'id': '123456' }, guild: undefined })));
  await run('moderation clear', () => moderationCmd.execute(makeInteraction({ subcommand: 'clear', options: { 'count': 10 } })));

  // ===== music (play requires voice channel; test both no-voice-channel and no-active-queue paths) =====
  await run('music play (not in voice)', () => musicCmd.execute(makeInteraction({ subcommand: 'play', options: { 'query': 'test song' }, member: makeMember('user1', { voice: { channel: null } }) })));

  // ===== help =====
  const fakeClient = { commands: new Map([
    ['economy', economyCmd], ['profile', profileCmd], ['moderation', moderationCmd],
    ['music', musicCmd], ['help', helpCmd], ['Report message', reportCmd]
  ])};
  [economyCmd,profileCmd,moderationCmd,musicCmd,helpCmd].forEach(c => c.category = c.category || 'test');
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
