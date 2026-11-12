/**
 * The Storyboard, every screen (docs/DECISIONS.md FD-22 to FD-32, FD-43; target WCAG 2.2 AA, docs/foundry/ACCESSIBILITY.md):
 * the brief (and "too short"), Composing (and Stop), the error, the finished story (beats, "+N", Useful / Not useful,
 * preview, add to the draft deck, Talk to your story, Start over) and the two "From your library" answers.
 *
 * The story is the real one: with no AI configured the storyboard tells it by its rules from the synthetic library.
 * Only what the synthetic library can't produce is stood in: a slow answer (to see Composing), a failed one, the
 * "From your library" answers, and the reply to Talk to your story. Each stand-in says so where it is set up.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BRIEF = 'A regional bank is consolidating three offices into one new headquarters and worries about staff morale and hybrid work.';

/**
 * Known contrast failures, measured 11 Nov (docs/foundry/ACCESSIBILITY.md, "Open findings"). Only the color-contrast
 * rule, and only on elements with these classes, is set aside in the scans; each has its own test at the end of this
 * file, marked as failing until fixed. Any other rule on them, and any contrast failure anywhere else, still fails.
 */
const KNOWN_CONTRAST = ['sb-eyebrow', 'sb-n', 'sb-accent', 'sb-beat-more', 'sb-pull-2', 'sb-label', 'sb-step-label', 'sb-step-n'];

async function axe(page: Page, opts: { known?: boolean } = { known: true }) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { violations } = await new AxeBuilder({ page }).include('.slidevault').withTags(WCAG_TAGS).analyze();
  const classes = (html: string) => (html.match(/^<[^>]*class="([^"]*)"/)?.[1] ?? '').split(/\s+/);
  const isKnown = (rule: string, html: string) => opts.known !== false && rule === 'color-contrast' && classes(html).some((c) => KNOWN_CONTRAST.includes(c));
  return violations
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !isKnown(v.id, n.html)) }))
    .filter((v) => v.nodes.length)
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** Light or dark, switched the way people switch it: the Account menu. */
async function theme(page: Page, mode: 'light' | 'dark') {
  if (mode === 'light') return;
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Dark mode' }).click();
  await expect(page.locator('.slidevault').first()).toHaveAttribute('data-theme', 'dark');
}

/** The Storyboard's own alerts (Next.js keeps a route announcer with role="alert" on every page). */
const alert = (page: Page) => page.locator('.sb').getByRole('alert');

