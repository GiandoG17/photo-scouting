const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.querySelector(s);
const STATUSES = [['', 'Stato: nessuno'], ['AVAILABLE', 'Available'], ['TBC', 'TBC'], ['NOT AVAILABLE', 'Not available']];
const BATCH = 8;

let project = null;
const selected = new Set();

async function api(path, opts = {}) {
  return apiFetch(`/api/projects/${id}${path}`, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
  });
}

function setProject(p) {
  project = p;
  for (const sid of [...selected]) if (!p.photos.some((ph) => ph.id === sid)) selected.delete(sid);
  render();
}

// ---- salvataggio automatico ----
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}
async function save() {
  clearTimeout(saveTimer);
  const body = { locations: project.locations };
  for (const el of document.querySelectorAll('[data-meta]')) body[el.dataset.meta] = el.type === 'checkbox' ? el.checked : el.value;
  const sent = project.locations;
  const p = await api('', { method: 'PUT', body: JSON.stringify(body) });
  // I campi a video restano legati agli oggetti location locali: se la struttura non è cambiata
  // si copiano solo i dati calcolati dal server, così le modifiche fatte nel frattempo non si perdono.
  const same = sent === project.locations && p.locations.length === sent.length
    && p.locations.every((l, i) => !sent[i].id || l.id === sent[i].id);
  if (same) {
    p.locations.forEach((l, i) => Object.assign(sent[i], { id: l.id, center: l.center, coverId: l.coverId }));
    project = { ...p, locations: sent };
  } else {
    project = p;
    render();
  }
  $('#title').textContent = p.name;
}

// ---- rendering ----
function render() {
  $('#title').textContent = project.name;
  document.title = project.name;
  for (const el of document.querySelectorAll('[data-meta]')) {
    if (document.activeElement === el) continue;
    if (el.type === 'checkbox') el.checked = !!project[el.dataset.meta];
    else el.value = project[el.dataset.meta] || '';
  }
  $('#logoPreview').hidden = $('#logoDel').hidden = !project.logo;
  if (project.logo) $('#logoPreview').src = `/files/${id}/logo.png?${Date.now()}`;

  const byId = new Map(project.photos.map((p) => [p.id, p]));
  const box = $('#locations');
  box.innerHTML = '';
  if (!project.locations.length) box.innerHTML = '<p class="muted">Nessuna foto ancora.</p>';

  project.locations.forEach((loc, i) => {
    const card = document.createElement('div');
    card.className = 'card loc-card';
    card.dataset.locId = loc.id;
    card.innerHTML = `
      <div class="loc-head">
        <div class="loc-num">${i + 1}</div>
        <input class="name" placeholder="Nome location (es. Piazza Duomo)">
        <select class="status">${STATUSES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        <input class="link" type="url" inputmode="url" placeholder="Link foto per il cliente (Drive, WeTransfer...)">
        <div class="row arrows">
          <button class="small up" title="Sposta su">↑</button>
          <button class="small down" title="Sposta giù">↓</button>
        </div>
      </div>
      <div class="loc-pos"></div>
      <div class="loc-meta muted"><button class="small select-all">Seleziona tutte</button> <span></span></div>
      <div class="thumbs"></div>`;
    const name = card.querySelector('.name');
    name.value = loc.name;
    name.oninput = () => { loc.name = name.value; scheduleSave(); };
    const status = card.querySelector('.status');
    status.value = loc.status;
    status.onchange = () => { loc.status = status.value; scheduleSave(); };
    const link = card.querySelector('.link');
    link.value = loc.link || '';
    link.oninput = () => { loc.link = link.value.trim(); scheduleSave(); };
    card.querySelector('.up').disabled = i === 0;
    card.querySelector('.down').disabled = i === project.locations.length - 1;
    card.querySelector('.up').onclick = () => moveLocation(i, -1);
    card.querySelector('.down').onclick = () => moveLocation(i, 1);

    card.querySelector('.select-all').onclick = () => {
      const all = loc.photoIds.every((pid) => selected.has(pid));
      loc.photoIds.forEach((pid) => (all ? selected.delete(pid) : selected.add(pid)));
      render();
    };

    const meta = card.querySelector('.loc-meta span');
    const photos = loc.photoIds.map((pid) => byId.get(pid)).filter(Boolean);
    const times = photos.map((p) => p.takenAt).filter(Boolean);
    meta.textContent = `${photos.length} foto`;
    if (times.length) meta.textContent += ` · ${fmtTime(Math.min(...times))}`;
    renderPosition(card.querySelector('.loc-pos'), loc, photos);

    const grid = card.querySelector('.thumbs');
    for (const p of photos) {
      const t = document.createElement('div');
      t.className = 'thumb' + (selected.has(p.id) ? ' selected' : '');
      t.dataset.photoId = p.id;
      t.innerHTML = `<img loading="lazy" draggable="false" src="/files/${id}/thumbs/${p.id}.jpg" alt="">`;
      if (p.id === loc.coverId) t.insertAdjacentHTML('beforeend', '<span class="badge">COPERTINA</span>');
      if (p.lat == null) t.insertAdjacentHTML('beforeend', '<span class="nogps">no GPS</span>');
      t.title = `${p.originalName}${p.takenAt ? ' · ' + fmtTime(p.takenAt) : ''}`;
      t.onclick = () => { if (drag.justDropped) return; selected.has(p.id) ? selected.delete(p.id) : selected.add(p.id); t.classList.toggle('selected'); renderActionbar(); };
      grid.appendChild(t);
    }
    box.appendChild(card);
  });


  renderActionbar();
  renderOutput();
}

