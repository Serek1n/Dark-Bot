// "Интерактивные сообщения" (as in Lacuna): the bot posts a message with buttons or a drop-down list; pressing one gives, takes
// or toggles roles for the person who pressed. "One at a time" (exclusive) keeps only one item's roles of the message.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { canSelfGive } = require('../utils/safeRole');
const { InteractiveMessage } = require('../../db');
const { getOrCreateSettings } = require('./leveling');
const { isEnabled } = require('../utils/features');
const logger = require('../utils/logger');

const PREFIX = 'im:';
const MAX_ITEMS = 25;
const MODES = ['toggle', 'add', 'remove'];
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

const parseItems = (json) => { try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []; } catch { return []; } };

/** Parses an emoji field: unicode or <:name:id>. */
function emojiOf(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = s.match(/^<(a?):(\w+):(\d+)>$/);
  return m ? { id: m[3], name: m[2], animated: Boolean(m[1]) } : { name: s };
}

/** The message payload (text + components) for a record. */
function payloadFor(rec) {
  const items = parseItems(rec.items);
  const rows = [];
  if (rec.kind === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}${rec.id}`)
      .setPlaceholder((rec.placeholder || 'Выберите роль').slice(0, 150))
      .setMinValues(0)
      .setMaxValues(rec.exclusive ? 1 : Math.max(1, items.length))
      .addOptions(items.map((it, i) => {
        const o = { label: String(it.label || `Вариант ${i + 1}`).slice(0, 100), value: String(i) };
        if (it.description) o.description = String(it.description).slice(0, 100);
        const e = emojiOf(it.emoji); if (e) o.emoji = e;
        return o;
      }));
    rows.push(new ActionRowBuilder().addComponents(menu));
  } else {
    for (let r = 0; r < items.length; r += 5) {
      rows.push(new ActionRowBuilder().addComponents(items.slice(r, r + 5).map((it, k) => {
        const b = new ButtonBuilder().setCustomId(`${PREFIX}${rec.id}:${r + k}`).setStyle(STYLES[it.style] || ButtonStyle.Secondary);
        const e = emojiOf(it.emoji);
        if (it.label) b.setLabel(String(it.label).slice(0, 80));
        if (e) b.setEmoji(e);
        if (!it.label && !e) b.setLabel(`Кнопка ${r + k + 1}`);
        return b;
      })));
    }
  }
  const embed = new EmbedBuilder().setColor(0x9a93ff).setDescription(String(rec.content).slice(0, 4000));
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

const isInteractive = (i) => typeof i.customId === 'string' && i.customId.startsWith(PREFIX);

/** Which roles to add and remove for a member after pressing. Pure, shared with the tests. */
function computeChanges(rec, chosen, has) {
  const items = parseItems(rec.items);
  const add = new Set(); const remove = new Set();
  const all = new Set(items.flatMap((it) => it.roleIds || []));
  if (rec.kind === 'select') {
    // the list shows the whole choice: chosen items' roles are wanted, the rest of this message's roles are not
    const wanted = new Set(chosen.flatMap((i) => items[i]?.roleIds || []));
    for (const id of all) { if (wanted.has(id) && !has(id)) add.add(id); if (!wanted.has(id) && has(id)) remove.add(id); }
    return { add: [...add], remove: [...remove] };
  }
  const item = items[chosen[0]];
  if (!item) return { add: [], remove: [] };
  const ids = item.roleIds || [];
  const owned = ids.length && ids.every(has);
  const mode = MODES.includes(rec.mode) ? rec.mode : 'toggle';
  const giving = mode === 'add' || (mode === 'toggle' && !owned);
  for (const id of ids) { if (giving && !has(id)) add.add(id); if (!giving && has(id)) remove.add(id); }
  if (giving && rec.exclusive) for (const id of all) if (!ids.includes(id) && has(id)) remove.add(id);
  return { add: [...add], remove: [...remove] };
}

async function handleInteractive(interaction) {
  const reply = (text) => (interaction.deferred ? interaction.editReply({ content: text }) : interaction.reply({ content: text, flags: MessageFlags.Ephemeral }));
  try {
    const [, idPart, idx] = interaction.customId.split(':');
    const rec = await InteractiveMessage.findOne({ where: { id: Number(idPart) || 0, guildId: interaction.guildId } });
    if (!rec || !interaction.guild || !interaction.member) return reply('Это сообщение больше не работает.');
    if (!isEnabled(await getOrCreateSettings(interaction.guildId), 'interactive')) return reply('Интерактивные сообщения на этом сервере отключены.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member.roles?.cache ? interaction.member : await interaction.guild.members.fetch(interaction.user.id);
    const chosen = rec.kind === 'select' ? (interaction.values || []).map(Number) : [Number(idx)];
    const { add, remove } = computeChanges(rec, chosen, (id) => member.roles.cache.has(id));
    const role = (id) => interaction.guild.roles.cache.get(id);
    const canTake = (id) => { const r = role(id); return r && !r.managed && r.editable !== false; };
    const done = { add: [], remove: [] }; let failed = 0;
    for (const id of add) { if (!canSelfGive(role(id), interaction.guild)) { failed++; continue; } await member.roles.add(id, 'Интерактивное сообщение').then(() => done.add.push(id)).catch(() => failed++); }
    for (const id of remove) { if (!canTake(id)) { failed++; continue; } await member.roles.remove(id, 'Интерактивное сообщение').then(() => done.remove.push(id)).catch(() => failed++); }
    const lines = [];
    if (done.add.length) lines.push(`✅ Выданы: ${done.add.map((id) => `<@&${id}>`).join(', ')}`);
    if (done.remove.length) lines.push(`➖ Сняты: ${done.remove.map((id) => `<@&${id}>`).join(', ')}`);
    if (failed) lines.push('⚠️ Часть ролей бот изменить не смог: его роль должна быть выше них.');
    return reply(lines.join('\n') || 'Ничего не изменилось.');
  } catch (err) {
    logger.warn(`Interactive message: ${err.message}`);
    return reply('Не получилось изменить роли. Попробуйте ещё раз.').catch(() => {});
  }
}

module.exports = { PREFIX, MAX_ITEMS, MODES, STYLES, parseItems, emojiOf, payloadFor, isInteractive, handleInteractive, computeChanges };
