import type { AssetRecord, DistrictParams, DistrictPlan, Entity } from '../../core/types';
import { composeYabaWorld } from './YabaWorld';
import type { TimeOfDay } from './DistrictOps';
import { districtPlan, PARAM_LIMITS, YABA_PARAMS } from './YabaPlan';

/**
 * Deterministic French intent parser → validated operations. It is NOT a language model: it recognizes
 * a fixed set of edit intents and says so when a sentence is outside them. An LLM can later produce the
 * same {op, args} objects through window.studio.tools without exposing any key in this frontend.
 */
export type Intent =
  | { op: 'enlargeRoom'; room: string; metres: number }
  | { op: 'addWorkstations'; room: string; count: number; wall: 'left' | 'right' | 'back' | 'auto' }
  | { op: 'seatChairAt'; chair?: string; target?: string }
  | { op: 'setTimeOfDay'; time: TimeOfDay }
  | { op: 'toggleLights'; on?: boolean }
  | { op: 'openDoor'; open: boolean };

const NUM: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12 };
const num = (w?: string) => (w ? NUM[w] ?? Number(w.replace(',', '.')) : NaN);

export function parseCommand(text: string): Intent | { error: string } {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
  if (/(agrandi|elargi|etend|plus grand)/.test(t) && /(cyber|cafe|salle|piece)/.test(t)) {
    const m = t.match(/(\d+(?:[.,]\d+)?|un|deux|trois|quatre|cinq|six)\s*(?:m\b|metres?)/);
    return { op: 'enlargeRoom', room: 'room.cafe', metres: m ? num(m[1]) : 3 };
  }
  if (/(ajoute|rajoute|installe|mets)\b.*\bpostes?\b/.test(t)) {
    const m = t.match(/(\d+|un|une|deux|trois|quatre|cinq|six|sept|huit)\s+(?:nouveaux?\s+)?postes?/);
    const wall = /mur (de )?gauche|cote gauche/.test(t) ? 'left' : /mur (de )?droit|cote droit/.test(t) ? 'right' : /fond/.test(t) ? 'back' : 'auto';
    return { op: 'addWorkstations', room: 'room.cafe', count: m ? num(m[1]) : 1, wall };
  }
  if (/(deplace|mets|place|pousse|amene)\b.*\bchaise\b.*\b(devant|face|a)\b.*\b(ordinateur|poste|ecran|pc|bureau|table)\b/.test(t))
    return { op: 'seatChairAt' };
  if (/(fin d apres[- ]midi|apres[- ]midi|17h|18h)/.test(t)) return { op: 'setTimeOfDay', time: 'late_afternoon' };
  if (/(crepuscule|soir|tombee de la nuit|nuit)/.test(t)) return { op: 'setTimeOfDay', time: 'dusk' };
  if (/(matin|lever du soleil)/.test(t)) return { op: 'setTimeOfDay', time: 'morning' };
  if (/(midi|plein jour|zenith)/.test(t)) return { op: 'setTimeOfDay', time: 'midday' };
  if (/(eteins|coupe).*(lumiere|neon)/.test(t)) return { op: 'toggleLights', on: false };
  if (/(allume).*(lumiere|neon)/.test(t)) return { op: 'toggleLights', on: true };
  if (/ouvr.*porte/.test(t)) return { op: 'openDoor', open: true };
  if (/ferm.*porte/.test(t)) return { op: 'openDoor', open: false };
  return { error: 'Commande non reconnue. Exemples pris en charge : « Agrandis le cybercafé de 3 m », « Ajoute deux postes le long du mur droit », « Déplace cette chaise devant cet ordinateur », « Passe en fin d’après-midi ».' };
}

// ---------------------------------------------------------------- brief → district plan
/** What the authored kit can honestly represent. */
export const KIT = {
  name: 'Kit « rue commerçante de Lagos, 1998–2008 »',
  /** places the kit's architecture, signage and vehicles belong to */
  places: ['yaba', 'surulere', 'ikeja', 'mushin', 'ebute metta', 'ebute-metta', 'obalende', 'oshodi', 'akoka', 'sabo', 'onike', 'ojuelegba', 'idumota', 'lagos island', 'victoria island', 'lagos', 'nigeria', 'nigerian'],
  era: [1998, 2008] as [number, number],
};

export interface Need { label: string; mode: 'all' | 'any'; required: boolean; items: { id: string; label: string; present: boolean }[]; satisfied: boolean }
export interface BriefReading {
  /** place as written in the brief (or null), and whether the kit covers it */
  place: string | null; placeSupported: boolean;
  era: string | null; eraSupported: boolean;
  /** explicit constraints recognised in the brief, in plain words */
  constraints: string[];
  /** brief requests the kit cannot honour — never silently replaced */
  unsupported: string[];
}

