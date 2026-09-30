const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const storage = require('./lib/storage');
const { ingestFile, removePhotoFiles } = require('./lib/ingest');
const { assignPhotos, locationCenter, parseCoords, validLatLon } = require('./lib/cluster');
const { reverseGeocode, forwardGeocode, GEOCODE_ENABLED } = require('./lib/geocode');
const { buildOutput } = require('./lib/build');

const PORT = Number(process.env.PORT) || 3210;
const APP_PASSWORD = process.env.APP_PASSWORD || '';

const app = express();
app.use(express.json({ limit: '2mb' }));

// Tutta l'app è privata se APP_PASSWORD è impostata: accesso da pagina di login dell'app (niente finestra nativa del browser).
const SESSION_COOKIE = 'fr_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 giorni
const sessionToken = () => crypto.createHmac('sha256', APP_PASSWORD).update('foto-recap-session').digest('hex');
const PUBLIC_PATHS = new Set(['/login.html', '/style.css', '/dialog.js', '/logo.png', '/favicon.png', '/apple-touch-icon.png', '/api/login']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (!safeEqual(req.body?.password || '', APP_PASSWORD)) return res.status(401).json({ error: 'Password non corretta' });
  const secure = req.secure || req.get('x-forwarded-proto') === 'https' ? '; Secure' : '';
  res.set('Set-Cookie', `${SESSION_COOKIE}=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (!APP_PASSWORD || PUBLIC_PATHS.has(req.path) || safeEqual(readCookie(req, SESSION_COOKIE), sessionToken())) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Accesso richiesto' });
  res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
});

app.use(express.static(path.join(__dirname, 'public')));

// Download di zip e PDF generati, solo per chi usa l'app.
app.get('/d/:id/:file', (req, res) => {
  const { id, file } = req.params;
  if (!storage.isValidId(id) || !/^[\w.-]+\.(zip|pdf)$/.test(file)) return res.sendStatus(404);
  res.download(path.join(storage.projectDir(id), 'out', file), file, (err) => err && !res.headersSent && res.sendStatus(404));
});


app.get('/files/:id/:kind/:file', (req, res) => {
  const { id, kind, file } = req.params;
  if (!storage.isValidId(id) || !['thumbs', 'web'].includes(kind) || !/^[\w-]+\.jpg$/.test(file)) return res.sendStatus(404);
  res.sendFile(path.join(storage.projectDir(id), kind, file), { maxAge: '7d' }, (err) => err && !res.headersSent && res.sendStatus(404));
});

const upload = multer({ dest: path.join(storage.DATA_DIR, 'tmp'), limits: { fileSize: 80 * 1024 * 1024 } });

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function withProject(req, res, fn) {
  return storage.withLock(req.params.id, async () => {
    const project = await storage.loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Progetto non trovato' });
    return fn(project);
  });
}

function publicView(project) {
  return {
    ...project,
    locations: project.locations.map((l) => ({ ...l, center: locationCenter(project, l) })),
  };
}

async function suggestNames(project, locations) {
  for (const loc of locations) {
    if (loc.name) continue;
    const c = locationCenter(project, loc);
    if (c) loc.name = await reverseGeocode(c);
  }
}

app.get('/api/defaults', (req, res) => res.json({ ...storage.DEFAULTS, auth: !!APP_PASSWORD }));

app.get('/api/projects', wrap(async (req, res) => res.json(await storage.listProjects())));

app.post('/api/projects', wrap(async (req, res) => res.json(await storage.createProject(req.body || {}))));

app.get('/api/projects/:id', wrap(async (req, res) => {
  const p = await storage.loadProject(req.params.id);
  p ? res.json(publicView(p)) : res.status(404).json({ error: 'Progetto non trovato' });
}));

app.delete('/api/projects/:id', wrap(async (req, res) => {
  await storage.withLock(req.params.id, () => storage.deleteProject(req.params.id));
  res.json({ ok: true });
}));

const META_FIELDS = ['name', 'company', 'client', 'dateLabel', 'email', 'phone', 'includeGrid'];
const STATUSES = ['', 'AVAILABLE', 'TBC', 'NOT AVAILABLE'];

// Salvataggio dell'intero stato modificabile: dati progetto + location (nomi, ordine, foto, copertine).
app.put('/api/projects/:id', wrap(async (req, res) => withProject(req, res, async (project) => {
  const body = req.body || {};
  for (const f of META_FIELDS) if (f in body) project[f] = f === 'includeGrid' ? !!body[f] : String(body[f] ?? '').slice(0, 200);

  if (Array.isArray(body.locations)) {
    const known = new Set(project.photos.map((p) => p.id));
    const used = new Set();
    project.locations = body.locations.map((l) => {
      const photoIds = (l.photoIds || []).filter((id) => known.has(id) && !used.has(id));
      photoIds.forEach((id) => used.add(id));
      return {
        id: /^[a-f0-9]{6,20}$/.test(l.id) ? l.id : storage.newId(6),
        name: String(l.name || '').slice(0, 80),
        status: STATUSES.includes(l.status) ? l.status : '',
        link: /^https?:\/\/\S+$/i.test(String(l.link || '').trim()) ? String(l.link).trim().slice(0, 500) : '',
        photoIds,
        coverId: photoIds.includes(l.coverId) ? l.coverId : photoIds[0] || null,
        manual: l.manual && validLatLon(Number(l.manual.lat), Number(l.manual.lon))
          ? { lat: Number(l.manual.lat), lon: Number(l.manual.lon), label: String(l.manual.label || '').slice(0, 200) }
          : null,
      };
    }).filter((l) => l.photoIds.length);
    // Nessuna foto deve restare orfana.
    const orphans = project.photos.filter((p) => !used.has(p.id)).map((p) => p.id);
    if (orphans.length) assignPhotos(project, orphans);
  }
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.post('/api/projects/:id/photos', upload.array('photos', 50), wrap(async (req, res) => {
  const files = req.files || [];
  let lastModified = [];
  try { lastModified = JSON.parse(req.body.lastModified || '[]'); } catch {}
  const failed = [];
  const ingested = [];
  for (let i = 0; i < files.length; i++) {
    try {
      ingested.push(await ingestFile(req.params.id, files[i], lastModified[i]));
    } catch (err) {
      console.error('ingest', files[i].originalname, err.message);
      failed.push(files[i].originalname);
      await fs.rm(files[i].path, { force: true });
    }
  }
  await withProject(req, res, async (project) => {
    project.photos.push(...ingested);
    const created = assignPhotos(project, ingested.map((p) => p.id));
    await suggestNames(project, created);
    await storage.saveProject(project);
    res.json({ project: publicView(project), added: ingested.length, failed });
  });
}));

app.post('/api/projects/:id/photos/delete', wrap(async (req, res) => withProject(req, res, async (project) => {
  const ids = new Set(req.body.photoIds || []);
  for (const p of project.photos.filter((x) => ids.has(x.id))) await removePhotoFiles(project.id, p);
  project.photos = project.photos.filter((p) => !ids.has(p.id));
  for (const l of project.locations) {
    l.photoIds = l.photoIds.filter((id) => !ids.has(id));
    if (!l.photoIds.includes(l.coverId)) l.coverId = l.photoIds[0] || null;
  }
  project.locations = project.locations.filter((l) => l.photoIds.length);
  // Zip e PDF generati contengono ancora le foto eliminate: vanno rigenerati.
  if (ids.size) {
    await fs.rm(path.join(storage.projectDir(project.id), 'out'), { recursive: true, force: true });
    await fs.mkdir(path.join(storage.projectDir(project.id), 'out'), { recursive: true });
    project.output = null;
  }
  await storage.saveProject(project);
  res.json(publicView(project));
})));

// Posizione a mano per una location: indirizzo, coordinate o link Google Maps. query vuota = torna al GPS delle foto.
app.post('/api/projects/:id/locations/:locId/position', wrap(async (req, res) => withProject(req, res, async (project) => {
  const loc = project.locations.find((l) => l.id === req.params.locId);
  if (!loc) return res.status(404).json({ error: 'Location non trovata' });
  const query = String(req.body?.query || '').trim().slice(0, 300);
  if (!query) {
    loc.manual = null;
  } else {
    const coords = parseCoords(query);
    if (coords) {
      loc.manual = { ...coords, label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` };
      if (!loc.name) loc.name = await reverseGeocode(coords);
    } else {
      if (!GEOCODE_ENABLED) return res.status(400).json({ error: 'La ricerca per indirizzo è disattivata (GEOCODE=off): inserisci le coordinate, es. 45.4636, 9.1959' });
      const hit = await forwardGeocode(query);
      if (!hit) return res.status(404).json({ error: `Nessun risultato per "${query}". Prova ad aggiungere la città, oppure incolla le coordinate o un link di Google Maps.` });
      loc.manual = { lat: hit.lat, lon: hit.lon, label: hit.label };
      if (!loc.name) loc.name = hit.name || query;
    }
  }
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.post('/api/projects/:id/recluster', wrap(async (req, res) => withProject(req, res, async (project) => {
  project.locations = [];
  const created = assignPhotos(project, project.photos.map((p) => p.id));
  await suggestNames(project, created);
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.post('/api/projects/:id/logo', upload.single('logo'), wrap(async (req, res) => withProject(req, res, async (project) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file' });
  const sharp = require('sharp');
  await sharp(req.file.path).resize({ width: 1200, height: 600, fit: 'inside', withoutEnlargement: true }).png()
    .toFile(path.join(storage.projectDir(project.id), 'logo.png'));
  await fs.rm(req.file.path, { force: true });
  project.logo = 'logo.png';
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.delete('/api/projects/:id/logo', wrap(async (req, res) => withProject(req, res, async (project) => {
  project.logo = null;
  await fs.rm(path.join(storage.projectDir(project.id), 'logo.png'), { force: true });
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.get('/files/:id/logo.png', (req, res) => {
  if (!storage.isValidId(req.params.id)) return res.sendStatus(404);
  res.sendFile(path.join(storage.projectDir(req.params.id), 'logo.png'), (err) => err && !res.headersSent && res.sendStatus(404));
});

app.post('/api/projects/:id/generate', wrap(async (req, res) => withProject(req, res, async (project) => {
  if (!project.locations.length) return res.status(400).json({ error: 'Nessuna foto caricata' });
  project.output = await buildOutput(project);
  await storage.saveProject(project);
  res.json(publicView(project));
})));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`foto-recap su http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  dal telefono (stessa Wi-Fi): http://${a.address}:${PORT}`);
  }
});
