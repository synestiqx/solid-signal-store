import { expect, test } from '@playwright/test';

test.describe('SolidStore browser demo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('solid-store-page')).toBeVisible();
  });

  test('store board updates exact leaves with batch and both wake modes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const batch = page.locator('.toolbar input[type="checkbox"]');
    const wake = page.locator('.toolbar select');
    const cell = page.getByTestId('solid-board-cell-0-0');

    for (const batchEnabled of [true, false]) {
      await batch.setChecked(batchEnabled);
      for (const wakeMode of ['grained', 'container']) {
        await wake.selectOption(wakeMode);
        await page.getByRole('button', { name: 'Reset board' }).click();
        await expect(cell.locator('strong')).toHaveText('0');
        await cell.click();
        await expect(cell.locator('strong')).toHaveText('1');
        await expect(cell.locator('span')).toHaveText('1 clicks');
        await cell.click({ button: 'right' });
        await expect(page.locator('.store-stats')).toContainText('left 1');
        await expect(page.locator('.store-stats')).toContainText('right 1');
        await expect(page.locator('.store-stats')).toContainText('cell-0-0');
      }
    }

    await page.getByRole('button', { name: 'Mutate active users' }).click();
    await expect(page.locator('.user-row').first()).toContainText('73');
    await page.getByRole('button', { name: 'Add dynamic key' }).click();
    await expect(page.locator('.event-log')).toContainText('runtime.lastAction');
    expect(errors).toEqual([]);
  });

  test('design controls write through nested proxy leaves', async ({ page }) => {
    await page.getByRole('button', { name: 'Design' }).click();
    await expect(page.getByTestId('solid-design-page')).toBeVisible();

    const width = page.locator('.controls input[type="range"]').first();
    await width.fill('700');
    await expect(page.locator('.controls output').first()).toHaveText('700px');
    await expect(page.locator('.ai-component')).toHaveCSS('width', '700px');

    const title = page.locator('.controls input[type="text"]');
    await title.fill('Production workspace');
    await expect(page.locator('.ai-component h2')).toHaveText('Production workspace');
  });

  test('named dashboard store remains reactive', async ({ page }) => {
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByTestId('solid-dashboard-page')).toBeVisible();
    await expect(page.locator('.service-row').filter({ hasText: 'query-api' })).toContainText('healthy');

    const requests = page.locator('.metrics article').first().locator('strong');
    const before = Number(await requests.textContent());
    await expect.poll(async () => Number(await requests.textContent()), { timeout: 5_000 }).toBeGreaterThan(before);
  });
});