/** The brief screen, reached the way people reach it: Create, then Open the Storyboard. */
async function openStoryboard(page: Page) {
  await page.goto('/slide-vault/create');
  await expect(page.getByRole('heading', { name: 'Create', level: 1 })).toBeVisible();
  // A click that lands before the page's code has loaded does nothing, so click until the Storyboard opens.
  await expect(async () => {
    await page.getByRole('button', { name: /Open the Storyboard/ }).click({ timeout: 2_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/start with the client/i, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** What a screen reader hears: the app's polite live region. */
const heard = (page: Page) => page.locator('.sr-only[aria-live="polite"]');

/** How long a story may take on a busy machine (it takes a fraction of a second on an idle one). */
const STORY_WAIT = { timeout: 60_000 };

/** A real story from the synthetic library. */
async function pullStory(page: Page) {
  await openStoryboard(page);
  await page.getByLabel("The client's situation").fill(BRIEF);
  await page.getByRole('button', { name: 'Pull the story' }).click();
  await expect(page.getByRole('button', { name: 'Add the story to the draft deck' })).toBeVisible(STORY_WAIT);
}

/** The server's real answer to the next storyboard request, changed by `edit` (for answers the sample library can't give). */
async function standIn(page: Page, edit: (data: Record<string, unknown>) => Record<string, unknown>) {
  await page.route('**/api/slide-vault/v1/storyboard', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, data: edit(body.data) } });
  }, { times: 1 });
}

const noSideScroll = (page: Page) => page.evaluate(() => document.querySelector('.sv-scroll')!.scrollWidth);

// The same set-up as accessibility.spec.ts: a caller and a person of its own per test (rate limits, FD-17 / FD-90),
// signed in as the demo profile, the quick tour marked seen.
let caller = 0;
test.beforeEach(async ({ page }) => {
  caller += 1;
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${((caller + 120) % 250) + 1}` });
  const person = encodeURIComponent(`Storyboard tester ${caller}`);
  await page.route('**/api/slide-vault/v1/**', (route) => {
    const headers = route.request().headers();
    return route.fallback(headers['x-slidevault-user'] ? { headers: { ...headers, 'x-slidevault-user': person } } : undefined);
  });
  await page.goto('/slide-vault/pages');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('slidevault:profile', 'Avery Walsh');
    localStorage.setItem('slidevault:tip:tour', '1');
  });
});

test.describe('brief', () => {
  for (const mode of ['light', 'dark'] as const) {
    test(`no WCAG 2.2 AA violations on the brief, ${mode}, including "too short"`, async ({ page }) => {
      await openStoryboard(page);
      await theme(page, mode);
      expect(await axe(page)).toEqual([]);
      await page.getByLabel("The client's situation").fill('Too short');
      await page.getByRole('button', { name: 'Pull the story' }).click();
      await expect(alert(page)).toContainText('Describe the client');
      expect(await axe(page)).toEqual([]);
    });
  }

  test('"too short" is announced, tied to the box, and puts focus back in it', async ({ page }) => {
    await openStoryboard(page);
    const box = page.getByLabel("The client's situation");
    await box.fill('Too short');
    await page.getByRole('button', { name: 'Pull the story' }).click();
    await expect(alert(page)).toHaveText(/Describe the client's situation in a sentence or more/);
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('aria-describedby', 'sb-too-short');
    // Writing enough takes the message away.
    await box.fill(BRIEF);
    await expect(alert(page)).toHaveCount(0);
  });

  test('every control on the brief has a name: the box, Tuned for, Pull the story', async ({ page }) => {
    await openStoryboard(page);
    await expect(page.getByRole('textbox', { name: "The client's situation" })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Tuned for' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pull the story' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Storyboard');
  });

  // WCAG 2.5.3 Label in Name (Level A): on hover and keyboard focus the button shows "Start planning story", but its
  // name stays "Pull the story", so "click Start planning story" by voice finds nothing. Found 11 Nov; the button is
  // Khushali's (StoryboardView.tsx, storyboard.css). Marked as failing until it is fixed: then this test passes and
  // Playwright reports it, and test.fail can be removed.
  test('the button\'s name contains the words it shows on focus (known issue: WCAG 2.5.3)', async ({ page }) => {
    test.fail(true, 'Known: shows "Start planning story" on focus, named "Pull the story" (WCAG 2.5.3). Remove test.fail once fixed.');
    await openStoryboard(page);
    const button = page.getByRole('button', { name: 'Pull the story' });
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('.sb-pull-2')).toHaveCSS('opacity', '1');
    const name = (await button.getAttribute('aria-label')) ?? '';
    expect(name.toLowerCase()).toContain('start planning story');
  });
});

test.describe('composing', () => {
  // Stand-in: the synthetic library answers in a fraction of a second, so the answer is held back to see this screen.
  async function slowStory(page: Page, ms: number) {
    await page.route('**/api/slide-vault/v1/storyboard', async (route) => {
      await new Promise((r) => setTimeout(r, ms));
      await route.fallback();
    }, { times: 1 });
  }

  for (const mode of ['light', 'dark'] as const) {
    test(`no WCAG 2.2 AA violations while composing, ${mode}`, async ({ page }) => {
      await slowStory(page, 6_000);
      await openStoryboard(page);
      await theme(page, mode);
      await page.getByLabel("The client's situation").fill(BRIEF);
      await page.getByRole('button', { name: 'Pull the story' }).click();
      await expect(page.getByRole('heading', { name: 'Reading the brief', level: 1 })).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  test('composing: busy, steps in order with the current one marked, focus on Stop; Escape stops and keeps the brief', async ({ page }) => {
    await slowStory(page, 8_000);
    await openStoryboard(page);
    await page.getByLabel("The client's situation").fill(BRIEF);
    await page.getByRole('button', { name: 'Pull the story' }).click();
    const section = page.locator('section.sb-composing');
    await expect(section).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reading the brief');
    await expect(page.locator('.sb-steps li .sb-step-label')).toHaveText(['Reading the brief', 'Searching the archive', 'Matching slides to the brief', 'Sequencing the story', 'Writing the narration']);
    await expect(page.locator('.sb-steps li[aria-current="step"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();
    // The status line under the steps announces itself politely as it changes.
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('aria-live', 'polite');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/start with the client/i);
    await expect(page.getByLabel("The client's situation")).toHaveValue(BRIEF);
  });

  test('Stop with the button returns to the brief too', async ({ page }) => {
    await slowStory(page, 8_000);
    await openStoryboard(page);
    await page.getByLabel("The client's situation").fill(BRIEF);
    await page.getByRole('button', { name: 'Pull the story' }).click();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByLabel("The client's situation")).toHaveValue(BRIEF);
  });
});

test('a failed story says so in an alert, with no WCAG 2.2 AA violations', async ({ page }) => {
  // Stand-in: the server's own "unavailable" answer (storyboard/route.ts), which the sample library never gives.
  await page.route('**/api/slide-vault/v1/storyboard', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LIBRARY_NOT_READY', message: 'The storyboard is unavailable right now. Please try again.', retryable: true }, requestId: 't' }) }), { times: 1 });
  await openStoryboard(page);
  await page.getByLabel("The client's situation").fill(BRIEF);
  await page.getByRole('button', { name: 'Pull the story' }).click();
  await expect(alert(page)).toContainText('The storyboard is unavailable right now');
  await expect(page.getByLabel("The client's situation")).toHaveValue(BRIEF);
  expect(await axe(page)).toEqual([]);
});

test.describe('the story', () => {
  for (const mode of ['light', 'dark'] as const) {
    test(`no WCAG 2.2 AA violations on the story, ${mode}, with a beat's other slides open and a slide marked`, async ({ page }) => {
      await pullStory(page);
      await theme(page, mode);
      expect(await axe(page)).toEqual([]);
      await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().click();
      await page.getByRole('group', { name: 'Was this slide useful?' }).first().getByRole('button', { name: 'Useful', exact: true }).click();
      expect(await axe(page)).toEqual([]);
    });
  }

  test('focus moves to the story\'s title when it is ready, and it is announced', async ({ page }) => {
    await pullStory(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(heard(page)).toContainText('Story ready');
  });

  test('one h1; each beat is a list item named by its own heading; no skipped heading levels', async ({ page }) => {
    await pullStory(page);
    await expect(page.locator('main h1')).toHaveCount(1);
    const beats = page.locator('ol.sb-beats > li');
    const count = await beats.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const id = await beats.nth(i).getAttribute('aria-labelledby');
      await expect(page.locator(`#${id}`)).toHaveJSProperty('tagName', 'H2');
    }
    const levels = await page.locator('main h1, main h2, main h3, main h4').evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
    expect(levels.every((level, i) => i === 0 || level - levels[i - 1] <= 1)).toBe(true);
  });

  test('"+N" says how many, toggles aria-expanded, and shows the slides as a named list', async ({ page }) => {
    await pullStory(page);
    const more = page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first();
    const n = Number(((await more.getAttribute('aria-label')) ?? '').match(/\d+/)![0]);
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    const hide = page.getByRole('button', { name: 'Hide the other slides' });
    await expect(hide).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('list', { name: 'More slides for this moment' }).first().getByRole('listitem')).toHaveCount(n);
    await hide.click();
    await expect(page.getByRole('list', { name: 'More slides for this moment' })).toHaveCount(0);
  });

  test('Useful / Not useful: a named group; the choice shows as pressed and can\'t be sent twice', async ({ page }) => {
    await pullStory(page);
    const group = page.getByRole('group', { name: 'Was this slide useful?' }).first();
    const useful = group.getByRole('button', { name: 'Useful', exact: true });
    const notUseful = group.getByRole('button', { name: 'Not useful', exact: true });
    await expect(useful).toHaveAttribute('aria-pressed', 'false');
    await useful.click();
    await expect(useful).toHaveAttribute('aria-pressed', 'true');
    await expect(useful).toBeDisabled();
    await expect(notUseful).toBeDisabled();
  });

  test('a beat\'s slide opens the preview; focus goes in, and back to the slide on Escape', async ({ page }) => {
    await pullStory(page);
    const opener = page.locator('ol.sb-beats > li').first().getByRole('button', { name: /^Preview: / });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('Add the story to the draft deck adds each beat\'s slide, in story order, and says so', async ({ page }) => {
    await pullStory(page);
    const beats = await page.locator('ol.sb-beats > li').count();
    await page.getByRole('button', { name: 'Add the story to the draft deck' }).click();
    await expect(heard(page)).toContainText(`Added the story's ${beats} slides to the draft deck, in story order`);
    await expect(page.locator('.cart-items li')).toHaveCount(beats);
  });

  test('Talk to your story: a named box, Send off until there is text, the reply announced politely', async ({ page }) => {
    await pullStory(page);
    // Stand-in: the reply is the AI's job; with none configured the server can't continue a story, so its answer is given.
    await page.route('**/api/slide-vault/v1/storyboard/refine', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { reply: 'Dropped the fees slide and kept the two you marked useful.' } }) }));
    const section = page.getByRole('region', { name: 'Talk to your story' });
    await expect(section).toBeVisible();
    const box = section.getByLabel('Tell it what to change');
    const send = section.getByRole('button', { name: 'Send' });
    await expect(send).toBeDisabled();
    await box.fill('Drop the fees');
    await expect(send).toBeEnabled();
    await box.press('Enter');
    await expect(section.locator('[aria-live="polite"]')).toContainText('Dropped the fees slide');
    await expect(box).toHaveValue('');
    expect(await axe(page)).toEqual([]);
  });

  test('Start over goes back to an empty brief', async ({ page }) => {
    await pullStory(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/start with the client/i);
  });
});

