// Browser ↔ private conversion service (environment B) with a FIXTURE job (no game files, NOT GTA content):
// health (reports what is missing for GTA), job creation, progress polling, private package download + import.
export default async ({ run, wait, log }) => {
  await run(() => window.studio.conversion.setConfig({ url: 'http://127.0.0.1:8787/', token: 'svc-test' }));
  log('health', JSON.stringify(await run(() => window.studio.conversion.health())));
  const job = await run(() => window.studio.conversion.createFixture());
  log('job', job.id, job.status);
  let j = job;
  for (let i = 0; i < 120 && !['done', 'failed', 'blocked'].includes(j.status); i++) { await wait(3000); j = await run((id) => window.studio.conversion.job(id), job.id); if (i % 5 === 0) log('…', j.status, JSON.stringify(j.progress ?? {}).slice(0, 160)); }
  log('final', j.status, JSON.stringify(j.steps), JSON.stringify(j.error ?? null));
  if (j.status !== 'done') return;
  log('import', JSON.stringify(await run(async (id) => { const [u, init] = await window.studio.conversion.packageRequest(id); const e = await window.studio.assembly.importUrl(u, init); return e; }, job.id)));
  log('catalog', JSON.stringify(await run(() => window.studio.assembly.catalog.list())));
  const region = await run(() => window.studio.conversion.createRegion('GTA zone test', [-200, -200, 200, 200]).then((x) => x, (e) => ({ error: String(e) })));
  await wait(3000);
  log('region job without game files', JSON.stringify(await run((id) => window.studio.conversion.job(id), region.id).catch((e) => String(e))));
};
