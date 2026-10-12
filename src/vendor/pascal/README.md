# Vendored from pascalorg/editor (MIT)

Revision `86f8e833904f7b6b3358bb1505feb82d801ad9ad`, `packages/core/src/`. Copied, then adapted where noted in
each file header. Pascal's own node schema (walls, levels, items) is not used: these operations run on the studio's
entities, which stay the single authority for the world state.

| File | Source | Changes |
|---|---|---|
| `apply-changes.ts` | `agent-operations/apply-changes.ts` | node type made generic (`id`, `parentId`, `children`) |
| `types.ts` | `agent-operations/types.ts` | `AnyNode`/`Collection` replaced by generics; `AgentContext` trimmed |
| `refusal.ts` | `agent-tools/refusal.ts` | none |
| `layout-clearance.ts` | `agent-operations/layout-clearance.ts` + `door-clearance.ts` | AABB placement search only (classifyPlacement, generatePlacementCandidates, findValidPlacement, aabbsOverlap, itemPlanAabb) |
| `plan-geometry.ts` | `agent-operations/plan-geometry.ts` | wall helpers removed |
