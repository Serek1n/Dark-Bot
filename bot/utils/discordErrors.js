// Turns a Discord error (discord.js or a raw REST/axios one) into Russian words a person can act on.
// The raw English text from Discord is never shown; callers log it themselves if needed.
const TEXT = {
  webhooklimit: 'В этом канале уже 15 вебхуков — это предел Discord. Удалите ненужные.',
  perm: 'У бота не хватает прав в этом канале (нужны «Просмотр канала» и «Управлять вебхуками»).',
  panelperm: 'У бота нет прав в этом канале: нужны «Просмотр канала», «Отправлять сообщения» и «Встраивать ссылки».',
  form: 'Discord не принял данные: проверьте имя (слова «discord» и «clyde» запрещены) и ссылку на картинку.',
  nochannel: 'Канал не найден — возможно, его удалили.',
  ratelimit: 'Discord просит подождать: слишком много действий подряд. Повторите через минуту.',
  timeout: 'Discord не ответил вовремя. Попробуйте ещё раз.',
  panel: 'Не удалось разместить панель. Попробуйте ещё раз.',
  discord: 'Discord отказал в действии. Попробуйте ещё раз позже.'
};

/** Short key for the error (safe to put in a link). */
function errorKey(err) {
  const code = err?.response?.data?.code ?? err?.rawError?.code ?? (typeof err?.code === 'number' ? err.code : undefined);
  const status = err?.response?.status ?? err?.status;
  const m = String(err?.response?.data?.message || err?.message || '');
  if (code === 30007 || /Maximum number of webhooks/i.test(m)) return 'webhooklimit';
  if (code === 50013 || code === 50001 || status === 403 || /Missing (Permissions|Access)/i.test(m)) return 'perm';
  if (code === 50035 || /Invalid Form Body/i.test(m)) return 'form';
  if (code === 10003 || /Unknown Channel/i.test(m)) return 'nochannel';
  if (status === 429) return 'ratelimit';
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || /timeout/i.test(m)) return 'timeout';
  return 'discord';
}

// The codes by which Discord says "this thing does not exist". Only these mean "gone"; any other failure (429, 5xx, a
// timeout, a network error) means "could not ask now" and the work is tried again later, never thrown away.
const GONE = new Set([10003, 10004, 10007, 10008, 10011, 10013, 10015]); // channel, guild, member, message, role, user, webhook
/** Did Discord answer that the asked thing does not exist (not "could not answer")? */
function isGone(err) {
  const code = err?.rawError?.code ?? err?.response?.data?.code ?? (typeof err?.code === 'number' ? err.code : undefined);
  return GONE.has(code);
}

const errorText = (keyOrErr) => TEXT[typeof keyOrErr === 'string' ? keyOrErr : errorKey(keyOrErr)] || TEXT.discord;

module.exports = { errorKey, errorText, isGone, GONE, ERROR_TEXT: TEXT };
