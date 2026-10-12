// Reference action: walk to the cybercafé, open the door, enter, reach a workstation and sit.
export default async ({ run, step, capture, log }) => {
  await run(() => window.studio.engine.setQuality('balanced'));
  const exec = async (id, action, maxSec = 60) => {
    await run(([id, action]) => { window.__r = null; window.studio.interactions.execute(id, action).then((r) => (window.__r = r)); }, [id, action]);
    for (let t = 0; t < maxSec; t += 0.5) { await step(0.5); const r = await run(() => window.__r); if (r) return r; }
    return { ok: false, error: 'timeout' };
  };
  const pos = () => run(() => window.studio.actor.position.toArray().map((v) => +v.toFixed(2)));
  // closed door must block a direct path inside
  log('path through closed door:', await run(() => window.studio.ops.moveActorTo([-9, 0.21, -12])));
  log('open door:', await exec('door.cafe', 'open'), await pos());
  await run(() => { const s = window.studio; s.cameras.setMode('follow'); s.resetFollowCamera(); });
  await step(0.6);
  await capture('a1-door-open');
  log('sit:', await exec('ws.1.chair', 'sit'), await pos(), await run(() => window.studio.actor.seated));
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-9.8, 1.5, -12.6], target: [-11.6, 1.0, -15.5], focalLength: 35 }));
  await step(0.2);
  await capture('a2-seated');
  log('stand:', await exec('ws.1.chair', 'stand'), await pos());
  log('lights off:', await exec('light.cafe', 'toggle'));
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-2.2, 1.6, -9.0], target: [-10, 1.0, -15], focalLength: 24 }));
  await step(0.2);
  await capture('a3-lights-off');
};
