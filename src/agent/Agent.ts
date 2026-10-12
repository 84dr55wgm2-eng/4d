import { idb } from '../storage/idb';
import type { Studio } from '../runtime/Studio';

/**
 * The studio agent: a language model reached through the owner's server-side relay (server/agent-relay), whose
 * tool calls run HERE, on the real studio state, through the same tool registry the UI and window.studio.tools use.
 * Without a configured relay the agent answers provider_not_configured; the operations stay usable from the panels
 * and are never presented as AI.
 */
type Json = Record<string, unknown>;
type Block = { type: string; [k: string]: unknown };
export type AgentMessage = { role: 'user' | 'assistant'; content: string | Block[] };
export interface AgentToolDef { name: string; description: string; input_schema: Json; call: [toolset: string, tool: string] }
export interface AgentLogEntry { kind: 'user' | 'assistant' | 'tool' | 'error' | 'status'; text: string; tool?: string; input?: unknown; output?: unknown; ok?: boolean }
export interface RelayConfig { url: string; token: string }
export type AgentStatus = { state: 'provider_not_configured'; missing: string[]; message: string } | { state: 'ready'; model: string } | { state: 'unreachable'; message: string };

const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] metres, y up' };
const endpoint = obj({ placement: str('placement id'), connector: str('connector id from inspect_set') }, ['placement', 'connector']);
const STEP_OPS = ['place_set', 'connect_sets', 'move_set', 'replace_set', 'remove_set', 'hide_members', 'add_entities'];

/** what the model sees: flat names, JSON schemas, mapped onto the registry (toolset, tool) */
export const AGENT_TOOLS: AgentToolDef[] = [
  { name: 'list_packages', description: 'Content packages imported in this browser (id, name, kind, notGta, counts).', input_schema: obj({}), call: ['catalog', 'list_packages'] },
  { name: 'search_sets', description: 'Search reusable world portions (map, street, intersection, building, interior, courtyard). Returns compact candidates with ref, size, accesses, tags.', input_schema: obj({ query: str('words describing the place (French or English)'), kind: { type: 'string', enum: ['map', 'street', 'intersection', 'building', 'interior', 'courtyard'] }, access: { type: 'string', enum: ['road', 'sidewalk', 'door', 'passage', 'open'] }, minWidth: num('metres'), maxWidth: num('metres'), limit: num('max results (default 12)') }), call: ['catalog', 'search_sets'] },
  { name: 'inspect_set', description: 'Connectors (id, kind, position, outward normal, width, origin measured/inferred), rooms and annotations of one set.', input_schema: obj({ ref: str('set ref from search_sets') }, ['ref']), call: ['catalog', 'inspect_set'] },
  { name: 'search_resources', description: 'Search props, characters (with animation clips) and vehicles.', input_schema: obj({ query: str('words'), kind: { type: 'string', enum: ['prop', 'character', 'vehicle', 'building', 'road', 'terrain', 'interior'] }, limit: num('max results') }), call: ['catalog', 'search_resources'] },
  { name: 'assembly_state', description: 'The open place: placements (id, ref, position, yaw), population, junctions, last issues.', input_schema: obj({}), call: ['assembly', 'state'] },
  { name: 'create_world', description: 'Save the current world and open a new empty place. The page reloads: call it alone, last.', input_schema: obj({ name: str('place name'), brief: str('the request, kept with the world'), era: str('era if any'), ambience: str('ambience') }, ['name']), call: ['assembly', 'create_world'] },
  {
    name: 'apply_plan', description: 'Apply several assembly steps as ONE undoable transaction, verified before commit (refused if it introduces blocking issues unless force). "$0" in an input = placement of step 0.',
    input_schema: obj({
      label: str('undo label'), force: { type: 'boolean', description: 'commit despite blocking issues (avoid)' },
      steps: { type: 'array', minItems: 1, items: obj({ op: { type: 'string', enum: STEP_OPS }, input: { type: 'object', description: 'place_set {ref, position?, yaw?, name?} · connect_sets {a:{placement,connector}, b:{placement,connector}} (B moves) · move_set {placement, position?|by?, yaw?} · replace_set {placement, ref} · remove_set {placement} · hide_members {placement, members[]} · add_entities {resource, count?, placement, at?, behavior?: wander|customer|sit|drive|idle}' } }, ['op', 'input']) },
    }, ['steps']), call: ['assembly', 'apply_plan'],
  },
  { name: 'connect_sets', description: 'Join two placements by connectors; B moves to meet A.', input_schema: obj({ a: endpoint, b: endpoint }, ['a', 'b']), call: ['assembly', 'connect_sets'] },
  { name: 'move_set', description: 'Move or rotate one placement.', input_schema: obj({ placement: str('placement id'), position: vec3, by: vec3, yaw: num('degrees') }, ['placement']), call: ['assembly', 'move_set'] },
  { name: 'verify', description: 'Check overlaps, junctions, floor steps, blocked doors, isolated sets and walking reachability.', input_schema: obj({}), call: ['assembly', 'verify'] },
  { name: 'select', description: 'Select an entity or placement in the studio (null to clear).', input_schema: obj({ id: { type: ['string', 'null'] } }, ['id']), call: ['editing', 'select'] },
  { name: 'undo', description: 'Undo the last change.', input_schema: obj({}), call: ['editing', 'undo'] },
  { name: 'redo', description: 'Redo.', input_schema: obj({}), call: ['editing', 'redo'] },
  { name: 'save', description: 'Save the world in this browser.', input_schema: obj({}), call: ['world', 'save'] },
  { name: 'create_sequence', description: 'New sequence from the current state (start state captured, including the population).', input_schema: obj({ name: str('sequence name') }), call: ['direction', 'create'] },
  { name: 'add_beat', description: 'Add an action to a sequence: moveTo {position} or wait {seconds}; actor = a population member id (from assembly_state.population), omit for the embodied character.', input_schema: obj({ sequence: str('sequence id'), beat: obj({ kind: { type: 'string', enum: ['moveTo', 'wait'] }, position: vec3, seconds: num('0.2–60'), actor: str('population entity id'), label: str('label') }, ['kind', 'label']), index: num('position in the list') }, ['sequence', 'beat']), call: ['direction', 'add_beat'] },
  { name: 'save_shot', description: 'Save the current camera as a named shot.', input_schema: obj({ name: str('shot name') }), call: ['camera', 'save_shot'] },
  { name: 'set_camera', description: 'Director camera pose {position, target, focalLength 10–200 mm}.', input_schema: obj({ position: vec3, target: vec3, focalLength: num('mm') }), call: ['camera', 'set'] },
  { name: 'add_cut', description: 'Cut to a shot (id or "follow") anchored on a beat index + offset seconds.', input_schema: obj({ sequence: str('sequence id'), shot: str('shot id or follow'), beat: num('beat index'), offset: num('seconds') }, ['sequence', 'shot']), call: ['direction', 'add_cut'] },
  { name: 'play_sequence', description: 'Restore the start state and play (rehearses timing first if needed).', input_schema: obj({ id: str('sequence id') }, ['id']), call: ['direction', 'play'] },
  { name: 'stop_sequence', description: 'Stop playback.', input_schema: obj({}), call: ['direction', 'stop'] },
  { name: 'resume_sequence', description: 'Resume a stopped sequence from where it stopped.', input_schema: obj({ id: str('sequence id') }, ['id']), call: ['direction', 'resume'] },
  { name: 'set_time_of_day', description: 'Sun and exposure only.', input_schema: obj({ time: { type: 'string', enum: ['morning', 'midday', 'late_afternoon', 'dusk'] } }, ['time']), call: ['world', 'set_time_of_day'] },
];

