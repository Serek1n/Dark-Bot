// Appeals inside Discord, mostly in the bot's DMs (no common server is needed: a banned person keeps the DM).
//   appeal:dm:<guild>      «appeal here» under a punishment's DM → the punishment (a menu when there are several) → a form
//   appeal:mine            «my punishments and appeals» (also /appeal)
//   appeal:pick            the menu of punishments → the form
//   appeal:m:<g>|<k>|<id>  the form: the explanation (20–2000) and links → an appeal with source 'dm'
//   appeal:pass:<guild>    «let me onto the appeal server» → a short comment → a request (or the invite, in the instant mode)
//   appeal:reply:<id>      the answer to a moderator's question
//   apass:ok|no:<pass>     the team decides a request (the moderation channel)
//   apdec:<decision>:<id>  the team decides an appeal (the moderation channel, the visitor's thread)
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const embeds = require('../utils/embeds');
const logger = require('../utils/logger');

const ap = () => require('./appeals');
const ag = () => require('./appealGuild');
const PREFIX = /^(appeal:|apass:|apdec:|apdecm:|apassm:)/;
const isAppealComponent = (i) => typeof i.customId === 'string' && PREFIX.test(i.customId);
const eph = { flags: MessageFlags.Ephemeral };
const say = (i, text, ok = true) => {
  const payload = { embeds: [ok ? embeds.success(text) : embeds.error(text)], components: [], ...eph };
  return i.replied || i.deferred ? i.followUp(payload) : i.reply(payload);
};
const guildName = (i, id) => i.client?.guilds?.cache?.get(id)?.name || `сервер ${id}`;

/** The form of an appeal against one punishment. */
async function appealModal(p, i) {
  const settings = await require('./leveling').getOrCreateSettings(p.guildId);
  const m = new ModalBuilder().setCustomId(`appeal:m:${p.guildId}|${p.kind}|${p.id}`).setTitle(`Апелляция: ${ap().KINDS[p.kind]}${p.caseNumber ? ` · дело #${p.caseNumber}` : ''}`.slice(0, 45));
  m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Почему наказание стоит снять?').setStyle(TextInputStyle.Paragraph).setMinLength(ap().TEXT_MIN).setMaxLength(ap().TEXT_MAX).setRequired(true)
    .setPlaceholder(`Наказание на «${guildName(i, p.guildId)}»: ${String(p.reason).slice(0, 60)}`.slice(0, 100))));
  if (settings.appealsLinks !== false && settings.appealsLinks !== 0) {
    m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('links').setLabel('Ссылки на доказательства (до 3, https)').setStyle(TextInputStyle.Short).setMaxLength(600).setRequired(false)));
  }
  return m;
}

