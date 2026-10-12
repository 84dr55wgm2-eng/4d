// Touch viewport path with real taps (run with VIEWPORT=390x844): tap actor → tap ground → walk + auto camera,
// tap the café door → action sheet, world menu (creator + command bar), DIRECT sequence panel.
export default async ({ page, run, step, capture, shot, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  const screen = (p) => run((p) => {
    const s = window.studio, v = s.actor.position.clone().set(...p).project(s.cameras.camera), r = s.canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) * r.width / 2, r.top + (1 - v.y) * r.height / 2];
  }, p);
  const tap = async (xy) => { await page.touchscreen.tap(xy[0], xy[1]); await page.waitForTimeout(300); };
  await step(0.1); await capture('t0-start');
  const a = await run(() => window.studio.actor.position.toArray());
  await tap(await screen([a[0], a[1] + 1.0, a[2]]));
  log('selection after actor tap', await run(() => window.studio.ui.selection));
  // tap the door → action sheet
  const d = await run(() => { const b = new window.studio.actor.position.constructor(); const o = window.studio.entities.objects.get('door.cafe'); o.getWorldPosition(b); return b.toArray(); });
  await tap(await screen([d[0] + 0.6, 1.2, d[2] + 0.05]));
  log('interaction target', await run(() => window.studio.ui.interactionTarget));
  await step(0.05); await capture('t3-door-actions');
  await page.getByRole('button', { name: 'Ouvrir', exact: true }).tap();
  await step(6); await step(6); await capture('t3b-door-open');
  log('door', await run(() => window.studio.store.entity('door.cafe').metadata.interaction.state), 'actor', await run(() => window.studio.actor.position.toArray().map((v) => +v.toFixed(2))));
  // a visible patch of ground lower-right of the screen (beside the actor, above the dock)
  await tap([330, 680]);
  await page.waitForTimeout(1500);
  log('walking', await run(() => [window.studio.actor.state, window.studio.cameras.mode]));
  await step(1.5); await capture('t1-walking');
  await step(6); await capture('t2-arrived');
  log('actor', await run(() => window.studio.actor.position.toArray().map((v) => +v.toFixed(2))));
  // world menu: creator + command bar
  await page.tap('button.world-name'); await page.waitForTimeout(800); await shot('t4-world-menu');
  await page.tap('button.world-name'); await page.waitForTimeout(300);
  await run(() => window.studio.set({ mode: 'direct', sequencePanel: true }));
  await page.waitForTimeout(800); await shot('t5-sequence-panel');
  const overflow = await run(() => [document.documentElement.scrollWidth, innerWidth]);
  log('scrollWidth vs innerWidth', overflow);
};
