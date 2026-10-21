// Removes the databases of earlier test runs (works on Windows too, unlike `rm -f`).
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data');
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/^test_.*\.sqlite/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
