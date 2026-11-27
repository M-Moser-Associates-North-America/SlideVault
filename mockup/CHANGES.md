# SlideVault v2 mockup: changes from v1

`mockup/SlideVault-v2.html` is a single self-contained file. It has no remote dependencies and works offline: open it by double-clicking. v1 (`reference/SlideVault.html`) is unchanged.

Everything in v2 is sample content. It has 12 fictional decks and 40 generated SVG slides, each marked "SAMPLE". Export, upload, download, AI tag suggestions, member invites and autosave are simulated and labelled as simulated. Draft decks are stored only in this browser's `localStorage`. Use **Prototype controls → Reset sample data** in the footer to restore the starting state before a demo.

## The 11 problems and what changed

| # | Problem in v1 | What v2 does | Where to see it |
|---|---|---|---|
| 1 | No clear flow; the heading changes per screen; no hierarchy or back cues | A fixed top bar that never changes: Home, Library, My decks, Upload, search, Access switcher, theme toggle. The current top-level item is highlighted, including on child screens (a deck highlights Library; a draft highlights My decks). Every inner screen has breadcrumbs. "Back to results" appears when you arrived from Library results. Hash routing makes browser Back and Forward work, including for filter changes. | Any screen. Example: Library → a deck → a slide shows `Library › Deck › Slide 4`. |
| 2 | After the 1-2-3-4 wizard you can't tell where the storyboard went or that it's saved | The wizard is gone. A new deck is created in one step and opens immediately. A toast says "Created. Find it anytime in My decks." The draft has a "Saved just now" indicator labelled as simulated autosave in this browser only. Drafts appear in My decks and in Home → "Continue your draft". | My decks → New deck → Create deck |
| 3 | Clicking a slide preview downloads the file | Every thumbnail opens a lightbox: ← and → move between slides, Esc closes, a counter shows "2 of 4", and focus returns to the thumbnail. Download is a separate, labelled button. It is disabled for Viewers and only shows a "Simulated: no file is produced" toast for others. | Any thumbnail; Deck and Slide detail → "Download …" |
| 4 | Abstract page target up front; no Co-owner role | New deck asks which sections the proposal needs, as a checklist with "Add your own", and how many "Needs a slide" spots each starts with. "Slide limit" is optional and only drives a running counter: it's a guide, not a hard stop. Draft members have Owner, Co-owner, Editor and Viewer roles. | New deck; draft deck → Members panel |
| 5 | Too many terms | The UI uses only **Deck**, **Section** and **Slide**. An empty spot is a "Needs a slide" spot. An automated check found no "tile", "storyboard" or "page(s)" in visible text on any screen at any width (see Verification). | Everywhere |
| 6 | Storyboard name and details look hard-coded | The deck name and section names are inline inputs with a dashed underline and a pencil icon that strengthens on hover and focus. They save as you type, and the indicator shows "Saving…" then "Saved". | Draft deck header and each section header |
| 7 | "Pages" screen is confusing | Removed. Library has a **Slides / Decks** toggle with the same search and filters. | Library |
| 8 | Generic document types | Document type uses the client-relevant list: Past submission, Case study / project profile, Capabilities / About Us, Team bios and resumes, Service-line deck, Reference letter, Diagram or framework, Master deck, Other. It's a Library filter and is required on Upload. | Library filters; Upload form |
| 9 | Nowhere to compare slides | Each slide card has a "Compare" checkbox. A floating "Compare (n)" bar holds 2–4 slides and keeps them across searches; it also says how many aren't in the current results. The Compare screen shows large previews side by side with status, last reviewed, source deck and slide, version, owner, approver, purpose, confidentiality and usage, plus "Add to deck" under each. "Find alternative" in a draft opens the same screen to replace a slide or fill a spot. | Library → tick slides → Compare; draft → "Find alternative" |
| 10 | Plain "Trending assets" home | Home has a search box (no hero), then horizontally scrolling rows: Continue your draft, Recently approved, Canonical: source of truth, Best of the Best, Most used this month, By service line (with tabs), and Needs review (Editor only). Rows scroll by touch, trackpad or ← → buttons, and each has "See all" linking to a pre-filtered Library. Cards show thumbnail, title, content class, status and last reviewed date. | Home |
| 11 | Thin search and filter metadata | Filters for document type, content class, status, service line (marked "to confirm with client"), sector, project type, office/region, year, slide purpose and narrative stage, each with live counts. An active-filter chips bar has "Clear all". Every result has a "Matched: …" line (for example `title, tag "utilisation"`). Detail screens show owner, approver, last reviewed (with "overdue" after 12 months), confidentiality, source deck and slide, version, and usage. Missing values show as "Unknown" or "Not approved yet", never as approved. | Library; Deck and Slide detail |

