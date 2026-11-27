/**
 * The 12-step screen-reader walk-through in docs/foundry/ACCESSIBILITY.md, on today's screens, checked against what a
 * screen reader reads: the browser's accessibility tree (roles, names, states), where focus is, and what the app
 * announces in its live regions. It is not a person listening with VoiceOver: it shows the app gives VoiceOver the
 * right things to say, not how VoiceOver says them. The steps a person still has to hear are marked in the doc.
 */
import { expect, test, type Page } from '@playwright/test';

const heard = (page: Page) => page.locator('.sr-only[aria-live="polite"]');

async function searchFor(page: Page, text: string) {
  await page.getByLabel('Search slides').fill(text);
  await page.getByLabel('Search slides').press('Enter');
}

// The same set-up as accessibility.spec.ts: its own caller and person (rate limits), the demo profile, the tour seen.
let caller = 0;
test.beforeEach(async ({ page }) => {
  caller += 1;
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${((caller + 200) % 250) + 1}` });
  const person = encodeURIComponent(`Screen reader tester ${caller}`);
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
  await page.goto('/slide-vault/pages');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
});

test('steps 1–3: landmarks (banner, main, Main navigation, search, Draft deck), one h1 "Home", the search box by name', async ({ page }) => {
  // 1. The rotor's Landmarks list
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Draft deck' })).toHaveCount(1);
  // 2. The rotor's Headings list: one level-1 heading, and it is the page's name
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Home');
  // 3. Tabbing to the search box says its name, inside a search landmark
  await expect(page.getByRole('search').getByRole('searchbox', { name: /search slides/i })).toBeVisible();
});

test('step 4: a search keeps focus in the box, and the result count sits in a polite live region', async ({ page }) => {
  const box = page.getByLabel('Search slides');
  await box.focus();
  await page.keyboard.type('leadership');
  await page.keyboard.press('Enter');
  const count = page.locator('p.summary[aria-live="polite"]');
  await expect(count).toHaveText(/^\d+ slides? from \d+ decks?/);
  await expect(box).toBeFocused();
  // A second search updates the same live region (the case screen readers announce reliably).
  await searchFor(page, 'services');
  await expect(count).toHaveText(/^\d+ slides? from \d+ decks?/);
});

test('steps 5–7: adding to the draft deck is a named checkbox, announced; reorder and remove are named; reordering keeps focus and says where', async ({ page }) => {
  await searchFor(page, 'leadership');
  const add = page.getByRole('checkbox', { name: 'Add to draft deck: Leadership team' });
  await expect(add).not.toBeChecked();
  await add.focus();
  await page.keyboard.press('Space');
  await expect(add).toBeChecked();
  // What is heard: the app announces "Added to draft deck: Leadership team", then the general message replaces it in the
  // same live region, so a screen reader hears "Added. 1 slide ready" (found 11 Nov; a person should confirm which is
  // spoken, see ACCESSIBILITY.md).
  await expect(heard(page)).toContainText(/Added/);
  await searchFor(page, 'services');
  await page.getByRole('checkbox', { name: 'Add to draft deck: Services' }).check({ force: true });
  // 6. In the draft deck: each slide's controls say what they do and to which slide
  const deck = page.getByRole('complementary', { name: 'Draft deck' });
  await expect(deck.getByRole('button', { name: /^Reorder: Leadership team/ })).toBeVisible();
  await expect(deck.getByRole('button', { name: /^Reorder: Services/ })).toBeVisible();
  await expect(deck.getByRole('button', { name: /Remove.*Leadership team/ })).toBeVisible();
  // 7. Moving one with the keyboard keeps focus on it and announces its new place
  const grip = deck.getByRole('button', { name: /^Reorder: Services/ });
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await expect(heard(page)).toContainText(/moved to position 1 of 2/);
  await expect(deck.getByRole('button', { name: /^Reorder: Services/ })).toBeFocused();
});

test('step 8: Download opens a named dialog, focus goes into it, and the download happens from the keyboard', async ({ page }) => {
  await searchFor(page, 'services');
  await page.getByRole('checkbox', { name: 'Add to draft deck: Services' }).check({ force: true });
  await page.getByRole('button', { name: 'Download as pptx' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.getAttribute('aria-labelledby') ?? await dialog.getAttribute('aria-label')).toBeTruthy();
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await dialog.getByRole('button', { name: 'Download', exact: true }).focus();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toMatch(/^SlideVault-export\.(pptx|zip)$/);
});

test('steps 9–11: Preview opens a dialog named for the slide, focus inside, its position announced; Escape returns focus', async ({ page }) => {
  await searchFor(page, 'leadership');
  const opener = page.getByRole('button', { name: 'Preview: Leadership team' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // 9. The dialog's accessible name includes the slide's title
  const name = await dialog.evaluate((d) => {
    const by = d.getAttribute('aria-labelledby');
    return (by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : d.getAttribute('aria-label') ?? '').trim();
  });
  expect(name).toContain('Leadership team');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  // 10. Where you are in the results is in a polite live region, so stepping through is announced
  await expect(dialog.locator('.counter[aria-live="polite"]').first()).not.toBeEmpty();
  // 11. Escape closes it and puts focus back on the button that opened it
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

// WCAG 4.1.3 Status Messages (AA): a search that finds nothing is announced in the page's polite live region (ResultsView calls announce()).
// Found 11 Nov (A1); fixed 17 Nov.
test('step 12: a search that finds nothing is announced (WCAG 4.1.3)', async ({ page }) => {
  await searchFor(page, 'zzqq');
  await expect(page.getByRole('heading', { name: /No slides found matching/ })).toBeVisible();
  // announce() (components/state.tsx) clears the live region, then fills it 40 ms later so screen readers read it
  // again. So wait for the message (up to 2 s) instead of checking once the instant the heading shows: checking once
  // raced that 40 ms and failed about half the runs, on every branch, though the message always arrives.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"], [role="status"], [role="alert"]')]
          .some((el) => /no slides found/i.test(el.textContent ?? '')),
      ),
      { timeout: 2_000 },
    )
    .toBe(true);
});

test('step 12 (reachable): the "No slides found" message is a heading, and Clear search is a named button', async ({ page }) => {
  await searchFor(page, 'zzqq');
  await expect(page.getByRole('heading', { name: /No slides found matching “zzqq”/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear search' }).first()).toBeVisible();
});