export interface DistrictBriefPlan {
  kind: 'district';
  brief: string;
  name: string;
  reading: BriefReading;
  needs: Need[];
  params: DistrictParams;
  spatial: { streetLength: number; buildings: number; accessibleRooms: string[] };
  workstations: number;
  time: TimeOfDay;
  plan: DistrictPlan;
  /** blocking: composing would misrepresent the brief or produce an unusable world */
  blockers: string[];
  missing: string[];
}

const strip = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');

/** Is this brief about a cybercafé street at all (the only kind of district this kit composes)? */
export function matchesDistrictKit(brief: string) {
  const t = strip(brief);
  return /cyber ?caf|cybercafe|internet ?caf|rue commer|lagos|yaba|nigeria/.test(t);
}

/** Read place, era and constraints from the brief, keeping the words the user wrote. */
export function readBrief(brief: string): BriefReading {
  const raw = brief.toLowerCase(), t = strip(brief);
  // place: "à X", "de X", "in X" followed by a capitalised name in the original text, or a known kit place
  let place: string | null = null;
  // the most specific covered place wins (« Yaba, Lagos » → Yaba): neighbourhoods are listed before city and country
  const known = KIT.places.find((p) => new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(t));
  if (known) place = known.replace(/^./, (c) => c.toUpperCase());
  else {
    const m = brief.match(/(?:^|\s)(?:à|a|au|en|in|de|du|dans|near|at)\s+((?:[A-ZÀ-Ý][\p{L}-]+)(?:[\s-](?:[A-ZÀ-Ý][\p{L}-]+))*)/u);
    if (m && !/^(Une|Un|La|Le|Les|Ce|Cette|Rue)$/.test(m[1])) place = m[1];
  }
  const placeSupported = !place || !!known;
  // era: a year (19xx/20xx) or "années 2000", "début des années 2000"
  let era: string | null = null, eraSupported = true;
  const year = t.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  const decade = t.match(/annees?\s+(19)?([5-9]0|2000|2010|2020)/);
  if (year) { era = year[1]; eraSupported = +year[1] >= KIT.era[0] && +year[1] <= KIT.era[1]; }
  else if (decade) { const d = decade[2].length === 2 ? 1900 + +decade[2] : +decade[2]; era = `années ${d}`; eraSupported = d + 9 >= KIT.era[0] && d <= KIT.era[1]; }
  else if (/aujourd|contemporain|actuel|moderne/.test(t)) { era = 'contemporaine'; eraSupported = false; }
  const constraints: string[] = [];
  const ws = t.match(/(\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze)\s+(?:postes?|ordinateurs?|pc)\b/);
  if (ws) constraints.push(`${num(ws[1]) || ws[1]} postes`);
  if (/rue (etroite|petite)|ruelle/.test(t)) constraints.push('rue étroite');
  if (/(grande|large) (rue|avenue)|avenue|boulevard/.test(t)) constraints.push('rue large');
  if (/(longue|grande) rue|rue longue/.test(t)) constraints.push('rue longue');
  if (/(courte|petite) rue|rue courte/.test(t)) constraints.push('rue courte');
  if (/(grand|vaste|spacieux) cyber/.test(t) || /cyber\S*\s+(grand|vaste|spacieux)/.test(t)) constraints.push('grand cybercafé');
  if (/(petit|minuscule|etroit) cyber/.test(t)) constraints.push('petit cybercafé');
  if (/(cote|trottoir) nord/.test(t)) constraints.push('café côté nord');
  if (/(cote|trottoir) sud/.test(t)) constraints.push('café côté sud');
  if (/(au )?(debut|entree) de la rue/.test(t)) constraints.push('café au début de la rue');
  if (/(au )?(bout|fond|fin) de la rue/.test(t)) constraints.push('café au bout de la rue');
  if (/(au )?milieu de la rue/.test(t)) constraints.push('café au milieu de la rue');
  if (/(postes?|ordinateurs?).{0,30}(en rangees?|au fond|contre le mur du fond)/.test(t)) constraints.push('postes contre le mur du fond');
  if (/(tout autour|sur trois murs|partout)/.test(t)) constraints.push('postes sur trois murs');
  if (/immeubles? (bas|d un etage|de plain-pied)/.test(t)) constraints.push('immeubles bas');
  if (/immeubles? (hauts?|eleves?)|tours?/.test(t)) constraints.push('immeubles hauts');
  // unsupported requests, read in context: "marché" is a market, "marche (vers)" is walking
  const unsupported: string[] = [];
  const asks = (re: RegExp) => re.test(raw) || re.test(t);
  if (asks(/\bdanfos?\b/)) unsupported.push('danfo (minibus jaune)');
  if (asks(/\bokadas?\b|moto-?taxi/)) unsupported.push('okada (moto-taxi)');
  if (asks(/\bkekes?\b|tricycle/)) unsupported.push('keke (tricycle)');
  // accented « marché » is the noun; unaccented « marche » only counts after an article and not before « vers … »
  // (« le personnage marche vers le café » is walking, « un marche animé » is a market typed without accent)
  if (/march(é|és)(?![\p{L}])/u.test(raw) || /\bmarkets?\b/.test(t) || /\b(le|un|au|du|des|ce|grand|petit)\s+marches?\b(?!\s+(vers|jusqu|dans|le long|sur|devant))/.test(t))
    unsupported.push('marché');
  if (asks(/\bmosquees?\b|\beglises?\b|\btemples?\b/)) unsupported.push('lieu de culte');
  if (asks(/\bplages?\b|\blagunes?\b|\bbord de mer\b|\bport\b/)) unsupported.push('littoral');
  if (asks(/\bfoule\b|\bpassants?\b|\bfigurants?\b|\bvendeu(r|se)s? ambulant/)) unsupported.push('passants / figurants');
  if (asks(/\bnuit\b.*\bpluie\b|\bpluie\b|\borage\b/)) unsupported.push('pluie');
  return { place, placeSupported, era, eraSupported, constraints, unsupported };
}

