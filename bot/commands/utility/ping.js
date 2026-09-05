const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Проверить задержку бота'),
  async execute(interaction) {
    await interaction.reply(`🏓 Понг! Задержка API: ${Math.round(interaction.client.ws.ping)}мс`);
  }
};
