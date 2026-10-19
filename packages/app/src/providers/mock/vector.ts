import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { arrayShape, floatType, intType } from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  dataset,
  group,
  scalarAttr,
  withDimScales,
} from '@h5web/shared/mock-utils';

/* Vector fields (`H5WEB_vis = "vector"`): datasets whose last dimension holds the components,
 * and a group naming one dataset per component */

function linspace(start: number, end: number, n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => start + ((end - start) * i) / (n - 1),
  );
}

// Dense near 0: sinh-spaced from -end to end
function sinhspace(end: number, n: number): number[] {
  const s = Math.asinh(end * 4);
  return linspace(-s, s, n).map((t) => Math.sinh(t) / 4);
}

function array1D(name: string, n: number) {
  return dataset(name, arrayShape([n]), floatType(), linspace(0, 1, n));
}

function scale(name: string, values: number[], units?: string) {
  return dataset(name, arrayShape([values.length]), floatType(), values, {
    attributes: [
      scalarAttr('CLASS', 'DIMENSION_SCALE'),
      scalarAttr('NAME', name),
      ...(units ? [scalarAttr('units', units)] : []),
    ],
  });
}

function vectorAttrs(longName: string, units: string, extra = {}) {
  return [
    scalarAttr('H5WEB_vis', 'vector'),
    scalarAttr('long_name', longName),
    scalarAttr('units', units),
    ...Object.entries(extra).map(([name, value]) => scalarAttr(name, value)),
  ];
}

/* Interleaved components of a 2D field over (y, x) */
function sample2D(
  xs: number[],
  ys: number[],
  fn: (x: number, y: number) => [number, number],
): number[] {
  return ys.flatMap((y) => xs.flatMap((x) => fn(x, y)));
}

// Lamb–Oseen vortex pair: counter-rotating, core radius 0.5, at (±1, 0)
const VORTEX_X = linspace(-4, 4, 81);
const VORTEX_Y = linspace(-3, 3, 61);
function lambOseen(x: number, y: number): [number, number] {
  let [u, v] = [0, 0];
  for (const [x0, gamma] of [
    [-1, 1],
    [1, -1],
  ]) {
    const [dx, dy] = [x - x0, y];
    const r2 = dx * dx + dy * dy || 1e-12;
    const vt = (gamma / (2 * Math.PI * r2)) * (1 - Math.exp(-r2 / 0.25)); // v_θ / r
    u -= vt * dy;
    v += vt * dx;
  }
  return [u, v];
}

// Electric dipole: +q at (0, 0.5), −q at (0, −0.5) (softened), on sinh-spaced axes
const DIPOLE_X = sinhspace(3, 61);
const DIPOLE_Y = sinhspace(3, 51);
function dipole(x: number, y: number): [number, number] {
  let [ex, ey] = [0, 0];
  for (const [y0, q] of [
    [0.5, 1],
    [-0.5, -1],
  ]) {
    const [dx, dy] = [x, y - y0];
    const r3 = (dx * dx + dy * dy + 0.01) ** 1.5;
    ex += (q * dx) / r3;
    ey += (q * dy) / r3;
  }
  return [ex, ey];
}

// Taylor–Green vortex and its pressure, per component
const TG = linspace(0, 2 * Math.PI, 41);
function taylorGreen(index: 0 | 1 | 2): number[] {
  return TG.flatMap((y) =>
    TG.map(
      (x) =>
        [
          Math.sin(x) * Math.cos(y),
          -Math.cos(x) * Math.sin(y),
          (Math.cos(2 * x) + Math.cos(2 * y)) / 4,
        ][index],
    ),
  );
}

// Double gyre (Shadden et al., 2005), 12 steps over a period of 10
const GYRE_X = linspace(0, 2, 51);
const GYRE_Y = linspace(0, 1, 26);
const GYRE_T = linspace(0, 11 * (10 / 12), 12);
function doubleGyre(t: number) {
  const [amp, eps, omega] = [0.1, 0.25, (2 * Math.PI) / 10];
  const a = eps * Math.sin(omega * t);
  const b = 1 - 2 * a;
  return (x: number, y: number): [number, number] => {
    const f = a * x * x + b * x;
    return [
      -Math.PI * amp * Math.sin(Math.PI * f) * Math.cos(Math.PI * y),
      Math.PI *
        amp *
        Math.cos(Math.PI * f) *
        Math.sin(Math.PI * y) *
        (2 * a * x + b),
    ];
  };
}

