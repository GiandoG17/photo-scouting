// Suggerisce un nome per la location via OpenStreetMap Nominatim (max 1 richiesta al secondo).
// Disattivabile con GEOCODE=off: in quel caso le coordinate non escono dal server.
const ENABLED = (process.env.GEOCODE || 'on') !== 'off';
const UA = process.env.GEOCODE_USER_AGENT || 'foto-recap/1.0 (uso privato)';

let lastCall = 0;

// Scarta "nomi" che sono codici (es. "1_33051") e prende il primo candidato leggibile.
const pickName = (...candidates) => candidates.find((c) => c && /\p{L}{2}/u.test(c) && !/_/.test(c)) || '';

async function reverseGeocode({ lat, lon }) {
  if (!ENABLED) return '';
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=it&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return '';
    const data = await res.json();
    const a = data.address || {};
    return pickName(data.name, a.square, a.pedestrian, a.road, a.park, a.neighbourhood, a.quarter, a.suburb, a.city);
  } catch {
    return '';
  }
}

// Da indirizzo a coordinate. Restituisce { lat, lon, label, name } oppure null.
async function forwardGeocode(query) {
  if (!ENABLED) return null;
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&accept-language=it&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('Servizio indirizzi non raggiungibile, riprova tra poco');
  const [hit] = await res.json();
  if (!hit) return null;
  const a = hit.address || {};
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    label: hit.display_name.split(',').slice(0, 3).join(',').trim(),
    name: pickName(hit.name, a.square, a.pedestrian, a.road, a.park),
  };
}

module.exports = { reverseGeocode, forwardGeocode, GEOCODE_ENABLED: ENABLED };
