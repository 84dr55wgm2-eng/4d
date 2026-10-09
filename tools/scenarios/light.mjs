export default async ({ run, step, capture, log }) => {
  await run(() => { const s = window.studio; s.engine.setQuality('high'); s.ops.setCamera({ mode: 'director', position: [-15.5, 2.0, 10.5], target: [-3, 2.6, -14], focalLength: 24 }); });
  const opts = [[215, 28, 3.4], [-20, 38, 3.6], [160, 34, 3.6], [35, 30, 3.6]];
  for (const [az, el, it] of opts) {
    await run(([az, el, it]) => window.studio.engine.setSun(az, el, it), [az, el, it]);
    await step(0.05);
    await capture(`l-${az}-${el}`);
  }
};
