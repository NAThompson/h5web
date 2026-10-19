const NAMED = new Map(
  Object.entries({
    degC: '°C',
    deg_C: '°C',
    degree_Celsius: '°C',
    degrees_Celsius: '°C',
    celsius: '°C',
    Celsius: '°C',
    degF: '°F',
    deg_F: '°F',
    degree_Fahrenheit: '°F',
    degrees_Fahrenheit: '°F',
    degree: '°',
    degrees: '°',
    percent: '%',
  }),
);

const COMPASS = /^degrees?_?([ENSW]|east|north|south|west)$/u;
// Base, then power: explicit (`m^2`, `m**-2`, `10^3`) or implicit (`m2`, `s-1`, units only)
const ATOM = /^(\p{L}+|\d+(?=\^|\*\*))(?:(?:\^|\*\*)([+-]?\d+)|([+-]?\d+))?$/u;
const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// Unit symbols (with SI prefixes) whose implicit powers are superscripted: not `CO2`, `PM10`
const PREFIXES = ['', ...'k M G T h d c m u µ μ n p'.split(' ')];
const SYMBOLS =
  'm s g K A mol cd Pa bar W J N V Hz L l eV Wh Ohm C S F Gy Sv Bq'.split(' ');
const UNITS = new Set([
  ...PREFIXES.flatMap((prefix) => SYMBOLS.map((sym) => `${prefix}${sym}`)),
  'rad',
  'sr',
  'min',
  'h',
  'd',
  'day',
  'yr',
  'a',
  'ft',
  'in',
  'mi',
  'deg',
  'kt',
  'knot',
  'Å',
  'au',
  'pc',
  'kpc',
  'Mpc',
]);

function toSuperscript(power: string): string {
  return power
    .replace('+', '')
    .replace('-', '⁻')
    .replaceAll(/\d/gu, (d) => SUPER[Number(d)]);
}

/* Unit name or power of one (e.g. `m2`, `s-1`, `m^-2`, `m**2`, `degC`), `undefined` if unknown
 * (or, if `isProduct`, not a unit symbol: `a.u` is not a product) */
function formatAtom(atom: string, isProduct: boolean): string | undefined {
  const named = NAMED.get(atom);
  if (named) {
    return named;
  }
  const compass = COMPASS.exec(atom);
  if (compass) {
    return `°${compass[1][0].toUpperCase()}`;
  }

  const match = ATOM.exec(atom);
  if (!match) {
    return undefined;
  }
  const [, base, explicit = '', implicit = ''] = match;
  const isUnit = UNITS.has(base) || NAMED.has(base);
  if ((implicit || isProduct) && !isUnit) {
    return undefined;
  }
  const name = NAMED.get(base) ?? base;
  return `${name}${toSuperscript(explicit || implicit)}`;
}

/*
 * CF / UDUNITS `units` for display: degrees as `°C`, `°E`, `°`, powers as superscripts (`m s⁻¹`),
 * the `.` multiplier as `·`, `percent` as `%`, and no units at all for the dimensionless `1`.
 * Anything unrecognised (e.g. `a.u.`, `1/Å`, `CO2`, time units `… since …`) is kept as is.
 */
export function formatUnits(units: string): string {
  const trimmed = units.trim();
  if (trimmed === '1') {
    return '';
  }
  if (trimmed.includes(' since ')) {
    return units;
  }

  // Tokens kept as is if unrecognised (e.g. `CO2` in `mol CO2 m-2 s-1`)
  const tokens = trimmed.split(/\s+/u).map((token) => {
    const parts = token.split('.');
    const atoms = parts.map((part) => formatAtom(part, parts.length > 1));
    return atoms.every((atom) => atom !== undefined) ? atoms.join('·') : token;
  });
  return tokens.join(' ');
}
