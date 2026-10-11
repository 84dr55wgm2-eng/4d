export default async ({ page, run, step, capture, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  await run(async () => { const s = window.studio; for (const id of ['khr.carconcept', 'tjs.ferrari', 'tjs.bike', 'khr.chairdamaskpurplegold', 'khr.glamvelvetsofa', 'khr.diffusetransmissionplant', 'khr.lantern']) await s.registry.loadGLTF(id).catch((e) => console.error(id, e.message)); });
  await step(0.1);
  await page.waitForFunction(() => window.studio.thumbnails.get('tjs.bike'), null, { timeout: 300000 });
  log('thumbs', await run(() => window.studio.registry.manifest.assets.filter((a) => window.studio.thumbnails.get(a.id)).map((a) => a.id)));
  await page.getByRole('button', { name: 'Open asset library' }).click({ force: true });
  await page.waitForTimeout(1500);
  await capture('t1-library-thumbs');
};
