/**
 * Runs Khushali's approved V3 design (SlideVault-v3.html, kept byte-for-byte as she wrote it)
 * on the real library. The file is served at /v3 with a few small, clearly marked additions:
 *
 *  1. A loader fetches GET /api/slide-vault/v1/library and turns it into V3's own deck and
 *     slide lists before V3 starts. If that fails or the library is empty, V3 runs on its
 *     built-in samples and says so, so the page is never blank. ?data=sample forces samples.
 *  2. Thumbnails: real slide previews instead of V3's drawn placeholders.
 *  3. "Also in N other decks": real duplicate groups (server/duplicates.ts).
 *  4. Download in the cart: the real export (one .pptx, or a .zip of one .pptx per deck).
 *
 * Everything the backend doesn't have yet (approval status, content class, usage counts,
 * slide types, AI search) keeps V3's simple defaults or simulated behaviour, which V3 already
 * labels as simulated. Each anchor below must match V3's text exactly; scripts/test-v3-live.mts
 * fails if a future edit to V3 moves one, and the page then falls back to V3 unchanged.
 */

const API = '/api/slide-vault/v1';

/** Runs in the browser before V3: fetch the library and convert it to V3's data shapes. */
const LOADER = `<script>
/* LIVE DATA loader (added by the app: features/slide-vault/v3/live.ts) */
(function () {
  var API = ${JSON.stringify(API)};
  function start() {
    var src = document.getElementById('sv-v3-app');
    var s = document.createElement('script');
    s.textContent = src.textContent;
    document.body.appendChild(s);
  }
  function note(text) {
    var el = document.createElement('div');
    el.className = 'sv-live-note';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
  }
  function toV3(data) {
    var deckById = {};
    var decks = data.decks.map(function (d) {
      var client = d.client || 'Unknown client';
      var where = [d.bestOfTheBest ? 'Best of the Best' : null, d.year, d.category].filter(Boolean).join(' · ');
      var v = { id: d.id, title: d.title, client: client, docType: 'Past submission', cls: 'Reusable', status: 'Approved',
        service: 'Unknown', sector: 'Unknown', ptype: null, office: 'Unknown', year: d.year || 'Unknown',
        owner: null, approver: null, reviewed: null, conf: null, version: 'v1', pal: 0, used: 0, usedMonth: 0, lastUsed: null,
        tags: d.category ? [d.category.toLowerCase()] : [],
        summary: 'Uploaded deck' + (where ? ' (' + where + ')' : '') + '. Slide types and tags come with AI tagging.',
        versionId: d.versionId, slideSize: d.slideSize };
      deckById[d.id] = v;
      return v;
    });
    var dupg = {};
    var slides = data.slides.filter(function (s) { return deckById[s.deckId]; }).map(function (s) {
      var d = deckById[s.deckId];
      if (s.duplicateGroupId) dupg[s.id] = s.duplicateGroupId;
      var o = { id: s.id, deckId: s.deckId, pos: s.slideNumber, title: s.title, purpose: 'Unknown', stage: 'Proposal', layout: 'bullets',
        tags: d.tags.slice(), text: s.text, usedMonth: 0, used: 0, featured: data.decks.some(function (x) { return x.id === s.deckId && x.bestOfTheBest; }),
        img: API + s.previewPath, versionId: d.versionId };
      if (d.slideSize === '4:3') o.ratio = '4:3';
      return o;
    });
    return { decks: decks, slides: slides, dupg: dupg };
  }
  var params = new URLSearchParams(location.search);
  if (params.get('data') === 'sample') { start(); note('Sample data'); return; }
  fetch(API + '/library' + (params.get('data') === 'all' ? '' : '?source=upload'), { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Library request failed (' + r.status + ')')); })
    .then(function (body) {
      var live = toV3(body.data);
      if (!live.slides.length) throw new Error('The library is empty');
      window.SV_LIVE = live;
      start();
      note('Live data: ' + live.decks.length + ' decks, ' + live.slides.length + ' slides');
    })
    .catch(function (e) {
      console.warn('SlideVault V3: live data unavailable, showing samples.', e);
      start();
      note('Sample data (live data unavailable)');
    });
})();
</script>`;

