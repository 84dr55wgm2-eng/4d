// Pass 3b: interior light on/off, signs above awnings, sequence stop during the walk, edited short sequence.
export default async ({ run, step, capture, log }) => {
  const S = (f, a) => run(f, a);
  await S(() => window.studio.engine.setQuality('balanced'));
  await S(() => { window.studio.interactions.applyState('door.cafe', 'open'); window.studio.setMode('direct'); window.studio.ops.setCamera({ mode: 'director', position: [-6.5, 1.65, -8.3], target: [-7.5, 1.0, -16.5], focalLength: 24 }); });
  await step(0.2); await capture('q1-interior-on');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', false));
  await step(0.1); await capture('q2-interior-off');
  await S(() => window.studio.interactions.applyState('light.cafe', 'toggle', true));
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-24, 1.6, 0.5], target: [-20, 2.6, -8], focalLength: 24 }));
  for (let i = 0; i < 3; i++) await step(1);
  await capture('q3-signs');
  await S(() => window.studio.interactions.applyState('door.cafe', 'close'));
  // reference sequence: play, stop during the walk → the actor must stop where he is
  const seq = await S(async () => window.studio.ops.createReferenceSequence());
  log('sequence', seq, await S(() => JSON.stringify(window.studio.ops.sequence().timing)));
  await S((id) => window.studio.ops.playSequence(id), seq.value);
  for (let i = 0; i < 8; i++) await step(0.5);
  const before = await S(() => [window.studio.actor.position.toArray().map((v) => +v.toFixed(2)), window.studio.actor.state, window.studio.actor.path.length]);
  await S(() => window.studio.ops.stopSequence());
  for (let i = 0; i < 6; i++) await step(0.5);
  const after = await S(() => [window.studio.actor.position.toArray().map((v) => +v.toFixed(2)), window.studio.actor.state, window.studio.actor.path.length, window.studio.sequences.playing]);
  log('stop during walk: before', before, 'after 3 s', after);
  // short edited sequence: lights off, pause, lights on — added, reordered, timed, played, seeked, exported
  const id = (await S(() => window.studio.ops.createSequence('Courte'))).value;
  log('add', await S((id) => window.studio.ops.addBeat(id, { kind: 'interact', target: 'door.cafe', action: 'open', label: 'Ouvrir la porte' }), id));
  log('add', await S((id) => window.studio.ops.addBeat(id, { kind: 'interact', target: 'light.cafe', action: 'toggle', label: 'Éteindre' }), id));
  log('add', await S((id) => window.studio.ops.addBeat(id, { kind: 'interact', target: 'light.cafe', action: 'toggle', label: 'Rallumer' }), id));
  const beats = await S((id) => window.studio.ops.sequence(id).beats.map((b) => b.id), id);
  // beats: [Pause, Ouvrir, Éteindre, Rallumer] → move the pause down twice: [Ouvrir, Éteindre, Pause, Rallumer]
  log('move pause', await S(([id, b]) => window.studio.ops.moveBeat(id, b, 1), [id, beats[0]]), await S(([id, b]) => window.studio.ops.moveBeat(id, b, 1), [id, beats[0]]));
  log('cuts follow their action', await S((id) => window.studio.ops.sequence(id).cuts.map((c) => c.beat), id));
  log('pause 1.5 s', await S(([id, b]) => window.studio.ops.updateBeat(id, b, { seconds: 1.5 }), [id, beats[0]]));
  log('bad target', await S(([id, b]) => window.studio.ops.updateBeat(id, b, { kind: 'interact', target: 'nope', action: 'open' }), [id, beats[0]]));
  log('stale', await S((id) => window.studio.sequences.isStale(window.studio.ops.sequence(id)), id));
  log('seek 12', await S((id) => window.studio.ops.seekSequence(id, 12), id), await S(() => window.studio.store.entity('light.cafe').metadata.interaction.enabled));
  log('timed', await S((id) => JSON.stringify(window.studio.ops.sequence(id).timing), id), 'stale', await S((id) => window.studio.sequences.isStale(window.studio.ops.sequence(id)), id));
  log('labels', await S((id) => window.studio.ops.sequence(id).beats.map((b) => b.label), id));
  const ex = await S(async (id) => {
    const s = window.studio;
    try { const r = await s.sequences.export(structuredClone(s.ops.sequence(id)), { fps: 4, width: 320 }); return { bytes: r.blob.size, mime: r.mime, frames: r.frames, head: [...new Uint8Array(await r.blob.slice(0, 4).arrayBuffer())].map((b) => b.toString(16)).join(' ') }; }
    catch (e) { return { error: String(e) }; }
  }, id);
  log('export', ex);
  // failure is reported: a beat whose target disappears
  await S((id) => { const s = window.studio; s.store.commit('test', (d) => { const sq = d.sequences.find((x) => x.id === id); sq.beats.push({ id: 'b.bad', kind: 'interact', label: 'Ouvrir une porte supprimée', target: 'door.missing', action: 'open' }); }); }, id);
  log('seek with failing beat', await S((id) => window.studio.ops.seekSequence(id, 9), id), 'engine paused', await S(() => window.studio.engine.paused));
  log('memory', await S(() => window.studio.registry.memoryStats()), await S(() => window.studio.entities.stats));
};
