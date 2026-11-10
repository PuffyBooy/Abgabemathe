'use strict';
// Baut die GitHub-Pages-Demo nach _site/: kopiert public/ und bindet die Browser-Demo (demo/demo.js) ein.
// Aufruf: npm run build:pages
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
// PHP-Backend, Konfiguration und Daten gehören nicht in die Demo
const skip = new Set(['api.php', 'config.php', 'config.sample.php', '.htaccess', 'data']);
fs.cpSync(path.join(root, 'public'), out, {
  recursive: true,
  filter: (src) => !skip.has(path.relative(path.join(root, 'public'), src).split(path.sep)[0]),
});
fs.copyFileSync(path.join(root, 'demo', 'demo.js'), path.join(out, 'demo.js'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

const marker = '<script src="common.js"></script>';
for (const page of ['index.html', 'lehrer.html']) {
  const file = path.join(out, page);
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes(marker)) throw new Error(`${page}: ${marker} nicht gefunden`);
  fs.writeFileSync(file, html.replace(marker, `<script src="demo.js"></script>\n  ${marker}`));
}
console.log('Demo gebaut in _site/');
