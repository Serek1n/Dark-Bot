// Webhook control panel: one message with icon buttons (create, list, send, edit, delete) in the same style as the room panel.
// The link of a webhook is a password, so every answer is visible only to the person who pressed the button,
// and the right to manage webhooks is checked again on every step.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ChannelType, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');
const { isEnabled } = require('../utils/features');
const { memberHasPermission } = require('../utils/permissions');
const { fetchAvatar } = require('../utils/safeImage');
const { getOrCreateSettings } = require('./leveling');

const PREFIX = 'wh:';
const ephemeral = { flags: MessageFlags.Ephemeral };
const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia].filter((t) => t !== undefined);

/** A message meant for the person who pressed the button (not a program error). */
class WebhookError extends Error {}
const fail = (text) => { throw new WebhookError(text); };

// id, icon (the buttons carry only the icon), name and a short explanation for the list in the message
const BUTTONS = [
  ['create', '➕', 'Создать', 'новый вебхук в выбранном канале, с именем и аватаркой'],
  ['list', '📋', 'Список', 'все вебхуки бота со ссылками (видите только вы)'],
  ['send', '✉️', 'Отправить', 'написать в канал от имени вебхука'],
  ['edit', '✏️', 'Изменить', 'поменять имя или аватарку вебхука'],
  ['delete', '🗑️', 'Удалить', 'удалить вебхук']
];

