/**
 * Tag types: how a tag became available, what weapon it's for, antlered vs antlerless,
 * and who can buy it. Read from each hunt's row where the state lists it, otherwise from
 * the source's defaults. Unknown values never block an alert.
 */

export type Opening = 'leftover' | 'returned' | 'reissue';
export type Weapon = 'archery' | 'muzzleloader' | 'rifle' | 'any';
export type Sex = 'antlered' | 'antlerless' | 'either';
export type Residency = 'resident' | 'nonresident' | 'both';

export const OPENINGS: Opening[] = ['leftover', 'returned', 'reissue'];
export const WEAPON_CHOICES = ['archery', 'muzzleloader', 'rifle'] as const;
export const SEX_CHOICES = ['antlered', 'antlerless'] as const;

export interface TagFacets {
  weapon?: Weapon | null;
  sex?: Sex | null;
  residency?: Residency | null;
}

export const OPENING_LABEL: Record<Opening, string> = { leftover: 'Leftover', returned: 'Returned', reissue: 'Reissued' };
const WEAPON_LABEL: Record<Weapon, string> = { archery: 'Archery', muzzleloader: 'Muzzleloader', rifle: 'Rifle', any: 'Any weapon' };
const SEX_LABEL: Record<Sex, string> = { antlered: 'Antlered', antlerless: 'Antlerless', either: 'Either sex' };
const RES_LABEL: Record<Residency, string> = { resident: 'Residents only', nonresident: 'Nonresident tag', both: 'Residents and nonresidents' };

const isWeapon = (v: unknown): v is Weapon => v === 'archery' || v === 'muzzleloader' || v === 'rifle' || v === 'any';
const isSex = (v: unknown): v is Sex => v === 'antlered' || v === 'antlerless' || v === 'either';
const isResidency = (v: unknown): v is Residency => v === 'resident' || v === 'nonresident' || v === 'both';

/** Read tag type words out of a hunt's text ("Bull elk, muzzleloader", "Antlerless deer – archery", hunt codes...). */
export function classify(text: string): TagFacets {
  const t = ` ${text.toLowerCase()} `;
  const out: TagFacets = {};

  // Weapon. "Any legal weapon" can be hunted with anything, so it matches every weapon filter.
  if (/any legal weapon|any weapon|\balw\b/.test(t)) out.weapon = 'any';
  else if (/archery|\bbow\b|crossbow/.test(t)) out.weapon = 'archery';
  else if (/muzzle ?loader|\bml\b|black ?powder/.test(t)) out.weapon = 'muzzleloader';
  else if (/rifle|firearm|\bgun\b|centerfire|shotgun/.test(t)) out.weapon = 'rifle';

  // Antlered vs antlerless. Utah-style hunt codes: EB/DB = bull/buck, EA/DA = antlerless.
  if (/either[- ]sex|any (deer|elk|antelope|pronghorn|moose)\b/.test(t)) out.sex = 'either';
  else if (/antlerless|\bcow\b|\bcows\b|\bdoe\b|\bdoes\b|\bewe\b|female|\b[ed]a\d{3,4}\b/.test(t)) out.sex = 'antlerless';
  else if (/antlered|\bbull\b|\bbuck\b|\bram\b|spike|\bmale\b|\b[ed]b\d{3,4}\b/.test(t)) out.sex = 'antlered';

  // Who can buy it.
  if (/non-?resident|\bnr\b/.test(t) && !/resident and non|residents? (or|&) non/.test(t)) out.residency = 'nonresident';
  else if (/resident and non|residents? (or|&) non/.test(t)) out.residency = 'both';
  else if (/resident only|residents only/.test(t)) out.residency = 'resident';

  return out;
}

/** Merge facets: values read from the row win over the source's defaults. */
export function mergeFacets(found: TagFacets, defaults: TagFacets | undefined): TagFacets {
  const d = defaults ?? {};
  return {
    weapon: found.weapon ?? (isWeapon(d.weapon) ? d.weapon : null),
    sex: found.sex ?? (isSex(d.sex) ? d.sex : null),
    residency: found.residency ?? (isResidency(d.residency) ? d.residency : null),
  };
}

/** Short labels for an alert line: ["Leftover", "Muzzleloader", "Antlered", "Nonresident tag"]. Unknowns are left out. */
export function facetLabels(opening: Opening | null | undefined, f: TagFacets): string[] {
  const out: string[] = [];
  if (opening && OPENING_LABEL[opening]) out.push(OPENING_LABEL[opening]);
  if (f.weapon && WEAPON_LABEL[f.weapon]) out.push(WEAPON_LABEL[f.weapon]);
  if (f.sex && SEX_LABEL[f.sex]) out.push(SEX_LABEL[f.sex]);
  if (f.residency && RES_LABEL[f.residency]) out.push(RES_LABEL[f.residency]);
  return out;
}

export interface TagFilter {
  openings: string; // '*' or comma list
  weapons: string;
  sexes: string;
  home_state: string | null;
}

function inList(list: string, value: string): boolean {
  return list === '*' || list.split(',').includes(value);
}

/** Does a hunt in `state` with these facets match the subscriber's tag-type settings? Unknown values always match. */
export function tagWanted(f: TagFilter, state: string, opening: Opening | null | undefined, facets: TagFacets): boolean {
  if (opening && !inList(f.openings, opening)) return false;
  if (facets.weapon && facets.weapon !== 'any' && !inList(f.weapons, facets.weapon)) return false;
  if (facets.sex && f.sexes !== '*') {
    const wanted = f.sexes.split(',');
    if (facets.sex === 'either' ? !wanted.some((s) => s === 'antlered' || s === 'antlerless') : !wanted.includes(facets.sex)) return false;
  }
  if (f.home_state && facets.residency) {
    const home = state === f.home_state;
    if (facets.residency === 'resident' && !home) return false;
    if (facets.residency === 'nonresident' && home) return false;
  }
  return true;
}
