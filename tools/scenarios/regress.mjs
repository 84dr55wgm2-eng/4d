// regression: a bundled world still opens with its actor and navigation
export default async ({ run, log, capture }) => {
  log(JSON.stringify(await run(() => ({ world: window.studio.store.doc.id, entities: window.studio.store.doc.entities.length, actor: !!window.studio.actor, nav: !!window.studio.nav, panel: window.studio.ui.placePanel ?? null, worlds: window.studio.worlds.length }))));
  await capture('r-' + (await run(() => window.studio.store.doc.id)));
};
