// Webhook links and bot/OAuth tokens must never reach the log files: replace them before printing.
const SECRET_PATTERNS = [
  [/(webhooks\/\d+\/)[\w-]{20,}/g, '$1<скрыто>'],
  [/(Bearer |Bot )[\w.-]{20,}/g, '$1<скрыто>'],
  [/\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}\b/g, '<токен скрыт>']
];
const redact = (v) => {
  const text = typeof v === 'string' ? v : v instanceof Error ? (v.stack || v.message) : null;
  if (text === null) return v;
  return SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
};

function ts() {
  return new Date().toISOString();
}

module.exports = {
  redact,
  info: (...args) => console.log(`[${ts()}] [INFO]`, ...args.map(redact)),
  warn: (...args) => console.warn(`[${ts()}] [WARN]`, ...args.map(redact)),
  error: (...args) => console.error(`[${ts()}] [ERROR]`, ...args.map(redact))
};
