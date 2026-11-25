// Tickets (stage 3): topics with a list and a window of questions, the limit of open tickets, the blacklist, the name
// format, the staff roles, closing with the transcript (text/HTML, kept for the panel), auto-close with a warning, the
// rating, and the panel's pages (settings, topics, publish, the list, the transcript, closing from the panel).
process.env.DATABASE_PATH = './data/test_tickets.sqlite';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 't'.repeat(40);
const fs = require('fs'); const path = require('path'); const assert = require('assert');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const G = '777000000000000001', CAT = '800000000000000020', LOG = '800000000000000030', STAFF = '600000000000000001', TOPIC_ROLE = '600000000000000002', PANEL_CH = '800000000000000040';
const results = []; let failed = 0;
async function test(name, fn) { try { await fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 3).join(' | ')}`); } }

// ---- a small Discord: a guild that makes channels, channels that keep messages ----
function makeWorld() {
  const channels = new Map(); const dms = []; let seq = 900000000000000000n;
  const nextId = () => String(++seq);
  const mkChannel = (id, extra = {}) => {
    const sent = [];
    const ch = { id, guildId: G, sent, deleted: false, type: 0, ...extra,
      send: async (p) => { const m = { id: nextId(), createdTimestamp: Date.now(), author: { username: 'Dark', bot: true }, content: p.content || '', attachments: new Map(), payload: p, edit: async (x) => { m.payload = x; return m; } }; sent.push(m); return m; },
      delete: async () => { ch.deleted = true; channels.delete(id); },
      messages: { fetch: async (q) => { if (typeof q === 'string') return sent.find((m) => m.id === q) || null; return new Map((q && q.before ? [] : sent.slice().reverse()).map((m) => [m.id, m])); } },
      permissionOverwrites: { edit: async () => {}, delete: async () => {} } };
    channels.set(id, ch); return ch;
  };
  mkChannel(LOG); mkChannel(PANEL_CH); channels.set(CAT, { id: CAT, type: 4 });
  const roles = new Map([[STAFF, { id: STAFF }], [TOPIC_ROLE, { id: TOPIC_ROLE }], [G, { id: G }]]);
  const created = [];
  const guild = { id: G, name: 'Night Owls', roles: { everyone: { id: G }, cache: roles },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null, create: async (o) => { const ch = mkChannel(nextId(), { name: o.name, parent: o.parent, overwrites: o.permissionOverwrites }); created.push(o); return ch; } },
    client: null };
  const client = { user: { id: 'BOT' }, guilds: { cache: new Map([[G, guild]]) }, channels: { fetch: async (id) => channels.get(id) || null },
    users: { fetch: async (id) => ({ id, send: async (p) => { dms.push({ id, p }); return {}; } }) } };
  guild.client = client;
  return { guild, client, channels, created, dms };
}
function press(world, { customId, user = 'U1', values, fields, member } = {}) {
  const out = { replies: [], modal: null };
  const i = {
    customId, values, guild: world.guild, client: world.client, user: { id: user, username: 'Vasya' }, member: member || { id: user, permissions: { has: () => false }, roles: { cache: new Map() } },
    isModalSubmit: () => Boolean(fields), fields: { getTextInputValue: (k) => (fields || {})[k] || '' },
    reply: async (p) => { out.replies.push(p); }, deferReply: async () => {}, editReply: async (p) => { out.replies.push(p); }, update: async (p) => { out.replies.push(p); },
    showModal: async (m) => { out.modal = m; }
  };
  return { i, out };
}
const text = (p) => JSON.stringify(p && p.embeds ? p.embeds.map((e) => (e.toJSON ? e.toJSON() : e)) : p);

(async () => {
  const db = require('../db'); await db.init();
  const tickets = require('../bot/modules/tickets');
  const mc = require('../bot/utils/moduleConfig');
  const { getOrCreateSettings } = require('../bot/modules/leveling');
  const setCfg = async (v, extra = {}) => { const s = await getOrCreateSettings(G); mc.write(s, 'tickets', v); Object.assign(s, extra); await s.save(); return s; };

  await test('the name of a channel follows the format: number, user, topic; no spaces or odd signs; never empty', async () => {
    assert.strictEqual(tickets.channelName('обращение-{number}-{user}', { number: 7, user: 'Vasya Pupkin!' }), 'обращение-0007-vasyapupkin');
    assert.strictEqual(tickets.channelName('{category} {number}', { number: 12, user: 'x', category: 'Оплата заказа' }), 'оплатазаказа-0012');
    assert.strictEqual(tickets.channelName('!!!', { number: 3, user: 'x' }), 'обращение-0003');
  });

  await test('settings: read with defaults, a form is checked, a topic without a name and a question without text are dropped', async () => {
    const s = await getOrCreateSettings(G);
    assert.strictEqual(mc.read(s, 'tickets').maxOpen, 1);
    const r = mc.fromForm('tickets', { _fields: 'categories,maxOpen', maxOpen: '9', categories_0_label: 'Оплата', categories_0_questions_0_label: 'Номер заказа', categories_0_questions_1_label: '', categories_1_label: '' });
    assert(r.fieldErrors.maxOpen, 'max 5');
    const ok = mc.fromForm('tickets', { _fields: 'categories', categories_0_label: 'Оплата', categories_0_roles: TOPIC_ROLE, categories_0_questions_0_label: 'Номер заказа', categories_0_questions_0_long: 'on', categories_1_label: '' });
    assert.strictEqual(ok.values.categories.length, 1); assert.strictEqual(ok.values.categories[0].questions.length, 1);
    assert(ok.values.categories[0].questions[0].long && ok.values.categories[0].roles[0] === TOPIC_ROLE);
  });

  await test('the panel: a button without topics; a list of topics with their emoji when there are topics', async () => {
    let s = await setCfg({ categories: [] });
    let p = tickets.panelPayload(s);
    assert.strictEqual(p.components[0].toJSON().components[0].custom_id, tickets.OPEN);
    s = await setCfg({ categories: [{ label: 'Оплата', emoji: '💳', description: 'Вопросы по оплате', roles: [TOPIC_ROLE], welcome: 'Пришлите номер заказа', questions: [{ label: 'Номер заказа', long: false, required: true }] }, { label: 'Другое', questions: [] }] });
    p = tickets.panelPayload(s);
    const menu = p.components[0].toJSON().components[0];
    assert(menu.custom_id === tickets.PICK && menu.options.length === 2 && menu.options[0].emoji.name === '💳', JSON.stringify(menu));
  });

  const world = makeWorld();
  await test('a topic with questions opens a window first; its answers go into the new channel with the topic roles and the staff', async () => {
    await setCfg({ supportRoles: [STAFF], nameFormat: '{category}-{number}' }, { ticketCategoryId: CAT, ticketLogChannelId: LOG, ticketsEnabled: true });
    let { i, out } = press(world, { customId: tickets.PICK, values: ['0'] });
    await tickets.handleTicketButton(i);
    assert(out.modal && out.modal.toJSON().custom_id === tickets.FORM + '0', 'the window');
    ({ i, out } = press(world, { customId: tickets.FORM + '0', fields: { q0: 'A-123' } }));
    await tickets.handleTicketButton(i);
    const made = world.created.pop();
    assert(made && made.name === 'оплата-0001' && made.parent === CAT, made && made.name);
    assert(made.permissionOverwrites.some((o) => o.id === STAFF) && made.permissionOverwrites.some((o) => o.id === TOPIC_ROLE), 'staff and topic roles see it');
    const t = await db.Ticket.findOne({ where: { guildId: G, userId: 'U1' } });
    assert(t.category === 'Оплата' && JSON.parse(t.answers)[0].a === 'A-123' && t.lastActivityAt, 'saved with the topic and the answers');
    const first = world.channels.get(t.channelId).sent[0];
    assert(first.content.includes(`<@&${STAFF}>`) && first.content.includes(`<@&${TOPIC_ROLE}>`) && text(first.payload).includes('A-123') && text(first.payload).includes('Пришлите номер заказа'), text(first.payload));
  });

  await test('one open ticket by default; the limit can be raised; a member on the blacklist is refused', async () => {
    let { i, out } = press(world, { customId: tickets.PICK, values: ['1'] });
    await tickets.handleTicketButton(i);
    assert(text(out.replies[0]).includes('уже есть открытое обращение'), text(out.replies[0]));
    await setCfg({ maxOpen: 2 });
    ({ i, out } = press(world, { customId: tickets.PICK, values: ['1'] }));
    await tickets.handleTicketButton(i);
    assert.strictEqual(await db.Ticket.count({ where: { guildId: G, userId: 'U1', status: 'open' } }), 2);
    await setCfg({ blacklist: ['100000000000000099'] });
    ({ i, out } = press(world, { customId: tickets.OPEN, user: '100000000000000099' }));
    await tickets.handleTicketButton(i);
    assert(text(out.replies[0]).includes('закрыт доступ'), text(out.replies[0]));
  });

  await test('closing keeps the transcript for the panel and sends it to the log (HTML when chosen); the author is asked for a rating', async () => {
    await setCfg({ transcript: 'html', rating: true });
    const t = await db.Ticket.findOne({ where: { guildId: G, userId: 'U1', status: 'open' }, order: [['id', 'ASC']] });
    const ch = world.channels.get(t.channelId);
    ch.sent.push({ id: '1', createdTimestamp: Date.now(), author: { username: 'Vasya' }, content: 'Не пришёл заказ <script>', attachments: new Map() });
    const r = await tickets.closeById(world.client, G, t.id, 'ADMIN', 'решено');
    assert(r.ok && !r.kept, JSON.stringify(r));
    await t.reload();
    assert(t.status === 'closed' && t.closedBy === 'ADMIN' && t.closeReason === 'решено' && t.transcript.includes('Не пришёл заказ'), 'closed with the transcript');
    const log = world.channels.get(LOG).sent.pop();
    const file = log.payload.files[0];
    assert(file.name.endsWith('.html') && String(file.attachment).includes('&lt;script&gt;') && !String(file.attachment).includes('<script>'), 'escaped HTML file');
    await new Promise((res) => setTimeout(res, 20));
    const dm = world.dms.find((d) => d.id === 'U1');
    assert(dm && JSON.stringify(dm.p.components[0].toJSON()).includes(`${tickets.RATE}${t.id}:5`), 'a rating was asked');
    // the author rates once; someone else cannot
    let { i, out } = press(world, { customId: `${tickets.RATE}${t.id}:5`, user: 'OTHER' });
    await tickets.handleTicketButton(i); assert(text(out.replies[0]).includes('нельзя'), 'not the author');
    ({ i, out } = press(world, { customId: `${tickets.RATE}${t.id}:4`, user: 'U1' }));
    await tickets.handleTicketButton(i);
    await t.reload(); assert.strictEqual(t.rating, 4);
    ({ i, out } = press(world, { customId: `${tickets.RATE}${t.id}:1`, user: 'U1' }));
    await tickets.handleTicketButton(i);
    await t.reload(); assert.strictEqual(t.rating, 4, 'rated once');
  });

  await test('auto-close: a warning before the limit, a message withdraws it, then the quiet ticket closes by itself', async () => {
    await setCfg({ autoCloseHours: 10, warnHours: 2, rating: false, transcript: 'txt' });
    const t = await db.Ticket.findOne({ where: { guildId: G, status: 'open' } });
    const ch = world.channels.get(t.channelId);
    const base = Date.now();
    t.lastActivityAt = new Date(base - 9 * 3600_000); await t.save();
    await tickets.autoClose(world.client, base);
    await t.reload(); assert(t.warnedAt && t.status === 'open', 'warned');
    assert(text(ch.sent[ch.sent.length - 1].payload).includes('закроется само'), 'the warning is in the channel');
    await tickets.loadOpenChannels();
    await tickets.noteActivity({ channelId: t.channelId, author: { bot: false } });
    await t.reload(); assert(!t.warnedAt, 'a message withdraws the warning');
    t.lastActivityAt = new Date(base - 11 * 3600_000); await t.save();
    await tickets.autoClose(world.client, base);
    await t.reload(); assert(t.status === 'closed' && t.closedBy === null && /нет сообщений/.test(t.closeReason), 'closed by itself');
  });

  await test('publish: the panel is posted, then edited in place in the same channel', async () => {
    let r = await tickets.publishPanel(world.client, G, PANEL_CH);
    assert(!r.edited);
    const s = await getOrCreateSettings(G); assert.strictEqual(mc.read(s, 'tickets').panelMessageId, r.message.id);
    r = await tickets.publishPanel(world.client, G, PANEL_CH);
    assert(r.edited && world.channels.get(PANEL_CH).sent.length === 1, 'edited, not posted twice');
  });

  // ---- the panel's pages ----
  const stub = (rel, exports) => { const f = require.resolve(path.join('..', 'web', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
  stub('middleware/ensureGuildAccess.js', { ensureGuildAccess: (q, s, n) => { q.user = { id: 'ADMIN' }; n(); } });
  stub('discordApi.js', {
    getGuild: async (id) => ({ id, name: 'T', icon: null }), getUsers: async () => ({}), getBotGuildIds: async () => new Set([G]),
    getGuildChannels: async () => [{ id: LOG, name: 'журнал', type: 0 }, { id: PANEL_CH, name: 'помощь', type: 0 }, { id: CAT, name: 'Обращения', type: 4 }],
    getGuildRoles: async () => [{ id: STAFF, name: 'Поддержка', position: 2 }, { id: TOPIC_ROLE, name: 'Бухгалтерия', position: 1 }]
  });
  stub('botBridge.js', { getClient: () => world.client, settingsChanged: () => {} });
  require('../web/modules');
  const express = require('express');
  const app = express(); app.set('view engine', 'ejs'); app.set('views', path.join(__dirname, '..', 'web', 'views')); app.use(express.urlencoded({ extended: true }));
  app.use('/dashboard', require('../web/routes/dashboard/tickets')); app.use((e, q, s, n) => s.status(500).send(String(e.stack)));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}/dashboard/${G}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  await test('panel: the settings page has the staff, the topics with an empty row for a new one, the panel, closing and the scope block', async () => {
    const html = await (await fetch(base + '/tickets')).text();
    for (const s of ['name="supportRoles"', 'categories_0_label', 'categories_2_label', 'name="panelEmbed_on"', '/tickets/publish', 'name="autoCloseHours"', '/scope/tickets', 'value="Оплата"']) assert(html.includes(s), s);
  });
  await test('panel: a form saves only its own fields; an emptied list of roles is empty; a bad number is refused', async () => {
    let r = await post('/tickets/settings', { _fields: 'supportRoles,maxOpen,nameFormat', maxOpen: '3', nameFormat: '{number}', ticketCategoryId: CAT });
    assert.strictEqual(r.status, 302);
    let s = await getOrCreateSettings(G); let c = mc.read(s, 'tickets');
    assert(c.maxOpen === 3 && c.supportRoles.length === 0 && s.ticketSupportRoleId === null && c.categories.length === 2 && c.autoCloseHours === 10, JSON.stringify(c));
    r = await post('/tickets/settings', { _fields: 'maxOpen', maxOpen: '0' });
    assert(r.headers.get('location').includes('invalid=1'), r.headers.get('location'));
    r = await post('/scope/tickets', { _fields: 'allow,deny,exceptRoles,cooldown', allow: PANEL_CH, cooldown: '30' });
    s = await getOrCreateSettings(G); const sc = mc.scopeOf(s, 'tickets');
    assert(sc.allow[0] === PANEL_CH && sc.cooldown === 30 && !sc.deny.length, JSON.stringify(sc));
  });
  await test('panel: the list shows open and closed tickets; the transcript opens; closing from the panel works', async () => {
    let html = await (await fetch(base + '/tickets-list?status=all')).text();
    assert(html.includes('Оплата') && html.includes('/transcript') && html.includes('★★★★'), 'the list');
    const closed = await db.Ticket.findOne({ where: { guildId: G, status: 'closed', rating: 4 } });
    const tr = await fetch(`${base}/tickets/${closed.id}/transcript`);
    assert(tr.status === 200 && (await tr.text()).includes('Не пришёл заказ'));
    const { i } = press(world, { customId: tickets.PICK, values: ['1'], user: 'U2' });
    await tickets.handleTicketButton(i);
    const open = await db.Ticket.findOne({ where: { guildId: G, status: 'open', userId: 'U2' } });
    const r = await post(`/tickets/${open.id}/close`, {});
    assert(r.headers.get('location').includes('ticketclosed'), r.headers.get('location'));
    await open.reload(); assert.strictEqual(open.status, 'closed');
    html = await (await fetch(base + '/tickets-list')).text();
    assert(html.includes('Открытых обращений нет'), 'empty now');
  });

  server.close();
  console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
