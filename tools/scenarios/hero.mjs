export default async ({ shot, frames, run, log }) => {
  await frames(2);
  log(await run(() => JSON.stringify({ stats: window.studio.engine.stats, actor: window.studio.ops.getState().actor })));
  await shot('01-explore');
  await run(() => window.studio.ops.setCamera({ mode: 'director', position: [-12, 1.7, 8], target: [2, 4, -22], focalLength: 24 }));
  await frames(2);
  await shot('02-director-street');
};
