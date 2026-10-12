// Vendored from pascalorg/editor@86f8e83 packages/core/src/agent-operations/types.ts (MIT).
// Adapted: Pascal's schema types (AnyNode, Collection, AssetInput) are replaced by a minimal generic node so the
// operations run on the studio's own entities (single authority for the world state).

/** any scene record with an id, optionally a parent and children ids */
export type AnyNode = { id: string; parentId?: string | null; children?: string[]; [k: string]: unknown }
export type Collection = Record<string, unknown>

export type SceneNodes = Readonly<Record<string, AnyNode>>

/** What a surface knows beyond the scene (catalog, checkpoint, active area). */
export type AgentContext = {
  activeLevelId: string | null
  checkpoint?: { name: string; measure: unknown }
  catalog?: readonly unknown[]
}

/** Edits an operation asks for; each surface applies them its own way, in one undo step. */
export type SceneChanges = {
  create?: { node: AnyNode; parentId?: string }[]
  update?: { id: string; data: Partial<AnyNode> }[]
  /** Ids to remove; as with the editor's Delete, each goes with everything under it. */
  delete?: string[]
  collections?: Record<string, Collection | null>
}

export type AgentOperationOutcome = {
  result: Record<string, unknown>
  changes?: SceneChanges
}

/** One agent tool's behaviour, shared by every surface: plan from the scene, or refuse. */
export type AgentOperation<Input = never> = (
  nodes: SceneNodes,
  input: Input,
  context: AgentContext,
) => AgentOperationOutcome

export type AgentOperations = Readonly<Record<string, AgentOperation>>
