export default async ({ page, run, step, capture, shot, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  const S = (f, a) => run(f, a);
  // ---- targeted edits
  log('add 2 back:', await S(() => window.studio.ops.command('Ajoute deux postes le long du mur du fond')));
  log('entities now', await S(() => window.studio.store.doc.entities.length));
  log('undo', await S(() => { window.studio.store.undo(); return window.studio.store.doc.entities.length; }));
  log('enlarge:', await S(() => window.studio.ops.command('Agrandis le cybercafé de 3 m en conservant la rue')));
  log('cafe depth', await S(() => window.studio.store.doc.district.buildings.find((b) => b.id === 'b.cafe').depth));
  await S(() => { const s = window.studio; s.setMode('edit'); s.select('ws.2.chair'); s.select('ws.3.crt'); });
  log('seat chair:', await S(() => window.studio.ops.command('Déplace cette chaise devant cet ordinateur')));
  log('chairs at ws3', await S(() => window.studio.store.doc.relations.filter((r) => r.kind === 'seatFor' && r.to === 'ws.3.desk').map((r) => r.from)));
  await step(0.6); // nav rebuild debounce runs on timers; give it time
  await page.waitForTimeout(1500);
  await S(() => window.studio.ops.setCamera({ mode: 'director', position: [-2.4, 1.7, -9.0], target: [-10.5, 0.9, -17], focalLength: 24 }));
  await step(0.1); await capture('d1-edited-interior');
  log('time:', await S(() => window.studio.ops.command('Passe en fin d’après-midi sans changer les bâtiments')));
  await S(() => window.studio.ops.setCamera({ mode: 'direct', position: [-30, 1.7, -2.5], target: [0, 3.2, -4], focalLength: 24 }));
  await step(0.1); await capture('d2-late-afternoon');
  // ---- reference sequence
  await S(() => window.studio.set({ mode: 'direct', sequencePanel: true }));
  const created = await S(async () => window.studio.ops.createReferenceSequence());
  log('sequence:', created, await S(() => JSON.stringify(window.studio.ops.sequence()?.timing)));
  const seq = await S(() => { const s = window.studio.ops.sequence(); return { id: s.id, cuts: window.studio.sequences.cutTimes(s).map((c) => [c.shotId.slice(0, 8), +c.at.toFixed(1)]) }; });
  log('cuts', seq.cuts);
  for (const [i, t] of [[1, 1.0], [2, seq.cuts[1][1] + 1.5], [3, seq.cuts[2][1] + 4]].map((x) => x)) {
    await S(([id, t]) => window.studio.ops.seekSequence(id, t), [seq.id, t]);
    log(`seek ${t.toFixed(1)} actor`, await S(() => [window.studio.actor.position.toArray().map((v) => +v.toFixed(2)), window.studio.actor.state, window.studio.cameras.mode]));
    await shot(`d3-seq-${i}`);
  }
  // seeking back restores a coherent state (door closed again, actor at start)
  await S(([id]) => window.studio.ops.seekSequence(id, 0.2), [seq.id]);
  log('back to start: door', await S(() => window.studio.store.entity('door.cafe').metadata.interaction.state), 'seated', await S(() => window.studio.actor.seated));
  // ---- export (reduced fps/size for the software-GL test)
  const ex = await S(async (id) => {
    const s = window.studio; const sq = structuredClone(s.ops.sequence(id));
    try { const r = await s.sequences.export(sq, { fps: 4, width: 480 }); return { bytes: r.blob.size, mime: r.mime, frames: r.frames, head: [...new Uint8Array(await r.blob.slice(0, 12).arrayBuffer())].map((b) => b.toString(16)).join(' ') }; }
    catch (e) { return { error: String(e) }; }
  }, seq.id);
  log('export:', ex);
  log('save', await S(() => window.studio.save()));
  await page.reload();
  await page.waitForFunction(() => window.studio?.ui.phase === 'ready', null, { timeout: 600000 });
  log('after reload', await S(() => ({ seqs: window.studio.store.doc.sequences?.length, shots: window.studio.store.doc.shots.length, depth: window.studio.store.doc.district.buildings.find((b) => b.id === 'b.cafe').depth, sun: window.studio.store.doc.environment.sun })));
};
