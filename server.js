const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const dataPath = path.join(root, 'data.json');
const port = process.env.PORT || 5173;
const host = process.env.HOST || '0.0.0.0';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const sessions = new Map();
let appData;

function readData() {
  if (appData) return appData;
  try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch { return { people: [] }; }
}

function writeData(data) {
  appData = data;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  saveRemoteData(data).catch((error) => console.error(`Supabase save failed: ${error.message}`));
}

function supabaseHeaders() {
  return { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' };
}

async function loadRemoteData() {
  appData = readData();
  if (!supabaseUrl || !supabaseServiceKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/app_state?id=eq.1&select=state`, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`read returned ${response.status}`);
  const rows = await response.json();
  if (rows[0]?.state) {
    appData = rows[0].state;
    fs.writeFileSync(dataPath, `${JSON.stringify(appData, null, 2)}\n`);
  } else {
    await saveRemoteData(appData);
  }
}

async function saveRemoteData(data) {
  if (!supabaseUrl || !supabaseServiceKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/app_state`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, state: data, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`write returned ${response.status}`);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://mar47362626-eng.github.io', 'Access-Control-Allow-Credentials': 'true' });
  response.end(JSON.stringify(body));
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(secret, salt, 64).toString('hex') };
}

function getSession(request) {
  const token = String(request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('ht_session='))?.split('=')[1];
  return token && sessions.has(token) ? sessions.get(token) : null;
}

function requireOwner(request, response) {
  if (getSession(request)) return true;
  sendJson(response, 401, { error: 'Owner login required.' });
  return false;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 5000000) {
        tooLarge = true;
        request.resume();
        reject(new Error('Payload too large'));
      }
    });
    request.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}