Also from the brief:
- **"Adding to: [deck] into [section]" bar.** It replaces the old Proposal tray and appears on Home, Library, Deck, Slide and Compare for Editors. While you fill a specific spot it turns orange and says what "Add to deck" will do.
- **Simulated export.** A pre-check lists slide and section counts, empty spots (skipped), retired slides (blocked) and the slide limit. Then come staged progress (no invented percentages), a summary ("10 slides, 6 sections, editable, source preserved") under a "Simulated: no file is produced" banner, and a source table for every slide. There is a designed failure state with Retry, triggered by the "simulate a failure" checkbox.
- **Upload (Editor only).** Sample-scenario picker, Browse button and drop zone (neither reads files), required document type, content class, duplicate dialog (new version / separate deck / view existing / cancel), processing queue with stages, a failure case (.ppt) and "Suggested tags (simulated AI)" with Accept / Dismiss.
- **Designed states.** Library: loading skeleton, search error with Try again, empty library (distinct from no results), and no results with "remove this filter" chips. Upload: loading, service unavailable, field validation, empty queue and failed item. Switch Library and Upload states in Prototype controls.

## Decisions I made and known limitations

**Decisions**
1. **Access tiers come from your brief, marked "Assumed tiers (to confirm)" on the switcher.** Viewer can browse, preview and compare. Reader adds download and export. Editor adds upload, curation and draft editing. Disabled controls stay visible with a tooltip saying why, and clicking them shows the reason as a message.
2. **Two role systems sit side by side.** The **Access** tier is app-wide. Each draft has **member roles**. A Reader opens drafts read-only but can export them. A banner explains why a draft is view-only.
3. **Where "Add to deck" puts a slide.** By default it fills the first "Needs a slide" spot in the chosen section ("First empty spot" means the first section that has one). Otherwise it appends to the section. If the slide is already in the deck, the button shows "In deck". Every add has Undo.
4. **Retired slides can't be added to a deck.** One sample draft deliberately contains a retired slide to show the export block and "Find alternative".
5. **Draft slides can be added; retired ones can't.** Draft slides are visible and show their Draft status. Library search hides Retired items unless you filter for them.
6. **Section names prefill Library filters** when you use "Find in library". For example, Team filters to slide purpose "Introduce team" and Fees to "Quantify economics"; a custom section searches its own name. The filter appears as a removable chip.
7. **Search terms and filters are in the URL hash**, so Back, Forward and "See all" links work. This conflicts with the docs' default (see below).
8. **Moving across sections:** "Move up" on a section's first slide moves it to the end of the previous section. Every slide also has a "Move to…" menu. Drag and drop is an extra route, not the only one.

