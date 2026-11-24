// Точка входу: HTTP-сервер Smart Klima (REST API + веб-застосунок).
'use strict';
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db.js');
const { createApp } = require('./app.js');

const PORT = +process.env.PORT || 3000;
const DB_PATH = process.argv[2] || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'smartklima.db');

function start(port = PORT, dbPath = DB_PATH, opts = {}) {
  const db = openDb(dbPath);
  const app = createApp(db, opts);
  const server = http.createServer(app);
  return new Promise(resolve => server.listen(port, () => resolve({ server, db, app, port: server.address().port })));
}

if (require.main === module) {
  start().then(({ port }) => {
    console.log(`Smart Klima API: http://localhost:${port}/api/health`);
    console.log(`Веб-застосунок:  http://localhost:${port}/web/`);
    if (!process.env.JWT_SECRET) console.warn('УВАГА: JWT_SECRET не задано — після перезапуску всім доведеться увійти знову.');
  });
}
module.exports = { start };
