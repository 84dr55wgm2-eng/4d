// Place studio, request B (test package — NOT GTA content) through the AGENT LOOP with the scripted test provider
// (tools/tests/mock-relay.mjs, not a model): the relay answers tool calls, the browser executes them on the real
// studio state. Checks: provider_not_configured without a relay, real tool execution, a refused call reported as
// an error (no fake success), verification, save/reopen.
export default async ({ run, wait, log, capture, shot }) => {
  const T = (set, tool, args) => run(([s, t, a]) => Promise.resolve(window.studio.tools.callTool(s, t, a)).then((r) => JSON.parse(JSON.stringify(r ?? null))), [set, tool, args]);
  const waitReady = async () => { for (let i = 0; i < 120; i++) { const p = await run(() => window.studio?.ui.phase).catch(() => null); if (p === 'ready') return p; await wait(3000); } throw new Error('ready timeout'); };
  await run(() => window.studio.assembly.importTestPackage());
  // 1. no relay configured
  log('status (none)', JSON.stringify(await run(() => window.studio.agent.status())));
  await run(() => window.studio.agent.ask('Une cour avec un accès depuis la rue et une petite boutique'));
  log('log (none)', JSON.stringify(await run(() => window.studio.agent.log.map((l) => [l.kind, l.text.slice(0, 160)]))));
  // 2. scripted test relay
  await run(() => window.studio.agent.setConfig({ url: 'http://127.0.0.1:8790/', token: 'test' }));
  log('status (mock)', JSON.stringify(await run(() => window.studio.agent.status())));
  await run(() => { window.studio.agent.reset(); return window.studio.agent.ask('Une cour avec un accès depuis la rue et une petite boutique'); });
  const lg = await run(() => window.studio.agent.log.map((l) => ({ kind: l.kind, text: l.text.slice(0, 120), ok: l.ok, out: l.kind === 'tool' ? JSON.stringify(l.output).slice(0, 260) : undefined })));
  for (const l of lg) log('agent', JSON.stringify(l));
  const st = await T('assembly', 'state', {});
  log('state', JSON.stringify({ placements: st.placements, junctions: st.junctions }));
  // population: a shopkeeper customer flow at the courtyard shop door
  const court = st.placements.find((p) => /court/.test(p.ref));
  const shopDoor = (await T('catalog', 'inspect_set', { ref: court.ref })).connectors.find((c) => c.kind === 'door').id;
  log('add people', JSON.stringify(await T('population', 'add_entities', { resource: 'fixture.test-city/cesiumman', count: 2, placement: court.id, at: shopDoor, behavior: 'customer' })).slice(0, 200));
  await run(() => window.studio.assembly.rebuildGeometry());
  log('verify', JSON.stringify(await T('assembly', 'verify', {})));
  await T('population', 'set_actor', { resource: 'fixture.test-city/cesiumman' }).catch(() => undefined);
  await wait(4000); await waitReady();
  await run(() => window.studio.assembly.waitForSets()); await wait(1500);
  log('reopened', JSON.stringify(await T('assembly', 'state', {})).slice(0, 400));
  log('verify after reopen', JSON.stringify(await T('assembly', 'verify', {})));
  await run(() => { const s = window.studio; s.set({ placePanel: false }); s.setCameraMode('director'); s.ops.setCamera({ position: [-30, 30, 95], target: [-2, 0, 62], focalLength: 24 }); });
  await capture('b01-overview');
  await run(() => { const s = window.studio; s.set({ placePanel: true }); });
  await wait(300);
  await shot('b02-agent-panel');
};
