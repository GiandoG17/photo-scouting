const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SUBDIRS = ['originals', 'web', 'thumbs', 'out'];

// Dati di default dei nuovi progetti (modificabili da variabili d'ambiente).
const DEFAULTS = {
  company: process.env.DEFAULT_COMPANY ?? 'Squalo Produzioni',
  email: process.env.DEFAULT_EMAIL ?? 'info@squaloproduzioni.com',
  phone: process.env.DEFAULT_PHONE ?? '+39 02 3826 7243',
};

const newId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
const projectDir = (id) => path.join(DATA_DIR, 'projects', id);
const isValidId = (id) => /^[a-f0-9]{8,40}$/.test(id);

async function createProject(meta) {
  const id = newId(10);
  const dir = projectDir(id);
  for (const sub of SUBDIRS) await fs.mkdir(path.join(dir, sub), { recursive: true });
  const project = {
    id,
    name: meta.name || 'Nuovo progetto',
    company: meta.company ?? DEFAULTS.company,
    client: meta.client || '',
    dateLabel: meta.dateLabel || defaultDateLabel(),
    email: meta.email ?? DEFAULTS.email,
    phone: meta.phone ?? DEFAULTS.phone,
    includeGrid: true,
    logo: null,
    createdAt: Date.now(),
    photos: [],
    locations: [],
    output: null,
  };
  await saveProject(project);
  return project;
}

function defaultDateLabel() {
  return new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
}

async function loadProject(id) {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir(id), 'project.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function saveProject(project) {
  const file = path.join(projectDir(project.id), 'project.json');
  await fs.writeFile(file + '.tmp', JSON.stringify(project, null, 2));
  await fs.rename(file + '.tmp', file);
}

async function listProjects() {
  const root = path.join(DATA_DIR, 'projects');
  await fs.mkdir(root, { recursive: true });
  const ids = await fs.readdir(root);
  const projects = [];
  for (const id of ids) {
    const p = await loadProject(id);
    if (p) projects.push({ id: p.id, name: p.name, client: p.client, createdAt: p.createdAt, photos: p.photos.length, locations: p.locations.length });
  }
  return projects.sort((a, b) => b.createdAt - a.createdAt);
}

async function deleteProject(id) {
  if (!isValidId(id)) return;
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

// Serializza le operazioni sullo stesso progetto (upload paralleli, salvataggi).
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(id, next);
  next.finally(() => { if (locks.get(id) === next) locks.delete(id); }).catch(() => {});
  return next;
}

module.exports = { DATA_DIR, DEFAULTS, newId, projectDir, isValidId, createProject, loadProject, saveProject, listProjects, deleteProject, withLock };
