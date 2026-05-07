const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

/**
 * Настройки для Render
 */
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 

// Используем /tmp для записи файлов, так как на Render основная папка только для чтения
const DATA_DIR = process.env.RENDER ? '/tmp' : __dirname;

const HTML_FILE      = path.join(__dirname, 'index.html');
const MESSAGES_FILE  = path.join(DATA_DIR, 'messages.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

const MAX_MESSAGES = 100;
const MAX_LEADERS  = 50; 

let messages = [];
let leaderboard = [];

/* ── Загрузка и сохранение данных ── */
function loadData() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
    if (fs.existsSync(LEADERBOARD_FILE)) {
      leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) {
    console.error("Ошибка при загрузке JSON:", e);
  }
}

function saveMessages() {
  try { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2)); } catch (e) {}
}

function saveLeaderboard() {
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2)); } catch (e) {}
}

function updateLeaderboard(username, score) {
  if (!username) return false;
  const existing = leaderboard.find(l => l.username === username);
  if (existing) {
    if (score <= existing.score) return false;
    existing.score = score;
    existing.updatedAt = new Date().toISOString();
  } else {
    leaderboard.push({ username, score, updatedAt: new Date().toISOString() });
  }
  leaderboard.sort((a, b) => b.score - a.score);
  if (leaderboard.length > MAX_LEADERS) leaderboard = leaderboard.slice(0, MAX_LEADERS);
  saveLeaderboard();
  return true;
}

/* ── SSE (Рассылка сообщений в чат) ── */
const sseClients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  }
}

/* ── Чтение тела POST запроса ── */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
  });
}

/* ── Создание сервера ── */
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);

  // ИСПРАВЛЕНИЕ CORS: Разрешаем запросы с любого адреса
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Обработка предварительных запросов (Preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Главная страница (Frontend)
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_FILE));
    } catch (e) {
      res.writeHead(404);
      res.end('Файл index.html не найден');
    }
    return;
  }

  // 2. ЧАТ: Получить историю
  if (pathname === '/api/messages' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
    return;
  }

  // 3. ЧАТ: Отправить сообщение
  if (pathname === '/api/messages' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.text) {
      const msg = {
        id: Date.now(),
        username: String(body.username || 'Аноним'),
        text: String(body.text),
        createdAt: new Date().toISOString()
      };
      messages.push(msg);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      saveMessages();
      broadcast(msg);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
    }
    return;
  }

  // 4. ЧАТ: SSE Стрим
  if (pathname === '/api/messages/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 5. ЛИДЕРБОРД: Получить топ
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ leaderboard: leaderboard.slice(0, 10) }));
    return;
  }

  // 6. ЛИДЕРБОРД: Обновить счет
  if (pathname === '/api/leaderboard/update' && req.method === 'POST') {
    const body = await readBody(req);
    const updated = updateLeaderboard(body.username, Number(body.score));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: updated, leaderboard: leaderboard.slice(0, 10) }));
    return;
  }

  // Ошибка 404
  res.writeHead(404);
  res.end();
});

// Запуск
loadData();
server.listen(PORT, HOST, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});