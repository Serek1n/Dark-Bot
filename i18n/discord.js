// Puts the translator (i18n/index.js) between the bot and Discord: everything the bot sends on a server whose language is
// English goes out in English — replies, edits, follow-ups, modals, channel messages, DMs, webhooks, names of the channels and
// posts it creates, and the text it draws on pictures. The bot's code itself is not changed.
const d = require('discord.js');
const i18n = require('./index');

const guildIdOf = (args) => {
  for (const a of args) {
    if (!a || typeof a !== 'object') continue;
    const id = a.guildId || a.guild?.id || a.message?.guildId || a.message?.guild?.id || a.member?.guild?.id;
    if (id) return id;
  }
  return null;
};

function wrap(proto, name, langOf) {
  const orig = proto && Object.prototype.hasOwnProperty.call(proto, name) ? proto[name] : null;
  if (!orig || orig.__i18n) return;
  const fn = function (...args) {
    const lang = langOf(this);
    if (lang === 'en') {
      const at = name === 'edit' || name === 'editMessage' ? 1 : 0; // MessageManager.edit(message, options), Webhook.editMessage(id, options)
      args[at] = i18n.translatePayload(args[at], 'en');
    }
    return orig.apply(this, args);
  };
  fn.__i18n = true;
  proto[name] = fn;
}

const byGuild = (self) => i18n.langOf(self?.guildId || self?.guild?.id) || i18n.currentLang();
const byInteraction = (self) => (self.guildId ? i18n.langOf(self.guildId) : (String(self.locale || '').startsWith('ru') ? 'ru' : 'en'));

let installed = false;
function install(client) {
  i18n.setClient(client);
  // Every event runs "inside" its server, so anything the handlers send (DMs too) knows the language.
  if (client && !client.emit.__i18n) {
    const emit = client.emit;
    client.emit = function (event, ...args) {
      const gid = guildIdOf(args);
      return gid ? i18n.runWith({ guildId: gid, lang: null }, () => emit.call(this, event, ...args)) : emit.call(this, event, ...args);
    };
    client.emit.__i18n = true;
  }
  if (installed) return;
  installed = true;
  for (const cls of [d.CommandInteraction, d.MessageComponentInteraction, d.ModalSubmitInteraction]) {
    for (const m of ['reply', 'editReply', 'followUp', 'update', 'showModal']) wrap(cls?.prototype, m, byInteraction);
  }
  for (const cls of [d.BaseGuildTextChannel, d.BaseGuildVoiceChannel, d.ThreadChannel, d.DMChannel]) wrap(cls?.prototype, 'send', byGuild);
  wrap(d.MessageManager.prototype, 'edit', (self) => byGuild(self.channel));
  for (const cls of [d.Webhook, d.WebhookClient, d.InteractionWebhook]) { wrap(cls?.prototype, 'send', byGuild); wrap(cls?.prototype, 'editMessage', byGuild); }
  // A DM to a member: in the language of the member's server
  const memberSend = d.GuildMember.prototype.send;
  if (memberSend && !memberSend.__i18n) {
    d.GuildMember.prototype.send = function (...args) { return i18n.runWith({ guildId: this.guild?.id, lang: null }, () => memberSend.apply(this, args)); };
    d.GuildMember.prototype.send.__i18n = true;
  }
  // Channels and forum posts the bot creates (tickets, rooms, log posts)
  for (const [cls, m] of [[d.GuildChannelManager, 'create'], [d.GuildForumThreadManager, 'create'], [d.GuildTextThreadManager, 'create']]) {
    const proto = cls?.prototype; const orig = proto?.[m];
    if (!orig || orig.__i18n) continue;
    proto[m] = function (options = {}, ...rest) {
      if (byGuild(this.guild || this.channel) === 'en' && options && typeof options === 'object') {
        options = { ...options };
        if (typeof options.name === 'string') options.name = i18n.toEnglish(options.name, false);
        if (typeof options.topic === 'string') options.topic = i18n.toEnglish(options.topic, true);
        if (options.message) options.message = i18n.translatePayload(options.message, 'en');
      }
      return orig.call(this, options, ...rest);
    };
    proto[m].__i18n = true;
  }
  // Text drawn on pictures (profile card, leaderboard, welcome card)
  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const proto = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
    for (const m of ['fillText', 'strokeText', 'measureText']) {
      const orig = proto[m]; if (!orig || orig.__i18n) continue;
      proto[m] = function (text, ...rest) { return orig.call(this, i18n.currentLang() === 'en' ? i18n.toEnglish(String(text), false) : text, ...rest); };
      proto[m].__i18n = true;
    }
  } catch { /* no canvas: nothing to draw */ }
}

/** Slash commands: English descriptions (and choice names) for Discord clients in English; Russian stays the default. */
function localizeCommand(json) {
  const en = (s) => (typeof s === 'string' && i18n.CYR.test(s) ? i18n.toEnglish(s, true) : null);
  const loc = (obj, key, locKey) => {
    const t = en(obj[key]); if (!t || t === obj[key]) return;
    obj[locKey] = { ...(obj[locKey] || {}), 'en-US': t.slice(0, key === 'name' ? 100 : 100), 'en-GB': t.slice(0, 100) };
  };
  const walk = (o) => {
    if (!o || typeof o !== 'object') return o;
    if (o.description) loc(o, 'description', 'description_localizations');
    (o.choices || []).forEach((c) => loc(c, 'name', 'name_localizations'));
    (o.options || []).forEach(walk);
    return o;
  };
  return walk(JSON.parse(JSON.stringify(json)));
}

module.exports = { install, localizeCommand, guildIdOf };
