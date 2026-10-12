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
  | 'ROAD' | 'PROP' | 'VEGETATION' | 'LIGHT' | 'ENVIRONMENT'
  /** a placed set of imported content (metadata.set.ref = `<packageId>/<setId>`) */
  | 'SET';

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
  /** a world assembled from imported packages: placements are SET entities; this keeps their junctions and context */
  assembly?: Assembly;
  /** content revision of a published package; a saved copy from an older revision is kept aside, not reused */
  revision?: string;
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
  imported?: {
    sourceAssetId: string;
    dataKey?: string;
    sourceUrl: string;
    license: AssetRecord['license'];
    triangleCount: number;
    bounds: [number, number, number, number];
    cells: { id: string; bounds: [number,number,number,number]; dependencies: string[] }[];
  };
  composition?: {
    brief: string;
    layout: 'street' | 'courtyard';
    size: number;
    cells: { id: string; bounds: [number, number, number, number]; entities: string[]; dependencies: string[] }[];
    dependencies: string[];
    missing: string[];
  };
  /** Yaba-style district package: semantic plan the runtime builds from (lots, buildings, rooms, openings). */
  district?: DistrictPlan;
  /** Semantic graph: object in room, chair assigned to workstation, door connecting spaces, … */
  relations?: Relation[];
  sequences?: Sequence[];
  spawn: { position: Vec3; heading: number };
  zones: Zone[];
  entities: Entity[];
  shots: CameraShot[];
  worldState: WorldState;
}

export type AssetCategory = 'ARCHITECTURE' | 'PROPS' | 'FURNITURE' | 'VEHICLES' | 'CHARACTERS' | 'VEGETATION' | 'MATERIALS' | 'ANIMATIONS' | 'ENVIRONMENT';

export interface AssetRecord {
  /** measured bounds of the normalized model (metres, pivot bottom-centre): obstacles without loading it */
  footprint?: { min: Vec3; max: Vec3 };
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

// ---------------------------------------------------------------- district (Pascal-style semantic construction)
/** What a shopfront sells: drives how its recess is dressed with authored objects. */
export type Trade = 'provisions' | 'phones' | 'chemist' | 'business' | 'electricals' | 'fashion' | 'barber' | 'photo' | 'canteen' | 'books' | 'general';
export interface Opening { id: string; kind: 'door' | 'shopfront' | 'window'; wall: 'front' | 'back' | 'left' | 'right'; offset: number; width: number; height: number; sill?: number; level: number; trade?: Trade }
export interface RoomSpec { id: string; name: string; kind: 'cybercafe' | 'shop' | 'office'; level: number; /** local rect inside the building [x0,z0,x1,z1] */ rect: [number, number, number, number] }
export interface BuildingSpec {
  id: string; name: string;
  /** centre of the front edge (street side) in world space, facing direction yaw (deg) toward the street */
  front: Vec3; yaw: number;
  width: number; depth: number; floors: number; floorHeight: number;
  style: { wall: string; trim: string; paint: [number, number, number]; base?: [number, number, number]; roof: 'parapet' | 'corrugated'; balcony: boolean; louvres: boolean; bars: boolean };
  openings: Opening[];
  rooms: RoomSpec[];
  signs: { text: string; sub?: string; colors: [string, string]; level: number; kind: 'board' | 'painted' | 'blade' }[];
}
/** Parameters a district plan is generated from (brief + preparation panel); stored with the plan. */
export interface DistrictParams {
  place: string; era: string; text: string;
  seed: string;
  street: { length: number; carriageway: number; sidewalk: number };
  /** storey range of the shop-houses */
  storeys: [number, number];
  cafe: { side: 'south' | 'north'; /** 0 = street start (west), 1 = end (east) */ position: number; width: number; depth: number; workstations: number; layout: 'sides' | 'back' | 'sides+back' };
  /** trades of the other shops, used in order (cycled) */
  trades: Trade[];
}
export interface DistrictPlan {
  brief: { place: string; era: string; mood: string; text: string };
  params?: DistrictParams;
  street: { length: number; carriageway: number; sidewalk: number; drain: boolean };
  buildings: BuildingSpec[];
  /** asset ids the plan requires; resolution report lists any that are missing */
  requires: string[];
  missing: string[];
}
export type RelationKind = 'in' | 'seatFor' | 'connects' | 'onSurface' | 'faces' | 'partOf';
export interface Relation { kind: RelationKind; from: string; to: string; data?: Record<string, unknown> }

// ---------------------------------------------------------------- direction
export interface SequenceBeat {
  id: string;
  kind: 'moveTo' | 'interact' | 'wait' | 'turnTo';
  label: string;
  /** who performs it: a population member's entity id (assembled places); absent = the embodied actor */
  actor?: string;
  target?: string;
  action?: string;
  position?: Vec3;
  seconds?: number;
}
/** camera cut: shotId references doc.shots, or 'follow' for the third-person camera */
export interface SequenceCut { id: string; shotId: string; beat: number; offset: number }
export interface SequenceStart {
  actor: { position: Vec3; heading: number; seatedOn?: string | null };
  entities: Record<string, { transform: Transform; interaction?: Record<string, unknown> }>;
  /** population state at the start (assembled places): every play/seek begins from the same crowd */
  sim?: unknown;
}
export interface Sequence {
  id: string;
  name: string;
  beats: SequenceBeat[];
  cuts: SequenceCut[];
  start: SequenceStart;
  /** measured by rehearsal (deterministic fixed-step simulation) */
  timing?: { beatStarts: number[]; duration: number; dt: number; /** what the timing was measured against (SequencePlayer.timingKey) */ key?: string };
}

/** Context and junctions of an assembled world (placements themselves are SET entities). */
export interface Assembly {
  /** what was asked and how it was read: a recomposition, never a geographic reconstruction */
  context: { brief?: string; place?: string; fictional: boolean; era?: string; timeOfDay?: string; ambience?: string; notes?: string[] };
  /** connector pairs that were joined (ids are placement entity ids + connector ids) */
  junctions: { id: string; a: { placement: string; connector: string }; b: { placement: string; connector: string }; kind: string }[];
  /** packages the world depends on (to reopen it, they must be imported in this browser) */
  packages: string[];
  /** last verification, kept with the world */
  issues?: { code: string; message: string; ids: string[] }[];
}
