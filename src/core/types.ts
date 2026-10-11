// Product data model. Three.js objects are runtime representations only;
// everything here is plain serializable data.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

export type EntityType =
  | 'ACTOR' | 'BUILDING' | 'ROOM' | 'DOOR' | 'CHAIR' | 'FURNITURE' | 'VEHICLE'
  | 'ROAD' | 'PROP' | 'VEGETATION' | 'LIGHT' | 'ENVIRONMENT';

export type Capability =
  | 'selectable' | 'movable' | 'rotatable' | 'scalable' | 'walkable' | 'collidable' | 'directable'
  | 'sittable' | 'interactable' | 'openable' | 'toggleable' | 'pickable';

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  assetId?: string;
  transform: Transform;
  parentId?: string | null;
  tags: string[];
  capabilities: Capability[];
  locked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Zone {
  id: string;
  name: string;
  kind: 'street' | 'terrace' | 'square' | 'interior' | 'alley';
  /** axis-aligned XZ bounds [minX, minZ, maxX, maxZ] */
  bounds: [number, number, number, number];
  tags: string[];
}

export type LensPreset = 24 | 35 | 50 | 85;

export interface CameraShot {
  id: string;
  name: string;
  position: Vec3;
  target: Vec3;
  focalLength: number;
  /** optional entity the shot looks at (overrides target when the entity moves) */
  lookAtEntity?: string | null;
}

export interface WorldState {
  timeOfDay: 'golden' | 'day' | 'overcast';
  [key: string]: unknown;
}

export interface WorldDocument {
  format: 'cws-world';
  version: number;
  id: string;
  name: string;
  environment: {
    assetId?: string;
    collision?: string;
    navmesh?: string;
    hdri: string;
    sun: { azimuth: number; elevation: number; intensity: number };
    exposure: number;
  };
  composition?: {
    brief: string;
    layout: 'street' | 'courtyard';
    size: number;
    cells: { id: string; bounds: [number, number, number, number]; entities: string[]; dependencies: string[] }[];
    dependencies: string[];
    missing: string[];
  };
  spawn: { position: Vec3; heading: number };
  zones: Zone[];
  entities: Entity[];
  shots: CameraShot[];
  worldState: WorldState;
}

export type AssetCategory = 'ARCHITECTURE' | 'PROPS' | 'FURNITURE' | 'VEHICLES' | 'CHARACTERS' | 'VEGETATION' | 'MATERIALS' | 'ANIMATIONS' | 'ENVIRONMENT';

export interface AssetRecord {
  id: string;
  name: string;
  category: AssetCategory;
  source: string;
  sourceUrl: string;
  /** where the runtime fetches the bytes (relative = served with the app) */
  url: string;
  license: { id: string; attribution?: string; verified: boolean; notes?: string };
  format: 'glb' | 'gltf' | 'hdr' | 'bin' | 'sog';
  thumbnail?: string;
  /** approximate size in bytes (for progress + cache budget) */
  bytes?: number;
  /** metres; bounds after normalization */
  bounds?: Vec3;
  scale?: { unitsToMetres: number; targetHeight?: number };
  tags: string[];
  entityType?: EntityType;
  /** asset-specific runtime metadata (rig profile, clip map, ...) */
  runtime?: Record<string, unknown>;
}

export interface ContentManifest {
  format: 'cws-manifest';
  version: string;
  assets: AssetRecord[];
  worlds: { id: string; name: string; url: string }[];
}

export type CacheStatus = 'remote' | 'downloading' | 'cached' | 'error';
