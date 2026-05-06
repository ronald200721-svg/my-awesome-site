/**
 * Сервер для кликера с общим чатом
 * Требования: Node.js 18+
 * Зависимости: нет (только встроенные модули Node.js)
 *
 * Запуск:
 *   node server.js
 *
 * По умолчанию запускается на порту 3000.
 * Чтобы изменить порт: PORT=8080 node server.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT         = process.env.PORT || 3000;
const HTML_FILE    = path.join(__dirname, 'index.html');
const MESSAGES_FILE= path.join(__dirname, 'messages.json');
const MAX_MESSAGES = 100;

/* ── Хранилище сообщений ── */
let messages = [];

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
  } catch (e) {
    messages = [];
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (e) {}
}

loadMessages();

/* ── SSE клиенты ── */
const sseClients = new Set();

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  }
}

/* ── Валидация ── */
function validateMessage(body) {
  if (!body || typeof body !== 'object') return null;
  const username = String(body.username || '').trim();
  const text     = String(body.text     || '').trim();
  if (!username || username.length > 30)  return null;
  if (!text     || text.length > 1000)    return null;
  return { username, text };
}

/* ── CORS заголовки ── */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ── Читаем тело запроса ── */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 8192) reject(new Error('Too large')); });
    req.on('end',  () => {
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/* ── HTTP сервер ── */
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);
  const method = req.method;

  setCors(res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  /* Отдаём HTML кликера */
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('index.html not found. Put index.html next to server.js');
    }
    return;
  }

  /* GET /api/messages — история */
  if (method === 'GET' && pathname === '/api/messages') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
    return;
  }

  /* POST /api/messages — отправить сообщение */
  if (method === 'POST' && pathname === '/api/messages') {
    try {
      const body    = await readBody(req);
      const valid   = validateMessage(body);
      if (!valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
        return;
      }
      const msg = {
        id:        Date.now() + Math.floor(Math.random() * 1000),
        username:  valid.username,
        text:      valid.text,
        createdAt: new Date().toISOString(),
      };
      messages.push(msg);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      saveMessages();
      broadcast(msg);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  /* GET /api/messages/stream — SSE */
  if (method === 'GET' && pathname === '/api/messages/stream') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  /* 404 */
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n✅ Сервер запущен: http://localhost:${PORT}`);
  console.log(`   Чат API:        http://localhost:${PORT}/api/messages`);
  console.log(`   SSE стрим:      http://localhost:${PORT}/api/messages/stream`);
  console.log(`   Файл с чатом:   ${HTML_FILE}`);
  console.log('\nЧтобы остановить: Ctrl+C\n');
});