**Limitations**
- The 360 px Compare screen stacks slides vertically, so it isn't side by side on a phone.
- Home rows rely on horizontal scrolling, with buttons as the keyboard route.
- Library slide results at 360 px make a long single-column scroll.
- Metadata edits ("Edit details"), upload queue items and export runs are kept in memory and reset on reload. Only draft decks persist.
- Sample usage numbers, "Best of the Best" picks and alternative ranking are fixed sample rules, not real data or a model.
- The top bar and the workspace sit in one file. In the real build the shell (navigation, Access switcher, theme) would be separate from the `.slidevault` workspace per the integration contract. Here they are separate elements that share the token root.
- Screen readers will hear "current page" on the active nav item and the last breadcrumb. That's the standard ARIA wording (`aria-current="page"`), not visible text.
- No real PowerPoint is parsed, rendered or produced. Nothing claims editability outside "(simulated)" labels.

## What this design contradicts in the docs (to raise with the client)

1. **Draft decks with sections, spots and members are the Phase 2 storyboard.** The docs put this after the Phase 1 library: PRODUCT_BRIEF "Phase 2 — Manual proposal storyboards", ARCHITECTURE §1, DELIVERY_PLAN "Later phases", ADR-008, D-01, D-10. v2 makes it the main flow, which also matches the client's "Deck creation" ask.
2. **Slide limit replaces the page budget and per-tile allocation** that PR-11 requires: "total page target … per-tile allocations". The tile fields for notes and assignee were also dropped. D-10 needs a decision.
3. **Export skips empty "Needs a slide" spots.** The brief says to "specify what happens to unfilled tiles … before promising storyboard export". Skipping is my assumption.
4. **Home rows.** There's no hero, so DESIGN_SYSTEM's no-hero rule is met. But DESIGN_SYSTEM "Responsive layout" says to use horizontal scrolling only for two-dimensional content. And PRODUCT_BRIEF treats "Recently approved / frequently used" as later ranking work and warns that popularity must not stand in for authority. The row subtitles say so, but "Most used" and "Best of the Best" need real data and a curation owner.
5. **Search text in the URL** conflicts with INTEGRATION_CONTRACT: "Keep sensitive search text out of shared URLs … by default; explicitly define any URL persistence in the UX contract."
6. **The "Pages" view is removed**, but INTEGRATION_CONTRACT's view list is `'home' | 'library' | 'pages' | 'upload' | 'deck' | 'slide'`. v2 also adds compare, my-decks, new, draft and export.
7. **Terminology.** PRODUCT_BRIEF defines "Deck" as a source presentation, with "Selection" and "Storyboard / Tile" for assembled work. v2 uses "Deck" for both library decks and draft decks, and "Section" plus "Needs a slide" instead of tiles. The glossary would need updating.
8. **Access tiers differ from the docs' pilot roles.** SECURITY_AND_OPERATIONS defines Reader, Contributor, Curator and Library administrator, and its "Reader" can export only where explicitly permitted. v2's Viewer/Reader/Editor reuses "Reader" with a different meaning and merges Contributor and Curator into Editor. Draft member roles (Owner, Co-owner, Editor, Viewer) also reuse "Editor" and "Viewer", and shared editing and roles are an open decision (D-10).
9. **The global top bar and role switcher belong to the host shell** under INTEGRATION_CONTRACT, which says fake logins and role switching are dev/test-container only. That's fine for a demo but shouldn't become the feature's own navigation.
10. **Upload removes v1's PDF option and SharePoint import.** This matches the docs (PPTX first; SharePoint is Phase 3), but it's a visible change from v1 the client may notice.

## Verification

Checked with headless Chromium (Playwright) against the file:
- Full flow at 1280 px: Home search → Library results with "Matched:" lines → tick 3 → facet filter → Compare → Add to deck (filled a spot, toast with Undo) → lightbox (arrows, counter, Esc, focus return) → Back to results → browser Back → Open deck → rename a section (autosave indicator) → keyboard Move down (focus stays on the button) → Find in library for a spot (fill bar) → Add → returns to the draft → Find alternative for the retired slide → replace → Export check, progress and summary. There were no JS errors and **no download events** at any point.
- Drag and drop within a section: the item moved and the new position was announced.
- New deck: empty-name validation and focus, custom section, slide limit, toast, persistence after reload, listing in My decks.
- Roles: Viewer and Reader controls are disabled or enabled as described, tooltips show, the Upload denied state appears, drafts are read-only, and Reader can export.
- Upload: validation, duplicate dialog, new-version path, the .ppt failure, the processing queue to "Ready".
- Library states: loading, error, empty library, no results.
- Every screen at 360, 768 and 1280 px: no horizontal page overflow and no banned words in visible text. Dark-theme screenshots were reviewed for Home, Library, Draft and Upload.