// Riga posizione: da GPS delle foto, inserita a mano (indirizzo, coordinate, link Google Maps) o assente.
function renderPosition(box, loc, photos) {
  const gps = photos.some((p) => p.lat != null);
  const mapsUrl = loc.center && `https://www.google.com/maps/search/?api=1&query=${loc.center.lat},${loc.center.lon}`;
  let text;
  if (loc.manual) text = `Posizione: <strong>${escapeHtml(loc.manual.label)}</strong> <small>(inserita a mano)</small>`;
  else if (gps) text = 'Posizione: <strong>dal GPS delle foto</strong>';
  else text = '<strong>Nessuna posizione</strong> <small>(foto senza GPS): inseriscila per averla in mappa</small>';
  box.innerHTML = `
    <div class="row pos-view">
      <span>${text}</span>
      ${mapsUrl ? `<a href="${mapsUrl}" target="_blank">vedi su mappa</a>` : ''}
      <button class="link-btn pos-edit">${loc.manual ? 'Modifica' : gps ? 'Correggi' : ''}</button>
      ${loc.manual ? `<button class="link-btn pos-clear">${gps ? 'Usa GPS delle foto' : 'Rimuovi'}</button>` : ''}
    </div>
    <form class="row pos-form" ${loc.center ? 'hidden' : ''} novalidate>
      <input class="pos-input" placeholder="Indirizzo, coordinate o link Google Maps (es. Piazza Fontana, Milano)">
      <button class="small primary" type="submit">Imposta</button>
      ${loc.center ? '<button class="small pos-cancel" type="button">Annulla</button>' : ''}
    </form>`;
  const form = box.querySelector('.pos-form');
  const input = box.querySelector('.pos-input');
  const editBtn = box.querySelector('.pos-edit');
  editBtn.hidden = !editBtn.textContent;
  editBtn.onclick = () => { form.hidden = false; input.value = loc.manual?.label || ''; input.focus(); input.select(); };
  box.querySelector('.pos-cancel')?.addEventListener('click', () => { form.hidden = true; });
  box.querySelector('.pos-clear')?.addEventListener('click', () => setPosition(loc, ''));
  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return appAlert({ title: 'Posizione vuota', message: 'Scrivi un indirizzo (es. "Piazza Fontana, Milano"), delle coordinate (es. "45.4636, 9.1959") oppure incolla un link di Google Maps.' });
    setPosition(loc, q, form.querySelector('[type=submit]'));
  };
}

async function setPosition(loc, query, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Cerco...'; }
  try {
    await save();
    setProject(await api(`/locations/${loc.id}/position`, { method: 'POST', body: JSON.stringify({ query }) }));
  } catch (err) {
    appAlert({ title: 'Posizione non trovata', message: err.message });
    if (btn) { btn.disabled = false; btn.textContent = 'Imposta'; }
  }
}

function renderActionbar() {
  $('#actionbar').classList.toggle('show', selected.size > 0);
  $('#selCount').textContent = `${selected.size} selezionate`;
  $('#coverBtn').disabled = selected.size !== 1;
  const opts = project.locations.map((l, i) => `<option value="${l.id}">${i + 1}. ${escapeHtml(l.name || 'Location ' + (i + 1))}</option>`);
  $('#moveTarget').innerHTML = opts.join('') + '<option value="new">+ Nuova location</option>';
}

