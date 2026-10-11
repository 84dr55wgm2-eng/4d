// LIBRARY → select item → click in world → entity placed (real UI clicks), gizmo + inspector, hero view.
export default async ({ page, run, step, capture, shot, log }) => {
  await run(() => window.studio.engine.setQuality('high'));
  await run(() => { const s = window.studio; s.setMode('edit'); s.cameras.setPose(new s.cameras.camera.position.constructor(-17, 3.2, 9), new s.cameras.camera.position.constructor(-7, 0.4, -4)); });
  await step(0.1);
  await page.getByRole('button', { name: 'Open asset library' }).click();
  await page.getByRole('button', { name: 'Vehicles' }).click();
  await capture('u1-library-open');
  await page.getByRole('button', { name: /Concept Car/ }).click();
  log('placing', await run(() => window.studio.ui.placing));
  // click the street in front of the camera
  const pt = await run(() => { const s = window.studio, V = s.cameras.camera.position.constructor; const v = new V(-9.5, 0.2, -1.5); v.project(s.cameras.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
  await page.mouse.click(pt[0], pt[1]);
  await run(() => window.studio.entities.ready());
  const sel = await run(() => { const s = window.studio; const e = s.store.entity(s.ui.selection); return e && { id: e.id, name: e.name, pos: e.transform.position }; });
  log('placed + selected', sel);
  await run((id) => window.studio.ops.rotateEntity(id, 115), sel.id);
  await step(0.05);
  await capture('u2-car-placed-gizmo');
  await page.getByRole('button', { name: 'Close library' }).click();
  await page.getByRole('button', { name: 'Rotate (R)' }).click();
  await step(0.05);
  await capture('u3-rotate-gizmo');
  // HERO VIEW
  await page.keyboard.press('Escape');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-19, 7.5, 16], target: [-4, 2, -10], focalLength: 24 }));
  await step(0.1);
  await capture('u4-hero-view');
  await run(() => window.studio.set({ diagnostics: true }));
  await step(0.6);
  await capture('u5-diagnostics');
};
