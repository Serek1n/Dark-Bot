process.env.DATABASE_PATH = './data/test_events.sqlite';
const {
  makeRole, makeChannel, makeGuild, makeMember, makeUser, makeMessage, makeReaction, makeVoiceState
} = require('./mock_events');

async function main() {
  const { init, GuildSettings, ReactionRole, TempVoiceChannel, CustomCommand, Warning } = require('../db');
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

  const messageCreate = require('../bot/events/messageCreate');
  const guildMemberAdd = require('../bot/events/guildMemberAdd');
  const voiceStateUpdate = require('../bot/events/voiceStateUpdate');
  const reactionAdd = require('../bot/events/messageReactionAdd');
  const reactionRemove = require('../bot/events/messageReactionRemove');

  // ===== messageCreate =====
  await run('messageCreate: DM (no guild) is ignored', async () => {
    const msg = makeMessage({ guild: null });
    await messageCreate.execute(msg);
  });

  await run('messageCreate: bot author is ignored', async () => {
    const msg = makeMessage({ author: makeUser('b1', { bot: true }) });
    await messageCreate.execute(msg);
  });

  await run('messageCreate: brand-new guild (no settings row yet) still grants XP', async () => {
    const guild = makeGuild({ id: 'guild_fresh' });
    const msg = makeMessage({ guild, content: 'hello', author: makeUser('newbie') });
    await messageCreate.execute(msg);
    const settings = await GuildSettings.findOne({ where: { guildId: 'guild_fresh' } });
    if (!settings) throw new Error('settings row was not auto-created');
  });

  await run('messageCreate: automod deletes banned word + logs to mod channel', async () => {
    const guild = makeGuild({ id: 'guild_automod' });
    const logChannel = makeChannel('log1');
    guild._channelsById.set('log1', logChannel);
    await GuildSettings.create({ guildId: 'guild_automod', automodEnabled: true, automodBannedWords: JSON.stringify(['спам']), modLogChannelId: 'log1' });
    let deleted = false;
    const msg = makeMessage({ guild, content: 'это спам сообщение', delete: async () => { deleted = true; } });
    await messageCreate.execute(msg);
    if (!deleted) throw new Error('message.delete() was not called');
    if (!logChannel._sent.length) throw new Error('automod did not notify the log channel');
  });

  await run('messageCreate: leveling level-up announces in level-up channel', async () => {
    const guild = makeGuild({ id: 'guild_level' });
    const levelChan = makeChannel('lvlchan');
    guild._channelsById.set('lvlchan', levelChan);
    await GuildSettings.create({ guildId: 'guild_level', levelUpChannelId: 'lvlchan', xpPerMessageMin: 999999, xpPerMessageMax: 999999 });
    const msg = makeMessage({ guild, content: 'hi', author: makeUser('leveler') });
    await messageCreate.execute(msg);
    if (!levelChan._sent.length) throw new Error('expected a level-up message to be sent (xp set high enough to guarantee level 1 on first message)');
  });

  await run('messageCreate: custom command trigger responds', async () => {
    const guild = makeGuild({ id: 'guild_cc' });
    await GuildSettings.create({ guildId: 'guild_cc', prefix: '!' });
    await CustomCommand.create({ guildId: 'guild_cc', trigger: 'rules', response: 'Правила тут', createdBy: 'u1' });
    const channel = makeChannel('c1');
    const msg = makeMessage({ guild, content: '!rules', channel });
    await messageCreate.execute(msg);
    if (!channel._sent.includes('Правила тут')) throw new Error('custom command response was not sent');
  });

  // ===== guildMemberAdd =====
  await run('guildMemberAdd: no settings row -> no crash', async () => {
    const guild = makeGuild({ id: 'guild_nosettings' });
    const member = makeMember('m1', guild);
    await guildMemberAdd.execute(member);
  });

  await run('guildMemberAdd: autorole is added', async () => {
    const guild = makeGuild({ id: 'guild_autorole', rolesCache: new Map([['role1', makeRole('role1')]]) });
    await GuildSettings.create({ guildId: 'guild_autorole', autoRoleId: 'role1' });
    let added = null;
    const member = makeMember('m1', guild, { roles: { add: async (r) => { added = r; } } });
    await guildMemberAdd.execute(member);
    if (!added || added.id !== 'role1') throw new Error('autorole was not added');
  });

  await run('guildMemberAdd: welcome message replaces {user}/{server}', async () => {
    const guild = makeGuild({ id: 'guild_welcome', name: 'Cool Server' });
    const welcomeChan = makeChannel('wc1');
    guild._channelsById.set('wc1', welcomeChan);
    await GuildSettings.create({ guildId: 'guild_welcome', welcomeChannelId: 'wc1', welcomeMessage: 'Привет {user} на {server}!' });
    const member = makeMember('m1', guild);
    await guildMemberAdd.execute(member);
    const sentText = welcomeChan._sent[0];
    if (!sentText || !sentText.includes('<@m1>') || !sentText.includes('Cool Server')) {
      throw new Error('welcome message placeholders not replaced correctly: ' + sentText);
    }
  });

  // ===== voiceStateUpdate =====
  await run('voiceStateUpdate: leaving an emptied temp channel deletes it', async () => {
    const guild = makeGuild({ id: 'guild_voice1' });
    const tempChan = makeChannel('temp1', { members: { size: 0 } });
    guild._channelsById.set('temp1', tempChan);
    await TempVoiceChannel.create({ guildId: 'guild_voice1', channelId: 'temp1', ownerId: 'm1' });
    let deletedCalled = false;
    tempChan.delete = async () => { deletedCalled = true; };
    const oldState = makeVoiceState({ guild, channelId: 'temp1' });
    const newState = makeVoiceState({ guild, channelId: null });
    await voiceStateUpdate.execute(oldState, newState);
    if (!deletedCalled) throw new Error('empty temp channel was not deleted');
    const stillTracked = await TempVoiceChannel.findOne({ where: { channelId: 'temp1' } });
    if (stillTracked) throw new Error('temp voice DB record was not cleaned up');
  });

  await run('voiceStateUpdate: manually-deleted temp channel record is cleaned up without crash', async () => {
    const guild = makeGuild({ id: 'guild_voice2' }); // channel intentionally NOT in _channelsById -> fetch returns null
    await TempVoiceChannel.create({ guildId: 'guild_voice2', channelId: 'ghost_channel', ownerId: 'm1' });
    const oldState = makeVoiceState({ guild, channelId: 'ghost_channel' });
    const newState = makeVoiceState({ guild, channelId: null });
    await voiceStateUpdate.execute(oldState, newState);
    const stillTracked = await TempVoiceChannel.findOne({ where: { channelId: 'ghost_channel' } });
    if (stillTracked) throw new Error('stale temp voice DB record was not cleaned up');
  });

  await run('voiceStateUpdate: joining trigger channel creates + moves into a new channel', async () => {
    const guild = makeGuild({ id: 'guild_voice3' });
    await GuildSettings.create({ guildId: 'guild_voice3', tempVoiceJoinChannelId: 'trigger1', tempVoiceNameTemplate: 'Комната {user}' });
    const triggerChan = makeChannel('trigger1', { parentId: 'cat1' });
    guild._channelsById.set('trigger1', triggerChan);
    const member = makeMember('m1', guild, { displayName: 'Вася' });
    let movedTo = null;
    const newState = makeVoiceState({ guild, channelId: 'trigger1', channel: triggerChan, member, setChannel: async (ch) => { movedTo = ch; } });
    const oldState = makeVoiceState({ guild, channelId: null });
    await voiceStateUpdate.execute(oldState, newState);
    if (!movedTo) throw new Error('member was not moved into the newly created channel');
    if (movedTo.name !== 'Комната Вася') throw new Error('channel name template was not applied, got: ' + movedTo.name);
  });

  // ===== messageReactionAdd / Remove =====
  await run('messageReactionAdd: matching reaction grants the role', async () => {
    const guild = makeGuild({ id: 'guild_rr', rolesCache: new Map([['role1', makeRole('role1')]]) });
    await ReactionRole.create({ guildId: 'guild_rr', channelId: 'c1', messageId: 'msg1', emoji: '😀', roleId: 'role1' });
    let added = null;
    const member = makeMember('u1', guild, { roles: { add: async (r) => { added = r; } } });
    guild._membersById.set('u1', member);
    const reaction = makeReaction({ message: { id: 'msg1', guild }, emoji: { name: '😀', id: null } });
    const user = makeUser('u1');
    await reactionAdd.execute(reaction, user);
    if (!added || added.id !== 'role1') throw new Error('reaction role was not granted');
  });

  await run('messageReactionAdd: bot reactions are ignored', async () => {
    const reaction = makeReaction();
    const user = makeUser('bot1', { bot: true });
    await reactionAdd.execute(reaction, user); // should just return, no throw
  });

  await run('messageReactionAdd: non-matching reaction is a no-op, no crash', async () => {
    const guild = makeGuild({ id: 'guild_rr2' });
    const reaction = makeReaction({ message: { id: 'msg_unrelated', guild }, emoji: { name: '🙂', id: null } });
    await reactionAdd.execute(reaction, makeUser('u2'));
  });

  await run('messageReactionRemove: matching reaction removes the role', async () => {
    const guild = makeGuild({ id: 'guild_rr3', rolesCache: new Map([['role1', makeRole('role1')]]) });
    await ReactionRole.create({ guildId: 'guild_rr3', channelId: 'c1', messageId: 'msg2', emoji: '😀', roleId: 'role1' });
    let removed = null;
    const member = makeMember('u1', guild, { roles: { remove: async (r) => { removed = r; } } });
    guild._membersById.set('u1', member);
    const reaction = makeReaction({ message: { id: 'msg2', guild }, emoji: { name: '😀', id: null } });
    await reactionRemove.execute(reaction, makeUser('u1'));
    if (!removed || removed.id !== 'role1') throw new Error('reaction role was not removed');
  });

  console.log('\n=== РЕЗУЛЬТАТЫ (события) ===');
  let failCount = 0;
  for (const r of results) {
    if (r.ok) {
      console.log('✅', r.label);
    } else {
      failCount++;
      console.log('❌', r.label, '->', r.error);
      console.log('   ', r.stack.split('\n').slice(0, 4).join('\n    '));
    }
  }
  console.log(`\nИтого: ${results.length - failCount}/${results.length} прошли успешно`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
