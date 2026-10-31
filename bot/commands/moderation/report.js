// "Пожаловаться" on a message: the report goes to the moderators with the message text and a link (reports v2).
const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const { fileReport } = require('../../modules/reports');

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Report message').setNameLocalizations({ ru: 'Пожаловаться' }).setType(ApplicationCommandType.Message),
  async execute(interaction) {
    const message = interaction.targetMessage;
    const r = await fileReport(interaction.guild, { reporter: interaction.user, target: message.author, category: 'other', message });
    return interaction.reply({ embeds: [r.ok ? embeds.success(r.text) : embeds.error(r.text)], flags: MessageFlags.Ephemeral });
  }
};