/** The message with the buttons that is posted into a channel. */
function panelPayload() {
  const embed = embeds.baseEmbed().setTitle('Управление вебхуками').setDescription(
    'Вебхук позволяет публиковать сообщения в канал от любого имени и с любой аватаркой. Здесь можно создавать вебхуки, получать их ссылки и писать через них. Управлять могут только те, у кого есть право «Управлять вебхуками».\n\n' +
    `${BUTTONS.map(([, emoji, label, hint]) => `${emoji} **${label}** — ${hint}`).join('\n')}\n\n` +
    'Ссылка вебхука — как пароль: по ней может писать любой. Поэтому все ответы видны только вам.\n\n' +
    '**Чтобы воспользоваться функциями интерфейса, нажмите на кнопки ниже.**'
  );
  // Buttons without names, only icons: what each one does is written in the message above.
  const row = new ActionRowBuilder().addComponents(BUTTONS.map(([id, emoji]) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${id}`).setEmoji(emoji).setStyle(id === 'delete' ? ButtonStyle.Danger : ButtonStyle.Secondary)));
  return { embeds: [embed], components: [row] };
}

/** Webhooks this bot created: only those it can show a link for and is allowed to remove (the log webhook is left alone). */
async function ownWebhooks(guild, settings) {
  const all = await guild.fetchWebhooks();
  return [...all.values()].filter((w) => w.owner?.id === guild.client.user.id && w.id !== settings?.logWebhookId);
}

/** The framed message (same look as the control panel) shown to the person who just created a webhook. */
function createdEmbed(hook, channelId) {
  return embeds.baseEmbed().setTitle('Вебхук создан').setDescription(
    `Вебхук **${hook.name}** создан в <#${channelId}>.\n\n` +
    `🔗 **Ссылка** — никому не показывайте, по ней можно писать в канал:\n||${hook.url}||\n\n` +
    `🆔 **ID:** \`${hook.id}\`\n\n` +
    '**Чтобы написать через вебхук, нажмите ✉️ в панели или используйте `/webhook send`.**');
}

/** The embed with the webhooks and their links. */
function listEmbed(hooks) {
  if (!hooks.length) return embeds.baseEmbed().setDescription('Вебхуков, созданных этим ботом, пока нет. Создайте через панель или командой `/webhook create`.');
  const lines = hooks.slice(0, 15).map((w) => `**${w.name}** · <#${w.channelId}> · ID \`${w.id}\`\n||${w.url}||`);
  const more = hooks.length > 15 ? `\n\nИ ещё ${hooks.length - 15}.` : '';
  return embeds.baseEmbed().setTitle(`Вебхуки бота (${hooks.length})`).setDescription(lines.join('\n\n').slice(0, 3900) + more);
}

/** Turns a Discord error into words the person can act on. */
function explain(err) {
  const m = err?.message || '';
  if (/Maximum number of webhooks/i.test(m)) return 'В этом канале уже 15 вебхуков — это предел Discord. Удалите ненужные.';
  if (/Missing (Permissions|Access)/i.test(m)) return 'У бота не хватает прав в этом канале (нужно «Управлять вебхуками» и «Просмотр канала»).';
  return `Discord отказал: ${m}`;
}

const isWebhookComponent = (i) => typeof i.customId === 'string' && i.customId.startsWith(PREFIX);
const rowOf = (c) => new ActionRowBuilder().addComponents(c);
const reply = (i, text, ok = false) => i.reply({ embeds: [ok ? embeds.success(text) : embeds.error(text)], ...ephemeral });

/** Checks who pressed the button and that the feature is on; returns what the actions need. */
async function gate(i) {
  const guild = i.guild;
  if (!guild || !i.member) fail('Вебхуками можно управлять только на сервере.');
  const settings = await getOrCreateSettings(guild.id);
  if (!isEnabled(settings, 'webhooks')) fail('Вебхуки отключены на этом сервере.');
  if (!memberHasPermission(i.member, 'ManageWebhooks')) fail('Нужно право «Управлять вебхуками».');
  const me = guild.members?.me;
  if (me && !me.permissions.has(PermissionFlagsBits.ManageWebhooks)) fail('У бота нет права «Управлять вебхуками». Выдайте его роли бота и повторите.');
  return { guild, settings };
}

const who = (i) => i.user?.tag || i.user?.username || 'участник';
const input = (id, label, o = {}) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(o.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(Boolean(o.required)).setMaxLength(o.max || 100);
  if (o.placeholder) t.setPlaceholder(o.placeholder);
  if (o.value) t.setValue(String(o.value).slice(0, o.max || 100));
  return rowOf(t);
};

/** A panel button was pressed: ask the next question. */
async function showStep(i, kind, ctx) {
  if (kind === 'create') {
    return i.reply({ content: 'В каком канале создать вебхук?', components: [rowOf(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}c:create`).setPlaceholder('Выберите канал').setChannelTypes(...CHANNEL_TYPES))], ...ephemeral });
  }
  if (kind === 'list') return i.reply({ embeds: [listEmbed(await ownWebhooks(ctx.guild, ctx.settings))], ...ephemeral });
  const hooks = await ownWebhooks(ctx.guild, ctx.settings);
  if (!hooks.length) return reply(i, 'Вебхуков, созданных этим ботом, пока нет. Сначала создайте — кнопка ➕.');
  const text = { send: 'От чьего имени написать?', edit: 'Какой вебхук изменить?', delete: 'Какой вебхук удалить?' }[kind];
  if (!text) fail('Неизвестная кнопка.');
  const options = hooks.slice(0, 25).map((w) => ({ label: String(w.name).slice(0, 100), description: `#${ctx.guild.channels?.cache?.get?.(w.channelId)?.name || w.channelId}`.slice(0, 100), value: w.id }));
  return i.reply({ content: text, components: [rowOf(new StringSelectMenuBuilder().setCustomId(`${PREFIX}s:${kind}`).setPlaceholder('Выберите вебхук').addOptions(options))], ...ephemeral });
}

async function findHook(ctx, id) {
  const hook = (await ownWebhooks(ctx.guild, ctx.settings)).find((w) => w.id === id);
  if (!hook) fail('Такого вебхука уже нет среди созданных этим ботом. Откройте список заново.');
  return hook;
}

/** A webhook was chosen in a menu: open the window or ask to confirm. */
async function afterChoice(i, kind, id, ctx) {
  const hook = await findHook(ctx, id);
  if (kind === 'send') {
    return i.showModal(new ModalBuilder().setCustomId(`${PREFIX}m:send:${id}`).setTitle(`Сообщение от «${hook.name}»`.slice(0, 45)).addComponents(
      input('text', 'Текст сообщения', { paragraph: true, required: true, max: 4000 }),
      input('title', 'Заголовок рамки (необязательно)', { max: 256 }),
      input('username', 'Другое имя на этот раз (необязательно)', { max: 80 }),
      input('frame', 'В рамке? да или нет', { max: 3, value: 'да' })));
  }
  if (kind === 'edit') {
    return i.showModal(new ModalBuilder().setCustomId(`${PREFIX}m:edit:${id}`).setTitle('Изменить вебхук').addComponents(
      input('name', 'Имя (до 32 символов)', { value: hook.name, max: 32 }),
      input('avatar', 'Ссылка на новую аватарку (https://…)', { max: 500, placeholder: 'Оставьте пустым, чтобы не менять' })));
  }
  if (kind === 'delete') {
    return i.update({ content: '', embeds: [embeds.baseEmbed().setDescription(`Удалить вебхук **${hook.name}** (<#${hook.channelId}>)? Все, кто пользуется его ссылкой, перестанут писать в канал.`)], components: [rowOf(new ButtonBuilder().setCustomId(`${PREFIX}y:delete:${id}`).setStyle(ButtonStyle.Danger).setLabel('Да, удалить'))] });
  }
  return fail('Неизвестное действие.');
}

async function createHook(i, ctx, channelId) {
  const channel = ctx.guild.channels?.cache?.get?.(channelId) || await ctx.guild.channels?.fetch?.(channelId).catch(() => null);
  if (!channel || typeof channel.createWebhook !== 'function') fail('В этом канале нельзя создать вебхук.');
  const name = i.fields.getTextInputValue('name').trim();
  if (!name) fail('Имя вебхука не может быть пустым.');
  const url = (i.fields.getTextInputValue('avatar') || '').trim();
  let avatar;
  if (url) { try { avatar = await fetchAvatar(url); } catch (e) { fail(e.message); } }
  const hook = await channel.createWebhook({ name, avatar: avatar || i.client.user.displayAvatarURL({ extension: 'png', size: 256 }), reason: `Создал ${who(i)} через панель вебхуков` });
  return i.reply({ embeds: [createdEmbed(hook, channel.id)], ...ephemeral });
}

async function sendThrough(i, ctx, id) {
  const hook = await findHook(ctx, id);
  const text = i.fields.getTextInputValue('text');
  if (!text || !text.trim()) fail('Напишите текст сообщения.');
  const username = (i.fields.getTextInputValue('username') || '').trim() || undefined;
  const framed = !/^(нет|no|н|n|0)$/i.test((i.fields.getTextInputValue('frame') || '').trim());
  if (!framed && text.length > 2000) fail('Обычным текстом можно не больше 2000 символов. Включите рамку (да) или сократите текст.');
  const title = (i.fields.getTextInputValue('title') || '').trim();
  const body = framed ? { embeds: [embeds.baseEmbed().setDescription(text.slice(0, 4000)).setTitle(title || null)] } : { content: text };
  await hook.send({ ...body, username, allowedMentions: { parse: [] } }); // no @everyone through a webhook
  return reply(i, `Сообщение отправлено от имени **${username || hook.name}** в <#${hook.channelId}>.`, true);
}

async function editHook(i, ctx, id) {
  const hook = await findHook(ctx, id);
  const name = (i.fields.getTextInputValue('name') || '').trim();
  const url = (i.fields.getTextInputValue('avatar') || '').trim();
  if (!name && !url) fail('Нечего менять: заполните имя или ссылку на аватарку.');
  const patch = { reason: `Изменил ${who(i)} через панель вебхуков` };
  if (name) patch.name = name;
  if (url) { try { patch.avatar = await fetchAvatar(url); } catch (e) { fail(e.message); } }
  await hook.edit(patch);
  return reply(i, `Вебхук **${name || hook.name}** обновлён.`, true);
}

async function removeHook(i, ctx, id) {
  const hook = await findHook(ctx, id);
  await hook.delete(`Удалил ${who(i)} через панель вебхуков`);
  return i.update({ content: '', embeds: [embeds.success(`Вебхук **${hook.name}** удалён.`)], components: [] });
}

async function handleWebhookComponent(i) {
  try {
    const ctx = await gate(i);
    const parts = i.customId.slice(PREFIX.length).split(':'); // button: [kind]; follow-up: [type, kind, id]
    if (parts.length === 1) return await showStep(i, parts[0], ctx);
    const [type, kind, id] = parts;
    if (type === 'c' && kind === 'create') { // channel chosen: ask for the name and the picture
      const channelId = (i.values || [])[0];
      if (!channelId) fail('Выберите канал.');
      return await i.showModal(new ModalBuilder().setCustomId(`${PREFIX}m:create:${channelId}`).setTitle('Новый вебхук').addComponents(
        input('name', 'Имя (до 32 символов)', { required: true, max: 32, placeholder: 'Например: Новости' }),
        input('avatar', 'Ссылка на аватарку (https://…)', { max: 500, placeholder: 'Пусто — аватарка бота' })));
    }
    if (type === 's') return await afterChoice(i, kind, (i.values || [])[0], ctx);
    if (type === 'm' && kind === 'create') return await createHook(i, ctx, id);
    if (type === 'm' && kind === 'send') return await sendThrough(i, ctx, id);
    if (type === 'm' && kind === 'edit') return await editHook(i, ctx, id);
    if (type === 'y' && kind === 'delete') return await removeHook(i, ctx, id);
    return fail('Неизвестное действие.');
  } catch (err) {
    if (!(err instanceof WebhookError)) logger.error('Webhook panel action failed:', err);
    const text = err instanceof WebhookError ? err.message : explain(err);
    const payload = { embeds: [embeds.error(text)], ...ephemeral };
    if (i.replied || i.deferred) return i.followUp(payload).catch(() => {});
    return i.reply(payload).catch(() => {});
  }
}

module.exports = { PREFIX, BUTTONS, panelPayload, isWebhookComponent, handleWebhookComponent, ownWebhooks, listEmbed, createdEmbed, explain, WebhookError };