const STYLE = `<style>
/* LIVE DATA additions (features/slide-vault/v3/live.ts) */
img.sv-live-thumb { display: block; width: 100%; height: 100%; object-fit: contain; background: #fff; }
.big-preview img.sv-live-thumb { height: auto; }
.sv-live-note { position: fixed; left: 12px; bottom: 12px; z-index: 50; padding: 4px 10px; border-radius: 999px;
  background: rgba(20, 20, 20, 0.85); color: #fff; font: 600 12px/1.6 system-ui, sans-serif; pointer-events: none; }
</style>`;

/** Inside V3's own script: the live download, which replaces the simulated one when live data is on. */
const LIVE_DOWNLOAD = `/* LIVE DATA: real download (features/slide-vault/v3/live.ts) */
function liveDownload(ids) {
  var p = dlPlan(ids);
  if (!p.ok.length) { toast('Retired slides can’t be downloaded.'); return; }
  DLG.p = p; DLG.live = true; DLG.fileName = ''; DLG.step = 1; renderDL(); clearInterval(DLG.timer);
  DLG.timer = setInterval(function () { if (DLG.step < DL_STEPS.length - 1) { DLG.step++; renderDL(); } }, 650);
  fetch('${API}/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'pptx', fidelityPolicy: 'preserve-source', items: p.ok.map(function (id) { return { slideId: id, sourceVersionId: SLIDE_MAP[id].versionId }; }) }) })
    .then(function (res) {
      if (!res.ok) return res.json().catch(function () { return null; }).then(function (b) { throw new Error(b && b.error ? b.error.message : 'The download could not be built. Please try again.'); });
      var m = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      DLG.fileName = m ? m[1] : (p.zip ? 'SlideVault-export.zip' : 'SlideVault-export.pptx');
      return res.blob();
    })
    .then(function (blob) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = DLG.fileName;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
      clearInterval(DLG.timer); DLG.step = DL_STEPS.length; renderDL();
    })
    .catch(function (e) { clearInterval(DLG.timer); closeDialog(); toast(e.message); });
}
`;

type Patch = { name: string; find: string | RegExp; replace: (match: string) => string };

const PATCHES: Patch[] = [
  {
    name: 'hold V3 until the data is loaded',
    find: '<script>\n(function () {',
    replace: () => '<script type="text/plain" id="sv-v3-app">\n(function () {',
  },
  {
    name: 'swap in the live decks, slides and duplicate groups',
    find: /var DUPG = \{[^\n]*\};\n/,
    replace: (m) => m + "/* LIVE DATA (features/slide-vault/v3/live.ts) */\nif (window.SV_LIVE) { DECKS = window.SV_LIVE.decks; SLIDES = window.SV_LIVE.slides; DUPG = window.SV_LIVE.dupg; }\n",
  },
  {
    name: 'real thumbnails',
    find: 'function thumbSVG(id) {\n',
    replace: (m) => m + "  /* LIVE DATA: real preview image */ if (SLIDE_MAP[id] && SLIDE_MAP[id].img) return '<img class=\"sv-live-thumb\" src=\"' + esc(SLIDE_MAP[id].img) + '\" alt=\"\" loading=\"lazy\">';\n",
  },
  {
    name: 'real download',
    find: 'function openDownload(ids) {\n',
    replace: (m) => LIVE_DOWNLOAD + m + '  if (window.SV_LIVE) return liveDownload(ids);\n',
  },
  {
    name: 'download dialog says what was saved',
    find: `'<p class="meta" style="margin-top:10px">Simulated: no file is created. Real files hold only the slides you picked.</p>'`,
    replace: (m) => `(DLG.live ? '<p class="meta" style="margin-top:10px">Saved <strong>' + esc(DLG.fileName) + '</strong> to your Downloads. It holds only the slides you picked, and they stay editable.</p>' : ${m})`,
  },
  { name: 'loader and styles', find: '</body>', replace: (m) => STYLE + '\n' + LOADER + '\n' + m },
];

/** Apply the additions. If any anchor is missing, return V3 unchanged (it then runs on samples). */
export function liveV3Page(original: string): { html: string; missing: string[] } {
  let html = original;
  const missing: string[] = [];
  for (const p of PATCHES) {
    const found = typeof p.find === 'string' ? html.includes(p.find) : p.find.test(html);
    if (!found) {
      missing.push(p.name);
      continue;
    }
    html = typeof p.find === 'string' ? html.replace(p.find, () => p.replace(p.find as string)) : html.replace(p.find, (m) => p.replace(m));
  }
  return missing.length ? { html: original, missing } : { html, missing };
}
