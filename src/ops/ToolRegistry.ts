import { planWorld } from '../world/WorldCreator';
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
          create: { description: 'Validate assets/navigation, compose and persist a new world, then open it.', run: (a) => studio.createWorld(a.plan) },
          list: { description: 'List bundled and user-created worlds.', run: () => studio.worlds },
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
