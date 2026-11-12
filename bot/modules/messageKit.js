// The message builder of the panel ("Сообщения"): one message with text, up to 10 embeds and link buttons, sent through a webhook
// or as the bot, edited later, kept as a draft or posted on a schedule. Everything that talks to Discord lives here, so the panel
// (sending now) and the bot's scheduler (sending later) check and send in exactly the same way.
const axios = require('axios');

const API = 'https://discord.com/api/v10';
const botApi = require('../../web/discordRest').createBotApi(); // through discord.js when the bot runs (rate limits respected)
const plainApi = axios.create({ baseURL: API, timeout: 10000 }); // webhook links carry their own token: no bot token is sent with them

const LIMITS = { content: 2000, embeds: 10, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000, rows: 5, buttons: 5, label: 80, username: 80 };
const MENTIONS = ['none', 'users', 'roles', 'everyone'];
const SNOW = /^\d{15,25}$/;

class KitError extends Error {
  constructor(text, code) { super(text); this.kit = true; this.code = code || 'invalid'; }
}

const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const isHttpUrl = (v) => /^https?:\/\/[^\s<>"]{1,2040}$/i.test(v);
const isImageUrl = (v) => /^https:\/\/[^\s<>"]{1,2040}$/i.test(v);

/** "#e3a857", "e3a857", 14919767 → a number for Discord; null when empty. */
function parseColor(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) return v;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(str(v).trim());
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}

function cleanEmbed(raw, n) {
  const where = `Эмбед ${n}`;
  if (!raw || typeof raw !== 'object') throw new KitError(`${where}: пустой.`);
  const e = {}; let chars = 0;
  const text = (v, max, what) => {
    const s = str(v).trim();
    if (s.length > max) throw new KitError(`${where}: ${what} длиннее ${max} символов.`);
    chars += s.length; return s;
  };
  const link = (v, what, image) => {
    const s = str(v).trim();
    if (!s) return '';
    if (!(image ? isImageUrl(s) : isHttpUrl(s))) throw new KitError(`${where}: ${what} — нужна ссылка, начинающаяся с ${image ? 'https://' : 'http(s)://'}.`);
    return s;
  };
  const title = text(raw.title, LIMITS.title, 'заголовок'); if (title) e.title = title;
  const url = link(raw.url, 'ссылка заголовка'); if (url) e.url = url;
  const description = text(raw.description, LIMITS.description, 'описание'); if (description) e.description = description;
  const color = parseColor(raw.color);
  if (color === undefined) throw new KitError(`${where}: цвет — напишите его как #e3a857.`);
  if (color !== null) e.color = color;
  if (raw.author && typeof raw.author === 'object') {
    const name = text(raw.author.name, LIMITS.author, 'имя автора');
    if (name) e.author = { name, ...(link(raw.author.url, 'ссылка автора') ? { url: raw.author.url.trim() } : {}), ...(link(raw.author.icon_url, 'иконка автора', true) ? { icon_url: raw.author.icon_url.trim() } : {}) };
  }
  if (raw.footer && typeof raw.footer === 'object') {
    const footerText = text(raw.footer.text, LIMITS.footer, 'подпись');
    if (footerText) e.footer = { text: footerText, ...(link(raw.footer.icon_url, 'иконка подписи', true) ? { icon_url: raw.footer.icon_url.trim() } : {}) };
  }
  const image = link(raw.image?.url ?? raw.image, 'картинка', true); if (image) e.image = { url: image };
  const thumb = link(raw.thumbnail?.url ?? raw.thumbnail, 'миниатюра', true); if (thumb) e.thumbnail = { url: thumb };
  if (raw.timestamp) {
    const t = new Date(raw.timestamp);
    if (Number.isNaN(t.getTime())) throw new KitError(`${where}: не понял дату в метке времени.`);
    e.timestamp = t.toISOString();
  }
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  if (fields.length > LIMITS.fields) throw new KitError(`${where}: полей больше ${LIMITS.fields}.`);
  const outFields = [];
  fields.forEach((f, i) => {
    const name = text(f?.name, LIMITS.fieldName, `название поля ${i + 1}`);
    const value = text(f?.value, LIMITS.fieldValue, `значение поля ${i + 1}`);
    if (!name && !value) return; // an empty row left in the editor is dropped
    if (!name || !value) throw new KitError(`${where}: у поля ${i + 1} нужны и название, и значение.`);
    outFields.push({ name, value, inline: Boolean(f.inline) });
  });
  if (outFields.length) e.fields = outFields;
  if (!e.title && !e.description && !e.author && !e.footer && !e.image && !e.thumbnail && !e.fields) throw new KitError(`${where}: заполните хотя бы одно поле или удалите его.`);
  return { embed: e, chars };
}

/** Link buttons only: they need no bot to answer them, so they work from any webhook and keep working forever. */
function cleanComponents(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  if (rows.length > LIMITS.rows) throw new KitError(`Кнопок больше ${LIMITS.rows} рядов.`);
  const out = [];
  rows.forEach((row, r) => {
    const items = Array.isArray(row?.components) ? row.components : Array.isArray(row) ? row : [];
    if (items.length > LIMITS.buttons) throw new KitError(`Ряд ${r + 1}: больше ${LIMITS.buttons} кнопок.`);
    const buttons = [];
    items.forEach((b, i) => {
      const label = str(b?.label).trim(); const url = str(b?.url).trim();
      if (!label && !url) return;
      if (!label || label.length > LIMITS.label) throw new KitError(`Ряд ${r + 1}, кнопка ${i + 1}: текст от 1 до ${LIMITS.label} символов.`);
      if (!/^(https?|discord):\/\/[^\s<>"]{1,500}$/i.test(url)) throw new KitError(`Ряд ${r + 1}, кнопка ${i + 1}: нужна ссылка (https://…).`);
      buttons.push({ type: 2, style: 5, label, url });
    });
    if (buttons.length) out.push({ type: 1, components: buttons });
  });
  return out;
}

// ---- Discord components ("Компоненты"): containers, text, separators, galleries, sections, link buttons ----
const V2 = 1 << 15; // IS_COMPONENTS_V2: such a message has no text and no embeds, only components
const V2_MAX = 40; // components in one message, nested ones included
const V2_TEXT = 4000; // characters of text in all text blocks together

function cleanV2(list) {
  let count = 0; let text = 0;
  const where = (n) => `Блок ${n}`;
  const url = (v, what, n, image) => {
    const u = str(v).trim();
    if (!(image ? isImageUrl(u) : /^(https?|discord):\/\/[^\s<>"]{1,500}$/i.test(u))) throw new KitError(`${where(n)}: ${what} — нужна ссылка, начинающаяся с ${image ? 'https://' : 'http(s)://'}.`);
    return u;
  };
  const textOf = (v, n) => {
    const t = str(v);
    if (!t.trim()) throw new KitError(`${where(n)}: текст пустой — напишите его или удалите блок.`);
    if (t.length > V2_TEXT) throw new KitError(`${where(n)}: текст длиннее ${V2_TEXT} символов.`);
    text += t.length; return t;
  };
  const button = (b, n) => {
    const label = str(b?.label).trim();
    if (!label || label.length > LIMITS.label) throw new KitError(`${where(n)}: у кнопки нужен текст от 1 до ${LIMITS.label} символов.`);
    count++;
    return { type: 2, style: 5, label, url: url(b?.url, 'ссылка кнопки', n) };
  };
  const one = (c, n, inContainer) => {
    count++;
    const type = Number(c?.type);
    if (type === 10) return { type: 10, content: textOf(c.content, n) };
    if (type === 14) return { type: 14, divider: c.divider !== false, spacing: Number(c.spacing) === 2 ? 2 : 1 };
    if (type === 12) {
      const items = (Array.isArray(c.items) ? c.items : []).filter((i) => str(i?.media?.url).trim());
      if (!items.length) throw new KitError(`${where(n)}: в галерее нет картинок.`);
      if (items.length > 10) throw new KitError(`${where(n)}: в галерее больше 10 картинок.`);
      return { type: 12, items: items.map((i) => ({ media: { url: url(i.media.url, 'картинка', n, true) }, ...(str(i.description).trim() ? { description: str(i.description).trim().slice(0, 1024) } : {}), ...(i.spoiler ? { spoiler: true } : {}) })) };
    }
    if (type === 9) {
      const texts = (Array.isArray(c.components) ? c.components : []).slice(0, 3);
      if (!texts.length) throw new KitError(`${where(n)}: в разделе нет текста.`);
      const acc = c.accessory || {};
      let accessory;
      if (Number(acc.type) === 2) accessory = button(acc, n);
      else { count++; accessory = { type: 11, media: { url: url(acc.media?.url, 'картинка справа', n, true) } }; }
      return { type: 9, components: texts.map((t) => { count++; return { type: 10, content: textOf(t.content, n) }; }), accessory };
    }
    if (type === 1) {
      const buttons = (Array.isArray(c.components) ? c.components : []).filter((b) => b && b.type === 2);
      if (!buttons.length) throw new KitError(`${where(n)}: добавьте хотя бы одну кнопку или удалите блок.`);
      if (buttons.length > 5) throw new KitError(`${where(n)}: в ряду больше 5 кнопок.`);
      return { type: 1, components: buttons.map((b) => button(b, n)) };
    }
    if (type === 17 && !inContainer) {
      const kids = Array.isArray(c.components) ? c.components : [];
      if (!kids.length) throw new KitError(`${where(n)}: контейнер пустой — добавьте в него блоки.`);
      const color = parseColor(c.accent_color);
      if (color === undefined) throw new KitError(`${where(n)}: цвет — напишите его как #e3a857.`);
      return { type: 17, ...(color !== null ? { accent_color: color } : {}), ...(c.spoiler ? { spoiler: true } : {}), components: kids.map((k, i) => one(k, `${n}.${i + 1}`, true)) };
    }
    throw new KitError(`${where(n)}: такой блок Discord не поддерживается.`);
  };
  const raw = Array.isArray(list) ? list : [];
  if (!raw.length) throw new KitError('Добавьте хотя бы один блок.');
  const out = raw.map((c, i) => one(c, i + 1, false));
  if (count > V2_MAX) throw new KitError(`Компонентов больше ${V2_MAX} (сейчас ${count}). Уберите часть блоков.`);
  if (text > V2_TEXT) throw new KitError(`Во всех текстах вместе больше ${V2_TEXT} символов (сейчас ${text}).`);
  return out;
}

/**
 * Checks a message from the editor and turns it into what Discord takes. Throws KitError with words a person can act on.
 * The result keeps `mentions` (who may be pinged) and the webhook-only `username` / `avatar_url` apart from the body.
 */
function cleanMessage(raw) {
  if (!raw || typeof raw !== 'object') throw new KitError('Сообщение пустое.');
  if (raw.v2 || (Number(raw.flags) & V2)) {
    const components = cleanV2(raw.components);
    const username = str(raw.username).trim();
    if (username.length > LIMITS.username) throw new KitError(`Имя отправителя длиннее ${LIMITS.username} символов.`);
    if (/discord|clyde/i.test(username)) throw new KitError('В имени отправителя Discord не разрешает слова «discord» и «clyde».');
    const avatar = str(raw.avatar_url).trim();
    if (avatar && !isImageUrl(avatar)) throw new KitError('Аватарка — нужна ссылка, начинающаяся с https://.');
    return { v2: true, flags: V2, content: '', embeds: [], components, username, avatar_url: avatar, mentions: MENTIONS.includes(raw.mentions) ? raw.mentions : 'none' };
  }
  const content = str(raw.content);
  if (content.length > LIMITS.content) throw new KitError(`Текст длиннее ${LIMITS.content} символов.`);
  const list = Array.isArray(raw.embeds) ? raw.embeds : [];
  if (list.length > LIMITS.embeds) throw new KitError(`Эмбедов больше ${LIMITS.embeds}.`);
  let total = 0; const embeds = [];
  list.forEach((e, i) => { const r = cleanEmbed(e, i + 1); total += r.chars; embeds.push(r.embed); });
  if (total > LIMITS.total) throw new KitError(`Во всех эмбедах вместе больше ${LIMITS.total} символов (сейчас ${total}).`);
  const components = cleanComponents(raw.components);
  if (!content.trim() && !embeds.length) throw new KitError('Напишите текст или добавьте эмбед.');
  const username = str(raw.username).trim();
  if (username.length > LIMITS.username) throw new KitError(`Имя отправителя длиннее ${LIMITS.username} символов.`);
  if (/discord|clyde/i.test(username)) throw new KitError('В имени отправителя Discord не разрешает слова «discord» и «clyde».');
  const avatar = str(raw.avatar_url).trim();
  if (avatar && !isImageUrl(avatar)) throw new KitError('Аватарка — нужна ссылка, начинающаяся с https://.');
  const mentions = MENTIONS.includes(raw.mentions) ? raw.mentions : 'none';
  return { content, embeds, components, username, avatar_url: avatar, mentions };
}

/** Who may be pinged. @everyone/@here only when the person asked for it AND may do it on the server.
 *  Without that right "roles" means only the roles the server itself marked as mentionable (roleIds). */
function allowedMentions(level, canEveryone, roleIds) {
  if (level === 'everyone' && canEveryone) return { parse: ['users', 'roles', 'everyone'] };
  if (level === 'roles' || level === 'everyone') {
    if (canEveryone || !Array.isArray(roleIds)) return canEveryone ? { parse: ['users', 'roles'] } : { parse: ['users'], roles: [] };
    return { parse: ['users'], roles: roleIds.slice(0, 100) };
  }
  if (level === 'users') return { parse: ['users'] };
  return { parse: [] };
}

/** https://discord.com/api/webhooks/ID/TOKEN (also canary/ptb/discordapp.com) → { id, token }; anything else → null. */
function parseWebhookUrl(url) {
  const m = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([\w-]{20,120})\/?(?:\?.*)?$/i.exec(str(url).trim());
  return m ? { id: m[1], token: m[2] } : null;
}

/** A message link or a bare ID → the message ID (and the channel from a link). */
function parseMessageRef(v) {
  const s = str(v).trim();
  if (SNOW.test(s)) return { messageId: s };
  const m = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})\/?$/i.exec(s);
  return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null;
}

function errorText(err) {
  if (err?.kit) return err.message;
  const status = err?.response?.status; const code = err?.response?.data?.code;
  if (code === 10015 || (status === 404 && /webhook/i.test(String(err?.config?.url)))) return 'Вебхук не найден — возможно, его удалили.';
  if (code === 10008) return 'Сообщение не найдено. Проверьте ID и канал.';
  if (code === 10003) return 'Канал не найден — возможно, его удалили.';
  if (code === 50005) return 'Изменить можно только сообщение, отправленное этим же вебхуком или ботом.';
  if (code === 50013 || code === 50001 || status === 403) return 'У бота не хватает прав в этом канале: нужны «Просмотр канала», «Отправлять сообщения», «Встраивать ссылки» (для веток — «Отправлять сообщения в ветках»).';
  if (code === 220001 || code === 220003) return 'Для форума укажите название новой публикации или ID существующей ветки.';
  if (code === 50035) {
    const detail = JSON.stringify(err.response.data.errors || {});
    if (/username/i.test(detail)) return 'Discord не принял имя отправителя.';
    if (/url|image|thumbnail|icon/i.test(detail)) return 'Discord не принял одну из ссылок: проверьте адреса картинок и кнопок.';
    return 'Discord не принял сообщение: проверьте поля.';
  }
  if (status === 429) return 'Discord просит подождать: слишком много сообщений подряд. Повторите через минуту.';
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') return 'Discord не ответил вовремя. Попробуйте ещё раз.';
  return 'Discord отказал в действии. Попробуйте ещё раз позже.';
}

// Errors after which a schedule cannot work any more: the webhook or the channel is gone.
const isGone = (err) => [10015, 10003].includes(err?.response?.data?.code) || err?.code === 'gone';

async function channelOf(id) {
  const { data } = await botApi.get(`/channels/${id}`);
  return data;
}

/**
 * Where a message goes, checked against the server: a webhook of THIS server (one the bot made, or a pasted link), or a channel /
 * thread of this server for posting as the bot. Returns { kind, id, token, channelId, threadId, threadName, forum }.
 */
async function resolveTarget(guildId, target, { webhookUrl, actor, need = 'send' } = {}) {
  const t = target && typeof target === 'object' ? target : {};
  const threadId = t.threadId ? str(t.threadId).trim() : '';
  if (threadId && !SNOW.test(threadId)) throw new KitError('ID ветки — это число из 17–20 цифр.');
  const threadName = str(t.threadName).trim().slice(0, 100);
  if (threadId) {
    const thread = await channelOf(threadId).catch(() => null);
    if (!thread || thread.guild_id !== guildId || ![10, 11, 12].includes(thread.type)) throw new KitError('Ветка не найдена на этом сервере.');
  }
  if (t.mode === 'webhook') {
    let id; let token;
    const link = webhookUrl || t.url;
    if (link) {
      const parsed = parseWebhookUrl(link);
      if (!parsed) throw new KitError('Это не ссылка вебхука Discord (https://discord.com/api/webhooks/…).');
      ({ id, token } = parsed);
      const { data } = await plainApi.get(`/webhooks/${id}/${token}`).catch((err) => { if (err?.response?.status === 404 || err?.response?.status === 401) throw new KitError('Вебхук по этой ссылке не найден — возможно, его удалили.', 'gone'); throw err; });
      if (data.guild_id !== guildId) throw new KitError('Этот вебхук принадлежит другому серверу.');
      return { kind: 'webhook', id, token, channelId: data.channel_id, threadId, threadName, forum: null };
    }
    id = str(t.webhookId).trim();
    if (!SNOW.test(id)) throw new KitError('Выберите вебхук или вставьте его ссылку.');
    const { data } = await botApi.get(`/webhooks/${id}`).catch((err) => { if (err?.response?.status === 404) throw new KitError('Вебхук не найден — возможно, его удалили.', 'gone'); throw err; });
    if (data.guild_id !== guildId || !data.token) throw new KitError('Этот вебхук не создан ботом на этом сервере — вставьте его ссылку.');
    const { GuildSettings } = require('../../db');
    const log = await GuildSettings.findOne({ where: { guildId }, attributes: ['logWebhookId'], raw: true }).catch(() => null);
    if (log?.logWebhookId && log.logWebhookId === id) throw new KitError('Это служебный вебхук журнала сервера: писать через него нельзя.', 'forbidden');
    return { kind: 'webhook', id, token: data.token, channelId: data.channel_id, threadId, threadName, forum: null };
  }
  const channelId = str(t.channelId).trim();
  if (!SNOW.test(channelId)) throw new KitError('Выберите канал.');
  const channel = await channelOf(channelId).catch(() => null);
  if (!channel || channel.guild_id !== guildId) throw new KitError('Канал не найден на этом сервере.', 'gone');
  await requireActor(guildId, channel, actor, need);
  return { kind: 'channel', channelId, threadId, threadName, forum: [15, 16].includes(channel.type) };
}

const P = { ADMIN: 1n << 3n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MESSAGES: 1n << 13n, HISTORY: 1n << 16n };
const big = (v) => { try { return BigInt(v || '0'); } catch { return 0n; } };

/** What the panel user himself may do in a channel: the bot must not become a way around the channel's own permissions.
 *  actor = { userId, access } where access is req.guildAccess. Server owners and administrators may everything. */
async function actorPerms(guildId, channel, actor) {
  const a = actor.access || {};
  if (a.viaOwnerOverride || a.owner || (big(a.permissions) & P.ADMIN) === P.ADMIN) return ~0n;
  const [member, roles] = await Promise.all([
    botApi.get(`/guilds/${guildId}/members/${actor.userId}`).then((r) => r.data).catch(() => null),
    botApi.get(`/guilds/${guildId}/roles`).then((r) => r.data).catch(() => null)
  ]);
  if (!member || !Array.isArray(roles)) return 0n;
  const mine = new Set([guildId, ...(member.roles || [])]);
  let perms = 0n;
  for (const r of roles) if (mine.has(r.id)) perms |= big(r.permissions);
  if ((perms & P.ADMIN) === P.ADMIN) return ~0n;
  const ows = channel.permission_overwrites || [];
  const every = ows.find((o) => o.id === guildId);
  if (every) perms = (perms & ~big(every.deny)) | big(every.allow);
  let allow = 0n; let deny = 0n;
  for (const o of ows) if (o.id !== guildId && String(o.type) === '0' && mine.has(o.id)) { allow |= big(o.allow); deny |= big(o.deny); }
  perms = (perms & ~deny) | allow;
  const own = ows.find((o) => String(o.type) === '1' && o.id === actor.userId);
  if (own) perms = (perms & ~big(own.deny)) | big(own.allow);
  return perms;
}

/** Throws unless the panel user may do `need` ('send' | 'edit' | 'read') in this channel (a thread answers for its parent). */
async function requireActor(guildId, channel, actor, need) {
  if (!actor) return;
  let base = channel;
  if ([10, 11, 12].includes(channel.type) && channel.parent_id) base = await channelOf(channel.parent_id).catch(() => null);
  if (!base || base.guild_id !== guildId) throw new KitError('Канал не найден на этом сервере.', 'gone');
  const perms = await actorPerms(guildId, base, actor);
  const has = (bit) => (perms & bit) === bit;
  if (!has(P.VIEW)) throw new KitError('У вас нет доступа к этому каналу в Discord.', 'forbidden');
  if (need === 'read' && !has(P.HISTORY)) throw new KitError('У вас нет права читать историю этого канала.', 'forbidden');
  if (need === 'send' && !has(P.SEND)) throw new KitError('У вас нет права писать в этот канал в Discord.', 'forbidden');
  if (need === 'edit') {
    if (!has(P.MANAGE_MESSAGES)) throw new KitError('Чтобы менять сообщения бота в этом канале, вам нужно право «Управлять сообщениями» в нём.', 'forbidden');
    const { GuildSettings } = require('../../db');
    const s = await GuildSettings.findOne({ where: { guildId }, attributes: ['modLogChannelId', 'logForumChannelId', 'reportChannelId', 'shopLogChannelId'], raw: true }).catch(() => null);
    const journals = [s?.modLogChannelId, s?.logForumChannelId, s?.reportChannelId, s?.shopLogChannelId].filter(Boolean);
    if (journals.includes(base.id) || journals.includes(channel.id)) throw new KitError('Это канал журнала: записи бота в нём изменить нельзя.', 'forbidden');
  }
}

const hookPath = (to, rest = '') => `/webhooks/${to.id}/${to.token}${rest}`;
const query = (to, extra = {}) => {
  const q = new URLSearchParams({ ...extra, with_components: 'true' });
  if (to.threadId) q.set('thread_id', to.threadId);
  return '?' + q.toString();
};

/** Sends (or, with messageId, edits) a checked message. Returns { id, channelId }. */
async function deliver(to, msg, { messageId, canEveryone = false, guildId } = {}) {
  let roleIds; // without the "mention everyone" right only the roles the server made mentionable are pinged
  if (!canEveryone && (msg.mentions === 'roles' || msg.mentions === 'everyone')) {
    roleIds = guildId ? await botApi.get(`/guilds/${guildId}/roles`).then((r) => r.data.filter((x) => x.mentionable && x.id !== guildId).map((x) => x.id)).catch(() => []) : [];
  }
  const body = msg.v2
    ? { flags: V2, components: msg.components || [], allowed_mentions: allowedMentions(msg.mentions, canEveryone, roleIds) }
    : { content: msg.content || '', embeds: msg.embeds || [], components: msg.components || [], allowed_mentions: allowedMentions(msg.mentions, canEveryone, roleIds) };
  if (to.kind === 'webhook') {
    if (messageId) {
      const { data } = await plainApi.patch(hookPath(to, `/messages/${messageId}`) + query(to), body);
      return { id: data.id, channelId: data.channel_id };
    }
    const full = { ...body, ...(msg.username ? { username: msg.username } : {}), ...(msg.avatar_url ? { avatar_url: msg.avatar_url } : {}), ...(to.threadName && !to.threadId ? { thread_name: to.threadName } : {}) };
    const { data } = await plainApi.post(hookPath(to) + query(to, { wait: 'true' }), full);
    return { id: data.id, channelId: data.channel_id };
  }
  const where = to.threadId || to.channelId;
  if (messageId) {
    const { data } = await botApi.patch(`/channels/${where}/messages/${messageId}`, body);
    return { id: data.id, channelId: data.channel_id };
  }
  if (to.forum && !to.threadId) {
    if (!to.threadName) throw new KitError('Для форума укажите название новой публикации или ID существующей ветки.');
    const { data } = await botApi.post(`/channels/${to.channelId}/threads`, { name: to.threadName, message: body });
    return { id: data.message?.id || data.id, channelId: data.id };
  }
  const { data } = await botApi.post(`/channels/${where}/messages`, body);
  return { id: data.id, channelId: data.channel_id };
}

/** An already sent message, back in the editor's shape (for editing it or restoring a copy). */
async function fetchMessage(to, messageId) {
  const { data } = to.kind === 'webhook'
    ? await plainApi.get(hookPath(to, `/messages/${messageId}`) + (to.threadId ? `?thread_id=${to.threadId}` : ''))
    : await botApi.get(`/channels/${to.threadId || to.channelId}/messages/${messageId}`);
  const pick = (e) => {
    const out = {};
    for (const k of ['title', 'url', 'description', 'color', 'timestamp']) if (e[k] !== undefined) out[k] = e[k];
    if (e.author) out.author = { name: e.author.name || '', url: e.author.url || '', icon_url: e.author.icon_url || '' };
    if (e.footer) out.footer = { text: e.footer.text || '', icon_url: e.footer.icon_url || '' };
    if (e.image?.url) out.image = { url: e.image.url };
    if (e.thumbnail?.url) out.thumbnail = { url: e.thumbnail.url };
    if (e.fields) out.fields = e.fields.map((f) => ({ name: f.name, value: f.value, inline: Boolean(f.inline) }));
    return out;
  };
  if ((data.flags || 0) & V2) {
    // only what the builder can edit comes back: link buttons stay, menus and other interactive parts are dropped
    const keep = (c) => {
      if (!c) return null;
      if (c.type === 1) { const b = (c.components || []).filter((x) => x.type === 2 && x.style === 5 && x.url).map((x) => ({ type: 2, style: 5, label: x.label || '', url: x.url })); return b.length ? { type: 1, components: b } : null; }
      if (c.type === 9 && c.accessory?.type === 2 && !c.accessory.url) return { ...c, accessory: { type: 11, media: { url: '' } } };
      if (c.type === 17) return { ...c, components: (c.components || []).map(keep).filter(Boolean) };
      return [9, 10, 11, 12, 14].includes(c.type) ? c : null;
    };
    return { v2: true, flags: V2, components: (data.components || []).map(keep).filter(Boolean), username: to.kind === 'webhook' ? (data.author?.username || '') : '', channelId: data.channel_id };
  }
  const rows = (data.components || []).map((r) => ({ type: 1, components: (r.components || []).filter((b) => b.type === 2 && b.style === 5).map((b) => ({ type: 2, style: 5, label: b.label || '', url: b.url })) })).filter((r) => r.components.length);
  return { content: data.content || '', embeds: (data.embeds || []).filter((e) => e.type === undefined || e.type === 'rich').map(pick), components: rows, username: to.kind === 'webhook' ? (data.author?.username || '') : '', channelId: data.channel_id };
}

/** Public facts about a webhook link (for the "Информация о вебхуке" tool). The token never comes back. */
async function webhookInfo(url) {
  const parsed = parseWebhookUrl(url);
  if (!parsed) throw new KitError('Это не ссылка вебхука Discord (https://discord.com/api/webhooks/…).');
  const { data } = await plainApi.get(`/webhooks/${parsed.id}/${parsed.token}`).catch((err) => { if ([401, 404].includes(err?.response?.status)) throw new KitError('Вебхук по этой ссылке не найден — возможно, его удалили.'); throw err; });
  return {
    id: data.id, name: data.name, type: data.type, channelId: data.channel_id, guildId: data.guild_id, applicationId: data.application_id || null,
    avatar: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=128` : null,
    createdAt: new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n)).toISOString()
  };
}

module.exports = { V2, cleanV2, cleanMessage, cleanEmbed, cleanComponents, parseColor, allowedMentions, parseWebhookUrl, parseMessageRef, resolveTarget, requireActor, deliver, fetchMessage, webhookInfo, errorText, isGone, KitError, LIMITS, _api: { botApi, plainApi } };
