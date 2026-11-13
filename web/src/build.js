const fs = require('fs'), path = require('path');
const d = __dirname, rd = f => fs.readFileSync(path.join(d, f), 'utf8');
const strip = s => s.replace(/\nif \(typeof module[^\n]*\n?/g, '\n');
let page = rd('page.html').replace('/*CORE*/', () => strip(rd('core.js'))).replace('/*EXPORT*/', () => strip(rd('exports.js')));
fs.mkdirSync(path.join(d, '../dist'), { recursive: true });
fs.writeFileSync(path.join(d, '../dist/artifact.html'), page);                       // artifact body
const m = page.indexOf('<div class="app">');
const full = '<!doctype html>\n<html lang="sk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<style>body{margin:0}[hidden]{display:none!important}</style>\n' + page.slice(0, m) + '</head>\n<body>\n' + page.slice(m) + '</body>\n</html>\n';

fs.writeFileSync(path.join(d, '../index.html'), full);                        // self-hosted
console.log('built', page.length, full.length);
