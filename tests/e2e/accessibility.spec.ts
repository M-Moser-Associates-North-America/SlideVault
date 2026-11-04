/**
 * Accessibility acceptance (docs/DESIGN_SYSTEM.md, "Accessibility acceptance"; target WCAG 2.2 AA).
 *
 * Automated checks only. The design doc also asks for a manual screen-reader pass through the
 * primary workflow; that is recorded separately (docs/foundry/ACCESSIBILITY.md).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const card = (page: Page, title: string) => page.locator('article.card').filter({ has: page.getByRole('link', { name: title, exact: true }) });

async function openHome(page: Page) {
  await page.goto('/slide-vault/pages');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await expect(page.locator('.row').first()).toBeVisible();
}

/** Search for a word so slide cards are on screen (Home shows deck rows when decks have no year or collection). */
async function openResults(page: Page, text = 'services') {
  await openHome(page);
  await searchFor(page, text);
}

/** Type a word and wait for results. The draft deck keeps its slides between searches. */
async function searchFor(page: Page, text: string) {
  await page.getByLabel('Search slides').fill(text);
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
}

// Colors animate briefly on state changes; measure settled colors (reduced motion makes transitions instant).
async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { violations } = await new AxeBuilder({ page }).include('.slidevault').withTags(WCAG_TAGS).analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s)`);
}

// The API rate-limits per caller (FD-17: 60 searches a minute, keyed on X-Forwarded-For). The whole
// suite runs from one address in under a minute, so give each test its own documentation-range
// address and its own limit; otherwise the last tests see "Too many requests" instead of the app.
let caller = 0;

test.beforeEach(async ({ page }) => {
  caller += 1;
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(caller % 250) + 1}` });
  await page.goto('/slide-vault/pages');
  await page.evaluate(() => {
    localStorage.clear();
    // The placeholder sign-in gates the app (SlideVaultWorkspace.tsx). Most of this suite is
    // about the app behind it, so sign in a demo profile here; the sign-in screen itself gets
    // its own accessibility test below.
    localStorage.setItem('slidevault:profile', 'Avery Walsh');
    // The quick tour starts by itself on a first sign-in and dims the page; mark it seen so these
    // tests reach the app. The tour gets its own test below.
    localStorage.setItem('slidevault:tip:tour', '1');
  });
});

test('no WCAG 2.2 AA violations on Home, light and dark', async ({ page }) => {
  await openHome(page);
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Dark mode' }).click();
  await expect(page.locator('.slidevault').first()).toHaveAttribute('data-theme', 'dark');
  expect(await axe(page)).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`no WCAG 2.2 AA violations, ${theme} theme, results with a cart`, async ({ page }) => {
    await openResults(page, 'services');
    await page.getByLabel('Add to draft deck: Services').check({ force: true });
    // The first selection expands the slide-selection panel (grid-template-columns transition,
    // --sv-duration = 220ms), which moves every card below it on this page's now-longer layout.
    // Wait for the state change, then the transition itself, or the next force-click's
    // coordinates go stale mid-animation and can land on nothing.
    await expect(page.locator('.cart-h .count')).toHaveText('1');
    await page.waitForTimeout(220);
    await searchFor(page, 'leadership');
    await page.getByLabel('Add to draft deck: Leadership team').check({ force: true });
    await expect(page.locator('.cart-h .count')).toHaveText('2');
    await page.evaluate((t) => document.querySelectorAll('.slidevault').forEach((el) => el.setAttribute('data-theme', t)), theme);
    expect(await axe(page)).toEqual([]);
  });
}

