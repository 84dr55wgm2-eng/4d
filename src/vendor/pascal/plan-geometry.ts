// Vendored from pascalorg/editor@86f8e83 packages/core/src/agent-operations/plan-geometry.ts (MIT). Wall helpers removed.

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export function distance2D(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  return Math.sqrt(dx * dx + dz * dz)
}


export function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}



export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    const next = points[(i + 1) % points.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area) / 2
}

export function polygonBounds(points: Vec2[]): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  centerX: number
  centerZ: number
} {
  const xs = points.map((p) => p[0])
  const zs = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
  }
}

export function pointInBoundsWithPadding(
  x: number,
  z: number,
  bounds: ReturnType<typeof polygonBounds>,
  padding: number,
): boolean {
  return (
    x >= bounds.minX + padding &&
    x <= bounds.maxX - padding &&
    z >= bounds.minZ + padding &&
    z <= bounds.maxZ - padding
  )
}

export function pointOnSegment(point: Vec2, a: Vec2, b: Vec2, tolerance = 1e-6): boolean {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1])
  if (Math.abs(cross) > tolerance) return false
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])
  if (dot < -tolerance) return false
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  return dot <= lenSq + tolerance
}

export function pointInPolygon(point: Vec2, polygon: Vec2[], includeBoundary = true): boolean {
  if (polygon.length < 3) return false
  let inside = false
  const [x, z] = point

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (pointOnSegment(point, a, b)) return includeBoundary

    const intersects =
      a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }

  return inside
}

export function polygonContainsPolygon(outer: Vec2[], inner: Vec2[]): boolean {
  return inner.every((point) => pointInPolygon(point, outer, true))
}
