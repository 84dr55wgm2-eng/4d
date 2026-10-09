// ACTOR chain: spawn → walk → turn → run → stop → approach architecture → collision holds.
const S = () => window.studio;
export default async ({ run, key, step, capture, log }) => {
  const st = () => run(() => { const a = window.studio.actor; return { p: a.position.toArray().map((v) => +v.toFixed(2)), h: +a.heading.toFixed(2), v: +a.speed.toFixed(2), s: a.state }; });
  await run(() => window.studio.engine.setQuality('balanced'));
  await step(0.5);
  log('spawn', await st());
  await capture('a1-idle');
  await key('KeyW', true); await step(1.6);
  log('walk', await st());
  await capture('a2-walk');
  await key('KeyD', true); await step(0.35);
  log('turning', await st());
  await capture('a3-turn');
  await key('KeyD', false); await step(1.0);
  await key('ShiftLeft', true); await step(1.8);
  log('run', await st());
  await capture('a4-run');
  await key('ShiftLeft', false); await key('KeyW', false); await step(0.25);
  log('stopping', await st());
  await capture('a5-stop');
  await step(1.5);
  log('stopped', await st());
  // approach architecture: face the nearest wall and keep walking into it for 6 s
  const wall = await run(() => {
    const s = window.studio, a = s.actor, c = s.collision; let best = null;
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * Math.PI * 2; const dir = new a.position.constructor(Math.sin(ang), 0, Math.cos(ang));
      const o = a.position.clone(); o.y += 1.0; const d = c.rayDistance(o, dir, 30);
      if (!best || d < best.d) best = { d, ang };
    }
    return best;
  });
  log('nearest wall', wall);
  await run((ang) => { const s = window.studio; s.actor.targetHeading = ang; }, wall.ang);
  await step(1.2);
  await run((ang) => { const a = window.studio.actor; a.desiredDir.set(Math.sin(ang), 0, Math.cos(ang)); a.desiredSpeed = a.walkSpeed; }, wall.ang);
  // drive via the same desiredDir path as input; keep explore input from overriding (input keys are up → it would zero speed), so switch to edit
  await run(() => { window.studio.set({ mode: 'edit' }); });
  await step(4);
  const p1 = await st();
  await step(2);
  const p2 = await st();
  const clearance = await run(() => { const s = window.studio, a = s.actor; const o = a.position.clone(); o.y += 1.0; return s.collision.rayDistance(o, a.desiredDir, 5); });
  log('at wall', p1, p2, 'moved in last 2s:', Math.hypot(p2.p[0] - p1.p[0], p2.p[2] - p1.p[2]).toFixed(3), 'clearance', clearance.toFixed(2));
  await run(() => { const s = window.studio; s.set({ mode: 'explore' }); s.resetFollowCamera(); s.cameras.followYaw += 0.9; });
  await step(0.5);
  await capture('a6-wall');
};
