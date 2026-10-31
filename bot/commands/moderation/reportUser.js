// /report and "Пожаловаться на участника" in a member's menu: a report about a person, with a category and a reason.
const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const embeds = require('../../utils/embeds');
const { fileReport, CATEGORIES } = require('../../modules/reports');

const MODAL = 'repmodal:';
const answer = (i, r) => i.reply({ embeds: [r.ok ? embeds.success(r.text) : embeds.error(r.text)], flags: MessageFlags.Ephemeral });

module.exports = {
  MODAL,
  variants: [
    {
      sub: 'slash',
      data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Пожаловаться на участника модераторам')
        .addUserOption((o) => o.setName('user').setDescription('На кого').setRequired(true))
        .addStringOption((o) => o.setName('category').setDescription('Что случилось').setRequired(true).addChoices(...Object.entries(CATEGORIES).map(([value, name]) => ({ name, value }))))
        .addStringOption((o) => o.setName('reason').setDescription('Подробности').setMaxLength(500))
    },
    { sub: 'menu', data: new ContextMenuCommandBuilder().setName('Report member').setNameLocalizations({ ru: 'Пожаловаться на участника' }).setType(ApplicationCommandType.User) }
  ],
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'menu') {
      // the member's menu: ask for the reason in a window
      const target = interaction.targetUser;
      const modal = new ModalBuilder().setCustomId(`${MODAL}${target.id}`).setTitle('Жалоба на участника').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Что произошло?').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true))
      );
      return interaction.showModal(modal);
    }
    const r = await fileReport(interaction.guild, { reporter: interaction.user, target: interaction.options.getUser('user'), category: interaction.options.getString('category'), reason: interaction.options.getString('reason') });
    return answer(interaction, r);
  },
  /** The reason window was sent. */
  async handleModal(interaction) {
    const targetId = interaction.customId.slice(MODAL.length);
    const target = await interaction.client.users.fetch(targetId).catch(() => null);
    if (!target) return answer(interaction, { ok: false, text: 'Участник не найден.' });
    const r = await fileReport(interaction.guild, { reporter: interaction.user, target, category: 'other', reason: interaction.fields.getTextInputValue('reason') });
    return answer(interaction, r);
  }
};
