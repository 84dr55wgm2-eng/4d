// Inference relay for Cinematic World Studio (environment A's only server piece).
//
// The studio runs in the browser (GitHub Pages: static, no secrets). The agent's tools execute there, on the real
// studio state. This relay holds the model credentials and forwards ONE agent turn at a time:
//   browser → POST /v1/turn {messages, tools} → Claude → {content, stop_reason} → browser runs the tool calls →
//   browser → POST /v1/turn with the tool results → … until the model stops calling tools.
// The system prompt and the model are fixed here, so the relay is not an open proxy for arbitrary prompts.
//
// Env:
//   ANTHROPIC_API_KEY   model credentials (or ANTHROPIC_AUTH_TOKEN). Missing → every turn answers provider_not_configured.
//   RELAY_TOKEN         shared secret typed once in the studio (Agent → Relais). Required.
//   ALLOW_ORIGIN        allowed browser origin (default https://84dr55wgm2-eng.github.io). Comma-separated list ok.
//   PORT / HOST         default 8788 / 0.0.0.0
//   AGENT_MODEL         default claude-opus-5-5
//   AGENT_EFFORT        low | medium | high | xhigh | max (default medium)
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';
const MODEL = process.env.AGENT_MODEL ?? 'claude-opus-5-5';
const EFFORT = process.env.AGENT_EFFORT ?? 'medium';
const ORIGINS = (process.env.ALLOW_ORIGIN ?? 'https://84dr55wgm2-eng.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const RELAY_TOKEN = process.env.RELAY_TOKEN ?? '';
const MAX_BODY = 4 * 1024 * 1024;

const missing = () => [
  ...(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? [] : ['ANTHROPIC_API_KEY']),
  ...(RELAY_TOKEN ? [] : ['RELAY_TOKEN']),
];
const client = missing().includes('ANTHROPIC_API_KEY') ? null : new Anthropic();

const SYSTEM = `You are the assembly agent of Cinematic World Studio, a browser studio that recomposes places from imported content packages (streets, crossroads, buildings, interiors, courtyards, characters, vehicles) and stages them.

How you work:
- You choose content and intent; the tools compute positions, alignments and checks. Never invent a set, resource, placement or connector id: take them from search_sets / inspect_set / search_resources / assembly_state results.
- Search first (compact candidates), inspect only the few sets you intend to use, then apply one coherent transaction with apply_plan. Inside a plan, "$0" refers to the placement made by step 0.
- After changing the place, call verify and fix blocking issues (move, replace, hide_members, or a different connector) before reporting.
- A tool result with ok:false or an error means nothing was changed. Report it plainly; do not claim success.
- Packages flagged notGta are distributable test content, not GTA content. Say so when you use them. Do not describe test content as a GTA scene.
- If the request needs content that is not in the catalogue, say what is missing instead of approximating it.
- Answer in the user's language (usually French), briefly: what you did (ids), what verify reports, what remains.`;

function cors(req, res) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes(o) || ORIGINS.includes('*') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

async function readJson(req) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** browser-supplied tool definitions: names, descriptions and JSON schemas only */
function checkTools(tools) {
  if (!Array.isArray(tools) || tools.length > 48) throw Object.assign(new Error('tools: array of at most 48 definitions expected'), { status: 400 });
  return tools.map((t) => {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(t?.name ?? '') || typeof t.description !== 'string' || t.input_schema?.type !== 'object')
      throw Object.assign(new Error(`invalid tool definition: ${t?.name}`), { status: 400 });
    return { name: t.name, description: t.description.slice(0, 2000), input_schema: t.input_schema };
  });
}

async function turn(body) {
  const tools = checkTools(body.tools ?? []);
  if (!Array.isArray(body.messages) || !body.messages.length) throw Object.assign(new Error('messages required'), { status: 400 });
  const context = typeof body.context === 'string' ? body.context.slice(0, 4000) : '';
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    // stable prefix first (tools → system) so repeated turns hit the prompt cache; the volatile studio context last
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, ...(context ? [{ type: 'text', text: `Current studio state:\n${context}` }] : [])],
    tools,
    tool_choice: { type: 'auto' },
    messages: body.messages,
  });
  // content is returned unchanged (thinking blocks included): the browser appends it as-is to keep the history valid
  return { id: msg.id, model: msg.model, content: msg.content, stop_reason: msg.stop_reason, stop_details: msg.stop_details ?? null, usage: msg.usage };
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    const m = missing();
    return send(res, 200, { ok: true, provider: 'anthropic', model: MODEL, configured: m.length === 0, missing: m });
  }
  if (req.method === 'POST' && url.pathname === '/v1/turn') {
    if (!RELAY_TOKEN || req.headers.authorization !== `Bearer ${RELAY_TOKEN}`)
      return send(res, RELAY_TOKEN ? 401 : 503, RELAY_TOKEN ? { code: 'unauthorized', error: 'Jeton du relais invalide.' } : { code: 'provider_not_configured', missing: missing(), error: 'RELAY_TOKEN absent côté serveur.' });
    if (!client) return send(res, 503, { code: 'provider_not_configured', missing: missing(), error: 'Aucune clé de modèle configurée sur le relais (ANTHROPIC_API_KEY).' });
    try {
      return send(res, 200, await turn(await readJson(req)));
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return send(res, 502, { code: 'provider_auth', error: 'La clé du modèle est refusée par le fournisseur.' });
      if (e instanceof Anthropic.RateLimitError) return send(res, 429, { code: 'rate_limited', error: 'Limite de débit du fournisseur atteinte ; réessaie plus tard.' });
      if (e instanceof Anthropic.BadRequestError) return send(res, 400, { code: 'bad_request', error: e.message });
      if (e instanceof Anthropic.APIError) return send(res, 502, { code: 'provider_error', status: e.status, error: e.message });
      return send(res, e.status ?? 500, { code: e.status ? 'bad_request' : 'relay_error', error: e.message });
    }
  }
  send(res, 404, { code: 'not_found' });
});

server.listen(PORT, HOST, () => {
  const m = missing();
  console.log(`agent relay on http://${HOST}:${PORT} · model ${MODEL} · ${m.length ? `NOT CONFIGURED (missing: ${m.join(', ')})` : 'configured'} · origins ${ORIGINS.join(', ')}`);
});
