const fs = require('fs/promises');
const path = require('path');
const exifr = require('exifr');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { newId, projectDir } = require('./storage');

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];

function isHeic(buf, ext) {
  if (ext === '.heic' || ext === '.heif') return true;
  return buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp' && HEIC_BRANDS.includes(buf.toString('ascii', 8, 12));
}

async function readMeta(buf) {
  try {
    const m = (await exifr.parse(buf, { gps: true, tiff: true, exif: true })) || {};
    const date = m.DateTimeOriginal || m.CreateDate || m.ModifyDate;
    return {
      lat: Number.isFinite(m.latitude) ? m.latitude : null,
      lon: Number.isFinite(m.longitude) ? m.longitude : null,
      takenAt: date instanceof Date && !isNaN(date) ? date.getTime() : null,
    };
  } catch {
    return { lat: null, lon: null, takenAt: null };
  }
}

// Salva l'originale, legge GPS e data, genera una versione web (per il PDF) e una miniatura.
async function ingestFile(projectId, file, lastModified) {
  const dir = projectDir(projectId);
  const id = newId(6);
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
  const stored = `${id}${ext}`;
  await fs.rename(file.path, path.join(dir, 'originals', stored));
  const buf = await fs.readFile(path.join(dir, 'originals', stored));

  const meta = await readMeta(buf);
  const decodable = isHeic(buf, ext)
    ? Buffer.from(await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.92 }))
    : buf;

  const img = sharp(decodable, { failOn: 'none' }).rotate();
  await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(dir, 'web', `${id}.jpg`));
  await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 }).toFile(path.join(dir, 'thumbs', `${id}.jpg`));

  return {
    id,
    file: stored,
    originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
    lat: meta.lat,
    lon: meta.lon,
    takenAt: meta.takenAt ?? (Number(lastModified) || null),
    timeFromExif: meta.takenAt != null,
  };
}

async function removePhotoFiles(projectId, photo) {
  const dir = projectDir(projectId);
  await Promise.all([
    fs.rm(path.join(dir, 'originals', photo.file), { force: true }),
    fs.rm(path.join(dir, 'web', `${photo.id}.jpg`), { force: true }),
    fs.rm(path.join(dir, 'thumbs', `${photo.id}.jpg`), { force: true }),
  ]);
}

module.exports = { ingestFile, removePhotoFiles };