Not verified:
- Screen readers (only ARIA structure and live regions are in place).
- Contrast measured with a tool (only checked by eye in both themes).
- Reduced-motion mode (CSS is in place but not exercised).
- Safari, Firefox and Edge.
- Real touch devices.
- 200% zoom.

---

## Round 2 changes (new navigation and numbered flow)

This round supersedes earlier rows where they conflict (for example the three access tiers and the “Adding to” bar).

| Change | What you will see |
| --- | --- |
| Tabs reduced to five, in flow order | **Home, Build, My decks, Library, Upload.** Pages, Storyboard and Archive are gone. Viewers see only Home, My decks and Library. Each tab has a hover/focus tooltip. |
| One numbered flow, always visible | A strip under the header: **1 Name it, 2 Choose sections, 3 Add slides, 4 Arrange and check, 5 Export.** It shows done, current and upcoming steps, a one-line “what to do” and an **If not** line (what to do when stuck). |
| Back and Next buttons | Step strip has **Back: step n** and **Next: step n** (Next is disabled with a reason until a slide is added). The bar under the tabs has **‹ ›** history buttons (disabled with a reason when there is nowhere to go). |
| Breadcrumbs in one place | Drawn once, in the bar under the tabs, on every screen. They show parent and child (for example My decks › Deck name › Export). |
| Build is a guided setup | Step 1 names the deck and **saves it immediately** (it appears in My decks). Step 2 picks sections and an optional slide limit. Step 3 lands in the Library. An unfinished setup shows “Setup unfinished” and **Continue setup** in My decks. |
| Current deck panel | Replaces the “Adding to” bar. A collapsible panel on the right (bottom-right button on small screens) shows the deck, its sections and slides, with move up/down, remove and **Find** on empty spots. Shown to Editors on Home, Library, deck, slide and compare screens. |
| Two access tiers | **Viewer** (browse, preview, compare) and **Editor** (everything else). “Reader” was removed. Draft decks keep their own roles (Owner, Co-owner, Editor, Viewer). |
| Slide previews are empty frames | No generated artwork. Frames keep the 16:9 or 4:3 shape; titles and trust details sit under them. |
| Look matches the original | Large header, underlined tabs, typed headline and pill search on Home. |

### Known limitations and decisions to confirm
- Two access tiers is an assumption taken from the team’s sketch. Confirm it, and where download/export belongs, with the client.
- “Back: step 2” from step 3 re-opens setup only while the deck has no slides. After that, sections are edited in step 4.
- Everything is still simulated: export produces no file, upload reads no file, drafts live only in this browser.
- Tested in Chrome only (desktop 1440, 1280, 1100, 768 and phone 390, 360 widths, no sideways scroll, no console errors). Not tested in Safari or Firefox, with a screen reader, or with real touch input.

