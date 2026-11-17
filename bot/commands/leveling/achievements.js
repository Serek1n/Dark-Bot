// /achievements — my (or someone's) achievements and progress, the server's catalog; grant / revoke by hand for those who
// may manage the server (a one-time achievement is never given twice: the second grant answers that he already has it).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ach = require('../../modules/achievements');

const keyOpt = (o) => o.setName('achievement').setDescription('Достижение').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Достижения: мои, чужие и все на сервере')
    .addSubcommand((s) => s.setName('list').setDescription('Достижения участника и прогресс').addUserOption((o) => o.setName('user').setDescription('Участник (по умолчанию — вы)')))
    .addSubcommand((s) => s.setName('all').setDescription('Все достижения сервера'))
    .addSubcommand((s) => s.setName('grant').setDescription('Выдать достижение (для администрации)').addUserOption((o) => o.setName('user').setDescription('Участник').setRequired(true)).addStringOption(keyOpt))
    .addSubcommand((s) => s.setName('revoke').setDescription('Забрать достижение (для администрации)').addUserOption((o) => o.setName('user').setDescription('Участник').setRequired(true)).addStringOption(keyOpt)),

  async autocomplete(interaction) {
    const settings = await require('../../modules/leveling').getOrCreateSettings(interaction.guild.id);
    const q = String(interaction.options.getFocused() || '').toLowerCase();
    const list = (await ach.catalog(interaction.guild.id, settings)).filter((a) => a.enabled && (!q || a.name.toLowerCase().includes(q)));
    return interaction.respond(list.slice(0, 25).map((a) => ({ name: `${a.name} — ${ach.RARITY[a.rarity].label}`.slice(0, 100), value: a.key })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const settings = await require('../../modules/leveling').getOrCreateSettings(guild.id);
    const fail = (text) => interaction.reply({ embeds: [embeds.error(text)], flags: MessageFlags.Ephemeral });
    if (!ach.isEnabled(settings)) return fail('Достижения на этом сервере выключены.');

    if (sub === 'list' || sub === 'all') {
      const user = (sub === 'list' && interaction.options.getUser('user')) || interaction.user;
      if (user.bot) return fail('У ботов нет достижений.');
      const member = user.id === interaction.user.id ? interaction.member : await guild.members.fetch(user.id).catch(() => null);
      const view = await ach.memberView(guild, user.id, member);
      if (sub === 'all') return interaction.reply({ embeds: [ach.catalogEmbed(view)], components: [ach.catalogMenu()], flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [ach.memberEmbed(view, member?.displayName || user.globalName || user.username)] });
    }

    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return fail('Выдавать и забирать достижения можно с правом **Управлять сервером**.');
    const user = interaction.options.getUser('user');
    if (user.bot) return fail('У ботов нет достижений.');
    const key = interaction.options.getString('achievement');
    const a = (await ach.catalog(guild.id, settings)).find((x) => x.key === key);
    if (!a) return fail('Такого достижения нет. Выберите его из списка.');
    if (sub === 'grant') {
      const got = await ach.grant(guild, user.id, a, interaction.user.id);
      if (!got) return interaction.reply({ embeds: [embeds.info(`У <@${user.id}> уже есть «${a.name}» — второй раз не выдаётся.`)], flags: MessageFlags.Ephemeral });
      const member = await guild.members.fetch(user.id).catch(() => null);
      await ach.notify(guild, member, user.id, [a], settings, interaction.channel).catch(() => {});
      return interaction.reply({ embeds: [embeds.success(`Достижение «${a.name}» выдано <@${user.id}>.`)], flags: MessageFlags.Ephemeral });
    }
    const had = await ach.revoke(guild.id, user.id, key);
    return interaction.reply({ embeds: [had ? embeds.success(`«${a.name}» забрано у <@${user.id}>. Награда, если была, осталась у участника. Если условие выполнено, достижение откроется снова.`) : embeds.info(`У <@${user.id}> нет «${a.name}».`)], flags: MessageFlags.Ephemeral });
  }
};
