import { expect, test } from '@playwright/test';

test('signs in, traces a fixture wrapper and opens the saved waterfall', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('fixture@example.com');
  await page.getByLabel('Password').fill('FixturePassword');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'New inspection' }),
  ).toBeVisible();
  await page
    .getByLabel('VAST tag URL')
    .fill('https://ads.fixture.example/wrapper');
  await page.getByRole('button', { name: 'Run inspection' }).click();

  const waterfall = page.getByRole('region', { name: 'Request waterfall' });
  const history = page.getByRole('region', { name: 'Run history' });
  await expect(waterfall.getByText('Completed')).toBeVisible();
  await expect(
    history.getByRole('button', { name: /ads.fixture.example/ }),
  ).toContainText('Completed');
  await expect(waterfall.getByText('1. wrapper')).toBeVisible();
  await expect(waterfall.getByText('2. inline')).toBeVisible();
  await expect(waterfall.getByText('IMP-MISSING')).toBeVisible();
  await waterfall.getByRole('button', { name: 'Explain findings' }).click();
  await expect(waterfall.getByText('Rule guidance')).toBeVisible();
  await expect(
    waterfall.getByRole('list', { name: 'Suggested fixes' }),
  ).toContainText('Add an Impression element');
  await expect(
    waterfall.getByRole('button', { name: 'Regenerate explanation' }),
  ).toBeEnabled();
  await waterfall.getByText('View redacted XML').first().click();
  const preview = waterfall.locator('pre').first();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('<VASTAdTagURI>');
  await expect(preview).not.toContainText('token=fixture');
  await page.screenshot({
    path: testInfo.outputPath('dashboard.png'),
    fullPage: true,
  });

  await page.reload();
  await history.getByRole('button', { name: /ads.fixture.example/ }).click();
  await expect(
    waterfall.getByText('Add an Impression element', { exact: false }),
  ).toBeVisible();

  const xml =
    '<VAST version="4.3"><Ad><InLine><AdTitle>Local draft</AdTitle></InLine></Ad></VAST>';
  await page.getByRole('button', { name: 'Paste XML' }).click();
  await page.getByLabel('VAST XML').fill(xml);
  await page.getByRole('button', { name: 'Run inspection' }).click();
  await waterfall.getByText('View submitted XML').click();
  await expect(waterfall.locator('pre')).toContainText('Local draft');

  await page.reload();
  await history.getByRole('button', { name: /Pasted XML/ }).click();
  await waterfall.getByText('View redacted XML').click();
  await expect(waterfall.locator('pre')).toContainText('[redacted]');
  await expect(waterfall.locator('pre')).not.toContainText('Local draft');

  await page.setViewportSize({ width: 375, height: 800 });
  await page.getByRole('link', { name: 'History' }).click();
  await expect(history).toBeFocused();
  const olderRun = history.getByRole('button', { name: /ads.fixture.example/ });
  await olderRun.click();
  await expect(waterfall).toBeFocused();
  await expect(
    waterfall.getByRole('heading', { name: 'Request waterfall' }),
  ).toBeInViewport();
  await expect(olderRun).toHaveAttribute('aria-pressed', 'true');
  await expect(waterfall.getByText('2. inline')).toBeVisible();
  await expect(
    waterfall.getByRole('list', { name: 'Suggested fixes' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  expect(
    await page.locator('body').evaluate((body) => body.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