### Round 3 (simpler chrome)
- **Header:** the big brand block is on Home only. Other screens use a slim one-line header (logo, search, access, theme) and a tab row that also holds ‹ › and breadcrumbs.
- **Step strip only while building:** it appears after you start a deck (Build step 1, “Add to deck”, opening a deck in My decks) and goes away with **Stop building** or **Finish**. Browsing shows nothing. It is one slim line; **Need help?** opens the step instructions and the “If not” advice.
- **One place for deck state:** the Current deck panel. The “choosing a slide” banner is now a single line.
- **Unfinished decks** now count as in progress: the strip shows step 2 with **Continue step 2**.
- **Library filters:** Document type, Content class and Status are open; the rest sit behind **More filters**.
- The **Draft deck** badge was kept.
- **Step card (round 4):** the step strip is a white rounded card with a tinted current step, shown on Home even when you aren’t building (orientation, with a **Build a deck** button). Elsewhere it appears only while building. Instructions and “If not” advice are visible by default; **Hide tips** collapses them.
- **Persistent steps and panel (round 5):** for Editors the step card now shows on every screen, and the Current deck panel on every browse screen (Home, Library, deck, slide, compare). **Stop building** clears the current deck and returns the card to its “Start here” state. The panel is a floating rounded card with a deck picker, progress bar, “Add into” section picker and **Open deck**; row actions appear on hover or keyboard focus; it collapses to a slim tab.


## SlideVault-v3.html (search-first rescope)

A new file. v2 is untouched. Built from NOTES.md ("Where we are now" and the PRD v2.1 edits), then revised from the team's whiteboard wireframe and design review. Everything is simulated; clients are fictional (Client A to H).

### Layout
- **Header:** brand, Home / Create / Upload tabs (orange underline on the current tab), light/dark toggle, and the Access card with its info (i) inside it.
- **Three columns:**
  - **Left (dimmed orange, full-bleed):** search box and greyed-out voice button, "Try asking" examples marked AI, then Filters. Shown on Home, search and browse pages only.
  - **Middle:** content. Breadcrumbs appear only below the top level (hidden on Home, Create, Upload).
  - **Right (grey, full-bleed):** the cart. Starts as a thin rail ("CART", icon, count), opens by itself when the first slide is ticked, and collapses again from the arrow, icon or word.
- **Create and Upload:** no left column; content is a centred 720px column that stays centred when the cart opens or closes.
- **Deck and slide pages:** no left column; search sits at the top of the content. Slide pages have ‹ › arrows next to "Slide 3 of 6 in this deck".
- **Phone:** the left column stacks above the content with Filters folded; the cart becomes a slim bottom bar.

### Home
- Rows: Best of the Best, Most downloaded, Recently added, Suggested (Editors and Curators), Decks, Browse by client and Browse by year (tiles show decks first, then slides). Row ends fade while more cards are off-screen.
- Cards show a sample slide drawing, title, client, year, content-class dot (Canonical orange, Reusable slate, One-off hollow), "Slide N of deck", and "Also in N other decks".

### Search
- Reads a plain-language request into removable chips (topic, client, year, sector), lists matching slides, and gives each a plain-language **Why it fits** line (rule-based here, AI in the real build).
- Example searches: team intro for a bank pitch, large office move proof, consolidation costs, hybrid work 2022.

### Filters
- Status (Editor and Curator), Content class (with tooltip), Year (Last 2, 5, 10 years + Custom range), Client (search box with dropdown and removable chips), Slide type. The Filters heading does not collapse on desktop.

### Cart, preview, download
- Per-item include tick and remove button; numbered thumbnails; **drag and drop to reorder** (or focus the grip and press Up/Down arrow). Slides preview and download in cart order. Preview and Download. Same deck gives one .pptx; different decks give a zip of one .pptx per deck; Retired slides are skipped. Simulated; no file is created.

### Access tiers
- Viewer sees Approved. Editor adds Suggested and Upload. Curator adds Retired and Approve/Retire. Labels show whether they came from the folder or are AI-suggested.

### Design contract
- Cool-grey page, white cards, soft shadows, 16px cards, 18px search, 44px touch targets, orange for selection and small accents only, near-black primary buttons.

### Not built
- Review labels screen (P1), edit deck and slide details, merging slides from different decks (P1), real voice, Saved row and bookmarks, Create sub-menu (Deck drafts, Create new).
