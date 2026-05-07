/**
 * Сервер для кликера с общим чатом и таблицей лидеров
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
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const MAX_MESSAGES = 100;
const MAX_LEADERS   = 50; // храним максимум 50 записей, отдаём топ-10

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

/* ── Хранилище лидеров ── */
let leaderboard = []; // { username, score, updatedAt }

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) {
    leaderboard = [];
  }
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
  } catch (e) {}
}

function updateLeaderboard(username, score) {
  if (!username || username.length === 0) return false;
  const existing = leaderboard.find(l => l.username === username);
  if (existing) {
    if (score <= existing.score) return false;
    existing.score = score;
    existing.updatedAt = new Date().toISOString();
  } else {
    leaderboard.push({
      username,
      score,
      updatedAt: new Date().toISOString()
    });
  }
  // Сортируем по убыванию счета и оставляем только MAX_LEADERS записей
  leaderboard.sort((a, b) => b.score - a.score);
  if (leaderboard.length > MAX_LEADERS) leaderboard = leaderboard.slice(0, MAX_LEADERS);
  saveLeaderboard();
  return true;
}

function getTopLeaderboard(limit = 10) {
  return leaderboard.slice(0, limit);
}

/* ── SSE клиенты для чата ── */
const sseClients = new Set();

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  }
}

/* ── Валидация сообщения чата ── */
function validateMessage(body) {
  if (!body || typeof body !== 'object') return null;
  const username = String(body.username || '').trim();
  const text     = String(body.text     || '').trim();
  if (!username || username.length > 30)  return null;
  if (!text     || text.length > 1000)    return null;
  return { username, text };
}

/* ── Валидация лидерборда (обновление счета) ── */
function validateScoreUpdate(body) {
  if (!body || typeof body !== 'object') return null;
  const username = String(body.username || '').trim();
  const score    = Number(body.score);
  if (!username || username.length > 30) return null;
  if (isNaN(score) || score < 0) return null;
  return { username, score: Math.floor(score) };
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

  /* ────────────── ЧАТ API ────────────── */
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

  /* ────────────── ЛИДЕРБОРД API ────────────── */
  /* GET /api/leaderboard — получить топ-10 */
  if (method === 'GET' && pathname === '/api/leaderboard') {
    const top = getTopLeaderboard(10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ leaderboard: top }));
    return;
  }

  /* POST /api/leaderboard/update — обновить счет игрока */
  if (method === 'POST' && pathname === '/api/leaderboard/update') {
    try {
      const body = await readBody(req);
      const valid = validateScoreUpdate(body);
      if (!valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
        return;
      }
      const updated = updateLeaderboard(valid.username, valid.score);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: updated, leaderboard: getTopLeaderboard(10) }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  /* 404 */
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Загружаем данные при старте
loadMessages();
loadLeaderboard();

server.listen(PORT, () => {
  console.log(`\n✅ Сервер запущен: http://localhost:${PORT}`);
  console.log(`   Чат API:        http://localhost:${PORT}/api/messages`);
  console.log(`   SSE стрим:      http://localhost:${PORT}/api/messages/stream`);
  console.log(`   Лидерборд API:  http://localhost:${PORT}/api/leaderboard`);
  console.log(`   Обновление:     POST ${PORT}/api/leaderboard/update`);
  console.log(`   Файлы:          чат: ${MESSAGES_FILE}, лидеры: ${LEADERBOARD_FILE}`);
  console.log('\nЧтобы остановить: Ctrl+C\n');
});