function renderOutput() {
  const out = project.output;
  const box = $('#output');
  if (!out) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <p><small>Generato il ${new Date(out.generatedAt).toLocaleString('it-IT')}</small></p>
    <p><a class="btn primary" href="${out.pdf}" target="_blank">Scarica il PDF</a></p>
    <p class="muted">Zip con gli originali, da caricare su Drive/WeTransfer: incolla il link nella location e nel PDF compare "Click here for more".</p>
    <ul>${out.zips.map((z) => `<li><a href="${z.url}">${escapeHtml(z.title)}</a>${z.link ? ' · <small>nel PDF linka a</small> <a href="' + escapeHtml(z.link) + '" target="_blank">' + escapeHtml(z.link) + '</a>' : ' · <small>nessun link nel PDF</small>'}</li>`).join('')}</ul>`;
}

const fmtTime = (ms) => new Date(ms).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- azioni sulle location ----
function moveLocation(i, dir) {
  const [loc] = project.locations.splice(i, 1);
  project.locations.splice(i + dir, 0, loc);
  render();
  save();
}

// Sposta foto in una location esistente (id) oppure in una nuova ('new').
async function movePhotos(ids, target) {
  const moving = new Set(ids);
  const dest0 = project.locations.find((l) => l.id === target);
  if (dest0 && ids.every((pid) => dest0.photoIds.includes(pid))) return; // già lì
  for (const l of project.locations) l.photoIds = l.photoIds.filter((pid) => !moving.has(pid));
  let dest = project.locations.find((l) => l.id === target);
  if (!dest) {
    dest = { id: '', name: '', status: '', photoIds: [], coverId: null };
    project.locations.push(dest);
  }
  dest.photoIds.push(...ids);
  project.locations = project.locations.filter((l) => l.photoIds.length);
  for (const pid of ids) selected.delete(pid);
  render();
  await save();
  render();
}

$('#moveBtn').onclick = () => movePhotos([...selected], $('#moveTarget').value);

$('#coverBtn').onclick = async () => {
  const [pid] = selected;
  const loc = project.locations.find((l) => l.photoIds.includes(pid));
  if (loc) loc.coverId = pid;
  selected.clear();
  await save();
  render();
};

$('#deleteBtn').onclick = async () => {
  const n = selected.size;
  if (!(await appConfirm({ title: `Eliminare ${n} foto?`, message: 'Le foto vengono cancellate dal server insieme a zip e PDF già generati.', confirmText: 'Elimina', danger: true }))) return;
  const p = await api('/photos/delete', { method: 'POST', body: JSON.stringify({ photoIds: [...selected] }) });
  selected.clear();
  setProject(p);
};

$('#deleteAllPhotos').onclick = async () => {
  if (!project.photos.length) return;
  if (!(await appConfirm({ title: 'Eliminare tutte le foto?', message: `Verranno cancellate tutte le ${project.photos.length} foto, con zip e PDF generati. Il progetto resta.`, confirmText: 'Elimina tutte', danger: true }))) return;
  selected.clear();
  setProject(await api('/photos/delete', { method: 'POST', body: JSON.stringify({ photoIds: project.photos.map((p) => p.id) }) }));
};

$('#deleteProject').onclick = async () => {
  if (!(await appConfirm({ title: 'Eliminare il progetto?', message: `"${project.name}" verrà cancellato definitivamente con tutte le foto, gli zip e il PDF.`, confirmText: 'Elimina progetto', danger: true }))) return;
  await api('', { method: 'DELETE' });
  location.href = '/';
};

$('#clearSel').onclick = () => { selected.clear(); render(); };

$('#recluster').onclick = async () => {
  if (!(await appConfirm({ title: 'Riraggruppare tutto?', message: 'Le location vengono ricreate da zero: nomi, stati e link attuali verranno persi.', confirmText: 'Riraggruppa' }))) return;
  $('#recluster').disabled = true;
  try { setProject(await api('/recluster', { method: 'POST' })); } finally { $('#recluster').disabled = false; }
};

for (const el of document.querySelectorAll('[data-meta]')) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', scheduleSave);

// ---- upload ----
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;
// Tiene solo le foto: scarta file nascosti e di sistema (.DS_Store, ._IMG... di macOS) e tutto ciò che non è immagine.
const isPhoto = (f) => {
  const rel = f.webkitRelativePath || f.relativePath || f.name;
  if (rel.split('/').some((part) => part.startsWith('.'))) return false;
  return IMAGE_EXT.test(f.name) || (f.type.startsWith('image/') && !/svg|gif/.test(f.type));
};

// Legge ricorsivamente le cartelle trascinate nella dropzone.
async function filesFromEntry(entry, prefix = '') {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((f) => { f.relativePath = prefix + f.name; resolve([f]); }, () => resolve([])));
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const entries = [];
  // readEntries restituisce i file a blocchi: va richiamato finché non torna vuoto.
  for (;;) {
    const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map((e) => filesFromEntry(e, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function uploadFiles(input, { fromFolder = false } = {}) {
  const all = [...input];
  const files = all.filter(isPhoto).sort((a, b) => (a.webkitRelativePath || a.relativePath || a.name).localeCompare(b.webkitRelativePath || b.relativePath || b.name));
  if (!files.length) {
    if (all.length || fromFolder) appAlert({ title: 'Nessuna foto trovata', message: fromFolder ? 'La cartella (e le sue sottocartelle) non contiene foto JPG, PNG o HEIC.' : 'I file selezionati non sono foto.' });
    return;
  }
  let found = '';
  if (fromFolder) {
    const folders = new Set(files.map((f) => (f.webkitRelativePath || f.relativePath || '').split('/').slice(0, -1).join('/')));
    found = `Trovate ${files.length} foto in ${folders.size} ${folders.size === 1 ? 'cartella' : 'cartelle'}. `;
  }
  const bar = $('#progress');
  bar.style.display = 'block';
  let done = 0;
  const failed = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    $('#progressText').textContent = `${found}Caricamento ${done}/${files.length}...`;
    const fd = new FormData();
    chunk.forEach((f) => fd.append('photos', f, f.name));
    fd.append('lastModified', JSON.stringify(chunk.map((f) => f.lastModified)));
    try {
      const r = await api('/photos', { method: 'POST', body: fd });
      failed.push(...r.failed);
      setProject(r.project);
    } catch (err) {
      failed.push(...chunk.map((f) => f.name));
    }
    done += chunk.length;
    bar.firstElementChild.style.width = `${(done / files.length) * 100}%`;
  }
  const withGps = project.photos.filter((p) => p.lat != null).length;
  $('#progressText').textContent = `${found}${done - failed.length} foto caricate` +
    (failed.length ? `, ${failed.length} non riuscite (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '...' : ''})` : '') +
    (withGps < project.photos.length ? `. ${project.photos.length - withGps} senza GPS: raggruppate per orario.` : '');
  setTimeout(() => { bar.style.display = 'none'; bar.firstElementChild.style.width = 0; }, 800);
  if (failed.length) {
    appAlert({ title: `${failed.length} foto non caricate`, message: `Non sono riuscito a leggere: ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''}.\nProva a ricaricarle.` });
  }
}

$('#pickFiles').onclick = () => $('#fileInput').click();
$('#pickFolder').onclick = () => $('#folderInput').click();
$('#fileInput').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; uploadFiles(f); };
$('#folderInput').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; uploadFiles(f, { fromFolder: true }); };
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const entries = [...e.dataTransfer.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return uploadFiles(e.dataTransfer.files);
  const hasFolder = entries.some((en) => en.isDirectory);
  $('#progressText').textContent = hasFolder ? 'Cerco le foto nelle cartelle...' : '';
  const files = (await Promise.all(entries.map((en) => filesFromEntry(en)))).flat();
  uploadFiles(files, { fromFolder: hasFolder });
});

// ---- logo ----
$('#logoBtn').onclick = (e) => { e.preventDefault(); $('#logoInput').click(); };
$('#logoInput').onchange = async (e) => {
  const fd = new FormData();
  fd.append('logo', e.target.files[0]);
  setProject(await api('/logo', { method: 'POST', body: fd }));
};
$('#logoDel').onclick = async (e) => { e.preventDefault(); setProject(await api('/logo', { method: 'DELETE' })); };

// ---- generazione ----
$('#generate').onclick = async () => {
  const btn = $('#generate');
  btn.disabled = true;
  $('#genStatus').textContent = 'Preparo zip, mappa e PDF...';
  try {
    await save();
    setProject(await api('/generate', { method: 'POST' }));
    $('#genStatus').textContent = '';
  } catch (err) {
    $('#genStatus').textContent = '';
    appAlert({ title: 'PDF non generato', message: err.message });
  } finally {
    btn.disabled = false;
  }
};


// ---- drag & drop delle foto tra le location ----
// Mouse: trascini direttamente. Touch: tieni premuto ~0,4 s e poi trascini (così lo scroll resta libero).
// Se la foto trascinata è selezionata, si spostano tutte le selezionate.
const drag = { active: false, justDropped: false, ids: [], ghost: null, target: null, timer: null, start: null, scrollRaf: null, lastY: 0 };

function dragBegin(thumb, x, y) {
  const pid = thumb.dataset.photoId;
  drag.ids = selected.has(pid) ? [...selected] : [pid];
  drag.active = true;
  document.body.classList.add('dragging');
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `<img src="${thumb.querySelector('img').src}" alt="">${drag.ids.length > 1 ? `<span>${drag.ids.length}</span>` : ''}`;
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  document.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('drag-src', drag.ids.includes(t.dataset.photoId)));
  const zone = document.createElement('div');
  zone.className = 'card drop-new';
  zone.dataset.locId = 'new';
  zone.textContent = '+ Rilascia qui per creare una nuova location';
  $('#locations').appendChild(zone);
  navigator.vibrate?.(15);
  dragMove(x, y);
}

function dragMove(x, y) {
  drag.lastY = y;
  drag.ghost.style.transform = `translate(${x - 40}px, ${y - 40}px)`;
  const el = document.elementFromPoint(x, y);
  const target = el?.closest('[data-loc-id]') || null;
  if (target !== drag.target) {
    drag.target?.classList.remove('drop-over');
    target?.classList.add('drop-over');
    drag.target = target;
  }
  if (!drag.scrollRaf) autoScroll();
}

// Scorre la pagina quando trascini vicino al bordo alto o basso.
function autoScroll() {
  if (!drag.active) { drag.scrollRaf = null; return; }
  const edge = 70;
  const h = window.innerHeight;
  const dy = drag.lastY < edge ? -(edge - drag.lastY) / 4 : drag.lastY > h - edge ? (drag.lastY - (h - edge)) / 4 : 0;
  if (dy) window.scrollBy(0, dy);
  drag.scrollRaf = requestAnimationFrame(autoScroll);
}

function dragEnd(drop) {
  clearTimeout(drag.timer);
  drag.start = null;
  if (!drag.active) return;
  const target = drag.target?.dataset.locId;
  drag.active = false;
  drag.ghost?.remove();
  drag.target?.classList.remove('drop-over');
  drag.target = null;
  document.body.classList.remove('dragging');
  document.querySelector('.drop-new')?.remove();
  document.querySelectorAll('.drag-src').forEach((t) => t.classList.remove('drag-src'));
  // Evita che il click che segue il rilascio selezioni/deselezioni la foto.
  drag.justDropped = true;
  setTimeout(() => { drag.justDropped = false; }, 50);
  if (drop && target) movePhotos(drag.ids, target);
}

// Mouse
document.addEventListener('mousedown', (e) => {
  const thumb = e.button === 0 && e.target.closest('.thumb');
  if (thumb) drag.start = { thumb, x: e.clientX, y: e.clientY };
});
document.addEventListener('mousemove', (e) => {
  if (drag.active) return dragMove(e.clientX, e.clientY);
  if (drag.start && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) > 6) {
    e.preventDefault();
    dragBegin(drag.start.thumb, e.clientX, e.clientY);
  }
});
document.addEventListener('mouseup', () => dragEnd(true));

// Touch
document.addEventListener('touchstart', (e) => {
  const thumb = e.touches.length === 1 && e.target.closest('.thumb');
  if (!thumb) return;
  const t = e.touches[0];
  drag.start = { thumb, x: t.clientX, y: t.clientY };
  drag.timer = setTimeout(() => { if (drag.start) dragBegin(thumb, drag.start.x, drag.start.y); }, 400);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (drag.active) {
    e.preventDefault(); // blocca lo scroll mentre trascini
    return dragMove(t.clientX, t.clientY);
  }
  // Ti sei mosso prima della pressione lunga: è uno scroll, non un trascinamento.
  if (drag.start && Math.hypot(t.clientX - drag.start.x, t.clientY - drag.start.y) > 10) {
    clearTimeout(drag.timer);
    drag.start = null;
  }
}, { passive: false });
document.addEventListener('touchend', (e) => { if (drag.active) e.preventDefault(); dragEnd(true); }, { passive: false });
document.addEventListener('touchcancel', () => dragEnd(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag.active) dragEnd(false); });

(async () => {
  try { setProject(await api('')); } catch (err) { document.body.innerHTML = `<p>Progetto non trovato. <a href="/">Torna ai progetti</a></p>`; }
})();
