const sharp = require('sharp');

// Mappa statica con marker numerati, costruita dai tile OpenStreetMap (desaturati per stare nello stile del deck).
const TILE = 256;
const SCALE = 2; // tile @2x per una stampa nitida
const TILE_URL = process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = process.env.MAP_ATTRIBUTION || '© OpenStreetMap contributors';

const worldX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

function pickZoom(points, width, height, pad) {
  if (points.length === 1) return 16;
  for (let z = 17; z >= 2; z--) {
    const xs = points.map((p) => worldX(p.lon, z));
    const ys = points.map((p) => worldY(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) <= width - 2 * pad && Math.max(...ys) - Math.min(...ys) <= height - 2 * pad) return z;
  }
  return 2;
}

async function fetchTile(z, x, y) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const url = TILE_URL.replace('{z}', z).replace('{x}', ((x % n) + n) % n).replace('{y}', y);
  const res = await fetch(url, { headers: { 'User-Agent': process.env.GEOCODE_USER_AGENT || 'foto-recap/1.0 (uso privato)' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  return sharp(Buffer.from(await res.arrayBuffer()))
    .resize(TILE * SCALE, TILE * SCALE, { kernel: 'lanczos3' })
    .grayscale().linear(0.55, 110).tint('#E3E0D5')
    .png().toBuffer();
}

function markersSvg(markers, w, h, withAttribution) {
  const r = 13 * SCALE;
  const items = markers.map(({ x, y, label }) => `
    <circle cx="${x}" cy="${y}" r="${r}" fill="#111" stroke="#E3E0D5" stroke-width="${2 * SCALE}"/>
    <text x="${x}" y="${y + 4.5 * SCALE}" font-family="Helvetica, Arial, sans-serif" font-size="${13 * SCALE}" font-weight="700" fill="#fff" text-anchor="middle">${label}</text>`).join('');
  const attr = withAttribution
    ? `<text x="${w - 8 * SCALE}" y="${h - 6 * SCALE}" font-family="Helvetica, Arial, sans-serif" font-size="${8 * SCALE}" fill="#555" text-anchor="end">${ATTRIBUTION}</text>`
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${items}${attr}</svg>`);
}

// points: [{lat, lon, label}] ; width/height in punti logici. Restituisce un JPEG.
async function renderMap(points, width, height) {
  const W = Math.round(width * SCALE);
  const H = Math.round(height * SCALE);
  const pad = 40;
  const z = pickZoom(points, width, height, pad);
  const xs = points.map((p) => worldX(p.lon, z));
  const ys = points.map((p) => worldY(p.lat, z));
  const left = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
  const top = (Math.min(...ys) + Math.max(...ys)) / 2 - height / 2;

  const tx0 = Math.floor(left / TILE);
  const ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + width) / TILE);
  const ty1 = Math.floor((top + height) / TILE);
  const canvasW = (tx1 - tx0 + 1) * TILE * SCALE;
  const canvasH = (ty1 - ty0 + 1) * TILE * SCALE;
  const offX = Math.round((left - tx0 * TILE) * SCALE);
  const offY = Math.round((top - ty0 * TILE) * SCALE);

  let base;
  let tilesOk = true;
  try {
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        jobs.push(fetchTile(z, tx, ty).then((input) => input && { input, left: (tx - tx0) * TILE * SCALE, top: (ty - ty0) * TILE * SCALE }));
      }
    }
    const tiles = (await Promise.all(jobs)).filter(Boolean);
    base = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: '#EDEBE4' } })
      .composite(tiles).png().toBuffer();
    base = await sharp(base).extract({ left: offX, top: offY, width: W, height: H }).png().toBuffer();
  } catch {
    // Offline o tile non disponibili: resta la mappa "vuota" con i soli punti nella posizione giusta.
    tilesOk = false;
    base = await sharp({ create: { width: W, height: H, channels: 3, background: '#EDEBE4' } }).png().toBuffer();
  }

  const markers = points.map((p, i) => ({ x: (xs[i] - left) * SCALE, y: (ys[i] - top) * SCALE, label: p.label }));
  return sharp(base)
    .composite([{ input: markersSvg(markers, W, H, tilesOk) }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

module.exports = { renderMap };
