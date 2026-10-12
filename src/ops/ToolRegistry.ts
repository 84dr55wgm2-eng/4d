import { planWorld } from '../world/WorldCreator';
import { matchesDistrictKit, planDistrict } from '../world/district/Commands';
import { compileWorldIntent } from '../world/WorldIntent';
import type { Studio } from '../runtime/Studio';

type Tool = {
  description: string;
  run: (args: any) => unknown;
};

type Toolset = {
  description: string;
  tools: Record<string, Tool>;
};

/**
 * Small-context semantic tool registry inspired by Epic's ToolsetRegistry:
 * discover domains first, inspect one domain, then dispatch only the needed tool.
 */
export class StudioToolRegistry {
  private sets: Record<string, Toolset>;

  constructor(private studio: Studio) {
    const ops = studio.ops;
    this.sets = {
      world: {
        description: 'World state, world briefs and persistence.',
        tools: {
          get_state: { description: 'Read the serializable world/editor state.', run: () => ops.getState() },
          set_state: { description: 'Change environment state such as time of day.', run: (a) => ops.setWorldState(a ?? {}) },
          compile_brief: { description: 'Turn a natural-language world brief into structured asset-search intent.', run: (a) => compileWorldIntent(String(a?.brief ?? '')) },
          plan: { description: 'Prepare an editable composition plan from a brief using the authored kit.', run: (a) => planWorld(String(a?.brief ?? ''), studio.registry.manifest.assets) },
          create: { description: 'Compose the available Bistro kit when the brief has no missing content; reject unsupported locations or interiors.', run: (a) => studio.createWorld(a.plan) },
          plan_district: { description: 'Brief → district plan (needs, spatial plan, asset resolution, gaps) with the Yaba 2003 kit.', run: (a) => matchesDistrictKit(String(a?.brief ?? '')) ? planDistrict(String(a.brief), studio.registry.manifest.assets) : { error: 'Brief hors du kit Yaba 2003 (Lagos / cybercafé)' } },
          create_district: { description: 'Compose, save and open a district world from plan_district output (rejected when content is missing).', run: (a) => studio.createDistrictWorld(a.plan) },
          command: { description: 'Targeted French edit command → validated operation (enlarge room, add workstations, seat chair at workstation, time of day, lights, door).', run: (a) => ops.command(String(a?.text ?? '')) },
          enlarge_room: { description: 'Extend a room backward without touching the street facade.', run: (a) => ops.enlargeRoom(a?.room, a?.metres) },
          add_workstations: { description: 'Add CRT workstations along a wall of a room (left/right/back/auto).', run: (a) => ops.addWorkstations(a?.room, a?.count, a?.wall) },
          place_chair_at: { description: 'Move a chair to a workstation seat zone, facing the screen.', run: (a) => ops.placeChairAt(String(a.chair), String(a.target)) },
          set_time_of_day: { description: 'Change sun/exposure only (morning, midday, late_afternoon, dusk).', run: (a) => ops.setTimeOfDay(a.time) },
          relations: { description: 'Read the semantic graph (in, seatFor, onSurface, connects, faces).', run: () => studio.store.doc.relations ?? [] },
          list: { description: 'List bundled and user-created worlds.', run: () => studio.worlds },
          import_asset: { description: 'Use a loaded authored scene as a full world and derive collision/navigation from its actual geometry.', run: (a) => studio.importWorldAsset(String(a.id)) },
          import_url: { description: 'Acquire a complete GLB/glTF world, cache its dependencies, validate navigation and open it.', run: (a) => studio.importWorldURL(String(a.url), a.unitsToMetres ?? 1) },
          open: { description: 'Save the current world and open a known world.', run: (a) => studio.switchWorld(String(a.id)) },
          save: { description: 'Persist the current WorldDocument in the browser.', run: () => ops.save() },
        },
      },
      actors: {
        description: 'Direct actor navigation and facing without keyboard control.',
        tools: {
          move_to: { description: 'Navigate the actor to a world-space point using the navmesh.', run: (a) => ops.moveActorTo(a.position, { run: !!a.run }) },
          turn_to: { description: 'Turn the actor toward a point or heading.', run: (a) => ops.turnActorTo(a.target) },
          stop: { description: 'Stop directed actor motion.', run: () => ops.stopActor() },
        },
      },
      interactions: {
        description: 'Discover and execute semantic object interactions.',
        tools: {
          list: { description: 'List valid actions for an entity.', run: (a) => ops.getInteractions(String(a.id)) },
          execute: { description: 'Approach an entity and execute a supported semantic action.', run: (a) => ops.interact(String(a.id), a.action) },
        },
      },
      assets: {
        description: 'Search, acquire, cache and place authored 3D assets.',
        tools: {
          search_local: { description: 'Search the project asset registry.', run: (a) => ops.findAssets(String(a?.query ?? ''), a?.category) },
          search_web: { description: 'Search free downloadable models through 3d-asset-server.', run: (a) => studio.registry.searchRemote(String(a?.query ?? ''), a?.limit ?? 18) },
          register_web_asset: { description: 'Promote a web search result into the persistent project registry.', run: (a) => studio.registry.registerRemote(a.result) },
          place: { description: 'Place a registered asset on walkable ground.', run: (a) => ops.placeAsset(String(a.assetId), a.position, a.yawDegrees ?? 0) },
        },
      },
      editing: {
        description: 'Deterministic semantic entity transforms and history.',
        tools: {
          select: { description: 'Select an entity.', run: (a) => ops.selectEntity(a.id ?? null) },
          move: { description: 'Move an entity.', run: (a) => ops.moveEntity(String(a.id), a.position, a.options) },
          rotate: { description: 'Rotate an entity around world up.', run: (a) => ops.rotateEntity(String(a.id), a.yawDegrees, a.options) },
          duplicate: { description: 'Duplicate an entity.', run: (a) => ops.duplicateEntity(String(a.id)) },
          delete: { description: 'Delete an editable entity.', run: (a) => ops.deleteEntity(String(a.id)) },
          undo: { description: 'Undo the last world edit.', run: () => ops.undo() },
          redo: { description: 'Redo the last undone world edit.', run: () => ops.redo() },
        },
      },
      direction: {
        description: 'Shots → sequences on one directing clock (actions + camera cuts), playback, seek, export.',
        tools: {
          create_reference: { description: 'Create shots + the reference sequence (walk to café, open door, enter, sit) and rehearse its timing.', run: (a) => ops.createReferenceSequence(a?.chair) },
          list: { description: 'List sequences with beats, cuts and timing.', run: () => studio.store.doc.sequences ?? [] },
          rehearse: { description: 'Re-measure beat times by fixed-step simulation.', run: (a) => ops.rehearseSequence(String(a.id)) },
          play: { description: 'Restore the start state and play actions + cuts.', run: (a) => ops.playSequence(String(a.id)) },
          stop: { description: 'Stop playback.', run: () => ops.stopSequence() },
          seek: { description: 'Restore and re-simulate up to time t (seconds).', run: (a) => ops.seekSequence(String(a.id), Number(a.t)) },
          set_cut: { description: 'Change which shot a cut uses, its beat anchor or offset.', run: (a) => ops.setCut(String(a.sequence), String(a.cut), a.patch ?? {}) },
          export: { description: 'Render the sequence frame by frame (fixed step) and encode a video file.', run: (a) => ops.exportSequence(String(a.id)) },
        },
      },
      camera: {
        description: 'Camera modes, focal lengths and reusable shots.',
        tools: {
          set: { description: 'Set camera mode, pose, lens or actor framing.', run: (a) => ops.setCamera(a ?? {}) },
          save_shot: { description: 'Save the current director camera.', run: (a) => ops.saveShot(a?.name) },
          recall_shot: { description: 'Recall a saved director shot.', run: (a) => ops.recallShot(String(a.idOrName), a?.duration ?? 0.9) },
        },
      },
    };
  }

  listToolsets() {
    return Object.entries(this.sets).map(([name, set]) => ({ name, description: set.description }));
  }

  describeToolset(name: string) {
    const set = this.sets[name];
    if (!set) throw new Error(`Unknown toolset ${name}`);
    return {
      name,
      description: set.description,
      tools: Object.entries(set.tools).map(([tool, def]) => ({ name: tool, description: def.description })),
    };
  }

  callTool(toolset: string, tool: string, args: unknown = {}) {
    const set = this.sets[toolset];
    if (!set) throw new Error(`Unknown toolset ${toolset}`);
    const def = set.tools[tool];
    if (!def) throw new Error(`Unknown tool ${toolset}.${tool}`);
    return def.run(args);
  }
}

export function createToolRegistry(studio: Studio) {
  return new StudioToolRegistry(studio);
}