/** Brief → parameters (explicit choices only; the rest keeps the authored Yaba defaults). */
export function paramsFromBrief(brief: string, reading: BriefReading, base: DistrictParams = YABA_PARAMS, assets?: AssetRecord[]): DistrictParams {
  const t = strip(brief);
  const p = structuredClone(base);
  p.text = brief;
  p.place = reading.placeSupported && reading.place ? reading.place : base.place;
  p.era = reading.era && reading.eraSupported ? reading.era : base.era;
  p.seed = strip(brief).replace(/[^a-z0-9]+/g, '-').slice(0, 40) || base.seed;
  const c = new Set(reading.constraints);
  const ws = t.match(/(\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze)\s+(?:postes?|ordinateurs?|pc)\b/);
  if (ws) p.cafe.workstations = num(ws[1]) || p.cafe.workstations;
  if (c.has('rue étroite')) { p.street.carriageway = 5.5; p.street.sidewalk = 2.2; }
  if (c.has('rue large')) { p.street.carriageway = 9; p.street.sidewalk = 4; }
  if (c.has('rue longue')) p.street.length = 100;
  if (c.has('rue courte')) p.street.length = 52;
  if (c.has('grand cybercafé')) { p.cafe.width = 15; p.cafe.depth = 14; }
  if (c.has('petit cybercafé')) { p.cafe.width = 9; p.cafe.depth = 9; }
  if (c.has('café côté nord')) p.cafe.side = 'north';
  if (c.has('café côté sud')) p.cafe.side = 'south';
  if (c.has('café au début de la rue')) p.cafe.position = 0.1;
  if (c.has('café au bout de la rue')) p.cafe.position = 0.9;
  if (c.has('café au milieu de la rue')) p.cafe.position = 0.5;
  if (c.has('postes contre le mur du fond')) p.cafe.layout = 'back';
  if (c.has('postes sur trois murs')) p.cafe.layout = 'sides+back';
  if (c.has('immeubles bas')) p.storeys = [1, 2];
  if (c.has('immeubles hauts')) p.storeys = [3, 4];
  // more stations than the walls hold: grow the room (measured by a trial composition) rather than drop stations
  if (assets) {
    while (cafeCapacity(p, assets) < p.cafe.workstations && p.cafe.depth < PARAM_LIMITS.cafeDepth[1]) p.cafe.depth += 1;
    while (cafeCapacity(p, assets) < p.cafe.workstations && p.cafe.width < PARAM_LIMITS.cafeWidth[1]) p.cafe.width += 1;
  }
  return p;
}

/** How many workstations the café room really takes with this layout (trial composition, same code as the world). */
export function cafeCapacity(params: DistrictParams, assets: AssetRecord[]) {
  const probe: Entity = { id: 'actor.probe', name: 'probe', type: 'ACTOR', transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: [], capabilities: [], metadata: {} };
  const doc = composeYabaWorld(districtPlan(params), probe, assets, { workstations: PARAM_LIMITS.workstations[1], layout: params.cafe.layout });
  return doc.entities.filter((e) => /^ws\.\d+\.desk$/.test(e.id)).length;
}