test('no violations on the deck page, slide page, Create and Upload', async ({ page }) => {
  await openResults(page, 'services');
  await card(page, 'Services').getByRole('link', { name: 'Services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Services', level: 1 })).toBeVisible();
  await expect(page.locator('.slide-text')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('link', { name: 'Open deck' }).click();
  await expect(page.getByRole('button', { name: 'Download whole deck' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Create', level: 1 })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('no violations in the preview and download dialogs, empty results and the download error state', async ({ page }) => {
  await openResults(page, 'leadership');
  await page.getByRole('button', { name: 'Preview: Leadership team' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByLabel('Search slides').fill('zzqq');
  await expect(page.getByText(/No slides found matching/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Clear search' }).first().click();

  await page.route('**/api/slide-vault/v1/exports', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'EXPORT_FAILED', message: 'The export could not be built. Please try again.', retryable: true }, requestId: 't' }) }),
  );
  await page.getByLabel('Search slides').fill('services');
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
  await page.getByLabel('Add to draft deck: Services').check({ force: true });
  await page.getByRole('button', { name: 'Download as pptx' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Your draft deck is unchanged');
  expect(await axe(page)).toEqual([]);
});

test('every interactive element shows a 2px solid focus outline', async ({ page }) => {
  await openResults(page, 'leadership');
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const own = cs.outlineStyle === 'solid' ? { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) } : null;
      // A visually hidden checkbox draws its ring on the label's box (.fchip, .pick).
      const sibling = el.matches('input[type="checkbox"]') ? el.nextElementSibling : null;
      const ring = sibling ? getComputedStyle(sibling) : null;
      const via = ring && ring.outlineStyle === 'solid' ? { style: ring.outlineStyle, width: parseFloat(ring.outlineWidth) } : null;
      const name = (el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 40);
      return { name, ...(own ?? via ?? { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }) };
    });
    if (!focus || seen.has(focus.name)) continue;
    seen.add(focus.name);
    expect(focus, `focus indicator on "${focus.name}"`).toMatchObject({ style: 'solid', width: 2 });
  }
  expect(seen.size).toBeGreaterThan(10);
});