// Arnold–Beltrami–Childress flow on [0, 2π]³
const ABC = linspace(0, 2 * Math.PI, 16);
function abcFlow(): number[] {
  const [a, b, c] = [Math.sqrt(3), Math.sqrt(2), 1];
  return ABC.flatMap((z) =>
    ABC.flatMap((y) =>
      ABC.flatMap((x) => [
        a * Math.sin(z) + c * Math.cos(y),
        b * Math.sin(x) + a * Math.cos(z),
        c * Math.sin(y) + b * Math.cos(x),
      ]),
    ),
  );
}

export function makeVectorGroup(): GroupWithChildren {
  return group('vector', [
    scale('x', VORTEX_X, 'm'),
    scale('y', VORTEX_Y, 'm'),
    withDimScales(
      dataset(
        'vortex',
        arrayShape([61, 81, 2]),
        floatType(),
        sample2D(VORTEX_X, VORTEX_Y, lambOseen),
        {
          attributes: vectorAttrs('velocity', 'm/s', {
            H5WEB_vector_style: 'streamlines',
            H5WEB_vector_background: 'curl',
          }),
        },
      ),
      { scales: [['/vector/y'], ['/vector/x'], []] },
    ),

    scale('dipole_x', DIPOLE_X, 'm'),
    scale('dipole_y', DIPOLE_Y, 'm'),
    withDimScales(
      dataset(
        'dipole',
        arrayShape([51, 61, 2]),
        floatType(),
        sample2D(DIPOLE_X, DIPOLE_Y, dipole),
        {
          attributes: [
            ...vectorAttrs('E', 'V/m', {
              H5WEB_scale: 'log',
              H5WEB_arrow_length: 'uniform',
            }),
            arrayAttr('H5WEB_arrow_density', [4], { type: intType(true, 8) }),
          ],
        },
      ),
      { scales: [['/vector/dipole_y'], ['/vector/dipole_x'], []] },
    ),

    group(
      'components',
      [
        dataset('u', arrayShape([41, 41]), floatType(), taylorGreen(0)),
        dataset('v', arrayShape([41, 41]), floatType(), taylorGreen(1)),
        dataset('pressure', arrayShape([41, 41]), floatType(), taylorGreen(2), {
          attributes: [scalarAttr('long_name', 'pressure')],
        }),
      ],
      {
        attributes: [
          scalarAttr('H5WEB_vis', 'Vector'),
          scalarAttr('H5WEB_u', 'u'),
          scalarAttr('H5WEB_v', 'v'),
          scalarAttr('H5WEB_vector_background', 'pressure'),
          scalarAttr('long_name', 'Taylor–Green vortex'),
        ],
      },
    ),
    group('missing_component', [array1D('u', 4)], {
      attributes: [
        scalarAttr('H5WEB_vis', 'vector'),
        scalarAttr('H5WEB_u', 'u'),
        scalarAttr('H5WEB_v', 'nowhere'),
      ],
    }),

    scale('t', GYRE_T, 's'),
    scale('gyre_x', GYRE_X),
    scale('gyre_y', GYRE_Y),
    withDimScales(
      dataset(
        'time',
        arrayShape([12, 26, 51, 2]),
        floatType(),
        GYRE_T.flatMap((t) => sample2D(GYRE_X, GYRE_Y, doubleGyre(t))),
        { attributes: vectorAttrs('double gyre', 'm/s') },
      ),
      {
        scales: [['/vector/t'], ['/vector/gyre_y'], ['/vector/gyre_x'], []],
      },
    ),

    dataset('abc_flow', arrayShape([16, 16, 16, 3]), floatType(), abcFlow(), {
      attributes: vectorAttrs('ABC flow', 'm/s'),
    }),
    dataset(
      'not_a_field',
      arrayShape([4, 5]),
      floatType(),
      linspace(0, 1, 20),
      { attributes: [scalarAttr('H5WEB_vis', 'vector')] },
    ),
  ]);
}
