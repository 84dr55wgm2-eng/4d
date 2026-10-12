// Touch viewport (VIEWPORT=390x844): creator panel with parameters + top view, sequence panel with editable actions.
export default async ({ page, run, shot, log }) => {
  // let the post-load stocking of nearby shops settle (software GL is slow)
  await page.waitForFunction(() => window.studio.dresser && window.studio.dresser.stats.loading === 0 && window.studio.dresser.stats.dressed > 3, null, { timeout: 300000 }).catch(() => {});
  await page.tap('button.world-name'); await page.waitForTimeout(600);
  const prep = page.getByRole('button', { name: 'Préparer le plan de quartier' });
  await prep.scrollIntoViewIfNeeded(); await prep.tap(); await page.waitForTimeout(800);
  await page.locator('.plan-map').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await shot('u1-creator-params');
  log('overflow', await run(() => [document.documentElement.scrollWidth, innerWidth]));
  await page.tap('button.world-name'); await page.waitForTimeout(300);
  await run(() => { window.studio.set({ mode: 'direct', sequencePanel: true }); });
  await page.waitForTimeout(500);
  const idle = () => page.waitForFunction(() => window.studio.dresser.stats.loading === 0, null, { timeout: 300000 }).catch(() => {});
  await idle(); await page.getByRole('button', { name: 'Nouvelle', exact: true }).tap({ timeout: 120000 }); await page.waitForTimeout(400);
  await idle(); await page.getByRole('button', { name: '+ Action', exact: true }).tap({ timeout: 120000 }); await page.waitForTimeout(400);
  await page.locator('.beats').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await shot('u2-sequence-actions');
  log('beats', await run(() => window.studio.ops.sequence().beats.map((b) => b.label)));
  log('overflow', await run(() => [document.documentElement.scrollWidth, innerWidth]));
};
