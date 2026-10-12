// Boot phase timings + render cost of the current view with/without the new elements (diagnostics).
export default async ({ run, log }) => {
  log('boot', await run(() => performance.getEntriesByType('mark').filter((m) => m.name.startsWith('boot:')).map((m) => `${m.name} ${(m.startTime / 1000).toFixed(1)}s`)));
  const cost = (label) => run((label) => {
    const s = window.studio, e = s.engine; e.paused = true;
    const t0 = performance.now(); e.renderOnce(); const t1 = performance.now(); e.renderOnce(); const t2 = performance.now();
    const i = e.renderer.info;
    return `${label}: ${(t2 - t1).toFixed(0)} ms (first ${(t1 - t0).toFixed(0)}), calls ${i.render.calls}, tris ${i.render.triangles}, programs ${i.programs?.length}, lights ${(() => { let n = 0; s.engine.scene.traverse((o) => { if (o.isLight && o.visible) n++; }); return n; })()}`;
  }, label);
  await run(() => { const s = window.studio; s.setMode('direct'); s.ops.setCamera({ mode: 'director', position: [-24, 1.6, 0.5], target: [-20, 2.6, -8], focalLength: 24 }); });
  log(await cost('street'));
  await run(() => { window.studio.dresser && (window.studio.dresser.group.visible = false); });
  log(await cost('street, no dressing'));
  await run(() => { window.studio.dresser && (window.studio.dresser.group.visible = true); window.studio.engine.scene.getObjectByName('__cws_semantic_fill') && (window.studio.engine.scene.getObjectByName('__cws_semantic_fill').visible = false); });
  log(await cost('street, no fill light'));
  await run(() => { window.studio.engine.scene.getObjectByName('__cws_semantic_light').visible = false; });
  log(await cost('street, no café lights'));
  log('dresser', await run(() => window.studio.dresser?.stats), 'entities', await run(() => window.studio.entities.stats));
};
