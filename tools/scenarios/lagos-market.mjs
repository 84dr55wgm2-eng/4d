export default async ({page,run,capture,log,step}) => {
 const state=await run(()=>{const s=window.studio;return {world:s.store.doc.id,phase:s.ui.phase,actor:!!s.actor,nav:!!s.nav,collision:!!s.collision,sim:s.sim.stats,clips:s.actor?.clips&&[s.actor.clips.idle.name,s.actor.clips.walk.clip.name,s.actor.clips.run.clip.name],failed:s.entities.stats};});
 if(state.world!=='lagos-market'||state.phase!=='ready'||!state.actor||!state.nav||!state.collision||state.sim.people!==6)throw new Error(JSON.stringify(state));
 log(state);
 await capture('market-overview');
 const before=await run(()=>window.studio.sim.snapshot());
 await step(4);
 const after=await run(()=>window.studio.sim.snapshot());
 if(!Object.keys(before.people).some(id=>Math.hypot(...before.people[id].p.map((v,i)=>v-after.people[id].p[i]))>0.3))throw new Error('Crowd did not advance');
 await run(()=>{const s=window.studio;s.cameras.goTo(s.store.doc.shots[1],0);});
 await capture('market-stalls');
 await run(()=>{const s=window.studio;s.cameras.setMode('director');const p=s.cameras.camera.position.clone().set(0.8,1.5,2.2);const t=p.clone().set(0,1.2,0);s.cameras.setPose(p,t);});
 await capture('civilian-close');
 // Pointer interaction, not a hidden scripted movement path: project the actor,
 // tap it, then project an actual navigable destination and tap that ground.
 await run(()=>{const s=window.studio;s.actor.place(s.nav.closest(s.actor.position),Math.PI);s.cameras.goTo(s.store.doc.shots[0],0);s.setMode('explore');s.cameras.setMode('free');});
 const project=async(p)=>run(p=>{const s=window.studio;const r=s.canvas.getBoundingClientRect();const v=s.actor.position.clone().fromArray(p).project(s.cameras.camera);return {x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};},p);
 const actorP=await run(()=>window.studio.actor.position.toArray().map((v,i)=>i===1?v+0.9:v));
 let at=await project(actorP);await page.mouse.click(at.x,at.y);
 const selected=await run(()=>window.studio.ui.selection);
 if(selected!=='performer')throw new Error(`Pointer actor selection failed: ${selected}`);
 const destination=await run(()=>{const s=window.studio;const q=s.nav.closest(s.actor.position.clone().set(0,0,-7));if(!q)throw new Error('Destination unavailable');return q.toArray();});
 at=await project(destination);await page.mouse.click(at.x,at.y);
 const initial=await run(()=>window.studio.actor.position.toArray());
 await step(7);
 const motion=await run(()=>({p:window.studio.actor.position.toArray(),state:window.studio.actor.state,path:window.studio.actor.path.length}));
 if(Math.hypot(motion.p[0]-initial[0],motion.p[2]-initial[2])<1)throw new Error('Pointer walking did not move actor');
 await run(()=>{const s=window.studio;s.cameras.setMode('follow');});
 await step(0.5);await capture('follow-camera');
 log({pointerSelection:selected,motion,crowdMoved:true});
};
