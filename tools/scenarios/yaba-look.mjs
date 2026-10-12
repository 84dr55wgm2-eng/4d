export default async ({ run, step, capture, log }) => {
  log(await run(() => JSON.stringify({ e: window.studio.store.doc.entities.length, nav: !!window.studio.nav, actor: window.studio.actor?.position.toArray().map((v) => +v.toFixed(2)), missing: window.studio.district?.mats.missing ? [...window.studio.district.mats.missing] : null })));
  await run(() => window.studio.engine.setQuality('high'));
  await step(0.3);
  await capture('y1-follow');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-30, 1.7, -2.5], target: [0, 3.2, -4], focalLength: 24 }));
  await step(0.1); await capture('y2-street-west');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [2, 1.6, 3.0], target: [-8, 2.5, -8], focalLength: 28 }));
  await step(0.1); await capture('y3-cafe-facade');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-2.2, 1.6, -9.0], target: [-10, 1.0, -15], focalLength: 24 }));
  await step(0.1); await capture('y4-interior');
};
