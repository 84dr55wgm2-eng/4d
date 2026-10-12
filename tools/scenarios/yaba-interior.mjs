export default async ({ run, step, capture, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  await run(() => { window.studio.interactions.applyState('door.cafe', 'open'); window.studio.set({ mode: 'direct' }); });
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-1.4, 1.6, -8.1], target: [-10.5, 1.0, -16.5], focalLength: 24 }));
  await step(0.1); await capture('i1-interior');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-11.8, 1.6, -8.1], target: [-2.5, 1.1, -17.5], focalLength: 24 }));
  await step(0.1); await capture('i2-interior');
  log('ok');
};
