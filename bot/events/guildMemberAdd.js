const { AttachmentBuilder } = require('discord.js');
const { getOrCreateSettings } = require('../modules/leveling');
const logger = require('../utils/logger');
const { renderWelcomeCard } = require('../modules/welcomeCard');
const { restoreMember } = require('../modules/memberRestore');

/** {user} {name} {server} {count} -> text. `mention` is false for people who already left (no ping). */
/** Welcome / goodbye text: the old short forms plus the full set of templates ({ member.* }, { guild.* }, functions). */
function fillTemplate(template, member, mention = true) {
  const name = member.displayName || member.user?.username || 'участник';
  const { render, buildContext } = require('../utils/replacers');
  return render(template, buildContext({ member, guild: member.guild }), {
    user: mention ? `<@${member.id}>` : name,
    name,
    server: member.guild?.name,
    count: member.guild?.memberCount ?? ''
  });
}

module.exports = {
  name: 'guildMemberAdd',
  fillTemplate,
  async execute(member) {
    require('../modules/reports').joinAlert(member).catch(() => {}); // someone with reports joined: a note for the moderators
    await restoreMember(member); // returning member: roles and nickname come back (works even when the welcome message is off)
    const settings = await getOrCreateSettings(member.guild.id);
    if (!settings || !settings.welcomeEnabled) return;

    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role && require('../utils/safeRole').canSelfGive(role, member.guild)) member.roles.add(role).catch((err) => logger.warn('Failed to add autorole:', err.message));
    }

    if (settings.welcomeChannelId) {
      const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
      if (channel) {
        const payload = { content: fillTemplate(settings.welcomeMessage, member), allowedMentions: { users: [member.id] } };
        if (settings.welcomeCard) {
          try {
            const png = await renderWelcomeCard({
              username: member.displayName || member.user?.username || 'участник',
              avatarURL: member.user?.displayAvatarURL?.({ extension: 'png', size: 256 }),
              serverName: member.guild.name,
              memberCount: member.guild.memberCount
            });
            payload.files = [new AttachmentBuilder(png, { name: 'welcome.png' })];
          } catch (err) {
            logger.warn('Welcome card failed:', err.message); // the text still goes out
          }
        }
        channel.send(payload).catch(() => {});
      }
    }
  }
};
