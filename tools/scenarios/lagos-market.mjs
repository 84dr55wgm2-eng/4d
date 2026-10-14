export default async ({page,run,capture,log,step}) => {
 const touch=!!process.env.VIEWPORT;
 const tap=(x,y)=>touch?page.touchscreen.tap(x,y):page.mouse.click(x,y);
 const state=await run(()=>{const s=window.studio;return {world:s.store.doc.id,phase:s.ui.phase,actor:!!s.actor,nav:!!s.nav,collision:!!s.collision,sim:s.sim.stats,clips:s.actor?.clips&&[s.actor.clips.idle.name,s.actor.clips.walk.clip.name,s.actor.clips.run.clip.name],failed:s.entities.stats};});
 if(state.world!=='lagos-market'||state.phase!=='ready'||!state.actor||!state.nav||!state.collision||state.sim.people!==6)throw new Error(JSON.stringify(state));
 log(state);
 const opening=await run(()=>({actual:window.studio.cameras.camera.position.toArray(),wanted:window.studio.store.doc.shots[0].position}));
 if(Math.hypot(...opening.actual.map((v,i)=>v-opening.wanted[i]))>.01)throw new Error('Opening camera cut not applied');
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
 let at=await project(actorP);await tap(at.x,at.y);
 const selected=await run(()=>window.studio.ui.selection);
 if(selected!=='performer')throw new Error(`Pointer actor selection failed: ${selected}`);
 const destination=await run(()=>{const s=window.studio;const q=s.nav.closest(s.actor.position.clone().set(0,0,-7));if(!q)throw new Error('Destination unavailable');return q.toArray();});
 at=await project(destination);await tap(at.x,at.y);
 const initial=await run(()=>window.studio.actor.position.toArray());
 await step(7);
 const motion=await run(()=>({p:window.studio.actor.position.toArray(),state:window.studio.actor.state,path:window.studio.actor.path.length}));
 if(Math.hypot(motion.p[0]-initial[0],motion.p[2]-initial[2])<1)throw new Error('Pointer walking did not move actor');
 await run(()=>{const s=window.studio;s.cameras.setMode('follow');});
 await step(0.5);await capture('follow-camera');
 const cameraBefore=await run(()=>window.studio.cameras.manualYaw);
 const rect=await page.locator('canvas').first().boundingBox();
 const x=rect.x+rect.width*.5,y=rect.y+rect.height*.45;
 if(touch){
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*10,y:y+i*2.5,id:0}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else{
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+80,y+20,{steps:8});await page.mouse.up();
 }
 const manual=await run(()=>window.studio.cameras.manualYaw);
 if(manual===null||manual===cameraBefore)throw new Error('Follow camera did not accept pointer angle override');
 await step(1);
 if(await run(()=>window.studio.cameras.manualYaw)!==manual)throw new Error('Follow tracking erased manual camera angle');
 await capture('manual-angle');
 log({pointerSelection:selected,motion,crowdMoved:true,input:touch?'touch':'mouse'});
};