function distanceInMeters(first, second) {
  const earthRadius = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(first.latitude)) * Math.cos(toRadians(second.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addLocationHistory(person, location, updatedAt) {
  person.locationHistory ||= [];
  person.totalDistanceMeters ||= 0;
  const previous = person.locationHistory[person.locationHistory.length - 1];
  if (previous) person.totalDistanceMeters += distanceInMeters(previous, location);
  person.locationHistory.push({ ...location, updatedAt });
  if (person.locationHistory.length > 500) person.locationHistory.shift();
}

function publicPerson(person) {
  return { id: person.id, name: person.name, email: person.email, phone: person.phone, photo: person.photo || '', active: person.active, location: person.location, geofence: person.geofence || null, totalDistanceMeters: person.totalDistanceMeters || 0, locationHistory: person.locationHistory || [], registeredAt: person.registeredAt, updatedAt: person.updatedAt, alerts: person.alerts || [], checkIns: person.checkIns || [], evidence: (person.evidence || []).map(({ id, createdAt, name }) => ({ id, createdAt, name })) };
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function handleApi(request, response, url) {
  const data = readData();
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    const owner = data.owner;
    return sendJson(response, 200, { configured: Boolean(owner), authenticated: Boolean(getSession(request)) });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/setup') {
    if (data.owner) return sendJson(response, 409, { error: 'Owner account already exists.' });
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const pin = String(body.pin || '');
    if (!email.includes('@') || password.length < 8 || !/^\d{4,8}$/.test(pin)) return sendJson(response, 400, { error: 'Use a valid email, an 8+ character password, and a 4-8 digit PIN.' });
    data.owner = { email, password: hashSecret(password), pin: hashSecret(pin), createdAt: new Date().toISOString() };
    writeData(data);
    return sendJson(response, 201, { ok: true });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const owner = data.owner;
    if (!owner) return sendJson(response, 409, { error: 'Set up the owner account first.' });
    const secret = String(body.password || body.pin || '');
    const stored = body.pin ? owner.pin : owner.password;
    const candidate = crypto.scryptSync(secret, stored.salt, 64).toString('hex');
    if (!crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored.hash))) return sendJson(response, 401, { error: 'Incorrect owner credentials.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { email: owner.email, createdAt: Date.now() });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `ht_session=${token}; HttpOnly; SameSite=None; Secure; Path=/`, 'Cache-Control': 'no-store' });
    return response.end(JSON.stringify({ ok: true }));
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = String(request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('ht_session='))?.split('=')[1];
    if (token) sessions.delete(token);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'ht_session=; Max-Age=0; HttpOnly; SameSite=None; Secure; Path=/' });
    return response.end(JSON.stringify({ ok: true }));
  }

  if (request.method === 'GET' && url.pathname === '/api/people') {
    if (!requireOwner(request, response)) return;
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    const phone = normalizePhone(url.searchParams.get('phone'));
    if ((email || phone) && !email && phone.length < 7) return sendJson(response, 400, { error: 'Enter a valid phone number.' });
    if ((email || phone) && email && !email.includes('@')) return sendJson(response, 400, { error: 'Enter a valid email address.' });
    const people = data.people.filter((person) => {
      if (!person.active) return false;
      if (email && String(person.email || '').trim().toLowerCase() !== email) return false;
      if (phone && normalizePhone(person.phone) !== phone) return false;
      return true;
    });
    return sendJson(response, 200, { people: people.map(publicPerson) });
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'connection') {
    const person = data.people.find((item) => item.id === parts[2] && item.active);
    return person ? sendJson(response, 200, { person: publicPerson(person) }) : sendJson(response, 404, { error: 'Active connection not found.' });
  }

  if (request.method === 'POST' && url.pathname === '/api/register') {
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const phoneDigits = String(body.phone || '').replace(/\D/g, '');
    if (!body.consent || !String(body.name || '').trim() || !String(body.email || '').includes('@') || phoneDigits.length < 7) return sendJson(response, 400, { error: 'Valid name, email, phone, and consent are required.' });
    const person = { id: crypto.randomUUID(), name: String(body.name).trim(), email: String(body.email).trim(), phone: String(body.phone).trim(), photo: typeof body.photo === 'string' && body.photo.startsWith('data:image/') ? body.photo : '', active: true, location: null, totalDistanceMeters: 0, locationHistory: [], registeredAt: new Date().toISOString(), updatedAt: null, alerts: [], checkIns: [], evidence: [] };
    data.people = data.people.filter((item) => item.email !== person.email);
    data.people.push(person);
    writeData(data);
    return sendJson(response, 201, { person: publicPerson(person) });
  }

  if (parts[0] === 'api' && parts[1] === 'location' && request.method === 'POST') {
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const person = data.people.find((item) => item.id === parts[2] && item.active);
    if (!person) return sendJson(response, 404, { error: 'Active sharing connection not found.' });
    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') return sendJson(response, 400, { error: 'A valid location is required.' });
    person.location = { latitude: body.latitude, longitude: body.longitude, accuracy: Number(body.accuracy) || null };
    person.updatedAt = new Date().toISOString();
    addLocationHistory(person, person.location, person.updatedAt);
    if (person.geofence && distanceInMeters(person.geofence.center, person.location) > person.geofence.radius) {
      person.alerts ||= [];
      const alreadyAlerted = person.alerts.some((alert) => alert.type === 'GEOFENCE' && !alert.resolved);
      if (!alreadyAlerted) person.alerts.unshift({ id: crypto.randomUUID(), type: 'GEOFENCE', message: `Outside the ${person.geofence.radius} m safety zone`, location: person.location, createdAt: person.updatedAt, resolved: false });
    }
    writeData(data);
    return sendJson(response, 200, { person: publicPerson(person) });
  }

  if (parts[0] === 'api' && parts[1] === 'geofence' && request.method === 'POST') {
    if (!requireOwner(request, response)) return;
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const person = data.people.find((item) => item.id === parts[2] && item.active);
    if (!person || !person.location) return sendJson(response, 400, { error: 'A current location is required first.' });
    const radius = Number(body.radius);
    if (!Number.isFinite(radius) || radius < 50 || radius > 100000) return sendJson(response, 400, { error: 'Radius must be between 50 and 100000 metres.' });
    person.geofence = { center: person.location, radius };
    writeData(data);
    return sendJson(response, 201, { person: publicPerson(person) });
  }

  if (parts[0] === 'api' && ['sos', 'checkin', 'evidence'].includes(parts[1]) && request.method === 'POST') {
    let body;
    try { body = await readBody(request); } catch { return sendJson(response, 400, { error: 'Invalid request.' }); }
    const person = data.people.find((item) => item.id === parts[2] && item.active);
    if (!person) return sendJson(response, 404, { error: 'Active sharing connection not found.' });
    const now = new Date().toISOString();
    person.alerts ||= [];
    person.checkIns ||= [];
    person.evidence ||= [];
    if (parts[1] === 'sos') person.alerts.unshift({ id: crypto.randomUUID(), type: 'SOS', message: String(body.message || 'Emergency help requested').slice(0, 300), location: person.location, createdAt: now, resolved: false });
    if (parts[1] === 'checkin') person.checkIns.unshift({ id: crypto.randomUUID(), location: person.location, createdAt: now });
    if (parts[1] === 'evidence') {
      if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) return sendJson(response, 400, { error: 'Choose an image from this device.' });
      person.evidence.unshift({ id: crypto.randomUUID(), name: String(body.name || 'Emergency evidence').slice(0, 100), image: body.image, createdAt: now });
    }
    person.updatedAt = now;
    writeData(data);
    return sendJson(response, 201, { person: publicPerson(person) });
  }

  if (parts[0] === 'api' && parts[1] === 'stop' && request.method === 'POST') {
    const person = data.people.find((item) => item.id === parts[2]);
    if (!person) return sendJson(response, 404, { error: 'Connection not found.' });
    person.active = false;
    person.updatedAt = new Date().toISOString();
    writeData(data);
    return sendJson(response, 200, { ok: true });
  }

  sendJson(response, 404, { error: 'API route not found.' });
}

function serveFile(request, response, url) {
  const routeFiles = { '/': 'index.html', '/admin': 'admin.html' };
  const requested = routeFiles[url.pathname] || url.pathname.slice(1);
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendJson(response, 404, { error: 'Page not found.' });
  response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
  if (requested === 'admin.html') {
    const initialPeople = getSession(request) ? readData().people.filter((person) => person.active).map(publicPerson) : [];
    const html = fs.readFileSync(filePath, 'utf8');
    const initialData = JSON.stringify(initialPeople).replace(/</g, '\\u003c');
    return response.end(html.replace('</body>', `<script>window.__INITIAL_PEOPLE__=${initialData};</script></body>`));
  }
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  response.setHeader('Access-Control-Allow-Origin', 'https://mar47362626-eng.github.io');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url).catch(() => sendJson(response, 500, { error: 'Server error.' }));
  serveFile(request, response, url);
});

loadRemoteData()
  .then(() => server.listen(port, host, () => console.log(`HereTogether server running on port ${port}`)))
  .catch((error) => {
    console.error(`Supabase startup failed: ${error.message}. Continuing with local storage.`);
    server.listen(port, host, () => console.log(`HereTogether server running on port ${port}`));
  });
