/**
 * Accessibility acceptance (docs/DESIGN_SYSTEM.md, "Accessibility acceptance"; target WCAG 2.2 AA).
 *
 * Automated checks only. The design doc also asks for a manual screen-reader pass through the
 * primary workflow; that is recorded separately (docs/foundry/ACCESSIBILITY.md).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

async function openSlides(page: Page) {
  await page.goto('/slide-vault/pages');
  await expect(page.getByText(/^\d+ results?$/)).toBeVisible();
}

// Colors animate briefly on state changes; measure settled colors (reduced motion makes transitions instant).
async function axe(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { violations } = await new AxeBuilder({ page }).include('.slidevault').withTags(WCAG_TAGS).analyze();
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} element(s)`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/slide-vault/pages');
  await page.evaluate(() => localStorage.clear());
});

for (const theme of ['light', 'dark'] as const) {
  test(`no WCAG 2.2 AA violations, ${theme} theme, with a selection`, async ({ page }) => {
    await openSlides(page);
    await card(page, 'Services').getByRole('button', { name: 'Select' }).click();
    await card(page, 'Who we are').getByRole('button', { name: 'Select' }).click();
    await page.evaluate((t) => document.querySelectorAll('.slidevault').forEach((el) => el.setAttribute('data-theme', t)), theme);
    expect(await axe(page)).toEqual([]);
  });
}

test('no violations in the preview dialog, empty results and export error states', async ({ page }) => {
  await openSlides(page);
  await page.getByRole('button', { name: 'Preview: Leadership team' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByLabel('Search slides').fill('zzqq');
  await expect(page.getByText(/No slides match/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Clear search' }).click();

  await page.route('**/api/slide-vault/v1/exports', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'EXPORT_FAILED', message: 'The export could not be built. Please try again.', retryable: true }, requestId: 't' }) }),
  );
  await card(page, 'Services').getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Export editable PowerPoint' }).click();
  await expect(page.locator('aside [role="alert"]')).toContainText('Your selection is unchanged');
  expect(await axe(page)).toEqual([]);
});

test('every interactive element shows a 2px solid focus outline', async ({ page }) => {
  await openSlides(page);
  const seen = new Set<string>();
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { name: (el.getAttribute('aria-label') || el.textContent || el.id).trim().slice(0, 40), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    if (!focus || seen.has(focus.name)) continue;
    seen.add(focus.name);
    expect(focus, `focus indicator on "${focus.name}"`).toMatchObject({ style: 'solid', width: 2 });
  }
  expect(seen.size).toBeGreaterThan(10);
});

test('targets are at least 24×24 CSS px', async ({ page }) => {
  await openSlides(page);
  await card(page, 'Services').getByRole('button', { name: 'Select' }).click();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.slidevault button, .slidevault input')]
      .map((e) => ({ name: (e.getAttribute('aria-label') || e.textContent || e.id).trim(), ...e.getBoundingClientRect().toJSON() }))
      .filter((r) => r.width && (r.width < 24 || r.height < 24))
      .map((r) => `${r.name} ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});

test('primary workflow works with the keyboard alone', async ({ page }) => {
  await openSlides(page);

  // Search
  await page.getByLabel('Search slides').focus();
  await page.keyboard.type('leadership');
  await expect(page.getByText(/^1 result for “leadership”$/)).toBeVisible();
  await page.getByLabel('Search slides').fill('');
  await expect(page.getByText(/^\d+ results?$/)).toBeVisible();

  // Select three slides with Enter
  for (const title of ['Northwind Studio', 'Services', 'Leadership team']) {
    await card(page, title).getByRole('button', { name: 'Select' }).focus();
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('aside ol li')).toHaveCount(3);

  // Reorder with Enter; focus stays on the control
  await page.getByRole('button', { name: 'Move “Leadership team” up' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('aside ol li').nth(1)).toContainText('Leadership team');
  await expect(page.getByRole('button', { name: 'Move “Leadership team” up' })).toBeFocused();

  // Export with Enter
  await page.getByRole('button', { name: 'Export editable PowerPoint' }).focus();
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  expect((await download).suggestedFilename()).toBe('SlideVault-export.pptx');
});

test('preview: focus moves into the dialog and returns to the opener on Escape', async ({ page }) => {
  await openSlides(page);
  const opener = card(page, 'Services').getByRole('button', { name: 'Preview', exact: true });
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('one of each landmark; one h1; no skipped heading levels', async ({ page }) => {
  await openSlides(page);
  await expect(page.locator('header')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('aside[aria-labelledby]')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const levels = await page.locator('h1, h2, h3, h4').evaluateAll((hs) => hs.map((h) => Number(h.tagName[1])));
  expect(levels.every((level, i) => i === 0 || level - levels[i - 1] <= 1)).toBe(true);
});

test('reflows without sideways scrolling at 320 px (400% zoom)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openSlides(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('reduced motion turns transitions off', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openSlides(page);
  const duration = await page.locator('.slidevault button').first().evaluate((b) => getComputedStyle(b).transitionDuration);
  expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  await context.close();
});
