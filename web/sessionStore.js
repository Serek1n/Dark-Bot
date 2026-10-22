// Login sessions live in the SAME database as everything else (table web_sessions), so the project needs only one sqlite driver.
const session = require('express-session');
const { sequelize } = require('../db');

const DAY = 24 * 60 * 60 * 1000;

class SequelizeStore extends session.Store {
  constructor({ cleanupMs = 15 * 60 * 1000 } = {}) {
    super();
    this.ready = sequelize.query('CREATE TABLE IF NOT EXISTS web_sessions (sid VARCHAR(255) PRIMARY KEY, expires BIGINT NOT NULL, sess TEXT NOT NULL)')
      .then(() => sequelize.query('CREATE INDEX IF NOT EXISTS web_sessions_expires ON web_sessions (expires)'));
    this.timer = setInterval(() => this.cleanup().catch(() => {}), cleanupMs);
    this.timer.unref();
  }

  static expiryOf(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    const t = e ? new Date(e).getTime() : NaN;
    return Number.isFinite(t) ? t : Date.now() + DAY;
  }

  async cleanup() {
    await this.ready;
    await sequelize.query('DELETE FROM web_sessions WHERE expires <= ?', { replacements: [Date.now()] });
  }

  get(sid, cb) {
    this.ready
      .then(() => sequelize.query('SELECT sess FROM web_sessions WHERE sid = ? AND expires > ?', { replacements: [sid, Date.now()], type: 'SELECT' }))
      .then((rows) => {
        if (!rows.length) return cb(null, null);
        try { cb(null, JSON.parse(rows[0].sess)); } catch (err) { cb(err); }
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    this.ready
      .then(() => sequelize.query('INSERT INTO web_sessions (sid, expires, sess) VALUES (?, ?, ?) ON CONFLICT (sid) DO UPDATE SET expires = excluded.expires, sess = excluded.sess',
        { replacements: [sid, SequelizeStore.expiryOf(sess), JSON.stringify(sess)] }))
      .then(() => cb(null), cb);
  }

  touch(sid, sess, cb = () => {}) {
    this.ready
      .then(() => sequelize.query('UPDATE web_sessions SET expires = ? WHERE sid = ?', { replacements: [SequelizeStore.expiryOf(sess), sid] }))
      .then(() => cb(null), cb);
  }

  destroy(sid, cb = () => {}) {
    this.ready.then(() => sequelize.query('DELETE FROM web_sessions WHERE sid = ?', { replacements: [sid] })).then(() => cb(null), cb);
  }
}

module.exports = { SequelizeStore };
