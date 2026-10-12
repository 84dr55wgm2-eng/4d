// Interior light after the environment-intensity fix: lights on / off from the entrance, and the workstation close-up.
export default async ({ run, step, capture, log }) => {
  const S = (f, a) => run(f, a);
  await S(() => { const s = window.studio; s.engine.setQuality('balanced'); s.interactions.applyState('door.cafe', 'open'); s.setMode('direct'); s.ops.setCamera({ mode: 'director', position: [-6.5, 1.65, -8.3], target: [-7.5, 1.0, -16.5], focalLength: 24 }); });
  await step(0.2); await capture('t1-interior-on');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', false));
  await step(0.1); await capture('t2-interior-off');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', true));
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-10.2, 1.45, -15.0], target: [-12.2, 0.7, -17.0], focalLength: 35 }));
  await step(0.1); await capture('t3-workstation');
  log('env', await S(() => { let n = 0, with_ = 0; window.studio.district.build.render.traverse((o) => { if (o.isMesh && /interior|ceiling|floor_tile/.test(o.name)) { n++; if (o.material.envMap) with_++; } }); return [n, with_]; }));
};
