// Vendored from pascalorg/editor@86f8e83 packages/core/src/agent-operations/layout-clearance.ts and
// door-clearance.ts (MIT). Kept: the plan-AABB placement search (classifyPlacement, generatePlacementCandidates,
// findValidPlacement) and its AABB helpers; removed: everything bound to Pascal's level/wall/item schema.

export type PlanAabb = { minX: number; maxX: number; minZ: number; maxZ: number }

/** Minimum free space (m) required between item footprints. */
export const DEFAULT_ITEM_GAP = 0.08

export function aabbsOverlap(a: PlanAabb, b: PlanAabb, gap = 0): boolean {
  const g = gap
  return a.maxX + g > b.minX && a.minX - g < b.maxX && a.maxZ + g > b.minZ && a.minZ - g < b.maxZ
}

export function itemPlanAabb(
  position: [number, number, number] | number[],
  dimensions: [number, number, number] | number[] | undefined,
  rotationYRad = 0,
): PlanAabb {
  const x = position[0] ?? 0
  const z = position[2] ?? 0
  const [w = 1, , d = 1] = dimensions ?? [1, 1, 1]
  const cos = Math.abs(Math.cos(rotationYRad))
  const sin = Math.abs(Math.sin(rotationYRad))
  const halfW = (w * cos + d * sin) / 2
  const halfD = (w * sin + d * cos) / 2
  return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD }
}

export type PlacementCandidate = { x: number; z: number; rotationDeg: number }
export type PlacementRejectReason = 'outside_bounds' | 'blocks_door_clearance' | 'overlaps_item' | 'ok'

export function classifyPlacement(args: {
  aabb: PlanAabb
  doorKeepouts: PlanAabb[]
  occupied: PlanAabb[]
  roomBounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  padding?: number
  itemGap?: number
  doorGap?: number
}): PlacementRejectReason {
  const padding = args.padding ?? 0.05
  const itemGap = args.itemGap ?? DEFAULT_ITEM_GAP
  const doorGap = args.doorGap ?? 0.02
  if (args.roomBounds) {
    const b = args.roomBounds
    if (args.aabb.minX < b.minX + padding || args.aabb.maxX > b.maxX - padding || args.aabb.minZ < b.minZ + padding || args.aabb.maxZ > b.maxZ - padding) return 'outside_bounds'
  }
  if (args.doorKeepouts.some((k) => aabbsOverlap(args.aabb, k, doorGap))) return 'blocks_door_clearance'
  if (args.occupied.some((o) => aabbsOverlap(args.aabb, o, itemGap))) return 'overlaps_item'
  return 'ok'
}

export function generatePlacementCandidates(
  primary: PlacementCandidate,
  options?: { lateralsM?: number[]; insetsM?: number[]; inward?: { x: number; z: number }; along?: { x: number; z: number } },
): PlacementCandidate[] {
  const laterals = options?.lateralsM ?? [0, -0.4, 0.4, -0.8, 0.8, -1.2, 1.2]
  const insets = options?.insetsM ?? [0, 0.25, 0.5, 0.75]
  const along = options?.along ?? { x: 1, z: 0 }
  const inward = options?.inward ?? { x: 0, z: 1 }
  const out: PlacementCandidate[] = []
  const seen = new Set<string>()
  for (const lat of laterals) {
    for (const inset of insets) {
      const x = primary.x + along.x * lat + inward.x * inset
      const z = primary.z + along.z * lat + inward.z * inset
      const key = `${x.toFixed(3)},${z.toFixed(3)},${primary.rotationDeg}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ x, z, rotationDeg: primary.rotationDeg })
    }
  }
  return out
}

export function findValidPlacement(args: {
  primary: PlacementCandidate
  dimensions: [number, number, number] | number[] | undefined
  doorKeepouts: PlanAabb[]
  occupied: PlanAabb[]
  roomBounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  along?: { x: number; z: number }
  inward?: { x: number; z: number }
  lateralsM?: number[]
  insetsM?: number[]
}): { candidate: PlacementCandidate; reason: PlacementRejectReason } | { candidate: null; reason: PlacementRejectReason } {
  const candidates = generatePlacementCandidates(args.primary, { along: args.along, inward: args.inward, lateralsM: args.lateralsM, insetsM: args.insetsM })
  let primaryReason: PlacementRejectReason | null = null
  const reasonPriority: PlacementRejectReason[] = ['blocks_door_clearance', 'overlaps_item', 'outside_bounds']
  let bestFailReason: PlacementRejectReason = 'overlaps_item'
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    const rot = (c.rotationDeg * Math.PI) / 180
    const aabb = itemPlanAabb([c.x, 0, c.z], args.dimensions, rot)
    const reason = classifyPlacement({ aabb, doorKeepouts: args.doorKeepouts, occupied: args.occupied, roomBounds: args.roomBounds })
    if (reason === 'ok') return { candidate: c, reason }
    if (i === 0) primaryReason = reason
    const prevRank = reasonPriority.indexOf(bestFailReason)
    const nextRank = reasonPriority.indexOf(reason)
    if (nextRank >= 0 && (prevRank < 0 || nextRank < prevRank)) bestFailReason = reason
  }
  return { candidate: null, reason: primaryReason ?? bestFailReason }
}