/** A menu of punishments to appeal (only those without an open appeal). */
function pickMenu(list, i) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('appeal:pick').setPlaceholder('Какое наказание обжаловать?')
    .addOptions(list.slice(0, 25).map((p) => ({ label: `${ap().KINDS[p.kind]}${p.caseNumber ? ` · дело #${p.caseNumber}` : ''} · ${guildName(i, p.guildId)}`.slice(0, 100), description: String(p.reason).slice(0, 100), value: `${p.guildId}|${p.kind}|${p.id}` }))));
}

/** «Мои наказания и апелляции»: what is in force, what is appealed, and a menu for the rest. */
async function mine(i) {
  const userId = i.user.id;
  const [list, appeals] = await Promise.all([ap().punishmentsOf(userId), require('../../db').Appeal.findAll({ where: { userId }, order: [['id', 'DESC']], limit: 10 })]);
  const lines = list.map((p) => `• **${ap().KINDS[p.kind]}** на «${guildName(i, p.guildId)}»${p.caseNumber ? ` (дело #${p.caseNumber})` : ''}: ${String(p.reason).slice(0, 80)}${p.open ? ` — апелляция #${p.open.id}: ${ap().STATUS[p.open.status]}` : ''}`);
  const past = appeals.filter((a) => !ap().OPEN.includes(a.status)).slice(0, 5).map((a) => `• #${a.id} на «${guildName(i, a.guildId)}»: ${ap().STATUS[a.status]}`);
  const text = [lines.length ? `**Действующие наказания**\n${lines.join('\n')}` : 'Действующих наказаний, которые можно обжаловать, нет.', past.length ? `**Решённые апелляции**\n${past.join('\n')}` : null].filter(Boolean).join('\n\n');
  const free = list.filter((p) => !p.open);
  const payload = { embeds: [embeds.info(text.slice(0, 4000)).setTitle('Мои наказания и апелляции')], ...eph };
  if (free.length) payload.components = [pickMenu(free, i)];
  return i.reply(payload);
}

async function handle(i) {
  const id = i.customId;
  const userId = i.user.id;
  try {
    if (id === 'appeal:mine') return await mine(i);

    if (id.startsWith('appeal:dm:')) {
      const gid = id.slice('appeal:dm:'.length);
      const list = (await ap().punishmentsOf(userId)).filter((p) => p.guildId === gid);
      const free = list.filter((p) => !p.open);
      if (!free.length) return say(i, list.length ? `Апелляция уже подана (#${list[0].open.id}) — дождитесь решения.` : 'Действующих наказаний на этом сервере, которые можно обжаловать, нет: они сняты, закончились или апелляции выключены.', false);
      if (free.length === 1) return i.showModal(await appealModal(free[0], i));
      return i.reply({ content: 'Выберите наказание:', components: [pickMenu(free, i)], ...eph });
    }

    if (id === 'appeal:pick') {
      const [g, kind, pid] = String(i.values?.[0] || '').split('|');
      const p = await ap().ownPunishment(userId, { guildId: g, kind, id: Number(pid) });
      if (p.open) return say(i, `Апелляция уже подана (#${p.open.id}) — дождитесь решения.`, false);
      return i.showModal(await appealModal(p, i));
    }

    if (id.startsWith('appeal:m:')) {
      const [g, kind, pid] = id.slice('appeal:m:'.length).split('|');
      const text = i.fields.getTextInputValue('text');
      let links = ''; try { links = i.fields.getTextInputValue('links') || ''; } catch { links = ''; }
      const appeal = await ap().create(userId, { guildId: g, kind, id: Number(pid), text, links, source: 'dm' });
      return say(i, `Апелляция #${appeal.id} отправлена модераторам «${guildName(i, g)}». Решение придёт сюда и будет видно на сайте.`);
    }

    if (id.startsWith('appeal:pass:')) {
      const gid = id.slice('appeal:pass:'.length);
      const m = new ModalBuilder().setCustomId(`apassm:${gid}`).setTitle('Вход на сервер апелляций')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comment').setLabel('Коротко: зачем вам на сервер апелляций?').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false)));
      return i.showModal(m);
    }
    if (id.startsWith('apassm:')) {
      const gid = id.slice('apassm:'.length);
      let comment = ''; try { comment = i.fields.getTextInputValue('comment') || ''; } catch { comment = ''; }
      const r = await ag().request(userId, gid, { comment, client: i.client });
      if (r.issued) {
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setURL(ag().inviteUrl(r.pass)).setLabel('Перейти на сервер апелляций').setStyle(ButtonStyle.Link));
        return i.reply({ embeds: [embeds.success(`Личное одноразовое приглашение действует до ${ap().fmtDate(r.pass.expiresAt)}.`)], components: [row], ...eph });
      }
      return say(i, 'Запрос отправлен модераторам. Когда его рассмотрят, ответ придёт сюда.');
    }

    if (id.startsWith('appeal:reply:')) {
      const aid = id.slice('appeal:reply:'.length);
      const m = new ModalBuilder().setCustomId(`appeal:rm:${aid}`).setTitle(`Ответ по апелляции #${aid}`.slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Ваш ответ модератору').setStyle(TextInputStyle.Paragraph).setMinLength(2).setMaxLength(ap().TEXT_MAX).setRequired(true)));
      return i.showModal(m);
    }
    if (id.startsWith('appeal:rm:')) {
      const appeal = await ap().reply(id.slice('appeal:rm:'.length), userId, i.fields.getTextInputValue('text'));
      return say(i, `Ответ добавлен к апелляции #${appeal.id}, она снова на рассмотрении.`);
    }

    // ---- the team ----
    if (id.startsWith('apass:')) {
      const [, act, pid] = id.split(':');
      const pass = await require('../../db').AppealGuildPass.findByPk(Number(pid) || 0);
      if (!pass) return say(i, 'Запрос не найден.', false);
      if (act === 'ok') {
        await ag().decide(pass.id, pass.guildId, userId, 'approve', '', { client: i.client });
        return say(i, 'Пропуск выдан: участник получил личное приглашение.');
      }
      const m = new ModalBuilder().setCustomId(`apass:nm:${pass.id}`).setTitle('Отказ в пропуске')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Причина (её увидит участник)').setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(300).setRequired(true)));
      if (act === 'no') return i.showModal(m);
      if (act === 'nm') {
        await ag().decide(pass.id, pass.guildId, userId, 'reject', i.fields.getTextInputValue('reason'), { client: i.client });
        return say(i, 'Пропуск отклонён, участнику сообщено.');
      }
      return null;
    }
    if (id.startsWith('apdec:')) {
      const [, decision, aid] = id.split(':');
      const appeal = await require('../../db').Appeal.findByPk(Number(aid) || 0);
      if (!appeal) return say(i, 'Апелляция не найдена.', false);
      const denied = await ap().mayDecide(i.client?.guilds?.cache?.get(appeal.guildId) || null, userId, appeal.kind);
      if (denied) return say(i, denied, false);
      const label = { approved: 'Причина одобрения', rejected: 'Причина отказа', info: 'Что нужно уточнить у автора' }[decision];
      if (!label) return say(i, 'Неизвестное решение.', false);
      const m = new ModalBuilder().setCustomId(`apdecm:${decision}:${appeal.id}`).setTitle(`Апелляция #${appeal.id}`)
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel(`${label} (увидит автор)`).setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(500).setRequired(true)));
      return i.showModal(m);
    }
    if (id.startsWith('apdecm:')) {
      const [, decision, aid] = id.split(':');
      const appeal = await require('../../db').Appeal.findByPk(Number(aid) || 0);
      if (!appeal) return say(i, 'Апелляция не найдена.', false);
      const done = await ap().decide(appeal.id, appeal.guildId, userId, decision, i.fields.getTextInputValue('reason'));
      return say(i, `Апелляция #${done.id}: ${ap().STATUS[done.status].toLowerCase()}.${done.actionResult ? ` ${done.actionResult}` : ''}`);
    }
  } catch (err) {
    if (err instanceof ap().AppealError) return say(i, err.message, false).catch(() => {});
    logger.error('Appeal action failed:', err);
    return say(i, 'Не получилось выполнить действие. Попробуйте ещё раз или подайте апелляцию на сайте.', false).catch(() => {});
  }
  return null;
}

module.exports = { isAppealComponent, handle, mine, appealModal };
