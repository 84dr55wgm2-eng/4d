// home screen and catalogue panel (test package — NOT GTA)
export default async ({ run, wait, shot, log }) => {
  await shot('h00-home');
  await run(() => window.studio.assembly.importTestPackage());
  await run(() => window.studio.set({ placePanel: false }));
  await wait(200);
  await run(() => window.studio.set({ placePanel: true }));
  await wait(300);
  await run(() => [...document.querySelectorAll('.place-head [role=tab]')].find((b) => b.textContent === 'Catalogue')?.click());
  await wait(300);
  await run(() => { const i = document.querySelector('.place-section .search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'café'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await wait(300);
  await run(() => document.querySelector('.set-main')?.click());
  await wait(300);
  await shot('h01-catalogue');
  await run(() => [...document.querySelectorAll('.place-head [role=tab]')].find((b) => b.textContent === 'Agent')?.click());
  await wait(800);
  await shot('h02-agent');
  log('done');
};
