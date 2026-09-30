const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ZipArchive } = require('archiver');
const { projectDir } = require('./storage');
const { locationCenter } = require('./cluster');
const { renderMap } = require('./staticmap');

// Stile ricalcato sul deck "Location Proposals": 16:9, fondo beige, Helvetica.
const W = 960;
const H = 540;
const M = 22;
const BG = '#E3E0D5';
const INK = '#111111';

const NUMBERS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
  'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY'];
const numberWord = (n) => NUMBERS[n] || String(n);

// I font standard PDF coprono solo Latin-1: le lettere accentate fuori set (es. "ő") perdono l'accento.
const pdfText = (s) => String(s || '').replace(/[^\u0000-\u00ff]/g, (c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\u0000-\u00ff]/g, '') || '?')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

const DEFAULT_LOGO = path.join(__dirname, '..', 'assets', 'logo.png');

const slugify = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const zipName = (loc, i) => `${String(i + 1).padStart(2, '0')}-${slugify(loc.name) || 'location'}.zip`;

function locationTitle(loc, i) {
  let t = `LOCATION ${numberWord(i + 1)}`;
  if (loc.name) t += ` - ${loc.name.toUpperCase()}`;
  if (loc.status) t += ` / ${loc.status.toUpperCase()}`;
  return pdfText(t);
}

function zipLocation(project, loc, i, outDir) {
  const dir = projectDir(project.id);
  const byId = new Map(project.photos.map((p) => [p.id, p]));
  const folder = path.basename(zipName(loc, i), '.zip');
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(path.join(outDir, zipName(loc, i)));
    const zip = new ZipArchive({ store: true });
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    loc.photoIds.forEach((id, n) => {
      const p = byId.get(id);
      if (!p) return;
      const ext = path.extname(p.file);
      const base = path.basename(p.originalName || p.file, path.extname(p.originalName || p.file));
      zip.file(path.join(dir, 'originals', p.file), { name: `${folder}/${String(n + 1).padStart(3, '0')}-${base}${ext}` });
    });
    zip.finalize();
  });
}