const SETTINGS_KEY = 'agentRelay';
const MAX_STEPS = 24;

export class StudioAgent {
  messages: AgentMessage[] = [];
  log: AgentLogEntry[] = [];
  busy = false;
  private listeners = new Set<() => void>();
  constructor(private studio: Studio) {}

  on(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { for (const l of this.listeners) l(); }
  private push(e: AgentLogEntry) { this.log = [...this.log, e]; this.emit(); }

  async config(): Promise<RelayConfig | null> { return (await idb.get<RelayConfig>('settings', SETTINGS_KEY).catch(() => undefined)) ?? null; }
  async setConfig(c: RelayConfig | null) { if (c) await idb.put('settings', SETTINGS_KEY, c); else await idb.del('settings', SETTINGS_KEY); this.emit(); }

  async status(): Promise<AgentStatus> {
    const c = await this.config();
    if (!c?.url) return { state: 'provider_not_configured', missing: ['relay_url'], message: 'Agent IA non connecté : aucun relais d’inférence configuré. Prérequis : l’adresse d’un relais déployé (server/agent-relay) et son jeton.' };
    try {
      const h = await (await fetch(new URL('health', c.url.endsWith('/') ? c.url : c.url + '/'))).json() as { configured: boolean; missing: string[]; model: string };
      if (!h.configured) return { state: 'provider_not_configured', missing: h.missing, message: `Le relais répond mais n’est pas configuré : ${h.missing.join(', ')} manquant(s) côté serveur.` };
      return { state: 'ready', model: h.model };
    } catch (e) { return { state: 'unreachable', message: `Relais injoignable (${e instanceof Error ? e.message : String(e)}).` }; }
  }

  reset() { this.messages = []; this.log = []; this.emit(); }

  /** run one tool call on the studio; errors become is_error results, never thrown */
  async runTool(name: string, input: unknown): Promise<{ ok: boolean; output: unknown }> {
    const def = AGENT_TOOLS.find((t) => t.name === name);
    if (!def) return { ok: false, output: { error: `Outil inconnu : ${name}` } };
    const bad = validate(def.input_schema, input);
    if (bad) return { ok: false, output: { error: `Entrée invalide : ${bad}` } };
    try {
      const out = await this.studio.tools.callTool(def.call[0], def.call[1], input ?? {});
      const failed = !!out && typeof out === 'object' && ('ok' in out && (out as { ok: unknown }).ok === false || 'error' in out && !('ok' in out));
      return { ok: !failed, output: out ?? null };
    } catch (e) { return { ok: false, output: { error: e instanceof Error ? e.message : String(e) } }; }
  }

  /** one user request → model turns → tool calls on the studio, until the model stops */
  async ask(text: string) {
    if (this.busy) return;
    const c = await this.config();
    const st = await this.status();
    this.push({ kind: 'user', text });
    if (st.state !== 'ready') { this.push({ kind: 'error', text: st.message, output: st.state === 'provider_not_configured' ? { code: 'provider_not_configured', missing: st.missing } : undefined }); return; }
    this.busy = true; this.emit();
    const tools = AGENT_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
    this.messages.push({ role: 'user', content: text });
    try {
      for (let i = 0; i < MAX_STEPS; i++) {
        const res = await fetch(new URL('v1/turn', c!.url.endsWith('/') ? c!.url : c!.url + '/'), {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c!.token}` },
          body: JSON.stringify({ messages: this.messages, tools, context: this.context() }),
        });
        const body = await res.json() as { content?: Block[]; stop_reason?: string; stop_details?: { category?: string; explanation?: string } | null; code?: string; error?: string; missing?: string[] };
        if (!res.ok || !body.content) {
          this.messages.pop(); // the user turn did not get an answer: keep the history valid for the next request
          this.push({ kind: 'error', text: body.error ?? `Relais : HTTP ${res.status}`, output: { code: body.code, missing: body.missing } });
          return;
        }
        this.messages.push({ role: 'assistant', content: body.content }); // unchanged (thinking blocks included)
        for (const b of body.content) if (b.type === 'text' && String(b.text).trim()) this.push({ kind: 'assistant', text: String(b.text) });
        if (body.stop_reason === 'refusal') { this.push({ kind: 'error', text: `Le modèle a refusé la demande${body.stop_details?.category ? ` (${body.stop_details.category})` : ''}.` }); return; }
        if (body.stop_reason === 'max_tokens') { this.push({ kind: 'error', text: 'Réponse tronquée (limite de longueur) ; aucun outil de ce tour n’a été exécuté.' }); return; }
        const calls = body.content.filter((b) => b.type === 'tool_use') as unknown as { id: string; name: string; input: unknown }[];
        if (body.stop_reason !== 'tool_use' || !calls.length) return;
        const results: Block[] = [];
        for (const call of calls) {
          const r = await this.runTool(call.name, call.input);
          this.push({ kind: 'tool', tool: call.name, input: call.input, output: r.output, ok: r.ok, text: `${call.name} ${r.ok ? '✓' : '✗'}` });
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(r.output ?? null).slice(0, 60000), ...(r.ok ? {} : { is_error: true }) });
        }
        this.messages.push({ role: 'user', content: results }); // all results of the turn in one message
      }
      this.push({ kind: 'error', text: `Arrêt après ${MAX_STEPS} tours d’outils.` });
    } catch (e) {
      this.push({ kind: 'error', text: `Relais : ${e instanceof Error ? e.message : String(e)}` });
    } finally { this.busy = false; this.emit(); }
  }

  /** short, volatile context sent after the cached system prompt */
  private context() {
    const d = this.studio.store.doc;
    return JSON.stringify({ world: d.name, assembly: !!d.assembly, placements: d.entities.filter((e) => e.type === 'SET').length, selection: this.studio.ui.selection, packages: this.studio.assembly.catalog.list().map((p) => ({ id: p.id, notGta: p.notGta })) });
  }
}

/** minimal JSON-schema check for the shapes above (type, required, enum, additionalProperties:false) */
export function validate(schema: Json, v: unknown, path = 'input'): string | null {
  const t = schema.type as string | string[] | undefined;
  const types = Array.isArray(t) ? t : t ? [t] : [];
  const kind = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (types.length && !types.some((x) => x === kind || (x === 'integer' && kind === 'number'))) return `${path} : ${types.join('|')} attendu`;
  if (schema.enum && !(schema.enum as unknown[]).includes(v)) return `${path} : valeur hors liste`;
  if (kind === 'object' && schema.properties) {
    const o = v as Json, props = schema.properties as Record<string, Json>;
    for (const r of (schema.required as string[] | undefined) ?? []) if (o[r] === undefined) return `${path}.${r} manquant`;
    for (const [k, x] of Object.entries(o)) {
      if (!props[k]) { if (schema.additionalProperties === false) return `${path}.${k} non prévu`; continue; }
      const e = validate(props[k], x, `${path}.${k}`); if (e) return e;
    }
  }
  if (kind === 'array') {
    const a = v as unknown[];
    if (schema.minItems !== undefined && a.length < (schema.minItems as number)) return `${path} : trop court`;
    if (schema.maxItems !== undefined && a.length > (schema.maxItems as number)) return `${path} : trop long`;
    if (schema.items) for (let i = 0; i < a.length; i++) { const e = validate(schema.items as Json, a[i], `${path}[${i}]`); if (e) return e; }
  }
  return null;
}
