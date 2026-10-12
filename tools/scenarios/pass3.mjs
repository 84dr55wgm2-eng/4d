// Pass 3 validation: automatic framing, café path, shop dressing, lights, spatial edit + undo,
// sequence stop during the walk, short edited sequence (play / seek / export).
export default async ({ run, step, capture, log }) => {
  const S = (f, a) => run(f, a);
  await S(() => window.studio.engine.setQuality('balanced'));
  const cam = () => S(() => { const s = window.studio, c = s.cameras.camera.position, a = s.actor.position; return { kind: s.cameras.framingKind, dist: +Math.hypot(c.x - a.x, c.z - a.z).toFixed(2), h: +(c.y - a.y).toFixed(2), lens: s.cameras.focalLength, actor: a.toArray().map((v) => +v.toFixed(2)) }; });
  await step(0.5); log('start', await cam()); await capture('p1-follow-exterior');
  // walk to the café door and open it (the actor approaches, camera follows on its own)
  const door = S(() => window.studio.ops.interact('door.cafe', 'open'));
  for (let i = 0; i < 4; i++) await step(2);
  log('walk', await cam()); await capture('p2-follow-walk');
  for (let i = 0; i < 6; i++) await step(2);
  log('door', await door, await S(() => window.studio.store.entity('door.cafe').metadata.interaction.state));
  const sit = S(() => window.studio.ops.interact('ws.1.chair', 'sit'));
  for (let i = 0; i < 3; i++) await step(1.5);
  log('entering', await cam()); await capture('p3-follow-interior');
  for (let i = 0; i < 8; i++) await step(2);
  log('sit', await sit, await S(() => window.studio.actor.seated), await cam()); await capture('p4-seated');
  // interior lit / unlit (director view from the entrance)
  await S(() => { window.studio.setMode('direct'); window.studio.ops.setCamera({ mode: 'director', position: [-6.5, 1.65, -8.3], target: [-7.5, 1.0, -16.5], focalLength: 24 }); });
  await step(0.1); await capture('p5-interior-on');
  log('lights off', await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', false)));
  await step(0.1); await capture('p6-interior-off');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', true));
  // close-up of a workstation (alignment, socket, cable)
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-10.2, 1.45, -15.0], target: [-12.2, 0.7, -17.0], focalLength: 35 }));
  await step(0.1); await capture('p7-workstation');
  // shops: stocked recesses across the street and on the café side
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-30, 1.6, -1.5], target: [-30, 1.2, -9], focalLength: 28 }));
  for (let i = 0; i < 6; i++) await step(1);
  log('dresser', await S(() => window.studio.dresser.stats), await S(() => [...window.studio.dresser.missing]));
  await capture('p8-shop-provisions');
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [6, 1.6, 1.0], target: [6.4, 1.2, 9], focalLength: 28 }));
  for (let i = 0; i < 6; i++) await step(1);
  await capture('p9-shop-north');
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [12, 1.6, -1.0], target: [15.6, 1.2, -9], focalLength: 28 }));
  for (let i = 0; i < 6; i++) await step(1);
  await capture('p10-shop-south');
  log('memory', await S(() => window.studio.registry.memoryStats()));
  // spatial edit + undo
  log('enlarge', await S(() => window.studio.ops.command('Agrandis le cybercafé de 3 m en conservant la rue')), await S(() => window.studio.store.doc.district.buildings.find((b) => b.id === 'b.cafe').depth));
  log('undo', await S(() => { window.studio.store.undo(); return window.studio.store.doc.district.buildings.find((b) => b.id === 'b.cafe').depth; }));
};
