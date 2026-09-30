const { newId } = require('./storage');

const RADIUS_M = Number(process.env.CLUSTER_RADIUS_M) || 150;
const GAP_MIN = Number(process.env.CLUSTER_GAP_MIN) || 30;

const hasGps = (p) => p.lat != null && p.lon != null;

function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function centroid(photos) {
  const pts = photos.filter(hasGps);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length,
  };
}

const newLocation = () => ({ id: newId(6), name: '', status: '', photoIds: [], coverId: null });

// Assegna le foto indicate alle location esistenti o ne crea di nuove.
// Con GPS: la location con centro entro RADIUS_M. Senza GPS: la foto scattata più vicina nel tempo (entro GAP_MIN).
function assignPhotos(project, photoIds) {
  const byId = new Map(project.photos.map((p) => [p.id, p]));
  const incoming = photoIds.map((id) => byId.get(id)).filter(Boolean)
    .sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  const groups = project.locations.map((loc) => ({ loc, photos: loc.photoIds.map((id) => byId.get(id)).filter(Boolean) }));
  const created = [];

  const createGroup = () => {
    const g = { loc: newLocation(), photos: [] };
    groups.push(g);
    created.push(g.loc);
    return g;
  };
  const add = (g, p) => { g.photos.push(p); g.loc.photoIds.push(p.id); };

  for (const p of incoming.filter(hasGps)) {
    let best = null;
    let bestD = Infinity;
    for (const g of groups) {
      const c = g.loc.manual || centroid(g.photos);
      if (!c) continue;
      const d = distanceM(p, c);
      if (d < bestD) { bestD = d; best = g; }
    }
    add(best && bestD <= RADIUS_M ? best : createGroup(), p);
  }

  for (const p of incoming.filter((x) => !hasGps(x))) {
    let best = null;
    let bestGap = Infinity;
    if (p.takenAt != null) {
      for (const g of groups) {
        for (const q of g.photos) {
          if (q.takenAt == null) continue;
          const gap = Math.abs(q.takenAt - p.takenAt);
          if (gap < bestGap) { bestGap = gap; best = g; }
        }
      }
    }
    add(best && bestGap <= GAP_MIN * 60000 ? best : createGroup(), p);
  }

  // Le nuove location vanno in coda, in ordine cronologico di scatto.
  const firstShot = (loc) => Math.min(...loc.photoIds.map((id) => byId.get(id)?.takenAt ?? Infinity));
  created.sort((a, b) => firstShot(a) - firstShot(b));
  project.locations.push(...created);
  for (const loc of project.locations) {
    loc.photoIds.sort((a, b) => (byId.get(a)?.takenAt ?? 0) - (byId.get(b)?.takenAt ?? 0));
    if (!loc.coverId || !loc.photoIds.includes(loc.coverId)) loc.coverId = loc.photoIds[0] || null;
  }
  return created;
}

// La posizione inserita a mano vince su quella calcolata dal GPS delle foto.
function locationCenter(project, loc) {
  if (loc.manual) return { lat: loc.manual.lat, lon: loc.manual.lon };
  const byId = new Map(project.photos.map((p) => [p.id, p]));
  return centroid(loc.photoIds.map((id) => byId.get(id)).filter(Boolean));
}

const validLatLon = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// Riconosce coordinate scritte a mano ("45.4636, 9.1959") o dentro un link di Google Maps (".../@45.46,9.19,17z", "?q=45.46,9.19").
function parseCoords(text) {
  const m = String(text).match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m || !/\./.test(m[1] + m[2])) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return validLatLon(lat, lon) ? { lat, lon } : null;
}

module.exports = { assignPhotos, locationCenter, distanceM, parseCoords, validLatLon };
