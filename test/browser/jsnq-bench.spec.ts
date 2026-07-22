import { test, expect } from '@playwright/test';

test('jsnq browser benchmark - logs + screenshot', async ({ page }) => {
  test.setTimeout(120_000);
  // Capture console logs early (before goto) to catch performance numbers from benchmark
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.goto('/jsnq-browser-bench.html');

  // Wait for benchmark to finish (we set document.title as signal)
  await page.waitForFunction(() => document.title === 'jsnq-bench-complete', { timeout: 90_000 });

  // Take screenshot of the results
  await page.screenshot({
    path: 'test-results/jsnq-browser-bench.png',
    fullPage: true,
  });

  // The page sets the title when done. We mainly care about screenshot + that it ran without crash.
  await expect(page).toHaveTitle('jsnq-bench-complete', { timeout: 5000 });

  const results = await page.evaluate(() => (window as any).__JSNQ_BENCH_RESULTS);
  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBeGreaterThanOrEqual(3);
  for (const result of results) {
    expect(result.ok).toBe(true);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.avgMs).toBeGreaterThanOrEqual(0);
    expect(result.ops).toBeGreaterThan(0);
  }

  // Explicit perf/timing assertions from captured logs; this is a real Vite import path, not a simulated page.
  expect(logs.some((l) => /real jsnq browser benchmark/i.test(l))).toBeTruthy();
  expect(logs.some((l) => /flat-where-update-5000-real-store:.*avg=.*ms/.test(l))).toBeTruthy();
  expect(logs.some((l) => /flat-deleteKey-10000-real-store:.*avg=.*ms/.test(l))).toBeTruthy();

  // Log whatever console output we got (useful for debugging in CI)
  console.log('Captured console from browser benchmark page:', logs);
});
