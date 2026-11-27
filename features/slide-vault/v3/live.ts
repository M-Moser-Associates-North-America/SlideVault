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
 *  5. Upload: a real .pptx picked on the Upload screen posts to POST /uploads; on success the
 *     live library is re-fetched so the new deck appears immediately, no reload needed.
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
  /* Exposed so a real upload (inside V3's own script, a separate scope) can re-run the
     same conversion after POST /uploads succeeds, instead of duplicating this logic. */
  window.SV_TO_V3 = toV3;
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

/**
 * Inside V3's own script: a real upload, which replaces the simulated "pick a sample" flow
 * when live data is on. Re-uses the Upload screen's existing queue UI (UP_STAGES, queueHTML,
 * S.uploads) -- only how an item gets added and finished changes.
 */
const LIVE_UPLOAD = `/* LIVE DATA: real upload (features/slide-vault/v3/live.ts) */
function viewUploadLive() {
  if (!can('upload')) return '<div class="sv-wrap">' + stateBlock('lock', 'Only Editors and Curators can upload', 'Switch Access in the top right to try it.', '<a class="btn" href="#/">Back to Home</a>') + '</div>';
  return '<div class="sv-wrap upload-wrap"><h1 class="h1" tabindex="-1">Upload</h1><p class="lede muted" style="margin-top:4px">Add a deck. SlideVault stores it unchanged, splits it into slides and makes thumbnails. AI-suggested labels come once a provider is approved.</p>' +
    '<div class="dropzone" style="margin-top:14px"><label for="sv-live-file" style="cursor:pointer;display:block">' + ic('upload', 'ic-big') + '<p style="margin:8px 0 4px"><strong>Click to choose a .pptx file</strong></p><p class="meta">This uploads for real.</p></label><input type="file" id="sv-live-file" accept=".pptx" style="margin-top:10px" onchange="if (this.files[0]) liveUploadFile(this.files[0]); this.value = &#39;&#39;;"></div>' +
    '<h2 class="h2" style="margin:24px 0 10px">Queue</h2><ul class="queue" id="queue">' + queueHTML() + '</ul></div>';
}
/* Inline onchange runs in global scope, not this closure -- expose it so the handler can find it. */
window.liveUploadFile = liveUploadFile;
function liveUploadFile(file) {
  var u = { id: 'up' + (++S.uploadN), name: file.name.replace(/\\.pptx$/i, ''), step: 0, done: false };
  S.uploads.push(u);
  var q = $('#queue'); if (q) q.innerHTML = queueHTML();
  var t = setInterval(function () { if (u.step < UP_STAGES.length - 1) { u.step++; var q2 = $('#queue'); if (q2) q2.innerHTML = queueHTML(); } }, 500);
  var form = new FormData(); form.append('file', file);
  fetch('${API}/uploads', { method: 'POST', body: form })
    .then(function (res) { return res.json().then(function (body) {
      if (!res.ok) throw new Error(body && body.error ? body.error.message : 'The upload could not be processed. Please try again.');
      return body.data;
    }); })
    .then(function (deck) {
      return fetch('${API}/library?source=upload', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Library request failed (' + r.status + ')')); })
        .then(function (body) {
          var live = window.SV_TO_V3(body.data);
          DECKS = live.decks; SLIDES = live.slides; DUPG = live.dupg; reindex();
          clearInterval(t); u.done = true; u.step = UP_STAGES.length; u.deckId = deck.id; u.n = deck.slideCount;
          var q3 = $('#queue'); if (q3) q3.innerHTML = queueHTML();
          var noteEl = document.querySelector('.sv-live-note'); if (noteEl) noteEl.textContent = 'Live data: ' + DECKS.length + ' decks, ' + SLIDES.length + ' slides';
          toast('Upload finished. ' + plural(u.n, 'slide') + ' added.', { label: 'Open deck', href: '#/deck/' + deck.id });
        });
    })
    .catch(function (e) {
      clearInterval(t); u.done = true; u.error = e.message;
      var q4 = $('#queue'); if (q4) q4.innerHTML = queueHTML();
      toast(e.message);
    });
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
  {
    name: 'real upload',
    find: 'function viewUpload() {\n',
    replace: (m) => LIVE_UPLOAD + m + '  if (window.SV_LIVE) return viewUploadLive();\n',
  },
  {
    name: 'upload queue shows a real error',
    // A chained ternary ("cond1 ? a : cond2 ? b : c" === "cond1 ? a : (cond2 ? b : c)"), not a
    // wrapped one -- needs no closing paren the single-anchor replace can't reach further down.
    find: `(u.done ? '<p class="meta" style="margin-top:8px">'`,
    replace: (m) => `(u.error ? '<p class="meta" style="margin-top:8px;color:var(--sv-danger)">' + esc(u.error) + '</p>' : ${m.slice(1)}`,
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
