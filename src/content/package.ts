/**
 * Prepared content package ("cws-package"): what the browser imports. Produced by tools/gta/pack from the
 * conversion chain (CodeWalker XML + per-drawable glTF), never from raw game archives in the browser.
 * All positions are glTF Y-up metres; GTA Z-up originals are kept in `source` fields for provenance.
 */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export interface PackageSource {
  kind: 'gta5' | 'fixture';
  /** true for test content: never presented as GTA content */
  notGta?: boolean;
  game?: { build?: string; gen9?: boolean };
  tools: Record<string, string>;
  /** extracted files and where they came from (archive path, content priority) */
  inputs: { file: string; rpf?: string; path?: string; priority?: number }[];
  license?: string;
}

export interface PackageResource {
  id: string;
  kind: 'model' | 'character' | 'vehicle';
  file: string;
  bytes: number;
  /** Y-up bounds of the drawable in its own frame */
  bounds: { min: V3; max: V3 };
  tags: string[];
  measured: { triangles: number; size: V3; flatGround?: boolean; road?: boolean; building?: boolean };
  inferred: Record<string, unknown>;
  source: Record<string, unknown>;
  /** this resource's lower-detail stand-in (by resource id), from the YMAP LOD hierarchy */
  lod?: string;
  /** collision geometry: the render mesh itself ('render'), a separate file, or none */
  collision: 'render' | { file: string } | 'none';
  /** animations carried by the file (characters) */
  clips?: string[];
}

export interface SetMember {
  id: string;
  resource: string;
  position: V3;
  quaternion: Q4;
  scale: V3;
  lod: 'HD' | 'LOD' | 'SLOD' | 'ORPHANHD';
  /** member id of the LOD parent (hidden when the HD children are shown) */
  parent?: string;
  /** interior membership (MLO room) */
  room?: string;
}

export interface SetConnector {
  id: string;
  kind: 'road' | 'sidewalk' | 'door' | 'passage' | 'open';
  position: V3;
  /** outward horizontal direction (unit) */
  normal: V3;
  width: number;
  /** how it was obtained: road graph, portal, ray sampling of the geometry… */
  origin: 'ynd' | 'portal' | 'measured' | 'inferred';
  /** for interiors: the connector of the shell building it opens through */
  data?: Record<string, unknown>;
}

export interface SetDef {
  id: string;
  name: string;
  kind: 'map' | 'street' | 'intersection' | 'building' | 'interior' | 'courtyard';
  source: { ymap?: string; mlo?: string; region?: string; originGta: V3; yawGta?: number };
  /** members are in set-local space; the set origin is its footprint centre at ground level */
  bounds: { min: V3; max: V3 };
  members: SetMember[];
  connectors: SetConnector[];
  /** road graph in set-local space: polylines of lane centre points */
  roads: { id: string; points: V3[]; oneway: boolean }[];
  rooms: { id: string; name: string; bounds: { min: V3; max: V3 } }[];
  /** what the studio can actually do with it */
  capabilities: ('walkable' | 'enterable' | 'vehicles' | 'seating' | 'interior' | 'lod')[];
  annotations: { measured: Record<string, number | boolean | string>; inferred: { tags: string[]; uses: string[] } };
  /** sets this one contains or is contained in (street ⊃ building ⊃ interior) */
  related: { kind: 'contains' | 'partOf' | 'interiorOf' | 'hasInterior'; set: string }[];
}

export interface CwsPackage {
  format: 'cws-package';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  source: PackageSource;
  coordinate: { from: 'gta-zup'; to: 'gltf-yup'; mapping: string };
  resources: PackageResource[];
  sets: SetDef[];
}

/** GTA (x, y, z) Z-up → glTF (x, z, −y) Y-up; the same change of basis applies to quaternion vectors. */
export const gtaToYup = (v: V3): V3 => [v[0], v[2], -v[1]];
export const gtaQuatToYup = (q: Q4): Q4 => [q[0], q[2], -q[1], q[3]];
