/**
 * Сервер для кликера с общим чатом и таблицей лидеров
 * Оптимизировано для работы на Render.com
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// На Render важно использовать 0.0.0.0 и динамический PORT
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; 

// Директория для данных. /tmp используется для временной записи на Render.
const DATA_DIR = process.env.RENDER ? '/tmp' : __dirname;

const HTML_FILE      = path.join(__dirname, 'index.html');
const MESSAGES_FILE  = path.join(DATA_DIR, 'messages.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

const MAX_MESSAGES = 100;
const MAX_LEADERS  = 50; 

/* ── Хранилище сообщений ── */
let messages = [];

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
  } catch (e) { messages = []; }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (e) { console.error('Ошибка записи сообщений:', e); }
}

/* ── Хранилище лидеров ── */
let leaderboard = []; 

function loadLeaderboard() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) { leaderboard = []; }
}

function saveLeaderboard() {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
  } catch (e) { console.error('Ошибка записи лидеров:', e); }
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

function getTopLeaderboard(limit = 10) {
  return leaderboard.slice(0, limit);
}

/* ── SSE клиенты ── */
const sseClients = new Set();

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  }
}

/* ── Валидация и CORS ── */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { 
      raw += chunk; 
      if (raw.length > 16384) reject(new Error('Too large')); 
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
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

  // Раздача HTML
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      const html = fs.readFileSync(HTML_FILE);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(404);
      res.end('index.html not found');
    }
    return;
  }

  // API Сообщений
  if (method === 'GET' && pathname === '/api/messages') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
    return;
  }

  if (method === 'POST' && pathname === '/api/messages') {
    try {
      const body = await readBody(req);
      const msg = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        username: String(body.username || 'Аноним').trim(),
        text: String(body.text || '').trim(),
        createdAt: new Date().toISOString(),
      };
      if (msg.text) {
        messages.push(msg);
        if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
        saveMessages();
        broadcast(msg);
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

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

  // API Лидерборда
  if (method === 'GET' && pathname === '/api/leaderboard') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ leaderboard: getTopLeaderboard(10) }));
    return;
  }

  if (method === 'POST' && pathname === '/api/leaderboard/update') {
    try {
      const body = await readBody(req);
      const updated = updateLeaderboard(body.username, Number(body.score));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: updated, leaderboard: getTopLeaderboard(10) }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Bad request' }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

loadMessages();
loadLeaderboard();

server.listen(PORT, HOST, () => {
  console.log(`✅ Сервер активен: http://${HOST}:${PORT}`);
});