test('targets are at least 24×24 CSS px', async ({ page }) => {
  await openResults(page, 'services');
  await page.getByLabel('Add to draft deck: Services').check({ force: true });
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.slidevault button, .slidevault input, .slidevault select')]
      .filter((e) => !(e as HTMLElement).hidden)
      .map((e) => ({ name: (e.getAttribute('aria-label') || e.textContent || e.id).trim(), ...e.getBoundingClientRect().toJSON() }))
      .filter((r) => r.width && (r.width < 24 || r.height < 24))
      .map((r) => `${r.name} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});

test('primary workflow works with the keyboard alone', async ({ page }) => {
  await openHome(page);

  // Search, then tick three slides with Space. Each is found with its own search; the draft deck keeps them.
  await page.getByLabel('Search slides').focus();
  await page.keyboard.type('northwind');
  await expect(page.getByText(/^\d+ slides? from \d+ decks?/)).toBeVisible();
  for (const [word, title] of [['northwind', 'Northwind Studio'], ['services', 'Services'], ['leadership', 'Leadership team']]) {
    await searchFor(page, word);
    await page.getByLabel(`Add to draft deck: ${title}`, { exact: true }).focus();
    await page.keyboard.press('Space');
  }
  await expect(page.locator('.cart-items li')).toHaveCount(3);

  // Reorder with the arrow keys on the grip; focus stays on the same grip
  const grip = page.getByRole('button', { name: /^Reorder: Leadership team/ });
  const order = () => page.locator('.cart-items li .ci-txt a').allTextContents();
  const before = await order();
  const at = before.indexOf('Leadership team');
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  const after = await order();
  expect(after.indexOf('Leadership team')).toBe(at - 1);
  await expect(page.getByRole('button', { name: /^Reorder: Leadership team/ })).toBeFocused();

  // Download with Enter
  await page.getByRole('button', { name: 'Download as pptx' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true }).focus();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  // With the broader smart search, these three titles can now span multiple decks,
  // which correctly downloads as a zip (one file per deck) instead of a single .pptx.
  expect((await download).suggestedFilename()).toMatch(/^SlideVault-export\.(pptx|zip)$/);
});

test('preview: focus moves into the dialog and returns to the opener on Escape', async ({ page }) => {
  await openResults(page, 'services');
  const opener = page.getByRole('button', { name: 'Preview: Services' });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('one banner, one main, one h1; no skipped heading levels', async ({ page }) => {
  await openResults(page, 'leadership');
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  expect(levels.every((level, i) => i === 0 || level - levels[i - 1] <= 1)).toBe(true);
});

test('reflows without sideways scrolling at 320 px (400% zoom)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openResults(page, 'leadership');
  expect(await page.evaluate(() => document.querySelector('.sv-scroll')!.scrollWidth)).toBeLessThanOrEqual(320);
});

test('reduced motion turns transitions off', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/slide-vault/pages');
  await page.evaluate(() => localStorage.setItem('slidevault:profile', 'Avery Walsh'));
  await openHome(page);
  const duration = await page.locator('.slidevault button').first().evaluate((b) => getComputedStyle(b).transitionDuration);
  expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  await context.close();
});

test('no WCAG 2.2 AA violations on the sign-in screen; Sign in goes straight to Home', async ({ page }) => {
  // This suite's beforeEach signs in a demo profile for every other test; start logged out here.
  await page.evaluate(() => localStorage.removeItem('slidevault:profile'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // The sign-in is a placeholder for M Moser's login: the fields start empty and Sign in works as it is.
  await expect(page.getByLabel('Email address')).toHaveValue('');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
});

test('combining slides from several decks asks the server for one file, and shows its fallback note', async ({ page }) => {
  // The real export counts downloads in the database, so a stand-in answers here and the request is inspected.
  const requests: { combine?: boolean; items: unknown[] }[] = [];
  await page.route('**/api/slide-vault/v1/exports', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="SlideVault-export.zip"',
        'X-SlideVault-Export-Note': 'These decks use different slide sizes, so you got a zip with one file per deck instead.',
      },
      body: 'stand-in',
    });
  });
  await openHome(page);
  // One slide from the Northwind deck and one from a different deck.
  await searchFor(page, 'services');
  await page.getByLabel('Add to draft deck: Services', { exact: true }).check({ force: true });
  await searchFor(page, 'approach');
  await page.getByLabel('Add to draft deck: Our approach', { exact: true }).first().check({ force: true });
  const option = page.getByLabel('Combine into one deck').first();
  await expect(option).toBeVisible();
  // Combining starts ticked (FD-74); unticking it gives the zip, ticking it again gives one file.
  await expect(option).toBeChecked();
  await expect(page.locator('.cart-foot')).toContainText('one editable .pptx');
  await option.uncheck();
  await expect(page.locator('.cart-foot')).toContainText('a zip, one .pptx per deck');
  await option.check();
  await expect(page.locator('.cart-foot')).toContainText('one editable .pptx');
  await page.getByRole('button', { name: 'Download as pptx' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Combine into one deck')).toBeChecked();
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('different slide sizes');
  expect(requests).toHaveLength(1);
  expect(requests[0].combine).toBe(true);
});

test('upload: see the slides, tag the deck and a slide, confirm, and everything is sent together', async ({ page }) => {
  // Stand-ins answer the upload, the library and the tag routes so nothing is stored; the requests are inspected.
  const tagPosts: { on: string; id: string; tag: string }[] = [];
  let uploadBody = '';
  await page.route('**/api/slide-vault/v1/tags', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { data: [{ tag: 'Healthcare', slides: 40, decks: 6 }, { tag: 'Workplace strategy', slides: 22, decks: 4 }] } });
      return;
    }
    const body = route.request().postDataJSON();
    tagPosts.push(body);
    await route.fulfill({ json: { data: { id: `t${tagPosts.length}`, tag: body.tag } } });
  });
  let uploads = 0;
  await page.route('**/api/slide-vault/v1/uploads', async (route) => {
    uploads += 1;
    uploadBody = route.request().postData() ?? '';
    await route.fulfill({ json: { data: { id: 'deck-new', title: 'Harbor Bank HQ proposal', status: 'ready', error: null, slideCount: 4 } } });
  });
  await page.route('**/api/slide-vault/v1/search?*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('hidden') !== 'include') return route.continue();
    const data = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, provenance: { sourceId: 'deck-new', slideNumber: n } }));
    await route.fulfill({ json: { data, page: { nextCursor: null } } });
  });
  await openHome(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Upload' }).click();
  await expect(page.getByRole('heading', { name: 'Upload', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload deck' })).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/harbor-bank-proposal.pptx');
  // The slides appear below the deck details, one card each, before anything is sent.
  await expect(page.locator('.upcard')).toHaveCount(4);
  expect(uploads).toBe(0);
  // The fixture names no client or year the page can read, so they are typed in (the page asks for both).
  await page.getByRole('textbox', { name: 'Client' }).fill('Harbor Bank');
  // Year takes only digits, four at most, in any browser: letters and extra digits are dropped as they are typed.
  const yearBox = page.getByRole('textbox', { name: 'Year' });
  await yearBox.pressSequentially('20a2-5x67');
  await expect(yearBox).toHaveValue('2025');
  const idd = page.getByRole('button', { name: 'IDD', exact: true });
  await idd.click();
  await expect(idd).toHaveAttribute('aria-pressed', 'true');
  const deckBox = page.getByRole('combobox', { name: /Deck tags/ });
  await deckBox.fill('health');
  await expect(page.getByRole('option', { name: /Healthcare/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await deckBox.press('ArrowDown');
  await deckBox.press('ArrowDown');
  await deckBox.press('Enter');
  await deckBox.fill('healthcare');
  await deckBox.press('Enter'); // already added, ignoring capital letters
  await expect(page.locator('.tagfield-chips').first().locator('.tagchip')).toHaveText(['Healthcare']);
  // One slide on its own, and two slides together.
  await page.locator('.upcard').nth(0).getByRole('button', { name: 'Tags for slide 1' }).click(); // "+ Add tag" opens the box
  const first = page.locator('.upcard').nth(0).getByRole('combobox');
  await first.pressSequentially('Pilot,'); // a comma ends a tag, like Enter
  await page.getByLabel(/Select slide 3/).click({ force: true });
  await page.getByLabel(/Select slide 4/).click({ force: true });
  await page.locator('.upgrid-bulk').getByRole('button', { name: /Add a tag to 2 selected slides/ }).click();
  await page.locator('.upgrid-bulk').getByRole('combobox').pressSequentially('Wellbeing,');
  await page.getByRole('button', { name: 'Done' }).click();
  expect(await axe(page)).toEqual([]);
  // Nothing is sent until the pop-up is confirmed.
  await page.getByRole('button', { name: 'Upload deck' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Upload this deck?' })).toBeVisible();
  await expect(dialog).toContainText('Deck tags: Healthcare');
  await expect(dialog).toContainText('3 tags on 3 slides');
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Upload deck' }).click();
  await dialog.getByRole('button', { name: 'Upload deck' }).click();
  await expect(page.getByText('Tags added: 1 deck tag and 3 slide tags.')).toBeVisible();
  expect(uploads).toBe(1);
  expect(tagPosts).toEqual([
    { on: 'deck', id: 'deck-new', tag: 'Healthcare' },
    { on: 'slide', id: 's1', tag: 'Pilot' },
    { on: 'slide', id: 's3', tag: 'Wellbeing' },
    { on: 'slide', id: 's4', tag: 'Wellbeing' },
  ]);
  expect(uploadBody).toContain('IDD');
  expect(await axe(page)).toEqual([]);
});

test('phones: tabs along the bottom, the draft deck opens from the last tab, nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openResults(page, 'leadership');
  const tabs = page.locator('.sv-bottombar');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('link')).toHaveText(['Home', 'Create', 'Upload', 'My decks']);
  await expect(page.locator('.sv-nav')).toBeHidden();
  expect(await page.evaluate(() => document.querySelector('.sv-scroll')!.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await axe(page)).toEqual([]);

  await page.getByLabel('Add to draft deck: Leadership team').check({ force: true });
  const deck = tabs.getByRole('button', { name: /Draft deck, 1 slide/ });
  // The first slide added to an empty draft deck opens it by itself, so the person sees it land.
  await expect(page.getByRole('region', { name: 'Draft deck' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Draft deck' })).toBeHidden();
  await expect(deck).toBeFocused();
  // The last tab opens it again.
  await deck.click();
  await expect(page.getByRole('region', { name: 'Draft deck' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Draft deck' })).toBeHidden();
});

// Deck sections (FD-57, FD-80). The sample decks have no section dividers, so the server's answers are stood in
// with real slides from the library: three slides of one deck are "the Case studies section".
test('sections: type a section, open it, see it framed in the deck strip, add it all; and browse it with the Section filter', async ({ page }) => {
  await openHome(page);
  // A deck the app really lists (near-identical copies of a deck are listed once): the deck of the first result for "services".
  const deck = await page.evaluate(async () => {
    const api = '/api/slide-vault/v1';
    const sourceId = (await (await fetch(`${api}/smart-search?q=services&limit=5`)).json()).data.items[0].slide.provenance.sourceId as string;
    const mine: { id: string; provenance: { sourceId: string; slideNumber: number } }[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: typeof mine; page: { nextCursor: string | null } } = await (await fetch(`${api}/search?kind=slide&limit=1000&duplicates=all${cursor ? `&cursor=${cursor}` : ''}`)).json();
      mine.push(...page.data.filter((s) => s.provenance.sourceId === sourceId));
      cursor = page.page.nextCursor;
    } while (cursor);
    return mine.sort((a, b) => a.provenance.slideNumber - b.provenance.slideNumber);
  });
  expect(deck.length).toBeGreaterThanOrEqual(5);
  const inSection = deck.slice(1, 4).map((s, i) => ({ ...s, section: { name: 'Case studies', kind: 'case-studies', divider: i === 0, dividerId: 'div-1' } }));
  await page.route('**/api/slide-vault/v1/smart-search?*', (route) =>
    route.fulfill({ json: { data: { query: 'case studies', reader: 'stand-in', readerNote: null, plan: {}, chips: [], relaxed: false, sections: ['case-studies'], items: inSection.map((slide) => ({ slide, why: '', matched: [] })) } } }),
  );
  await page.route('**/api/slide-vault/v1/sections/div-1', (route) => route.fulfill({ json: { data: { name: 'Case studies', kind: 'case-studies', slides: inSection } } }));
  await page.route('**/api/slide-vault/v1/sections?kind=case-studies', (route) =>
    route.fulfill({ json: { data: [{ dividerId: 'div-1', name: 'Case studies', kind: 'case-studies', slideCount: 3, cover: inSection[0] }] } }),
  );

  // Typing a section name shows its card by itself, no pill needed.
  await page.getByLabel('Search slides').fill('case studies');
  const sectionCard = page.locator('.seccard');
  await expect(sectionCard).toHaveCount(1);
  await expect(sectionCard).toContainText('3 slides in this section');
  expect(await axe(page)).toEqual([]);

  // Open the section: counted "1 of 3 in section", the whole deck in the strip with the section in one frame.
  await sectionCard.getByRole('button', { name: 'Open section' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.lb-results .counter')).toContainText('1 of 3 in section');
  await expect(dialog.locator('.lb-frame')).toHaveCount(1);
  await expect(dialog.locator('.lb-frame .lb-thumb')).toHaveCount(3);
  expect(await dialog.locator('.lb-thumb').count()).toBe(deck.length);
  // The arrows walk the whole deck, past the section, and the counter says so.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.lb-results .counter')).toContainText('Not in the Case studies section');
  await dialog.getByRole('button', { name: 'Back to the section' }).click();
  await expect(dialog.locator('.lb-results .counter')).toContainText('1 of 3 in section');
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');

  // Add all three slides to the draft deck in one go; the card says so and can take them out again.
  await sectionCard.getByRole('button', { name: 'Add all 3 to draft deck' }).click();
  await expect(sectionCard.getByRole('button', { name: /In draft deck/ })).toBeVisible();
  await sectionCard.getByRole('button', { name: /In draft deck/ }).click();
  await expect(sectionCard.getByRole('button', { name: 'Add all 3 to draft deck' })).toBeVisible();

  // Without a search: the Section filter lists that kind of section from every deck.
  await page.getByLabel('Search slides').fill('');
  await page.locator('[data-key="section"]').click();
  await page.getByRole('checkbox', { name: /Case studies/ }).click();
  await expect(page.getByRole('heading', { name: 'Case studies', level: 2 })).toBeVisible();
  await expect(page.locator('.seccard')).toHaveCount(1);
  expect(await axe(page)).toEqual([]);
});

test('Useful / Not relevant: remembered after a reload, changing your mind takes the old click back, nothing is sent twice', async ({ page }) => {
  const sent: { verdict: string; undo?: boolean; slideId: string }[] = [];
  await page.route('**/api/slide-vault/v1/smart-search/feedback', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { saved: true } } });
  });
  await openResults(page);
  const first = page.locator('article.card').first();
  const useful = first.getByRole('button', { name: 'Useful for this search', exact: true });
  const notRelevant = first.getByRole('button', { name: 'Not useful for this search' });

  await useful.click();
  await expect(useful).toHaveAttribute('aria-pressed', 'true');
  // The toast and the screen reader's announcement both say it (one or both may be there yet): either shows it was told.
  await expect(page.getByText('Thanks. Search will use this for similar searches.').first()).toBeVisible();
  expect(sent.map((s) => `${s.verdict}${s.undo ? ' undo' : ''}`)).toEqual(['useful']);

  // A reload forgets the page but not the answer: the arrow is still lit, and answering the same again sends nothing new.
  await openResults(page);
  const again = page.locator('article.card').first();
  await expect(again.getByRole('button', { name: 'Useful for this search', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(sent).toHaveLength(1);

  // Changing your mind takes the Useful back, then sends Not relevant.
  await again.getByRole('button', { name: 'Not useful for this search' }).click();
  await expect(again.getByRole('button', { name: 'Not useful for this search' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sent.length).toBe(3);
  expect(sent.slice(1).map((s) => `${s.verdict}${s.undo ? ' undo' : ''}`).sort()).toEqual(['not-relevant', 'useful undo']);

  // Clicking the lit arrow again just takes it back.
  await again.getByRole('button', { name: 'Not useful for this search' }).click();
  await expect(again.getByRole('button', { name: 'Not useful for this search' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => sent.length).toBe(4);
  expect(`${sent[3].verdict}${sent[3].undo ? ' undo' : ''}`).toBe('not-relevant undo');

  // Not a second time on the same arrow, and a different search starts clean.
  await searchFor(page, 'team');
  await expect(page.locator('article.card').first().getByRole('button', { name: 'Not useful for this search' })).toHaveAttribute('aria-pressed', 'false');
  expect(sent).toHaveLength(4);
});

test('Personalize: turning it on or off is confirmed on a card, not only a toast', async ({ page }) => {
  let on = false;
  await page.route('**/api/slide-vault/v1/me/activity', async (route) => {
    if (route.request().method() === 'PATCH') on = route.request().postDataJSON().optedIn;
    await route.fulfill({ json: { data: { optedIn: on, retentionDays: 90, entries: [] } } });
  });
  // The one-time question after sign-in would be in the way: mark it answered.
  await page.evaluate(() => localStorage.setItem('slidevault:tip:activity-ask', '1'));
  await page.goto('/slide-vault/settings');
  const box = page.getByLabel(/Use my activity to personalize/);
  await box.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Personalize my Vault?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(dialog.getByRole('heading', { name: 'Personalization is on' })).toBeVisible();
  await expect(dialog).toContainText('Kept 90 days');
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(box).toBeChecked();

  await box.click();
  await dialog.getByRole('button', { name: 'Turn off and delete my history' }).click();
  await expect(dialog.getByRole('heading', { name: 'Personalization is off' })).toBeVisible();
  await expect(dialog).toContainText('Your history was deleted');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(box).not.toBeChecked();
});

test('Home search: the clear cross is there as soon as there is text, without hovering, and clears it', async ({ page }) => {
  await openHome(page);
  const box = page.getByLabel('Search slides');
  const clear = page.getByRole('button', { name: 'Clear search' });
  await expect(clear).toBeHidden();
  await box.fill('services');
  await page.mouse.move(5, 5); // nowhere near the search box
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(clear).toBeHidden();

  // The slim search that stays after scrolling has its own cross too.
  await page.setViewportSize({ width: 1280, height: 520 });
  await box.fill('services');
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
  await page.mouse.move(400, 400); // over the results, so the wheel scrolls them
  await page.mouse.wheel(0, 900);
  const slim = page.locator('.fb-search');
  await expect(slim).toBeVisible();
  await expect(slim.getByRole('button', { name: 'Clear search' })).toBeVisible();
});

test("the team's labels: a card shows the two most relevant and +N for the rest; the preview shows them all", async ({ page }) => {
  await page.route('**/api/slide-vault/v1/smart-search?*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.data.items[0].slide.story = { role: 'proof', type: 'case_study_detail', reuse: 'reusable', themes: ['workplace strategy & data', 'cost certainty & risk'], sectors: ['hospitality'], projects: [], flags: [], shows: null, convinces: null, status: 'confirmed' };
    await route.fulfill({ response: res, json: body });
  });
  await openResults(page);
  const first = page.locator('article.card').first();
  // Two labels, the slide's type first, then the rest behind +3.
  await expect(first.locator('.tags-compact .tag-team')).toHaveText(['Case study detail', 'Hospitality']);
  const more = first.getByRole('button', { name: /3 more tags/ });
  await expect(more).toHaveText('+3');
  // No tooltips on the tags themselves; the rest open as a list, one below the other.
  await expect(first.locator('.tag-team').first()).not.toHaveAttribute('data-tip', /.*/);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByRole('group', { name: 'More tags' });
  await expect(list.getByRole('button')).toHaveText(['Workplace strategy & data', 'Cost certainty & risk', 'Proof']);
  const [a, b] = await Promise.all([list.getByRole('button').nth(0).boundingBox(), list.getByRole('button').nth(1).boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y); // one below the other
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  // The preview lists all five.
  await first.locator('.thumb').first().click();
  const labels = page.getByRole('dialog').getByRole('group', { name: 'Labels from the team' });
  await expect(labels.locator('.tag-team')).toHaveCount(5);
  // Share in the preview is a small icon beside the close button, not a row of its own.
  await expect(page.getByRole('dialog').getByRole('button', { name: /^Share: copy a link/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('slide page: Share sits with the other buttons in Use this slide, once, and copies the slide link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openResults(page);
  await page.locator('article.card').first().getByRole('link').first().click();
  const panel = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Use this slide' }) });
  await expect(panel.getByRole('button')).toContainText(['Add to draft deck', 'Share', 'Download slide']);
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByText('Link copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/slide-vault\/slide\//);
  expect(await axe(page)).toEqual([]);
});

test('Search with AI: hidden when the server has no AI; off by default, remembered, and a short search asks first', async ({ page }) => {
  // No AI reader in this server: no switch.
  await openHome(page);
  await expect(page.getByRole('checkbox', { name: 'Search with AI' })).toHaveCount(0);

  // Pretend the server has one. Short searches that ask for the AI come back flagged, as the real server does.
  await page.route('**/api/slide-vault/v1/session', (route) => route.fulfill({ json: { data: { contractVersion: 'test', capabilities: ['library.read'], aiAvailable: true } } }));
  const asked: URLSearchParams[] = [];
  await page.route(/\/api\/slide-vault\/v1\/smart-search\?/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push(params);
    const res = await route.fetch();
    const body = await res.json();
    body.data.aiAvailable = true;
    if (params.get('read') === '1' && params.get('ai') !== 'off' && params.get('ai') !== 'always') body.data.aiSkipped = 'short';
    await route.fulfill({ response: res, json: body });
  });
  await page.goto('/slide-vault/pages');
  const toggle = page.getByRole('checkbox', { name: 'Search with AI' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  // Off: every search tells the server to keep the AI out, and no note shows.
  await page.getByLabel('Search slides').fill('services');
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
  await page.getByLabel('Search slides').press('Enter');
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((p) => p.get('ai') === 'off')).toBe(true);
  await expect(page.getByText('Your search is short for the AI to read')).toHaveCount(0);

  // Turning it on reads the words already typed with the AI (no ai=off); too short, so it asks first.
  await toggle.check();
  await expect(toggle).toBeChecked();
  const note = page.getByText('This is a short search, and a regular search usually handles those well.');
  await expect(note).toBeVisible();
  const last = asked[asked.length - 1];
  expect(last.get('read')).toBe('1');
  expect(last.get('ai')).toBeNull();
  expect(await axe(page)).toEqual([]);

  // "Yes, use AI" reads this short search with the AI anyway (ai=always) and the question goes away.
  await page.getByRole('button', { name: 'Yes, use AI' }).click();
  await expect(note).toHaveCount(0);
  await expect.poll(() => asked[asked.length - 1].get('ai')).toBe('always'); // sent after the short typing pause

  // The next short search asks again; "No, keep these results" puts the question away for it.
  await page.getByLabel('Search slides').fill('team');
  await page.getByLabel('Search slides').press('Enter');
  await expect(note).toBeVisible();
  await page.getByRole('button', { name: 'No, keep these results' }).click();
  await expect(note).toHaveCount(0);

  // Remembered on this device after a reload; turning it off sends ai=off again.
  await page.reload();
  const again = page.getByRole('checkbox', { name: 'Search with AI' });
  await expect(again).toBeChecked();
  await again.uncheck();
  await expect(again).not.toBeChecked();
  await page.getByLabel('Search slides').fill('services');
  await expect(page.getByText(/^\d+ slides? from/)).toBeVisible();
  expect(asked[asked.length - 1].get('ai')).toBe('off');
});

test('upload: tags the AI fills in are marked "please check", can be removed, and are named before uploading', async ({ page }) => {
  // A stand-in for the AI: it names the client and suggests one deck tag and one slide tag (FD-85).
  await page.route('**/api/slide-vault/v1/uploads/suggest', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { data: { aiAvailable: true } } });
    return route.fulfill({
      json: { data: {
        suggestions: { client: { value: 'Harbor Bank', source: 'ai', evidence: 'x' }, year: null, category: null, bestOfTheBest: null, author: null, lastEditedBy: null, office: null },
        reader: 'model', readerNote: null, slideCount: 4,
        tags: { deck: [{ tag: 'workplace strategy & data', from: 'ai', score: 0.9 }], slides: { '2': [{ tag: 'cost certainty & risk', from: 'ai', score: 0.8 }] } },
      } },
    });
  });
  await openHome(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Upload' }).click();
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/harbor-bank-proposal.pptx');
  await expect(page.locator('.upcard')).toHaveCount(4);
  await page.getByRole('button', { name: 'Fill the rest with AI' }).click();
  await expect(page.getByText('Added 1 deck tag and 1 slide tag the AI read from your slides.')).toBeVisible();

  // Marked, with the same "please check" line as the other filled-in details.
  await expect(page.locator('.tagchip.is-auto')).toHaveCount(1);
  await expect(page.locator('.upcard').nth(1).locator('.tag.is-auto')).toHaveCount(1);
  await expect(page.getByText('Filled in from the AI (please check). Remove any that don’t fit.')).toBeVisible();
  expect(await axe(page)).toEqual([]);

  // Taking one off is one click and it is no longer "filled in"; the other is named before uploading.
  await page.getByRole('button', { name: 'Remove tag workplace strategy & data' }).click();
  await expect(page.locator('.tagchip.is-auto')).toHaveCount(0);
  await expect(page.getByText('Filled in from the AI (please check). Remove any that don’t fit.')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Year' }).fill('2025');
  await page.getByRole('button', { name: 'Upload deck' }).click();
  await expect(page.getByRole('dialog').getByText('1 tag filled in by the AI: please check it before you upload')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
});
