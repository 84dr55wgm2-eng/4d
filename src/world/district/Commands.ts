import type { AssetRecord, DistrictPlan } from '../../core/types';
import type { TimeOfDay } from './DistrictOps';
import { yabaPlan } from './YabaPlan';

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

const NUM: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8 };
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
export interface DistrictBriefPlan {
  kind: 'district';
  brief: string;
  name: string;
  needs: { label: string; satisfiedBy: string[]; missing?: boolean }[];
  spatial: { streetLength: number; buildings: number; accessibleRooms: string[] };
  workstations: number;
  time: TimeOfDay;
  plan: DistrictPlan;
  missing: string[];
}

/** Is this brief within the authored Yaba 2003 kit (Lagos street, cybercafé, early 2000s)? */
export function matchesDistrictKit(brief: string) {
  const t = brief.toLowerCase();
  return /(lagos|yaba|nigeria|cyber ?caf)/.test(t);
}

export function planDistrict(brief: string, assets: AssetRecord[]): DistrictBriefPlan {
  const t = brief.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const plan = yabaPlan();
  const has = (id: string) => assets.some((a) => a.id === id);
  const ws = (() => { const m = t.match(/(\d+|deux|trois|quatre|cinq|six|sept|huit)\s+postes?/); return m ? Math.min(8, Math.max(2, num(m[1]))) : 6; })();
  const time: TimeOfDay = /apres[- ]midi/.test(t) ? 'late_afternoon' : /soir|crepuscule|nuit/.test(t) ? 'dusk' : /matin/.test(t) ? 'morning' : 'midday';
  const need = (label: string, ids: string[]) => ({ label, satisfiedBy: ids.filter(has), missing: !ids.some(has) });
  const needs = [
    { label: 'Façades, ouvertures et seuils (construction sémantique, enduits Poly Haven)', satisfiedBy: ['district-builder'], missing: false },
    need('Postes CRT (écran, tour, clavier)', ['lagos.crt']),
    need('Bureaux et sièges', ['lagos.desk', 'lagos.chair']),
    need('Éclairage intérieur', ['lagos.fluorescent', 'lagos.fan']),
    need('Réseau électrique de rue', ['lagos.pole', 'lagos.pole_transformer', 'lagos.aircon', 'lagos.generator']),
    need('Véhicules d’époque', ['lagos.peugeot504', 'lagos.corolla', 'lagos.covered_car']),
    need('Objets de proximité', ['lagos.crate', 'lagos.jerrycan', 'lagos.bench', 'lagos.barrel', 'lagos.tyre']),
  ];
  const missing: string[] = needs.filter((n) => n.missing).map((n) => `Contenu manquant : ${n.label}`);
  // requests the kit cannot honour are reported, never silently replaced
  if (/(danfo|okada|keke|marche|market|mosquee|eglise|plage|lagune)/.test(t))
    missing.push('Le kit Yaba 2003 ne contient pas encore ce lieu ou ce véhicule (danfo, okada, marché, lieu de culte, littoral).');
  const name = brief.length < 48 ? brief.replace(/^./, (c) => c.toUpperCase()) : 'Yaba, Lagos — 2003';
  return {
    kind: 'district', brief, name, needs, workstations: ws, time, plan, missing,
    spatial: { streetLength: plan.street.length, buildings: plan.buildings.length, accessibleRooms: plan.buildings.flatMap((b) => b.rooms.map((r) => r.name)) },
  };
}