function buildPdf(project, locations, links, mapJpeg, file) {
  const dir = projectDir(project.id);
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: project.name, Author: project.company } });
  const stream = fs.createWriteStream(file);
  doc.pipe(stream);

  const year = new Date().getFullYear();
  project = { ...project, name: pdfText(project.name), company: pdfText(project.company), client: pdfText(project.client), dateLabel: pdfText(project.dateLabel) };
  const logo = project.logo ? path.join(dir, project.logo) : fs.existsSync(DEFAULT_LOGO) ? DEFAULT_LOGO : null;
  const footerRight = [project.dateLabel, [project.company, project.client].filter(Boolean).join(' - ')].filter(Boolean).join(' / ');

  const page = () => {
    doc.addPage({ size: [W, H], margin: 0 });
    doc.rect(0, 0, W, H).fill(BG);
    doc.fillColor(INK).font('Helvetica').fontSize(7);
    doc.text(`©${year} All rights reserved`, M, H - 20, { lineBreak: false });
    if (footerRight) doc.text(footerRight, W - M - 400, H - 20, { width: 400, align: 'right', lineBreak: false });
  };

  const header = (left, right = []) => {
    doc.fillColor(INK).font('Helvetica').fontSize(7);
    doc.text(left, M + 4, 18, { lineBreak: false });
    // Link in alto a destra, allineati a destra uno dopo l'altro.
    let x = W - M;
    for (const { text, url } of right.slice().reverse()) {
      const w = doc.widthOfString(text);
      x -= w;
      doc.text(text, x, 18, { lineBreak: false, link: url, underline: false });
      x -= 18;
    }
  };

  const coverImage = (imgPath, x, y, w, h) => {
    doc.save();
    doc.rect(x, y, w, h).clip();
    doc.image(imgPath, x, y, { cover: [w, h], align: 'center', valign: 'center' });
    doc.restore();
  };

  const divider = () => {
    page();
    doc.fillColor(INK).font('Helvetica').fontSize(64);
    doc.text('LOCATION', M, H / 2 - 40, { lineBreak: false });
    doc.text('PROPOSALS', W - M - doc.widthOfString('PROPOSALS'), H / 2 - 40, { lineBreak: false });
  };

  // Copertina
  page();
  if (logo) {
    doc.image(logo, W / 2 - 110, H / 2 - 40, { fit: [220, 80], align: 'center', valign: 'center' });
  } else {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(46);
    doc.text(project.company || project.name, M, H / 2 - 26, { width: W - 2 * M, align: 'center' });
  }
  if (logo || project.company) {
    doc.font('Helvetica').fontSize(9).text(project.name.toUpperCase(), M, H / 2 + 62, { width: W - 2 * M, align: 'center' });
  }

  // Mappa con tutti i punti + legenda cliccabile
  if (mapJpeg) {
    page();
    header('MAP / ALL LOCATIONS');
    const mapW = 640;
    coverImage(mapJpeg, M, 40, mapW, H - 80);
    let y = 48;
    const lx = M + mapW + 24;
    const lw = W - M - lx;
    const step = Math.min(24, (H - 100) / Math.max(1, locations.length));
    locations.forEach((loc, i) => {
      doc.circle(lx + 7, y + 6, 7).fill(INK);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7).text(String(i + 1), lx, y + 3.4, { width: 14, align: 'center', lineBreak: false });
      doc.fillColor(INK).font('Helvetica').fontSize(8)
        .text(locationTitle(loc, i).replace(/^LOCATION \w+ - /, ''), lx + 20, y + 2.5, { width: lw - 20, height: 12, ellipsis: true, lineBreak: false });
      doc.goTo(lx, y, lw, 14, `loc-${i}`);
      y += step;
    });
  }

  // Pagine location
  locations.forEach((loc, i) => {
    if (i === 0) divider();

    const byId = new Map(project.photos.map((p) => [p.id, p]));
    const photos = loc.photoIds.map((id) => byId.get(id)).filter(Boolean);
    const cover = byId.get(loc.coverId) || photos[0];
    const center = locationCenter(project, loc);
    const right = [];
    if (center) right.push({ text: 'Open in Maps', url: `https://www.google.com/maps/search/?api=1&query=${center.lat.toFixed(6)},${center.lon.toFixed(6)}` });
    // Unico link "for more": testo in alto a destra, solo se la location ha un URL impostato. Le immagini non sono cliccabili.
    if (links[i]) right.push({ text: 'Click here for more', url: links[i] });

    page();
    doc.addNamedDestination(`loc-${i}`);
    header(locationTitle(loc, i), right);
    if (cover) coverImage(path.join(dir, 'web', `${cover.id}.jpg`), M, 40, W - 2 * M, H - 80);

    // Galleria con tutte le altre foto della location, 6 per pagina.
    const others = photos.filter((p) => p !== cover);
    const PER_PAGE = 6;
    const pages = project.includeGrid ? Math.ceil(others.length / PER_PAGE) : 0;
    for (let pg = 0; pg < pages; pg++) {
      const chunk = others.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);
      page();
      header(`${locationTitle(loc, i)} / GALLERY${pages > 1 ? ` ${pg + 1}/${pages}` : ''}`, right);
      const cols = chunk.length <= 2 ? chunk.length : 3;
      const rows = Math.ceil(chunk.length / cols);
      const gap = 8;
      const cw = (W - 2 * M - gap * (cols - 1)) / cols;
      const ch = (H - 80 - gap * (rows - 1)) / rows;
      chunk.forEach((p, n) => {
        const x = M + (n % cols) * (cw + gap);
        const y = 40 + Math.floor(n / cols) * (ch + gap);
        coverImage(path.join(dir, rows === 1 ? 'web' : 'thumbs', `${p.id}.jpg`), x, y, cw, ch);
      });
    }
  });

  // Chiusura
  page();
  doc.fillColor(INK).font('Helvetica').fontSize(40).text('THANK YOU!', M, H / 2 - 20, { lineBreak: false });
  doc.fontSize(8);
  const contacts = [project.email, project.phone].filter(Boolean);
  contacts.forEach((c, n) => {
    const link = c.includes('@') ? `mailto:${c}` : `tel:${c.replace(/[^+\d]/g, '')}`;
    doc.text(c, W - M - 300, H / 2 - 6 + n * 11, { width: 300, align: 'right', lineBreak: false, link });
  });

  doc.end();
  return new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
}

// Genera gli zip per ogni location (da scaricare dall'app) e il PDF di recap.
// Il PDF non contiene mai link all'app: "Click here for more" compare solo se la location ha un link esterno (Drive, WeTransfer...).
async function buildOutput(project) {
  const outDir = path.join(projectDir(project.id), 'out');
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });

  const locations = project.locations.filter((l) => l.photoIds.length);
  const downloadBase = `/d/${project.id}`;
  const links = locations.map((loc) => loc.link || null);
  for (let i = 0; i < locations.length; i++) await zipLocation(project, locations[i], i, outDir);

  const points = locations
    .map((loc, i) => ({ c: locationCenter(project, loc), label: String(i + 1) }))
    .filter((p) => p.c)
    .map((p) => ({ lat: p.c.lat, lon: p.c.lon, label: p.label }));
  const mapJpeg = points.length ? await renderMap(points, 640, H - 80) : null;
  if (mapJpeg) await fsp.writeFile(path.join(outDir, 'map.jpg'), mapJpeg);

  const pdfName = `${slugify(project.name) || 'recap'}.pdf`;
  await buildPdf(project, locations, links, mapJpeg, path.join(outDir, pdfName));

  return {
    generatedAt: Date.now(),
    pdf: `${downloadBase}/${pdfName}`,
    zips: locations.map((loc, i) => ({ locationId: loc.id, title: locationTitle(loc, i), url: `${downloadBase}/${zipName(loc, i)}`, link: links[i] })),
  };
}

module.exports = { buildOutput };
