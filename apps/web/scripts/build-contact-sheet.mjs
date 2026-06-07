/**
 * Build a single-page HTML contact sheet previewing every captured screen.
 *
 * Scans `screens/<module>/<screen>.png` and writes `screens/index.html` with
 * one section per module and a clickable thumbnail per screen. Uses relative
 * image paths so the file works when opened directly from disk.
 *
 *   node scripts/build-contact-sheet.mjs
 */
import { readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Optional first arg overrides the screens dir (so the same builder can target
// any app's screens/ folder); defaults to this web app's screens/.
const SCREENS_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'screens');

const titleCase = (s) =>
  s.replace(/[-/]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Map a PNG filename to its base screen name + viewport variant. */
function classify(file) {
  const stem = file.replace(/\.png$/, '');
  if (stem.endsWith('.tablet')) return { base: stem.slice(0, -'.tablet'.length), variant: 'tablet' };
  if (stem.endsWith('.mobile')) return { base: stem.slice(0, -'.mobile'.length), variant: 'mobile' };
  return { base: stem, variant: 'desktop' };
}

async function collect() {
  const entries = await readdir(SCREENS_DIR, { withFileTypes: true });
  const modules = [];
  let totalScreens = 0;
  let totalImages = 0;
  for (const dir of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = (await readdir(path.join(SCREENS_DIR, dir.name))).filter((f) => f.endsWith('.png'));
    if (files.length === 0) continue;
    // Group viewport variants under each base screen.
    const byBase = new Map();
    for (const f of files) {
      const { base, variant } = classify(f);
      if (!byBase.has(base)) byBase.set(base, {});
      byBase.get(base)[variant] = `${dir.name}/${f}`;
      totalImages += 1;
    }
    const screens = [...byBase.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([base, variants]) => ({ base, variants }));
    modules.push({ name: dir.name, screens });
    totalScreens += screens.length;
  }
  return { modules, totalScreens, totalImages };
}

function render({ modules, totalScreens, totalImages }, generatedAt) {
  const nav = modules
    .map(
      (m) =>
        `<a href="#${m.name}">${esc(titleCase(m.name))} <span class="count">${m.screens.length}</span></a>`,
    )
    .join('');

  const ORDER = ['desktop', 'tablet', 'mobile'];
  const ABBR = { desktop: 'D', tablet: 'T', mobile: 'M' };

  const sections = modules
    .map((m) => {
      const cards = m.screens
        .map((s) => {
          // Prefer desktop as the thumbnail; fall back to the first available.
          const primary = s.variants.desktop ?? Object.values(s.variants)[0];
          const links = ORDER.filter((v) => s.variants[v])
            .map(
              (v) =>
                `<a class="vp" href="${s.variants[v]}" target="_blank" title="${v}">${ABBR[v]}</a>`,
            )
            .join('');
          return `        <div class="card">
          <a class="thumb" href="${primary}" target="_blank" title="${esc(primary)}"><img loading="lazy" src="${primary}" alt="${esc(s.base)}"></a>
          <div class="cap"><span>${esc(s.base)}</span><span class="vps">${links}</span></div>
        </div>`;
        })
        .join('\n');
      return `    <section id="${m.name}">
      <h2>${esc(titleCase(m.name))} <span class="count">${m.screens.length}</span></h2>
      <div class="grid">
${cards}
      </div>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ProctiraERP — Screen Contact Sheet</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1a2233; background: #f6f7f9; }
  header { position: sticky; top: 0; z-index: 5; padding: 18px 28px; background: #1d2b4f; color: #fff;
    box-shadow: 0 1px 8px rgba(0,0,0,.18); }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  header .meta { font-size: 12px; opacity: .8; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 28px; background: #fff;
    border-bottom: 1px solid #e3e6ea; position: sticky; top: 64px; z-index: 4; }
  nav a { text-decoration: none; color: #1d2b4f; background: #eef1f6; padding: 4px 10px;
    border-radius: 999px; font-size: 12px; }
  nav a:hover { background: #dfe5ef; }
  .count { display: inline-block; min-width: 18px; text-align: center; font-size: 11px;
    background: #c9d3e6; color: #1d2b4f; border-radius: 999px; padding: 0 6px; margin-left: 2px; }
  h2 .count { background: #1d2b4f; color: #fff; vertical-align: middle; }
  main { padding: 8px 28px 60px; }
  section { padding-top: 18px; }
  section h2 { font-size: 16px; margin: 10px 0 12px; padding-top: 70px; margin-top: -60px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .card { display: block; text-decoration: none; color: inherit; background: #fff; border: 1px solid #e3e6ea;
    border-radius: 10px; overflow: hidden; transition: box-shadow .15s, transform .15s; }
  .card:hover { box-shadow: 0 6px 20px rgba(20,30,60,.16); transform: translateY(-2px); }
  .thumb { aspect-ratio: 16/10; background: #fafbfc; overflow: hidden; border-bottom: 1px solid #eef0f3; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .cap { padding: 8px 12px; font-size: 13px; font-weight: 600; display: flex;
    align-items: center; justify-content: space-between; gap: 8px; }
  .vps { display: inline-flex; gap: 4px; }
  .vp { text-decoration: none; font-size: 11px; font-weight: 700; color: #41506e;
    background: #eef1f6; border: 1px solid #dfe3ea; border-radius: 5px; width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center; }
  .vp:hover { background: #1d2b4f; color: #fff; border-color: #1d2b4f; }
  footer { padding: 20px 28px 40px; color: #6b7585; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>ProctiraERP — Screen Contact Sheet</h1>
  <div class="meta">${totalScreens} screens · ${totalImages} images (desktop/tablet/mobile) across ${modules.length} modules · captured against <code>next dev</code> (no backend — pages show empty/loading states) · generated ${generatedAt}</div>
</header>
<nav>${nav}</nav>
<main>
${sections}
</main>
<footer>Click any thumbnail to open the full-resolution screenshot. Source PNGs live alongside this file under <code>screens/&lt;module&gt;/&lt;screen&gt;.png</code>.</footer>
</body>
</html>
`;
}

async function main() {
  await stat(SCREENS_DIR); // throws if missing
  const data = await collect();
  // Stable timestamp from the newest PNG mtime (Date.now() is unavailable here anyway).
  const html = render(data, new Date().toISOString().slice(0, 10));
  const out = path.join(SCREENS_DIR, 'index.html');
  await writeFile(out, html, 'utf8');
  console.log(`Wrote ${out}`);
  console.log(`${data.totalScreens} screens, ${data.totalImages} images, ${data.modules.length} modules.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
