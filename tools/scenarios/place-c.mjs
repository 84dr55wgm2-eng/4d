// Direction in an assembled place (test package — NOT GTA): sequence with a population member and the embodied
// character on one clock; play → stop → resume (re-simulated) → seek; capture frames.
export default async ({ run, wait, log, capture }) => {
  const T = (set, tool, args) => run(([s, t, a]) => Promise.resolve(window.studio.tools.callTool(s, t, a)).then((r) => JSON.parse(JSON.stringify(r ?? null))), [set, tool, args]);
  const waitReady = async () => { for (let i = 0; i < 120; i++) { const p = await run(() => window.studio?.ui.phase).catch(() => null); if (p === 'ready') return p; await wait(3000); } throw new Error('ready timeout'); };
  await run(() => window.studio.assembly.importTestPackage());
  const r = await T('assembly', 'apply_plan', { steps: [
    { op: 'place_set', input: { ref: 'fixture.test-city/cross:fx_downtown#10', position: [0, 0, 0] } },
    { op: 'place_set', input: { ref: 'fixture.test-city/street:fx_residential#0' } },
    { op: 'connect_sets', input: { a: { placement: '$0', connector: 'road1' }, b: { placement: '$1', connector: 'road3' } } },
    { op: 'place_set', input: { ref: 'fixture.test-city/bldg:fx_downtown#1', position: [13.0, 0, 0], yaw: 90, name: 'Café' } },
    { op: 'add_entities', input: { resource: 'fixture.test-city/cesiumman', count: 2, placement: '$1', behavior: 'wander', name: 'Passant' } },
  ] });
  log('plan', r.ok, r.error ?? '');
  await T('population', 'set_actor', { resource: 'fixture.test-city/cesiumman' }).catch(() => undefined);
  await wait(4000); await waitReady();
  await run(() => window.studio.assembly.waitForSets()); await wait(1500);
  const st = await T('assembly', 'state', {});
  const extra = st.population.find((p) => p.sim.kind === 'person').id;
  const seq = await T('direction', 'create', { name: 'Rencontre au carrefour' });
  log('sequence', JSON.stringify(seq));
  const id = seq.value;
  log('beats', JSON.stringify([
    await T('direction', 'add_beat', { sequence: id, beat: { kind: 'moveTo', actor: extra, position: [4, 0.3, 2], label: 'Le passant va au carrefour' } }),
    await T('direction', 'add_beat', { sequence: id, beat: { kind: 'moveTo', position: [3, 0.3, -1], label: 'Le personnage le rejoint' } }),
    await T('direction', 'add_beat', { sequence: id, beat: { kind: 'wait', seconds: 1.5, label: 'Ils se font face' } }),
    await T('direction', 'add_beat', { sequence: id, beat: { kind: 'moveTo', actor: 'nobody', position: [0, 0, 0], label: 'invalide' } }),
  ]));
  await T('camera', 'set', { position: [-8, 6, 12], target: [3, 0.8, 0], focalLength: 28 });
  const shot = await T('camera', 'save_shot', { name: 'Large carrefour' });
  log('shot', JSON.stringify(shot));
  log('cut', JSON.stringify(await T('direction', 'add_cut', { sequence: id, shot: shot.value, beat: 1, offset: 0 })));
  log('rehearse', JSON.stringify(await T('direction', 'rehearse', { id })));
  await run(() => { window.studio.engine.paused = false; });
  await run((i) => { void window.studio.ops.playSequence(i); }, id);
  await wait(6000);
  await T('direction', 'stop', {});
  const stoppedAt = await run(() => window.studio.sequences.time);
  log('stopped at', stoppedAt.toFixed(2), JSON.stringify(await run((x) => window.studio.sim.people.find((p) => p.id === x)?.obj.position.toArray().map((v) => +v.toFixed(2)), extra)));
  const res = await T('direction', 'resume', { id });
  log('resumed at', JSON.stringify(res), 'playing', await run(() => window.studio.sequences.playing));
  await wait(3000);
  log('time after resume', (await run(() => window.studio.sequences.time)).toFixed(2));
  await T('direction', 'stop', {});
  log('seek', JSON.stringify(await T('direction', 'seek', { id, t: 4 })));
  await run(() => window.studio.set({ placePanel: false }));
  await capture('c01-seek-4s');
  log('seek end', JSON.stringify(await T('direction', 'seek', { id, t: 30 })));
  log('positions', JSON.stringify(await run((x) => ({ extra: window.studio.sim.people.find((p) => p.id === x)?.obj.position.toArray().map((v) => +v.toFixed(2)), actor: window.studio.actor.position.toArray().map((v) => +v.toFixed(2)) }), extra)));
  await capture('c02-end');
};
