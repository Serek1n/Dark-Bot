// Secrets kept in the database (the log webhook token) are stored encrypted with AES-256-GCM, so a copy of the database file alone
// does not give anyone the right to post as the bot's webhook. The key comes from DATA_KEY in .env, or, if that is not set,
// from SESSION_SECRET (which the panel needs anyway). Keep that value: with another key the saved token cannot be read and the
// forum has to be connected again in the panel.
const crypto = require('crypto');

const PREFIX = 'enc:v1:';

function key() {
  const secret = process.env.DATA_KEY || process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  return crypto.createHash('sha256').update('dark-bot:data:v1:' + secret).digest();
}

const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

/** Encrypts a string. Without a usable key the value is returned as it is (the old behaviour), never lost. */
function encrypt(value) {
  if (value === null || value === undefined || value === '' || isEncrypted(value)) return value;
  const k = key();
  if (!k) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Decrypts; an old plain value is returned as it is, an unreadable one (other key, damaged) gives null. */
function decrypt(value) {
  if (!isEncrypted(value)) return value;
  const k = key();
  if (!k) return null;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, isEncrypted };
