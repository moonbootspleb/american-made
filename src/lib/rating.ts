import type { Manufacturer } from './manufacturers';

/**
 * American rating. Weights must match the "How we rate" page.
 * Three lines are scored. Automation is shown and worth zero:
 * it does not add points and it does not remove them.
 * Unknown scored lines are left out of the total.
 * Do not sort manufacturers by this number.
 */
export const RATING_WEIGHTS = {
  ownership: 40,
  manufacturing: 40,
  inputs: 20,
} as const;

const SCORED_TOTAL =
  RATING_WEIGHTS.ownership + RATING_WEIGHTS.manufacturing + RATING_WEIGHTS.inputs;

if (SCORED_TOTAL !== 100) {
  throw new Error('Scored rating weights must total 100.');
}

for (const weight of Object.values(RATING_WEIGHTS)) {
  if (weight % 2 !== 0) {
    throw new Error('Rating weights must be even so a half score stays a whole number.');
  }
}

type Level = 'full' | 'half' | 'none' | 'unknown';

export interface RatingRow {
  id: 'ownership' | 'manufacturing' | 'inputs' | 'automation';
  name: string;
  detail: string;
  figure: string;
  note: string;
  scored: boolean;
}

export interface AmericanRating {
  earned: number;
  possible: number;
  headline: string;
  caption: string;
  rows: RatingRow[];
}

function levelPoints(level: Level, weight: number): number | null {
  if (level === 'full') return weight;
  if (level === 'half') return weight / 2;
  if (level === 'none') return 0;
  return null;
}

function noteFor(level: Level): string {
  if (level === 'full') return 'Full';
  if (level === 'half') return 'Half';
  if (level === 'none') return 'None';
  return 'Unknown';
}

function ownershipLevel(profile: Manufacturer): Level {
  const { code, confidence } = profile.ownership;
  if (code === 'unverified' || confidence === 'unverified') return 'unknown';
  if (code === 'not-american-owned-and-run') return 'none';
  if (confidence === 'partial') return 'half';
  return 'full';
}

function manufacturingLevel(profile: Manufacturer): Level {
  const { code, confidence } = profile.manufacturing;
  if (code === 'unverified' || confidence === 'unverified') return 'unknown';
  if (code === 'not-made-in-usa') return 'none';
  if (code === 'split' || confidence === 'partial') return 'half';
  return 'full';
}

function inputsLevel(profile: Manufacturer): Level {
  const inputs = profile.inputs;
  if (!inputs || inputs.code === 'unknown' || inputs.confidence === 'unverified') return 'unknown';
  if (inputs.code === 'not-american') return 'none';
  if (inputs.code === 'partial' || inputs.confidence === 'partial') return 'half';
  return 'full';
}

function scoredRow(
  id: RatingRow['id'],
  name: string,
  detail: string,
  weight: number,
  level: Level,
): { row: RatingRow; points: number | null } {
  const points = levelPoints(level, weight);
  return {
    points,
    row: {
      id,
      name,
      detail,
      figure: points === null ? 'Left out' : `${points} / ${weight}`,
      note: noteFor(level),
      scored: true,
    },
  };
}

export function rateManufacturer(profile: Manufacturer): AmericanRating {
  const ownership = scoredRow(
    'ownership',
    'Who owns and runs it',
    profile.ownership.label,
    RATING_WEIGHTS.ownership,
    ownershipLevel(profile),
  );
  const manufacturing = scoredRow(
    'manufacturing',
    'Where it is made',
    profile.manufacturing.label,
    RATING_WEIGHTS.manufacturing,
    manufacturingLevel(profile),
  );
  const inputs = scoredRow(
    'inputs',
    'Inputs from America',
    profile.inputs?.label ?? 'Not established',
    RATING_WEIGHTS.inputs,
    inputsLevel(profile),
  );

  const automationSet = profile.automation?.heavilyAutomated === true;
  const automation: RatingRow = {
    id: 'automation',
    name: 'Automation',
    detail: automationSet ? profile.automation!.label : 'Not established',
    figure: 'Not in the score',
    note: automationSet ? 'Disclosed' : 'Unknown',
    scored: false,
  };

  const known = [ownership, manufacturing, inputs].filter((factor) => factor.points !== null);
  const earned = known.reduce((sum, factor) => sum + (factor.points ?? 0), 0);
  const possible = known.reduce((sum, factor) => {
    if (factor.row.id === 'ownership') return sum + RATING_WEIGHTS.ownership;
    if (factor.row.id === 'manufacturing') return sum + RATING_WEIGHTS.manufacturing;
    return sum + RATING_WEIGHTS.inputs;
  }, 0);

  const headline = possible === 0 ? 'Not established' : `${earned} / ${possible}`;
  const caption =
    possible === 0
      ? 'No scored line is established yet.'
      : possible < SCORED_TOTAL
        ? 'Unknown lines are left out of this total.'
        : 'Three scored lines. Automation is shown and worth zero.';

  return {
    earned,
    possible,
    headline,
    caption,
    rows: [ownership.row, manufacturing.row, inputs.row, automation],
  };
}
