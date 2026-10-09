export default async ({ shot, frames, run }) => {
  await run(() => { const s = window.studio; s.nav.debugObject().visible = true; s.ops.setCamera({ mode: 'director', position: [0, 140, 0.01], target: [0, 0, 0], focalLength: 24 }); s.engine.setQuality('balanced'); });
  await frames(2);
  await shot('top-nav');
};
