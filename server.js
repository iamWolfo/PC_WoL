require('dotenv').config();

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.POSTGRESQL_ADDON_URI });
const sessions = new Map();

app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname));

async function query(text, params) {
  return pool.query(text, params);
}

async function initializeDatabase() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validMac(mac) {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac);
}

function sessionUser(req) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-session-token');
  const userId = token && sessions.get(token);
  return userId ? { token, userId } : null;
}

function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Authentification requise.' });
  req.user = user;
  next();
}

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || email.split('@')[0] || '').trim();
    if (!email || !email.includes('@') || password.length < 8 || !displayName) {
      return res.status(400).json({ error: 'Nom, e-mail valide et mot de passe de 8 caractères minimum requis.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query('INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name', [email, displayName, passwordHash]);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, result.rows[0].id);
    res.status(201).json({ token, user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const result = await query('SELECT id, email, display_name, password_hash FROM users WHERE email = $1', [normalizeEmail(req.body.email)]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.id);
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name } });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  sessions.delete(req.user.token);
  res.status(204).end();
});

app.get('/api/dashboard', requireAuth, async (req, res, next) => {
  try {
    const [user, devices, routers, activity, stats] = await Promise.all([
      query('SELECT id, email, display_name FROM users WHERE id = $1', [req.user.userId]),
      query(`SELECT id, name, local_ip, mac_address, operating_system, is_online, wake_count, last_wake_at, router_id FROM devices WHERE user_id = $1 ORDER BY created_at`, [req.user.userId]),
      query('SELECT id, name, local_ip, broadcast_ip FROM routers WHERE user_id = $1 ORDER BY created_at', [req.user.userId]),
      query(`SELECT id, event_type, message, created_at FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.user.userId]),
      query(`SELECT COUNT(*)::int AS devices, COUNT(*) FILTER (WHERE is_online)::int AS online_devices, COALESCE(SUM(wake_count), 0)::int AS wakes FROM devices WHERE user_id = $1`, [req.user.userId])
    ]);
    res.json({ user: user.rows[0], devices: devices.rows, routers: routers.rows, activity: activity.rows, stats: stats.rows[0] });
  } catch (error) { next(error); }
});

app.patch('/api/account', requireAuth, async (req, res, next) => {
  try {
    const displayName = String(req.body.displayName || '').trim();
    const email = normalizeEmail(req.body.email);
    if (!displayName || !email.includes('@')) return res.status(400).json({ error: 'Nom et e-mail valides requis.' });
    const result = await query('UPDATE users SET display_name = $1, email = $2 WHERE id = $3 RETURNING id, email, display_name', [displayName, email, req.user.userId]);
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
    next(error);
  }
});

app.post('/api/routers', requireAuth, async (req, res, next) => {
  try {
    const { name, localIp, broadcastIp } = req.body;
    if (!name || !localIp) return res.status(400).json({ error: 'Nom et adresse IP du routeur requis.' });
    const result = await query(`INSERT INTO routers (user_id, name, local_ip, broadcast_ip) VALUES ($1, $2, $3, $4) RETURNING *`, [req.user.userId, name.trim(), localIp.trim(), (broadcastIp || '255.255.255.255').trim()]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

app.patch('/api/routers/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, localIp, broadcastIp } = req.body;
    const result = await query(`UPDATE routers SET name = COALESCE($1, name), local_ip = COALESCE($2, local_ip), broadcast_ip = COALESCE($3, broadcast_ip) WHERE id = $4 AND user_id = $5 RETURNING *`, [name?.trim(), localIp?.trim(), broadcastIp?.trim(), req.params.id, req.user.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Routeur introuvable.' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete('/api/routers/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM routers WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Routeur introuvable.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/devices', requireAuth, async (req, res, next) => {
  try {
    const { name, macAddress, localIp, operatingSystem, routerId } = req.body;
    if (!name || !validMac(macAddress)) return res.status(400).json({ error: 'Nom et adresse MAC valide requis.' });
    const result = await query(`INSERT INTO devices (user_id, router_id, name, mac_address, local_ip, operating_system) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [req.user.userId, routerId || null, name.trim(), macAddress.toLowerCase(), localIp || null, operatingSystem || null]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

function sendMagicPacket(macAddress, broadcastIp) {
  const mac = Buffer.from(macAddress.replace(/:/g, ''), 'hex');
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(() => socket.setBroadcast(true));
    socket.send(packet, 9, broadcastIp || '255.255.255.255', (error) => {
      socket.close();
      if (error) reject(error); else resolve();
    });
  });
}

app.post('/api/devices/:id/wake', requireAuth, async (req, res, next) => {
  try {
    const deviceResult = await query(`SELECT d.*, r.broadcast_ip FROM devices d LEFT JOIN routers r ON r.id = d.router_id AND r.user_id = d.user_id WHERE d.id = $1 AND d.user_id = $2`, [req.params.id, req.user.userId]);
    const device = deviceResult.rows[0];
    if (!device) return res.status(404).json({ error: 'Appareil introuvable.' });
    await sendMagicPacket(device.mac_address, device.broadcast_ip);
    await query(`UPDATE devices SET wake_count = wake_count + 1, last_wake_at = NOW() WHERE id = $1`, [device.id]);
    await query(`INSERT INTO activity_logs (user_id, device_id, event_type, message) VALUES ($1, $2, 'wake', $3)`, [req.user.userId, device.id, `${device.name} réveillé avec succès`]);
    res.json({ ok: true, message: `Paquet magique envoyé à ${device.name}.` });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

initializeDatabase().then(() => app.listen(port, () => console.log(`Wakebase disponible sur http://localhost:${port}`))).catch((error) => {
  console.error('Impossible d’initialiser PostgreSQL.', error.message);
  process.exitCode = 1;
});