/**
 * Сервер для кликера с регистрацией, авторизацией и сохранением прогресса
 * Работает без внешних зависимостей (только встроенные модули Node.js)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Директории для данных
const DATA_DIR = process.env.RENDER ? '/tmp' : __dirname;
const HTML_FILE = path.join(__dirname, 'index.html');
const USERS_FILE   = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE  = path.join(DATA_DIR, 'messages.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

// Хранилище сессий (токен -> username)
const sessions = new Map();

// Настройки
const MAX_MESSAGES = 100;
const MAX_LEADERS  = 50;

// Загружаемые данные
let users = {};        // { username: { passwordHash, salt, gameData } }
let messages = [];
let leaderboard = [];

/* ---------- Работа с файлами ---------- */
function loadData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
    if (fs.existsSync(MESSAGES_FILE)) {
      messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
    if (fs.existsSync(LEADERBOARD_FILE)) {
      leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
    }
  } catch (e) {
    console.error("Ошибка загрузки данных:", e);
  }
}

function saveUsers() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch(e) {}
}

function saveMessages() {
  try { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2)); } catch(e) {}
}

function saveLeaderboard() {
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2)); } catch(e) {}
}

/* ---------- Хеширование пароля ---------- */
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/* ---------- Управление игровыми данными ---------- */
function getDefaultGameData() {
  return {
    coins: 0,
    totalClicks: 0,
    clickPower: 1,
    perSecond: 0,
    levelIdx: 0,
    upgrades: [0,0,0,0,0,0,0],  // соответствует upgrades в клиенте
    achievements: []
  };
}

// Обновление таблицы лидеров на основе gameData.coins
function updateLeaderboardFromGameData(username) {
  const user = users[username];
  if (!user || !user.gameData) return false;
  const score = Math.floor(user.gameData.coins || 0);
  
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

/* ---------- Аутентификация и сессии ---------- */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function registerUser(username, password) {
  if (!username || !password) return { success: false, error: 'Заполните поля' };
  if (users[username]) return { success: false, error: 'Пользователь уже существует' };
  if (username.length < 3 || username.length > 30) return { success: false, error: 'Имя от 3 до 30 символов' };
  if (password.length < 4) return { success: false, error: 'Пароль не менее 4 символов' };
  
  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  users[username] = {
    passwordHash,
    salt,
    gameData: getDefaultGameData()
  };
  saveUsers();
  return { success: true };
}

function loginUser(username, password) {
  const user = users[username];
  if (!user) return { success: false, error: 'Неверное имя или пароль' };
  const testHash = hashPassword(password, user.salt);
  if (testHash !== user.passwordHash) return { success: false, error: 'Неверное имя или пароль' };
  
  const token = generateToken();
  sessions.set(token, username);
  // Автоматически очищаем старые сессии (просто для порядка)
  if (sessions.size > 1000) {
    const firstKey = sessions.keys().next().value;
    sessions.delete(firstKey);
  }
  return { success: true, token, username };
}

function getUserByToken(token) {
  return sessions.get(token) || null;
}

/* ---------- SSE для чата ---------- */
const sseClients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  }
}

/* ---------- Вспомогательные функции ---------- */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function checkAuth(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendJSON(res, 401, { error: 'Не авторизован' });
    return null;
  }
  const token = authHeader.slice(7);
  const username = getUserByToken(token);
  if (!username) {
    sendJSON(res, 401, { error: 'Сессия истекла' });
    return null;
  }
  return { username, token };
}

/* ---------- HTTP сервер ---------- */
const server = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Отдача фронтенда
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_FILE));
    } catch (e) {
      res.writeHead(404);
      res.end('index.html not found');
    }
    return;
  }
  
  // ---- РЕГИСТРАЦИЯ ----
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const result = registerUser(body.username, body.password);
    if (result.success) {
      sendJSON(res, 201, { success: true });
    } else {
      sendJSON(res, 400, { success: false, error: result.error });
    }
    return;
  }
  
  // ---- ЛОГИН ----
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const result = loginUser(body.username, body.password);
    if (result.success) {
      sendJSON(res, 200, { success: true, token: result.token, username: result.username });
    } else {
      sendJSON(res, 401, { success: false, error: result.error });
    }
    return;
  }
  
  // ---- ПОЛУЧИТЬ ДАННЫЕ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ----
  if (pathname === '/api/me' && req.method === 'GET') {
    const auth = checkAuth(req, res);
    if (!auth) return;
    const user = users[auth.username];
    if (!user) {
      sendJSON(res, 404, { error: 'Пользователь не найден' });
      return;
    }
    sendJSON(res, 200, { username: auth.username, gameData: user.gameData });
    return;
  }
  
  // ---- СОХРАНИТЬ ИГРОВЫЕ ДАННЫЕ ----
  if (pathname === '/api/savegame' && req.method === 'POST') {
    const auth = checkAuth(req, res);
    if (!auth) return;
    const body = await readBody(req);
    const user = users[auth.username];
    if (user && body.gameData) {
      user.gameData = body.gameData;
      saveUsers();
      updateLeaderboardFromGameData(auth.username);
      sendJSON(res, 200, { success: true });
    } else {
      sendJSON(res, 400, { error: 'Некорректные данные' });
    }
    return;
  }
  
  // ---- ЧАТ: ПОЛУЧИТЬ СООБЩЕНИЯ ----
  if (pathname === '/api/messages' && req.method === 'GET') {
    sendJSON(res, 200, { messages });
    return;
  }
  
  // ---- ЧАТ: ОТПРАВИТЬ СООБЩЕНИЕ ----
  if (pathname === '/api/messages' && req.method === 'POST') {
    const auth = checkAuth(req, res);
    if (!auth) return;
    const body = await readBody(req);
    const text = body.text ? String(body.text).trim() : '';
    if (text === '') {
      sendJSON(res, 400, { error: 'Пустое сообщение' });
      return;
    }
    const msg = {
      id: Date.now(),
      username: auth.username,
      text: text.slice(0, 1000),
      createdAt: new Date().toISOString()
    };
    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    saveMessages();
    broadcast(msg);
    sendJSON(res, 201, msg);
    return;
  }
  
  // ---- ЧАТ: SSE ПОТОК ----
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
  
  // ---- ЛИДЕРБОРД: ПОЛУЧИТЬ ТОП-10 ----
  if (pathname === '/api/leaderboard' && req.method === 'GET') {
    sendJSON(res, 200, { leaderboard: leaderboard.slice(0, 10) });
    return;
  }
  
  // ---- ОБНОВЛЕНИЕ ЛИДЕРБОРДА (вызывается автоматически через savegame, но оставим для совместимости) ----
  if (pathname === '/api/leaderboard/update' && req.method === 'POST') {
    const auth = checkAuth(req, res);
    if (!auth) return;
    const body = await readBody(req);
    if (body.score !== undefined) {
      const user = users[auth.username];
      if (user) {
        if (!user.gameData) user.gameData = getDefaultGameData();
        user.gameData.coins = Number(body.score);
        saveUsers();
        updateLeaderboardFromGameData(auth.username);
      }
    }
    sendJSON(res, 200, { success: true, leaderboard: leaderboard.slice(0, 10) });
    return;
  }
  
  // Если ничего не подошло
  res.writeHead(404);
  res.end();
});

// Запуск
loadData();
server.listen(PORT, HOST, () => {
  console.log(`✅ Сервер запущен на http://${HOST}:${PORT}`);
  console.log(`📁 Данные хранятся в: ${DATA_DIR}`);
});