/** Needs of the composition: mandatory components are checked one by one; alternatives need one of them. */
export function districtNeeds(assets: AssetRecord[]): Need[] {
  const has = (id: string) => assets.some((a) => a.id === id);
  const need = (label: string, mode: Need['mode'], required: boolean, items: [string, string][]): Need => {
    const its = items.map(([id, l]) => ({ id, label: l, present: has(id) }));
    return { label, mode, required, items: its, satisfied: mode === 'all' ? its.every((i) => i.present) : its.some((i) => i.present) };
  };
  return [
    need('Poste de cybercafé (chaque élément est indispensable)', 'all', true, [['lagos.desk', 'table'], ['lagos.crt', 'ordinateur CRT avec tour, clavier et souris'], ['lagos.chair', 'chaise']]),
    need('Éclairage du cybercafé', 'all', true, [['lagos.fluorescent', 'réglette fluorescente']]),
    need('Raccordement des postes', 'all', false, [['lagos.socket4', 'prise murale']]),
    need('Ventilation (au choix)', 'any', false, [['lagos.fan', 'ventilateur de plafond'], ['lagos.aircon', 'climatiseur']]),
    need('Réseau électrique de rue', 'all', true, [['lagos.pole', 'poteau'], ['lagos.pole_transformer', 'poteau transformateur']]),
    need('Véhicules d’époque (au choix)', 'any', false, [['lagos.peugeot504', 'Peugeot 504 break'], ['lagos.corolla', 'Toyota Corolla E70'], ['lagos.covered_car', 'voiture bâchée']]),
    need('Stock des boutiques', 'all', false, [['lagos.shelf_steel', 'étagère métallique'], ['lagos.food_cans', 'conserves'], ['lagos.medical_box', 'boîtes de pharmacie']]),
  ];
}

export function planDistrict(brief: string, assets: AssetRecord[], override?: DistrictParams, opts: { acceptKitPlace?: boolean } = {}): DistrictBriefPlan {
  const t = strip(brief);
  const reading = readBrief(brief);
  const params = override ?? paramsFromBrief(brief, reading, YABA_PARAMS, assets);
  const plan = districtPlan(params);
  const time: TimeOfDay = /apres[- ]midi|17h|18h/.test(t) ? 'late_afternoon' : /soir|crepuscule|nuit/.test(t) ? 'dusk' : /matin/.test(t) ? 'morning' : 'midday';
  const needs = districtNeeds(assets);
  const blockers: string[] = [];
  const missing: string[] = [];
  if (!reading.placeSupported) {
    const msg = `Le lieu demandé (« ${reading.place} ») n’est pas couvert : le seul kit disponible représente une rue commerçante de Lagos (architecture, enseignes, véhicules). Je ne le renomme pas en ${reading.place}.`;
    if (opts.acceptKitPlace) missing.push(`${msg} Le monde sera composé et nommé comme une rue de Lagos.`); else blockers.push(msg);
  }
  if (!reading.eraSupported) missing.push(`Époque « ${reading.era} » hors du kit (${KIT.era[0]}–${KIT.era[1]}) : ordinateurs CRT et véhicules resteront ceux de cette période.`);
  const capacity = cafeCapacity(params, assets);
  if (capacity < params.cafe.workstations) blockers.push(`La salle (${params.cafe.width} × ${params.cafe.depth} m, disposition choisie) accueille ${capacity} poste(s) sur ${params.cafe.workstations} : agrandis-la, change la disposition ou réduis le nombre de postes.`);
  for (const n of needs) if (!n.satisfied) (n.required ? blockers : missing).push(`${n.required ? 'Manque indispensable' : 'Contenu manquant'} : ${n.label} — ${n.items.filter((i) => !i.present).map((i) => i.label).join(', ')}`);
  for (const u of reading.unsupported) missing.push(`Pas encore dans le kit : ${u} (non remplacé).`);
  const placeName = reading.placeSupported && reading.place ? reading.place : 'Lagos';
  const name = `${placeName === 'Lagos' || placeName === 'Nigeria' ? 'Lagos' : `${placeName}, Lagos`} — cybercafé${params.era ? ` (${params.era})` : ''}`;
  return {
    kind: 'district', brief, name, reading, needs, params, workstations: params.cafe.workstations, time, plan, blockers, missing,
    spatial: { streetLength: plan.street.length, buildings: plan.buildings.length, accessibleRooms: plan.buildings.flatMap((b) => b.rooms.map((r) => r.name)) },
  };
}
