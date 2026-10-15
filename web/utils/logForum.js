// Builds the "Логи" forum: tags, a webhook and one post (thread) per category.
// Safe to run again: whatever already exists is kept, only the missing parts are created.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('../../bot/utils/logCategories');

const FORUM = 15; // ChannelType.GuildForum
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const hook = axios.create({ baseURL: 'https://discord.com/api/v10', timeout: 10000 }); // webhook calls need no bot token

// The bot's own avatar, as a data URI for the webhook (the bundled icon when the bot has none).
async function botAvatar(botApi) {
  let url = null;
  try {
    const { data: me } = await botApi.get('/users/@me');
    if (me?.avatar) {
      url = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=256`;
      const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      return { url, dataUri: `data:image/png;base64,${Buffer.from(img.data).toString('base64')}` };
    }
  } catch {
    // fall through to the bundled icon
  }
  try {
    const file = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    return { url, dataUri: `data:image/png;base64,${file.toString('base64')}` };
  } catch {
    return { url, dataUri: null };
  }
}

class SetupError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'notforum' | 'perm' | 'fail'
  }
}

function asSetupError(err) {
  if (err instanceof SetupError) return err;
  const status = err?.response?.status;
  if (status === 403 || err?.response?.data?.code === 50013) return new SetupError('perm', 'Недостаточно прав у бота');
  return new SetupError('fail', err?.message || 'Ошибка Discord');
}

/**
 * @param botApi   axios instance with the bot token
 * @param forumId  id of the forum channel
 * @param saved    { webhookId, webhookToken, threads } from the settings (may be empty)
 * @returns        { webhookId, webhookToken, threads, created }
 */
async function setupLogForum(botApi, forumId, saved = {}) {
  try {
    const { data: forum } = await botApi.get(`/channels/${forumId}`);
    if (forum.type !== FORUM) throw new SetupError('notforum', 'Выбранный канал не является форумом');

    // 1. Tags: keep the existing ones, add the missing by name (a forum holds up to 20).
    const tags = [...(forum.available_tags || [])];
    const missing = CATEGORIES.filter((c) => !tags.some((t) => t.name.toLowerCase() === c.tag.toLowerCase()));
    let tagList = tags;
    if (missing.length) {
      if (tags.length + missing.length > 20) throw new SetupError('fail', 'В форуме слишком много тегов: нужно место под ' + missing.length);
      const { data } = await botApi.patch(`/channels/${forumId}`, {
        available_tags: [...tags.map((t) => ({ id: t.id, name: t.name, moderated: t.moderated, emoji_id: t.emoji_id, emoji_name: t.emoji_name })), ...missing.map((c) => ({ name: c.tag }))]
      });
      tagList = data.available_tags || [];
    }
    const tagId = (c) => tagList.find((t) => t.name.toLowerCase() === c.tag.toLowerCase())?.id;

    // 2. Webhook: reuse the saved one when it still belongs to this forum.
    const avatar = await botAvatar(botApi);
    let webhookId = saved.webhookId;
    let webhookToken = saved.webhookToken;
    if (webhookId && webhookToken) {
      const ok = await hook.get(`/webhooks/${webhookId}/${webhookToken}`).then((r) => r.data.channel_id === forumId).catch(() => false);
      if (!ok) webhookId = webhookToken = null;
      else if (avatar.dataUri) await hook.patch(`/webhooks/${webhookId}/${webhookToken}`, { avatar: avatar.dataUri }).catch(() => {}); // old webhooks get the avatar too
    }
    if (!webhookId) {
      const { data } = await botApi.post(`/channels/${forumId}/webhooks`, { name: 'Dark · Логи', ...(avatar.dataUri ? { avatar: avatar.dataUri } : {}) });
      webhookId = data.id;
      webhookToken = data.token;
    }

    // 3. One post per category; an existing post of this forum is kept (and un-archived).
    const threads = {};
    const created = [];
    const oldThreads = saved.threads || {};
    for (const c of CATEGORIES) {
      const existing = oldThreads[c.key];
      if (existing) {
        const t = await botApi.get(`/channels/${existing}`).then((r) => r.data).catch(() => null);
        if (t && t.parent_id === forumId) {
          if (t.thread_metadata?.archived) await botApi.patch(`/channels/${existing}`, { archived: false }).catch(() => {});
          threads[c.key] = existing;
          continue;
        }
      }
      const tag = tagId(c);
      const { data } = await hook.post(`/webhooks/${webhookId}/${webhookToken}`, {
        content: c.content,
        thread_name: c.thread,
        applied_tags: tag ? [tag] : [],
        username: 'Dark · Логи',
        ...(avatar.url ? { avatar_url: avatar.url } : {}),
        allowed_mentions: { parse: [] }
      }, { params: { wait: true } });
      threads[c.key] = data.channel_id;
      created.push(c.key);
      await pause(400);
    }
    return { webhookId, webhookToken, threads, created };
  } catch (err) {
    throw asSetupError(err);
  }
}

module.exports = { setupLogForum, SetupError };
