export default async ({run,capture,log}) => {
 const s=await run(()=>({world:window.studio.store.doc.id,actor:!!window.studio.actor,nav:!!window.studio.nav,collision:!!window.studio.collision,mode:window.studio.cameras.mode}));
 if(s.world!=='hidden-alley'||!s.nav||!s.collision||s.actor)throw new Error(JSON.stringify(s));
 log(s);await capture('entrance');
 await run(()=>{const s=window.studio;const p=s.cameras.camera.position.clone().set(1,2,-8);const t=p.clone().set(-2,2,-20);s.cameras.setPose(p,t);});
 await capture('inside');
};