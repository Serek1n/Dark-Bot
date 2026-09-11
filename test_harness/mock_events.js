// Mocks tailored to event handlers (messageCreate, guildMemberAdd, voiceStateUpdate,
// messageReactionAdd/Remove) — separate from mock.js which targets slash commands.

function makeRole(id, name = 'Role') {
  return { id, name };
}

function makeChannel(id, overrides = {}) {
  const sent = [];
  return {
    id,
    name: overrides.name || 'general',
    type: 0,
    parentId: overrides.parentId ?? null,
    parent: overrides.parent ?? null,
    members: overrides.members || { size: 0 },
    send: async (payload) => { sent.push(payload); return { id: 'msg_' + Math.random() }; },
    delete: async () => {},
    _sent: sent,
    ...overrides
  };
}

function makeGuild(overrides = {}) {
  const rolesCache = overrides.rolesCache || new Map();
  const channelsById = overrides.channelsById || new Map();
  const membersById = overrides.membersById || new Map();
  return {
    id: overrides.id || 'guild1',
    name: overrides.name || 'Test Guild',
    roles: { cache: rolesCache },
    channels: {
      fetch: async (id) => channelsById.get(id) || null,
      create: async (opts) => {
        const ch = makeChannel('created_' + Math.random().toString(36).slice(2), { name: opts.name, parentId: opts.parent });
        channelsById.set(ch.id, ch);
        return ch;
      }
    },
    members: {
      fetch: async (id) => membersById.get(id) || null
    },
    _channelsById: channelsById,
    _membersById: membersById,
    ...overrides
  };
}

function makeMember(id, guild, overrides = {}) {
  return {
    id,
    guild,
    displayName: overrides.displayName || 'TestMember',
    roles: { add: async () => {}, remove: async () => {}, ...overrides.roles },
    voice: overrides.voice || { channel: null },
    ...overrides
  };
}

function makeUser(id, overrides = {}) {
  return { id, bot: false, username: 'user_' + id, ...overrides };
}

function makeMessage(overrides = {}) {
  const guild = overrides.guild !== undefined ? overrides.guild : makeGuild();
  const channel = overrides.channel || makeChannel('chan1');
  return {
    guild,
    channel,
    content: overrides.content ?? '',
    author: overrides.author || makeUser('author1'),
    client: overrides.client || { user: { id: 'bot_id' } },
    member: overrides.member || null,
    delete: overrides.delete || (async () => {}),
    ...overrides
  };
}

function makeReaction(overrides = {}) {
  return {
    partial: overrides.partial ?? false,
    fetch: overrides.fetch || (async () => {}),
    emoji: overrides.emoji || { name: '😀', id: null },
    message: overrides.message || { id: 'msg1', guild: makeGuild() }
  };
}

function makeVoiceState(overrides = {}) {
  return {
    guild: overrides.guild,
    channelId: overrides.channelId ?? null,
    channel: overrides.channel || null,
    member: overrides.member || null,
    setChannel: overrides.setChannel || (async () => {})
  };
}

module.exports = { makeRole, makeChannel, makeGuild, makeMember, makeUser, makeMessage, makeReaction, makeVoiceState };
