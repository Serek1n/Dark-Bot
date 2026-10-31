// Webhook panel in Discord: buttons, menus and windows. Discord is faked.
process.env.DATABASE_PATH = './data/test_webhookbot.sqlite';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const { PermissionFlagsBits, ButtonStyle } = require('discord.js');
const axios = require('axios');

(async () => {
  const db = require('../db'); await db.init();
  const wp = require('../bot/modules/webhookPanel');
  const cmd = require('../bot/commands/utility/webhook');
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const txt = (x) => JSON.stringify(x);

  const BOT = 'BOT1'; const sent = []; const deleted = []; const edited = []; const created = [];
  const hook = (id, owner, name = 'h' + id) => ({ id, name, channelId: 'C1', url: `https://discord.com/api/webhooks/${id}/tok`, owner: { id: owner },
    send: async (x) => sent.push([id, x]), delete: async (r) => { deleted.push([id, r]); store = store.filter((h) => h.id !== id); }, edit: async (x) => edited.push([id, x]) });
  let store = [hook('1', BOT), hook('2', 'SOMEONE'), hook('LOG', BOT)];
  const channel = { id: 'C1', createWebhook: async (o) => { if (channel.fail) throw new Error(channel.fail); created.push(o); const h = hook('N' + created.length, BOT, o.name); store.push(h); return h; } };
  const oldMsgs = [];
  const panelChannel = { id: 'P1', send: async () => ({ id: 'MSG' + (oldMsgs.length + 1) }), messages: { delete: async (id) => oldMsgs.push(id) } };
  const channels = new Map([['C1', channel], ['P1', panelChannel]]);
  const guild = { id: 'WB1', client: { user: { id: BOT } }, members: { me: { permissions: { has: () => guild.botCan !== false } } },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null }, fetchWebhooks: async () => new Map(store.map((h) => [h.id, h])) };
  await db.GuildSettings.create({ guildId: 'WB1', logWebhookId: 'LOG' });
  const member = (can) => ({ permissions: { has: (f) => (can ? true : f !== PermissionFlagsBits.ManageWebhooks) } });

  // one fake pressed component / submitted window
  const press = async (customId, { can = true, values, fields = {}, g = guild } = {}) => {
    const out = { replies: [], updates: [], modals: [], follow: [] };
    const i = { guild: g, member: member(can), user: { id: 'U', username: 'neya' }, client: { user: { displayAvatarURL: () => 'https://cdn/bot.png' } }, customId, values, replied: false, deferred: false,
      fields: { getTextInputValue: (n) => fields[n] ?? '' },
      reply: async (x) => { out.replies.push(x); i.replied = true; }, update: async (x) => out.updates.push(x), showModal: async (m) => out.modals.push(m.toJSON()), followUp: async (x) => out.follow.push(x),
      deferReply: async (x) => { i.deferred = true; out.replies.push(x); }, editReply: async (x) => { out.replies.push(x); } };
    await wp.handleWebhookComponent(i); return out;
  };
  const said = (o) => txt([o.replies, o.updates, o.follow]);

  await test('panel: 5 icon-only buttons in one row, delete is red, every icon is different and explained in the text', async () => {
    const p = wp.panelPayload(); const rows = p.components.map((r) => r.toJSON());
    assert(rows.length === 1 && rows[0].components.length === 5, 'row');
    assert(rows[0].components.map((c) => c.custom_id).join() === 'wh:create,wh:list,wh:send,wh:edit,wh:delete', 'ids');
    assert(rows[0].components[4].style === ButtonStyle.Danger && rows[0].components[0].style === ButtonStyle.Secondary, 'styles');
    assert(rows[0].components.every((c) => !c.label && c.emoji && c.emoji.name), 'icons only');
    const text = p.embeds[0].toJSON().description; for (const [, emoji, label, hint] of wp.BUTTONS) assert(text.includes(`${emoji} **${label}** — ${hint}`), 'explained: ' + label);
    assert(new Set(wp.BUTTONS.map((b) => b[1])).size === 5, 'different icons');
  });
  await test('list button: only own webhooks, no log webhook, private reply', async () => {
    const o = await press('wh:list'); const t = said(o);
    assert(t.includes('webhooks/1/tok') && !t.includes('webhooks/2/') && !t.includes('webhooks/LOG/') && t.includes('"flags":64'), t);
  });
  await test('no right to manage webhooks: nothing opens and nothing changes', async () => {
    for (const id of ['wh:list', 'wh:create', 'wh:s:delete', 'wh:y:delete:1', 'wh:m:send:1']) { const o = await press(id, { can: false, values: ['1'], fields: { text: 'x' } }); assert(said(o).includes('Управлять вебхуками') && !o.modals.length, id); }
    assert(!deleted.length && !sent.length, 'untouched');
  });
  await test('the bot lacks the right, or the feature is off: refused', async () => {
    guild.botCan = false; assert(said(await press('wh:list')).includes('У бота нет права'), 'bot'); guild.botCan = true;
    await db.GuildSettings.update({ webhooksEnabled: false }, { where: { guildId: 'WB1' } });
    assert(said(await press('wh:list')).includes('отключена'), 'off');
    await db.GuildSettings.update({ webhooksEnabled: true }, { where: { guildId: 'WB1' } });
  });
  await test('create: channel menu, then a window, then the webhook with the bot avatar and a private link', async () => {
    const m = await press('wh:create'); assert(txt(m.replies).includes('wh:c:create'), 'channel menu');
    const w = await press('wh:c:create', { values: ['C1'] }); assert(w.modals[0].custom_id === 'wh:m:create:C1' && w.modals[0].components.length === 2, 'window');
    const o = await press('wh:m:create:C1', { fields: { name: ' Новости ', avatar: '' } });
    assert(created[0].name === 'Новости' && created[0].avatar === 'https://cdn/bot.png', txt(created[0]));
    assert(said(o).includes('webhooks/N1/tok') && said(o).includes('"flags":64'), said(o));
  });
  await test('create: picture by link is downloaded safely; internal addresses and non-images are refused', async () => {
    const real = axios.get; let calls = 0;
    axios.get = async () => { calls++; return { headers: { 'content-type': 'image/png' }, data: Buffer.from([1, 2, 3]) }; };
    try {
      await press('wh:m:create:C1', { fields: { name: 'A', avatar: 'https://93.184.216.34/a.png' } });
      assert(created[1].avatar.startsWith('data:image/png;base64,'), 'data uri');
      const n = created.length; const c = calls;
      for (const bad of ['http://93.184.216.34/a.png', 'https://127.0.0.1/a.png', 'https://10.0.0.5/a.png', 'https://[::1]/a.png']) {
        const o = await press('wh:m:create:C1', { fields: { name: 'B', avatar: bad } }); assert(said(o).includes('❌') && created.length === n, bad);
      }
      assert(calls === c, 'nothing was requested');
      axios.get = async () => ({ headers: { 'content-type': 'text/html' }, data: Buffer.from('x') });
      assert(said(await press('wh:m:create:C1', { fields: { name: 'B', avatar: 'https://93.184.216.34/a' } })).includes('PNG'), 'type');
    } finally { axios.get = real; }
  });
  await test('create: Discord errors become readable messages', async () => {
    channel.fail = 'Maximum number of webhooks reached (15)'; assert(said(await press('wh:m:create:C1', { fields: { name: 'X' } })).includes('уже 15'), 'limit');
    channel.fail = 'Missing Permissions'; assert(said(await press('wh:m:create:C1', { fields: { name: 'X' } })).includes('не хватает прав'), 'perm'); channel.fail = null;
    assert(said(await press('wh:m:create:NOPE', { fields: { name: 'X' } })).includes('нельзя создать'), 'bad channel');
  });
  await test('send: choose a webhook, write text, the message goes out with no mentions parsed', async () => {
    const m = await press('wh:send'); assert(txt(m.replies).includes('wh:s:send') && txt(m.replies).includes('"value":"1"') && !txt(m.replies).includes('"value":"2"') && !txt(m.replies).includes('"value":"LOG"'), 'menu');
    const w = await press('wh:s:send', { values: ['1'] }); assert(w.modals[0].custom_id === 'wh:m:send:1', 'window');
    const o = await press('wh:m:send:1', { fields: { text: 'всем @everyone привет', username: 'Бот' } });
    const s = sent.find((x) => x[0] === '1'); assert(s && !s[1].content && s[1].embeds[0].toJSON().description.includes('@everyone') && s[1].username === 'Бот' && s[1].allowedMentions.parse.length === 0, txt(sent));
    assert(said(o).includes('отправлено'), said(o));
    await press('wh:m:send:1', { fields: { text: 'просто текст', frame: 'нет' } });
    const p = sent[sent.length - 1][1]; assert(p.content === 'просто текст' && !p.embeds, 'plain: ' + txt(p));
    await press('wh:m:send:1', { fields: { text: 'a', title: 'Заголовок', frame: 'да' } });
    assert(sent[sent.length - 1][1].embeds[0].toJSON().title === 'Заголовок', 'title');
    assert(said(await press('wh:m:send:1', { fields: { text: 'x'.repeat(2001), frame: 'нет' } })).includes('2000'), 'plain limit');
  });
  await test('send/edit/delete refuse a webhook that is not the bot\'s own (another bot, the log webhook)', async () => {
    const n = sent.length;
    for (const id of ['2', 'LOG', '999']) {
      assert(said(await press('wh:m:send:' + id, { fields: { text: 'x' } })).includes('❌'), 'send ' + id);
      assert(said(await press('wh:y:delete:' + id)).includes('❌'), 'delete ' + id);
      assert(said(await press('wh:m:edit:' + id, { fields: { name: 'x' } })).includes('❌'), 'edit ' + id);
      assert(!(await press('wh:s:delete', { values: [id] })).updates.length, 'confirm ' + id);
    }
    assert(sent.length === n && !deleted.length && !edited.length, 'untouched');
  });
  await test('edit: name and picture change; empty window is refused', async () => {
    const w = await press('wh:s:edit', { values: ['1'] }); assert(w.modals[0].custom_id === 'wh:m:edit:1', 'window');
    await press('wh:m:edit:1', { fields: { name: ' Новое ', avatar: '' } }); assert(edited[0][1].name === 'Новое' && !edited[0][1].avatar, txt(edited));
    assert(said(await press('wh:m:edit:1', { fields: {} })).includes('Нечего менять') && edited.length === 1, 'empty');
  });
  await test('delete: confirmation first, then it is removed', async () => {
    const c = await press('wh:s:delete', { values: ['1'] }); assert(txt(c.updates).includes('wh:y:delete:1') && !deleted.length, 'confirm');
    const o = await press('wh:y:delete:1'); assert(deleted[0][0] === '1' && txt(o.updates).includes('удалён'), txt(o));
    assert(said(await press('wh:send')).includes('N1'), 'others stay');
  });
  await test('/webhook panel: posts the panel, replaces the older one, remembers it', async () => {
    const replies = [];
    const run = async () => { await cmd.execute({ guild, channel: panelChannel, member: member(true), user: { id: 'U', username: 'neya' }, options: { getSubcommand: () => 'panel', getChannel: () => null }, reply: async (x) => replies.push(x) }); };
    await run(); await run();
    const st = await db.GuildSettings.findByPk('WB1');
    assert(st.webhookPanelChannelId === 'P1' && st.webhookPanelMessageId === 'MSG1' && oldMsgs.join() === 'MSG1', `${st.webhookPanelMessageId} ${oldMsgs}`);
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : '\n      ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
