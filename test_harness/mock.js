// Lightweight mocks for discord.js interaction objects, just enough to exercise
// command execute() functions and catch runtime errors that static review misses.

function makeUser(id, overrides = {}) {
  return { id, username: 'testuser_' + id, bot: false, displayAvatarURL: () => 'http://x/avatar.png', ...overrides };
}

function makeChannel(id, overrides = {}) {
  return {
    id,
    name: 'general',
    type: 0,
    send: async (x) => { return { id: 'msg_sent' }; },
    messages: { fetch: async () => null },
    bulkDelete: async () => ({ size: 3 }),
    ...overrides
  };
}

function makeMember(id, overrides = {}) {
  return {
    id,
    displayName: 'TestMember',
    permissions: { has: () => true },
    moderatable: true,
    kickable: true,
    bannable: true,
    voice: { channel: null },
    roles: { add: async () => {}, remove: async () => {} },
    timeout: async () => {},
    kick: async () => {},
    ...overrides
  };
}

function makeGuild(overrides = {}) {
  const membersCache = new Map();
  return {
    id: 'guild1',
    name: 'Test Guild',
    approximate_member_count: 100,
    channels: {
      fetch: async (id) => makeChannel(id),
      create: async (opts) => makeChannel('new_chan_id', { name: opts.name })
    },
    roles: { cache: new Map([['role1', { id: 'role1', name: 'TestRole' }]]) },
    members: {
      fetch: async (id) => makeMember(id),
      ban: async (id, opts) => ({ id })
    },
    ...overrides
  };
}

// Mimics Discord's actual embed validation limits so bugs like an oversized
// field are caught here instead of only in production.
function validateEmbed(embed) {
  const data = embed?.data || embed;
  if (!data) return;
  const errors = [];
  if (data.title && data.title.length > 256) errors.push(`title слишком длинный (${data.title.length}/256)`);
  if (data.description && data.description.length > 4096) errors.push(`description слишком длинный (${data.description.length}/4096)`);
  if (data.fields) {
    if (data.fields.length > 25) errors.push(`слишком много полей (${data.fields.length}/25)`);
    for (const f of data.fields) {
      if (f.name && f.name.length > 256) errors.push(`имя поля "${f.name.slice(0, 30)}..." слишком длинное (${f.name.length}/256)`);
      if (f.value && f.value.length > 1024) errors.push(`значение поля "${f.name}" слишком длинное (${f.value.length}/1024)`);
    }
  }
  const total =
    (data.title?.length || 0) +
    (data.description?.length || 0) +
    (data.footer?.text?.length || 0) +
    (data.fields || []).reduce((sum, f) => sum + (f.name?.length || 0) + (f.value?.length || 0), 0);
  if (total > 6000) errors.push(`суммарная длина embed превышена (${total}/6000)`);
  if (errors.length) throw new Error('Discord embed limit violated: ' + errors.join('; '));
}

function validatePayload(payload) {
  if (payload?.embeds) payload.embeds.forEach(validateEmbed);
}

function makeInteraction({ subcommand, subcommandGroup = null, options = {}, guild = null, user = null, member = null, channel = null } = {}) {
  const g = guild || makeGuild();
  const u = user || makeUser('user1');
  const m = member || makeMember('user1');
  const c = channel || makeChannel('chan1');

  const replies = [];
  return {
    guild: g,
    user: u,
    member: m,
    channel: c,
    client: {
      users: { send: async () => {} },
      commands: new Map()
    },
    options: {
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
      getUser: (name) => options[name] ?? null,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => (options[name] !== undefined ? options[name] : null),
      getBoolean: (name) => (options[name] !== undefined ? options[name] : null),
      getRole: (name) => options[name] ?? null,
      getChannel: (name) => options[name] ?? null
    },
    replied: false,
    deferred: false,
    reply: async function (payload) { validatePayload(payload); this.replied = true; replies.push(payload); return payload; },
    editReply: async function (payload) { validatePayload(payload); replies.push(payload); return payload; },
    deferReply: async function () { this.deferred = true; },
    _replies: replies
  };
}

module.exports = { makeUser, makeChannel, makeMember, makeGuild, makeInteraction };
