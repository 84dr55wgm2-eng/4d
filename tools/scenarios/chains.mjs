// CAMERA, EDITING, ASSET and PERSISTENCE acceptance chains (real clicks where it matters).
export default async ({ page, run, step, capture, log, shot }) => {
  const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);
  await run(() => window.studio.engine.setQuality('balanced'));
  await step(0.3);
  await capture('c0-follow-actor');   // tinted outfit check

  // ---- CAMERA: follow → free → director → save shot → move → recall
  await run(() => window.studio.setCameraMode('free'));
  await run(() => { const s = window.studio; s.cameras.setPose(new s.cameras.camera.position.constructor(-20, 6, 14), new s.cameras.camera.position.constructor(-6, 1.5, -2)); });
  await step(0.1);
  log('free cam', await run(() => [window.studio.cameras.mode, window.studio.ui.mode]));
  await capture('c1-free');
  await run(() => { const s = window.studio; s.setMode('direct'); s.ops.setCamera({ position: [-9.5, 1.15, -1.2], focalLength: 85 }); s.ops.setCamera({ lookAtActor: true }); });
  await step(0.2);
  await capture('c2-director-85');
  const savedPose = await run(() => { const s = window.studio; const id = s.ops.saveShot('SHOT_A'); return { id: id.value, pose: s.cameras.currentShot() }; });
  await run(() => window.studio.ops.setCamera({ position: [-18, 3, 10], target: [-8, 1, 0], focalLength: 24 }));
  await step(0.2);
  await run(() => window.studio.ops.recallShot('SHOT_A'));
  await step(1.2);
  const recalled = await run(() => window.studio.cameras.currentShot());
  log('CAMERA recall matches', near(recalled.position, savedPose.pose.position, 0.01) && near(recalled.target, savedPose.pose.target, 0.01) && recalled.focalLength === 85);
  await capture('c3-recalled-shot');

  // ---- EDITING: select by real click → move → rotate → undo → redo
  await run(() => { const s = window.studio; s.setMode('edit'); s.cameras.setPose(new s.cameras.camera.position.constructor(-12.5, 2.4, 4.2), new s.cameras.camera.position.constructor(-10.2, 0.5, 1.2)); });
  await step(0.1);
  await capture('e0-before-click');
  const scr = await run(() => { const s = window.studio; const o = s.entities.objects.get('prop.cone1'); const v = o.position.clone(); v.y += 0.3; v.project(s.cameras.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; });
  await page.mouse.click(scr[0], scr[1]);
  log('selected by click:', await run(() => window.studio.ui.selection));
  await run(() => window.studio.ops.moveEntity('prop.cone1', [0.9, 0, -0.6], { relative: true }));
  await run(() => window.studio.ops.rotateEntity('prop.cone1', 35));
  const moved = await run(() => window.studio.store.entity('prop.cone1').transform);
  await step(0.05);
  await shot('e1-selected-moved');   // full page: inspector + dock + gizmo
  await run(() => window.studio.store.undo());
  const afterUndo = await run(() => window.studio.store.entity('prop.cone1').transform);
  await run(() => window.studio.store.redo());
  const afterRedo = await run(() => window.studio.store.entity('prop.cone1').transform);
  log('EDIT undo reverted rotation', !near(afterUndo.rotation, moved.rotation), 'redo restored', near(afterRedo.rotation, moved.rotation) && near(afterRedo.position, moved.position));

  // ---- ASSET: library item → load → place → entity created
  const placed = await run(async () => { const s = window.studio; await s.registry.loadGLTF('khr.chairdamaskpurplegold'); const r = s.ops.placeAsset('khr.chairdamaskpurplegold', [-11.6, 0, 2.6], 200); await s.entities.ready(); return r; });
  log('ASSET placed', placed);
  await step(0.05);
  await capture('e2-placed-chair');
  const saved = await run(() => window.studio.save());
  log('saved', saved, await run(() => window.studio.ui.saveState));

  // ---- PERSISTENCE: reload → transforms, placed asset and shot survive
  await page.reload();
  await page.waitForFunction(() => window.studio?.ui.phase === 'ready', null, { timeout: 600000 });
  const after = await run(() => { const s = window.studio; return { cone: s.store.entity('prop.cone1')?.transform, chair: s.store.doc.entities.find((e) => e.assetId === 'khr.chairdamaskpurplegold')?.id, shots: s.store.doc.shots.map((x) => x.name), cache: s.registry.status('khr.chairdamaskpurplegold'), hits: s.registry.cache.stats.hits }; });
  log('PERSIST cone', near(after.cone.position, moved.position) && near(after.cone.rotation, moved.rotation), 'chair', !!after.chair, 'shots', after.shots, 'chair cache', after.cache, 'opfs hits', after.hits);
  await run(() => window.studio.engine.setQuality('balanced'));
  await run(() => window.studio.ops.recallShot('SHOT_A', 0));
  await step(0.1);
  await capture('p1-after-reload-shotA');
};