test.describe('from your library', () => {
  // Stand-ins: asking for a deck "as it was" needs the request to name a real client deck; the synthetic library's
  // real story is sent back reshaped into the two answers storyboard.ts gives (FD-31, FD-34).
  test('the original deck found: Open the original, Tell its story better, Start over; no violations', async ({ page }) => {
    await standIn(page, (d) => {
      const lead = (d.beats as { lead: { slide: { provenance: { sourceId: string; sourceTitle: string } } } }[])[0].lead.slide.provenance;
      return { ...d, mode: 'retrieve', beats: [], deck: { id: lead.sourceId, title: lead.sourceTitle, slideCount: 12 } };
    });
    await openStoryboard(page);
    await page.getByLabel("The client's situation").fill(BRIEF);
    await page.getByRole('button', { name: 'Pull the story' }).click();
    await expect(page.getByText('From your library')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the original' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tell its story better' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test('a deck the library doesn\'t have: says so, offers a new story; no violations', async ({ page }) => {
    await standIn(page, (d) => ({ ...d, mode: 'retrieve', beats: [], title: 'The Harbor Bank deck from 2019', missing: { name: 'Harbor Bank', years: [2019] } }));
    await openStoryboard(page);
    await page.getByLabel("The client's situation").fill(BRIEF);
    await page.getByRole('button', { name: 'Pull the story' }).click();
    await expect(page.getByText(/Nothing in the library matches that name/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build a new story instead' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
});

test('the whole Storyboard with the keyboard alone: brief, story, a verdict, the other slides, into the draft deck', async ({ page }) => {
  await openStoryboard(page);
  await page.getByLabel("The client's situation").focus();
  await page.keyboard.type(BRIEF);
  // Tab past the mic (when shown) and Tuned for to the button, by name, the way a keyboard user would.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Pull the story') break;
  }
  await expect(page.getByRole('button', { name: 'Pull the story' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused(STORY_WAIT);
  await page.getByRole('group', { name: 'Was this slide useful?' }).first().getByRole('button', { name: 'Useful', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: 'Was this slide useful?' }).first().getByRole('button', { name: 'Useful', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Hide the other slides' })).toBeFocused();
  await page.getByRole('button', { name: 'Add the story to the draft deck' }).focus();
  await page.keyboard.press('Enter');
  await expect(heard(page)).toContainText(/Added the story's \d+ slides to the draft deck/);
});

test('every Storyboard control shows a 2px solid focus outline', async ({ page }) => {
  await pullStory(page);
  const seen = new Set<string>();
  await page.getByRole('heading', { level: 1 }).focus();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !el.closest('.sb')) return null;
      const cs = getComputedStyle(el);
      return { name: (el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 40), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    if (!focus || seen.has(focus.name)) continue;
    seen.add(focus.name);
    expect(focus, `focus indicator on "${focus.name}"`).toMatchObject({ style: 'solid', width: 2 });
  }
  expect(seen.size).toBeGreaterThan(8);
});

test('Storyboard targets are 24×24 CSS px or spaced as WCAG 2.5.8 allows, on the brief and on the story', async ({ page }) => {
  // WCAG 2.5.8 (AA): a target is at least 24×24, or a 24 px circle on its centre touches no other target or other
  // small target's circle (the spacing exception). Links inside a sentence are exempt (the inline exception).
  const small = () =>
    page.evaluate(() => {
      const els = [...document.querySelectorAll('.slidevault button, .slidevault input, .slidevault select, .slidevault textarea, .slidevault a')]
        .filter((e) => !(e as HTMLElement).hidden && (e as HTMLElement).offsetParent !== null && !(e.tagName === 'A' && e.closest('p')));
      const boxes = els.map((e) => ({ e, r: e.getBoundingClientRect(), name: (e.getAttribute('aria-label') || e.textContent || e.id).trim().slice(0, 50) })).filter((b) => b.r.width && b.r.height);
      const isSmall = (r: DOMRect) => r.width < 24 || r.height < 24;
      const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      const circleHitsRect = (c: { x: number; y: number }, r: DOMRect) => {
        const dx = c.x - Math.max(r.left, Math.min(c.x, r.right));
        const dy = c.y - Math.max(r.top, Math.min(c.y, r.bottom));
        return dx * dx + dy * dy < 12 * 12;
      };
      return boxes
        .filter((b) => b.e.closest('.sb') && isSmall(b.r))
        .filter((b) => {
          const c = centre(b.r);
          return boxes.some((o) => {
            if (o.e === b.e || o.e.contains(b.e) || b.e.contains(o.e)) return false;
            if (isSmall(o.r)) { const d = centre(o.r); return Math.hypot(c.x - d.x, c.y - d.y) < 24; }
            return circleHitsRect(c, o.r);
          });
        })
        .map((b) => `${b.name} ${Math.round(b.r.width)}×${Math.round(b.r.height)}`);
    });
  await openStoryboard(page);
  expect(await small()).toEqual([]);
  await page.getByLabel("The client's situation").fill(BRIEF);
  await page.getByRole('button', { name: 'Pull the story' }).click();
  await expect(page.getByRole('button', { name: 'Add the story to the draft deck' })).toBeVisible(STORY_WAIT);
  await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().click();
  expect(await small()).toEqual([]);
});

test.describe('screen sizes', () => {
  // Each runs the whole flow plus two scans at one size: give it the time a busy machine needs.
  test.slow();
  const sizes = [
    { name: 'phone, 390 px', width: 390, height: 844 },
    { name: 'tablet upright, 768 px', width: 768, height: 1024 },
    { name: 'tablet sideways, 1024 px', width: 1024, height: 768 },
    { name: '320 px (400% zoom)', width: 320, height: 800 },
  ];
  for (const size of sizes) {
    test(`${size.name}: brief and story, nothing scrolls sideways, no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openStoryboard(page);
      expect(await noSideScroll(page)).toBeLessThanOrEqual(size.width);
      expect(await axe(page)).toEqual([]);
      await page.getByLabel("The client's situation").fill(BRIEF);
      await page.getByRole('button', { name: 'Pull the story' }).click();
      await expect(page.getByRole('button', { name: 'Add the story to the draft deck' })).toBeVisible(STORY_WAIT);
      await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().click();
      expect(await noSideScroll(page)).toBeLessThanOrEqual(size.width);
      expect(await axe(page)).toEqual([]);
    });
  }
});

test('reduced motion turns the Storyboard\'s transitions off', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/slide-vault/pages');
  await page.evaluate(() => { localStorage.setItem('slidevault:profile', 'Avery Walsh'); localStorage.setItem('slidevault:tip:tour', '1'); });
  await openStoryboard(page);
  const durations = await page.locator('.sb-pull, .sb-pull-1, .sb-pull-2').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
  expect(durations.every((d) => d.split(',').every((x) => parseFloat(x) === 0))).toBe(true);
  await context.close();
});

/**
 * The contrast ratio of every element matching `selector`, worked out from its real colours: its text colour over the
 * backgrounds behind it, with the opacity of every ancestor (WCAG 1.4.3: 4.5:1, or 3:1 for large text, 24 px or
 * 18.66 px bold). Returns the elements that fall short, with their ratio. Deterministic, unlike a scan's view of what
 * is on screen.
 */
async function shortOfContrast(page: Page, selector: string) {
  // Colours fade when the theme or a state changes: measure them settled (reduced motion turns the fades off).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return page.locator(selector).evaluateAll((els) => {
    const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const mix = (top: { r: number; g: number; b: number }, a: number, under: { r: number; g: number; b: number }) => ({ r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a) });
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return els.map((el) => {
      // The solid background behind the element, then any translucent ones above it, painted bottom up.
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.push(e);
      let bg = { r: 255, g: 255, b: 255 };
      const layers = chain.map((e) => parse(getComputedStyle(e).backgroundColor));
      const solid = layers.findIndex((l) => l.a >= 1);
      for (let i = (solid < 0 ? layers.length : solid + 1) - 1; i >= 0; i--) if (layers[i].a > 0) bg = mix(layers[i], layers[i].a, bg);
      // Text colour with its own alpha, then the opacity of the element and every ancestor up to the solid background.
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      let opacity = 1;
      for (let i = 0; i < (solid < 0 ? chain.length : solid + 1); i++) opacity *= Number(getComputedStyle(chain[i]).opacity);
      const shown = mix(fg, fg.a * opacity, bg);
      const [hi, lo] = [lum(shown), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      return { text: (el.textContent || '').trim().slice(0, 30), ratio: Math.round(ratio * 100) / 100, needs: large ? 3 : 4.5 };
    }).filter((x) => x.ratio < x.needs);
  });
}

test.describe('known contrast findings (WCAG 1.4.3, measured 11 Nov; marked failing until fixed)', () => {
  // When a colour is fixed its test passes, Playwright reports "expected to fail, but passed", and its test.fail
  // line and its class in KNOWN_CONTRAST can be removed.
  test('the "Storyboard" / "From your library" label, light (4.09:1)', async ({ page }) => {
    test.fail(true, 'Known: .sb-eyebrow #e03408 on #f3f4f6');
    await openStoryboard(page);
    expect(await shortOfContrast(page, '.sb-eyebrow')).toEqual([]);
  });

  test('Pull the story on hover or focus: "Start planning story", light (3.52:1) and dark (3.11:1)', async ({ page }) => {
    test.fail(true, 'Known: .sb-pull-2 white on #ff3f0a (light), #ff5a2c (dark)');
    await openStoryboard(page);
    await page.getByRole('button', { name: 'Pull the story' }).hover();
    const light = await shortOfContrast(page, '.sb-pull-2');
    await page.mouse.move(0, 0);
    await theme(page, 'dark');
    await page.getByRole('button', { name: 'Pull the story' }).hover();
    expect([...light, ...(await shortOfContrast(page, '.sb-pull-2'))]).toEqual([]);
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`Composing, ${mode}: the current step and the steps to come (55% opacity)`, async ({ page }) => {
      test.fail(true, mode === 'light' ? 'Known: current step #e03408 is 4.09:1; li.is-todo at opacity 0.55' : 'Known: li.is-todo at opacity 0.55');
      await page.route('**/api/slide-vault/v1/storyboard', async (route) => { await new Promise((r) => setTimeout(r, 6_000)); await route.fallback(); }, { times: 1 });
      await openStoryboard(page);
      await theme(page, mode);
      await page.getByLabel("The client's situation").fill(BRIEF);
      await page.getByRole('button', { name: 'Pull the story' }).click();
      await expect(page.getByRole('heading', { name: 'Reading the brief' })).toBeVisible();
      expect(await shortOfContrast(page, '.sb-steps li .sb-step-label, .sb-steps li .sb-step-n')).toEqual([]);
    });
  }

  test('the beat numbers "01", "02"…, light (3.20:1)', async ({ page }) => {
    test.fail(true, 'Known: .sb-n #ff3f0a on #f3f4f6');
    await pullStory(page);
    expect(await shortOfContrast(page, '.sb-n')).toEqual([]);
  });

  test('the "Matches …" line under each slide, light (4.09:1)', async ({ page }) => {
    test.fail(true, 'Known: .sb-accent #e03408 on #f3f4f6');
    await pullStory(page);
    expect(await shortOfContrast(page, '.sb-accent')).toEqual([]);
  });

  test('the "Talk to your story" heading, light (4.09:1)', async ({ page }) => {
    test.fail(true, 'Known: #sb-sharpen-h (.sb-label) #e03408 on #f3f4f6');
    await pullStory(page);
    expect(await shortOfContrast(page, '#sb-sharpen-h')).toEqual([]);
  });

  test('"Hide the other slides" once a beat is open, dark (2.74:1)', async ({ page }) => {
    test.fail(true, 'Known: .sb-beat-more white on #ff7048');
    await pullStory(page);
    await theme(page, 'dark');
    await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().click();
    expect(await shortOfContrast(page, '.sb-beat-more[aria-expanded="true"]')).toEqual([]);
  });

  test('passing colours stay passing: the open "+N" in light is 4.50:1, the other Storyboard text clears 4.5:1', async ({ page }) => {
    await pullStory(page);
    await page.getByRole('button', { name: /^Show \d+ more slides?$/ }).first().click();
    expect(await shortOfContrast(page, '.sb-beat-more, .sb-board-title, .sb-beat-title, .sb-beat-say, .sb-beat-why, .sb-beat-caption > span:first-child, .sb-msg')).toEqual([]);
  });
});

// WCAG 2.4.3 Focus Order / 4.1.3: when a "From your library" answer replaces Composing, focus should move to its title,
// as it does for a story. Measured 11 Nov with the CPU slowed 6×: a story put focus on its title 5 of 5 times, a
// "From your library" answer 1 of 5; otherwise focus fell to the page (the Stop button it was on is gone). Likely cause:
// StoryboardView.tsx focuses the title in requestAnimationFrame, which can run before the new screen is rendered.
// It is a timing race, so how often it shows depends on the machine (1 of 5 and 4 of 6 on 11 Nov): on a fast CI runner
// it could pass by luck and break every PR. So it runs on demand only: SV_RACE_CHECK=1 npx playwright test storyboard -g "slow machine"
test('"From your library": focus lands on the title every time, even on a slow machine (known issue)', async ({ page }) => {
  test.skip(!process.env.SV_RACE_CHECK, 'Timing race: run on demand with SV_RACE_CHECK=1 (see the comment above).');
  test.fail(true, 'Known: focus is lost after a "From your library" answer on slower machines.');
  test.setTimeout(240_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.route('**/api/slide-vault/v1/storyboard', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, data: { ...body.data, mode: 'retrieve', beats: [], title: 'The Harbor Bank deck from 2019', missing: { name: 'Harbor Bank', years: [2019] } } } });
  });
  // Every step waits long enough for the slowed browser, so the only way this fails is focus not reaching the title.
  const slow = { timeout: 45_000 };
  let onTitle = 0;
  for (let i = 0; i < 6; i++) {
    await page.goto('/slide-vault/create');
    await expect(page.getByRole('heading', { name: 'Create', level: 1 })).toBeVisible(slow);
    await page.getByRole('button', { name: /Open the Storyboard/ }).click();
    await expect(page.getByLabel("The client's situation")).toBeVisible(slow);
    await page.getByLabel("The client's situation").fill(BRIEF);
    await page.getByRole('button', { name: 'Pull the story' }).click();
    await expect(page.getByRole('button', { name: 'Build a new story instead' })).toBeVisible(slow);
    await page.waitForTimeout(1_500);
    if (await page.evaluate(() => document.activeElement?.tagName === 'H1')) onTitle++;
  }
  console.log(`"From your library" under 6× CPU slowdown: focus on the title ${onTitle} of 6`);
  expect(onTitle).toBe(6);
});
