/* eslint-disable func-style */
import { range } from 'd3-array';
import ndarray, { type NdArray } from 'ndarray';

import { type ArrayValue, type H5WebComplex } from './hdf5-models';
import { cplx } from './hdf5-utils';

const range1 = () => range(-20, 21);
const range2 = () => range(0, 100, 5);
const range3 = () => range(-1, 1.25, 0.25);
const range4 = () => range(10, 40, 10);
const range5 = () => range(1, 4);
const range6 = () => range(9335, 9338);
const range7 = () => range(0, 4);
const range8 = () => range(0, 10);
const range9 = () => range(1, 11);

const oneD = () => ndarray(range1().map((val) => val ** 2));

const oneD_bigint = () =>
  ndarray(
    range8().map((_, i) => BigInt(Number.MAX_SAFE_INTEGER) + BigInt(i - 5)),
  );

const oneD_boolean = () =>
  ndarray([true, false, false, true, true, true, false, true, false, false]);

const oneD_enum = () => ndarray([0, 2, 2, 1, 1, 0, 2, 2, 1, 1]);

const oneD_complex = () =>
  ndarray(
    range9().map((val) =>
      cplx(val * Math.cos(val * 3.14), val * Math.sin(val * 3.14)),
    ),
  );

const oneD_compound = () => {
  const arrOneD = oneD();
  const arrOneDComplex = oneD_complex();
  return ndarray(
    ['Hydrogen', 'Lithum', 'Carbon', 'Sodium', 'Argon'].map<
      [string, number, number, boolean, H5WebComplex]
    >((element, index) => [
      element,
      index,
      arrOneD.get(index),
      index % 2 === 0,
      arrOneDComplex.get(index),
    ]),
  );
};

const twoD = () => {
  const { data: dataOneD } = oneD();
  return ndarray(
    range2().flatMap((offset) => dataOneD.map((val) => val - offset)),
    [20, 41],
  );
};

const twoD_bigint = () => {
  const { data: dataOneDBigInt } = oneD_bigint();
  return ndarray(
    range5().flatMap((_, i) =>
      dataOneDBigInt.map((val) => val + 1n + BigInt(i) * 10n),
    ),
    [3, 10],
  );
};

const twoD_boolean = () => {
  const { data: dataOneDBool } = oneD_boolean();
  return ndarray(
    dataOneDBool.flatMap((rowBool) =>
      dataOneDBool.map((colBool) => (rowBool ? colBool : !colBool)),
    ),
    [10, 10],
  );
};

const threeD = () => {
  const { data: dataTwoD } = twoD();
  return ndarray(
    range3().flatMap((multiplier) => dataTwoD.map((val) => val * multiplier)),
    [9, 20, 41],
  );
};

// Electron density of hydrogen 4f orbitals, |ψ|² with ψ ∝ e^(-r/4) (5z³ - 3zr² + 9xyz)
const threeD_volume = () => {
  const size = 64;
  const coords = range(size).map((i) => ((2 * i) / (size - 1) - 1) * 20);
  return ndarray(
    Float32Array.from(
      coords.flatMap((z) =>
        coords.flatMap((y) =>
          coords.map((x) => {
            const r2 = x * x + y * y + z * z;
            const psi =
              Math.exp(-Math.sqrt(r2) / 4) *
              (5 * z ** 3 - 3 * z * r2 + 9 * x * y * z);
            return psi * psi;
          }),
        ),
      ),
    ),
    [size, size, size],
  );
};

// Brillouin-zone wave vectors from -π to π, for `threeD_fermi`
const K_SIZE = 64;
const kGrid = () =>
  range(K_SIZE).map((i) => -Math.PI + (2 * Math.PI * i) / (K_SIZE - 1));

// Tight-binding band of a simple cubic lattice, E(k) = -2t (cos kx + cos ky + cos kz) with t = 1, indexed [kz][ky][kx]
const threeD_fermi = () => {
  const cosK = kGrid().map(Math.cos);
  return ndarray(
    Float32Array.from(
      cosK.flatMap((cz) =>
        cosK.flatMap((cy) => cosK.map((cx) => -2 * (cx + cy + cz))),
      ),
    ),
    [K_SIZE, K_SIZE, K_SIZE],
  );
};

// Smooth image with peaks, troughs and saddles, for contour lines
const twoD_contours = () => {
  const [rows, cols] = [96, 128];
  return ndarray(
    Float32Array.from(
      range(rows).flatMap((r) =>
        range(cols).map((c) => {
          const x = (c / (cols - 1)) * 4 * Math.PI;
          const y = (r / (rows - 1)) * 3 * Math.PI;
          const bump = Math.exp(-((x - 7) ** 2 + (y - 5) ** 2) / 4);
          return Math.sin(x) * Math.cos(y) + 1.5 * bump;
        }),
      ),
    ),
    [rows, cols],
  );
};

// Sign-changing field: its zero contours are nodal lines
const nodal = () =>
  ndarray(
    range(0, 24 * 32).map(
      (i) => Math.sin((i % 32) / 5) * Math.cos(Math.floor(i / 32) / 4),
    ),
    [24, 32],
  );

const threeD_rgb = () =>
  ndarray(
    [
      [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
      ],
      [
        [0, 255, 255],
        [255, 0, 255],
        [255, 255, 0],
      ],
      [
        [0, 0, 0],
        [128, 128, 128],
        [255, 255, 255],
      ],
    ].flat(2),
    [3, 3, 3],
  );

const threeD_rgba = () =>
  ndarray(
    [
      [
        [255, 0, 0, 50],
        [0, 255, 0, 100],
      ],
      [
        [0, 0, 255, 150],
        [128, 128, 128, 200],
      ],
    ].flat(2),
    [2, 2, 4],
  );

// Lissajous knot (3, 5, 7) and its speed |r'(t)|
const KNOT_SAMPLES = 200;
const knotParams = () =>
  range(KNOT_SAMPLES).map((i) => (2 * Math.PI * i) / (KNOT_SAMPLES - 1));
const knot_x = () => ndarray(knotParams().map((t) => Math.cos(3 * t + 0.7)));
const knot_y = () => ndarray(knotParams().map((t) => Math.cos(5 * t + 1)));
const knot_z = () => ndarray(knotParams().map((t) => Math.cos(7 * t)));
const knot_speed = () =>
  ndarray(
    knotParams().map((t) =>
      Math.hypot(
        3 * Math.sin(3 * t + 0.7),
        5 * Math.sin(5 * t + 1),
        7 * Math.sin(7 * t),
      ),
    ),
  );

// Speed of knot at three phases (leading dimension, to slice)
const knot_speed_phases = () => {
  const phases = [0, 0.5, 1];
  return ndarray(
    phases.flatMap((phase) =>
      knotParams().map((t) =>
        Math.hypot(
          3 * Math.sin(3 * t + 0.7 + phase),
          5 * Math.sin(5 * t + 1),
          7 * Math.sin(7 * t),
        ),
      ),
    ),
    [phases.length, KNOT_SAMPLES],
  );
};

// Torus (R = 2, r = 0.75) on a (u, v) grid, and its Gaussian curvature
const TORUS_SHAPE = [24, 48];
const [TORUS_R, TORUS_RR] = [2, 0.75];
function torusGrid(fn: (u: number, v: number) => number) {
  const [rows, cols] = TORUS_SHAPE;
  return ndarray(
    range(rows).flatMap((i) =>
      range(cols).map((j) =>
        fn((2 * Math.PI * i) / (rows - 1), (2 * Math.PI * j) / (cols - 1)),
      ),
    ),
    TORUS_SHAPE,
  );
}
const torus_x = () =>
  torusGrid((u, v) => (TORUS_R + TORUS_RR * Math.cos(u)) * Math.cos(v));
const torus_y = () =>
  torusGrid((u, v) => (TORUS_R + TORUS_RR * Math.cos(u)) * Math.sin(v));
const torus_z = () => torusGrid((u) => TORUS_RR * Math.sin(u));
const torus_curvature = () =>
  torusGrid(
    (u) => Math.cos(u) / (TORUS_RR * (TORUS_R + TORUS_RR * Math.cos(u))),
  );
const torus_waves = () => {
  const phases = [0, 1, 2];
  return ndarray(
    phases.flatMap(
      (phase) => torusGrid((u, v) => Math.sin(3 * v + 2 * u + phase)).data,
    ),
    [phases.length, ...TORUS_SHAPE],
  );
};

// Conical helix, as rows of vertex coordinates (x, y, z)
const helix = () =>
  ndarray(
    range(120).flatMap((i) => {
      const t = i / 10;
      return [t * Math.cos(t), t * Math.sin(t), t];
    }),
    [120, 3],
  );

export const mockValues = {
  oneD,
  oneD_linear: () => ndarray(range1()),
  oneD_bigint,
  oneD_string: () => ndarray(range8().map((val) => 'A'.repeat(val))),
  oneD_complex,
  oneD_compound,
  oneD_boolean,
  oneD_enum,
  oneD_errors: () => ndarray(oneD().data.map((val) => Math.abs(val) / 10)),
  oneD_str: () => ndarray(['foo', 'bar']),
  twoD,
  twoD_asym: () => {
    const { data: dataTwoD, shape: shapeTwoD } = twoD();
    return ndarray(
      dataTwoD.map((val, index) => (index % 41 >= 20 ? val * 5 : val)),
      shapeTwoD,
    );
  },
  twoD_bigint,
  twoD_complex: () =>
    ndarray(
      [
        [cplx(0, -5), cplx(-2.1, -2)],
        [cplx(5, 0), cplx(-3, 0.1)],
      ].flat(1),
      [2, 2],
    ),
  twoD_compound: () => {
    const arrOneD = oneD();
    const arrOneDComplex = oneD_complex();
    return ndarray(
      [
        ...oneD_compound().data,
        ...['Vanadium', 'Niobium', 'Tantalum', 'Silicon', 'Germanium'].map<
          [string, number, number, boolean, H5WebComplex]
        >((element, index) => [
          element,
          index * 10,
          arrOneD.get(index),
          index % 2 === 1,
          arrOneDComplex.get(index),
        ]),
      ],
      [2, 5],
    );
  },
  twoD_boolean,
  twoD_enum: () => {
    const { data: dataOneDEnum } = oneD_enum();
    return ndarray(
      dataOneDEnum.flatMap((rowEnum, i) =>
        dataOneDEnum.map((colEnum) => (i % 2 === 0 ? colEnum : rowEnum)),
      ),
      [10, 10],
    );
  },
  twoD_errors: () => {
    const arr = range1();
    return ndarray(
      range2().flatMap((offset) => arr.map((val) => Math.abs(val - offset))),
      [20, 41],
    );
  },
  twoD_negative: () => ndarray(range(-10, 0), [1, 10]),
  twoD_opaque: () =>
    ndarray(
      [
        new Uint8Array([0, 1]),
        new Uint8Array([2, 3]),
        new Uint8Array([4, 5]),
        new Uint8Array([6, 7]),
      ],
      [2, 2],
    ),
  threeD,
  threeD_complex: () =>
    ndarray(
      [
        [
          [cplx(2, 0), cplx(1.41, 1.41), cplx(1, 1.73), cplx(0, 2)],
          [cplx(4, 0), cplx(2.82, 2.82), cplx(2, 3.46), cplx(0, 4)],
          [cplx(1, 0), cplx(0.71, 0.71), cplx(0.5, 0.87), cplx(0, 1)],
        ],
        [
          [cplx(-1, 0), cplx(0.87, -0.5), cplx(0.92, -0.38), cplx(1, 0)],
          [cplx(-4, 0), cplx(3.46, -2), cplx(3.7, -1.53), cplx(4, 0)],
          [cplx(-8, 0), cplx(6.93, -4), cplx(7.39, -3.06), cplx(8, 0)],
        ],
      ].flat(2),
      [2, 3, 4],
    ),
  threeD_boolean: () =>
    ndarray(
      [
        [
          [true, false, true, false],
          [true, true, true, true],
          [false, false, false, false],
        ],
        [
          [true, false, false, false],
          [true, true, true, true],
          [false, false, true, false],
        ],
      ].flat(2),
      [2, 3, 4],
    ),
  threeD_rgb,
  threeD_rgba,
  threeD_volume,
  threeD_fermi,
  twoD_contours,
  K: () => ndarray(kGrid()),
  // Bin edges around the points of `K`
  K_edges: () => {
    const half = Math.PI / (K_SIZE - 1);
    return ndarray(
      range(K_SIZE + 1).map((i) => -Math.PI - half + 2 * half * i),
    );
  },
  fourD: () => {
    const { data: dataThreeD } = threeD();
    return ndarray(
      range4().flatMap((divider) =>
        dataThreeD.map((val) => Math.sin(val / divider)),
      ),
      [3, 9, 20, 41],
    );
  },
  fourD_rgb: () => {
    const { data: dataRgb } = threeD_rgb();
    return ndarray(
      range8().flatMap((i) =>
        dataRgb.map((val) => Math.min(val + i * 20, 255)),
      ),
      [10, 3, 3, 3],
    );
  },
  uint8: () => ndarray(Uint8Array.from(range7()), [2, 2]),
  int16: () => ndarray(Int16Array.from(range7()), [2, 2]),
  int64: () => ndarray(BigInt64Array.from(range7(), BigInt), [2, 2]),
  float16: () => ndarray(Float16Array.from(range7()), [2, 2]),
  float32: () => ndarray(Float32Array.from(range7()), [2, 2]),
  float64: () => ndarray(Float64Array.from(range7()), [2, 2]),
  int8_rgb: () =>
    ndarray(
      Int8Array.from(threeD_rgb().data.map((val) => val - 128)),
      [3, 3, 3],
    ),
  uint8_rgb: () => ndarray(Uint8Array.from(threeD_rgb().data), [3, 3, 3]),
  int32_rgb: () => ndarray(Uint32Array.from(threeD_rgb().data), [3, 3, 3]),
  float32_rgb: () =>
    ndarray(
      Float32Array.from(threeD_rgb().data.map((val) => val / 255)),
      [3, 3, 3],
    ),
  X: () => ndarray(range1()),
  X_desc: () => {
    const arr = range1();
    arr.reverse();
    return ndarray(arr);
  },
  X_log: () => ndarray(range1().map((_, i) => (i + 1) * 0.1)),
  X_rgb: () => ndarray(range5()),
  X_bigint: () => ndarray(range8().map(BigInt)),
  Y: () => ndarray(range2()),
  Y_desc: () => {
    const arr = range1();
    arr.reverse();
    return ndarray(arr);
  },
  Y_rgb: () => ndarray(range6()),
  secondary: () =>
    ndarray(
      twoD().data.map((v) => v * 2),
      [20, 41],
    ),
  secondary_cplx: () =>
    ndarray(
      [
        [cplx(1, -6), cplx(-3.1, -1)],
        [cplx(6, -1), cplx(-4, 1.1)],
      ].flat(1),
      [2, 2],
    ),
  secondary_bigint: () => {
    const { data: dataTwoDBigInt, shape: shapeTwoDBigInt } = twoD_bigint();
    return ndarray(
      dataTwoDBigInt.map((val) => val + 1n),
      shapeTwoDBigInt,
    );
  },
  secondary_boolean: () => {
    const { data: dataTwoDBool, shape: shapeTwoDBool } = twoD_boolean();
    return ndarray(
      dataTwoDBool.map((val) => !val),
      shapeTwoDBool,
    );
  },
  secondary_enum: () => {
    const { data: dataOneDEnum } = oneD_enum();
    return ndarray(
      dataOneDEnum.flatMap((rowEnum) =>
        dataOneDEnum.map((colEnum, j) => (j % 2 === 0 ? colEnum : rowEnum)),
      ),
      [10, 10],
    );
  },
  tertiary: () =>
    ndarray(
      twoD().data.map((v) => v / 2),
      [20, 41],
    ),
  tertiary_cplx: () =>
    ndarray(
      twoD().data.map((v) => cplx(v / 2, v / 4)),
      [20, 41],
    ),
  tertiary_float: () =>
    ndarray(
      [
        [-2, -1.6],
        [-1, 1],
      ].flat(1),
      [2, 2],
    ),
  position: () => ndarray([-1, 1, 3]), // pixel boundaries (N + 1)
  knot_x,
  knot_y,
  knot_z,
  knot_speed,
  knot_speed_phases,
  torus_x,
  torus_y,
  torus_z,
  torus_curvature,
  torus_waves,
  helix,
  scatter_data: () =>
    ndarray(range1().map((val) => Math.cos((val * 3.14) / 40))),
  Y_scatter: () =>
    ndarray(range1().map((_, i) => ((i % 10) + (i % 5)) / 123_456)),
  // Optimizer run over 5 generations, in the index coordinates of `twoD` (41 x 20)
  cma_generation: () => ndarray(range(0, 5)),
  cma_mean: () =>
    ndarray(
      range(0, 5).flatMap((g) => [30 - 5 * g, 15 - 2 * g]),
      [5, 2],
    ),
  cma_population: () =>
    ndarray(
      range(0, 5).flatMap((g) =>
        [-1, 0, 1].flatMap((k) => [30 - 5 * g + 2 * k, 15 - 2 * g - k]),
      ),
      [5, 3, 2],
    ),
  cma_fitness: () =>
    ndarray(
      range(0, 5).flatMap((g) => [0, 1, 2].map((k) => 100 / (g + 1) + k)),
      [5, 3],
    ),
  cma_cov: () =>
    ndarray(
      range(0, 5).flatMap((g) => [4, 1, 1, 2].map((v) => v / (g + 1))),
      [5, 2, 2],
    ),
  // Field on [0, π]² with static overlays on the edges of the domain, in axis values
  psi_axis: () => ndarray(range(0, 21).map((i) => (i * Math.PI) / 20)),
  psi: () =>
    ndarray(
      range(0, 21 * 21).map((i) =>
        i % 21 === 0 || i % 21 === 20 // `NaN` on the edges α = 0 and α = π
          ? Number.NaN
          : Math.sin(i % 21) * Math.cos(i / 21),
      ),
      [21, 21],
    ),
  /* Stack of 5 slices of 4 x 6: slices 1 and 2 all `NaN`; others `NaN` in column 0, then
   * -0.1, 0.3, 0.7, 1.1, 1.5 (beyond [0, 1] in columns 1, 4 and 5) */
  nan_stack: () =>
    ndarray(
      range(0, 5 * 4 * 6).map((i) => {
        const [slice, col] = [Math.floor(i / 24), i % 6];
        return slice === 1 || slice === 2 || col === 0
          ? Number.NaN
          : (col * 2) / 5 - 0.5;
      }),
      [5, 4, 6],
    ),
  /* Triangular stack (k, p, 2, 3), as FockExpansion's: `NaN` images where p > k / 2 */
  triangle_stack: () =>
    ndarray(
      range(0, 6 * 3 * 6).map((i) => {
        const [k, p] = [Math.floor(i / 18), Math.floor(i / 6) % 3];
        return p > k / 2 ? Number.NaN : k + p + (i % 6) / 10;
      }),
      [6, 3, 2, 3],
    ),
  // (k, p) stack whose first images are empty (k < 2): opened on k = 2
  blank_start_stack: () =>
    ndarray(
      range(0, 4 * 2 * 3).map((i) => (i < 12 ? Number.NaN : i / 10)),
      [4, 2, 3],
    ),
  psi_edge_0: () => ndarray([0, 0, 0, Math.PI], [2, 2]),
  psi_edge_pi: () => ndarray([Math.PI, 0, Math.PI, Math.PI], [2, 2]),
  psi_point: () => ndarray([Math.PI / 2, 0]),
  // 1 down to 1e-16, e.g. a wave function decaying over 16 decades
  decades_twoD: () =>
    ndarray(
      range(0, 3 * 17).map((i) => 10 ** -(i % 17)),
      [3, 17],
    ),
  nodal,
  nodal_amplitude: () =>
    ndarray(
      nodal().data.map((v) => Math.abs(v) + 0.1),
      [24, 32],
    ),
  // Three curves along `angle`
  multi_angle: () => ndarray([0.5236, 1.0472, 1.5708]),
  multi_curves: () =>
    ndarray([1, 2, 3, 4, 5, 2, 3, 4, 5, 6, 3, 4, 5, 6, 7], [3, 5]),
  multi_nan_curves: () =>
    ndarray(
      range(0, 15).map((i) => (i >= 5 && i < 10 ? Number.NaN : i)),
      [3, 5],
    ),
  // Stack (κ, row, column) of 4 × 3 × 5, with value 10 (k + 1) + row + column / 10
  probe_kappa: () => ndarray([0.5, 1, 2, 4]),
  probe_stack: () =>
    ndarray(
      range(0, 60).map(
        (i) =>
          10 * (Math.floor(i / 15) + 1) +
          Math.floor((i % 15) / 5) +
          (i % 5) / 10,
      ),
      [4, 3, 5],
    ),
  constant_twoD: () =>
    ndarray(
      Array.from({ length: 12 }, () => 1),
      [3, 4],
    ),
  many_points: () =>
    ndarray(
      range(0, 6000).flatMap((i) => [(i * 7) % 41, (i * 3) % 20]),
      [6000, 2],
    ),
  // log10 of an error decaying over 12 decades, exactly 0 (log10: −∞) at k = 6
  log10_error: () =>
    ndarray(
      range(0, 13).map((k) => (k === 6 ? -Infinity : 0.3 * Math.sin(k) - k)),
    ),
  log10_twoD: () =>
    ndarray(
      range(0, 24).map((i) =>
        i === 9 ? -Infinity : -Math.floor(i / 6) - (i % 6),
      ),
      [4, 6],
    ),
  // Convergence: error over iterations, not monotonic, with a missing value
  convergence: () =>
    ndarray(
      range(0, 16).map((i) =>
        i === 5 ? Number.NaN : 10 ** (-i / 3) * (1.5 + Math.sin(2 * i)),
      ),
    ),
  // Error against truncation order, for two parameters
  convergence_twoD: () =>
    ndarray(
      range(0, 24).map((i) => {
        const [p, k] = [Math.floor(i / 12), i % 12];
        return k === 10
          ? Number.NaN
          : 10 ** (-k / (p + 1)) * (1.2 + Math.cos(3 * k));
      }),
      [2, 12],
    ),
  // Decays in k (3) × x (10), with a model fitted to them and a bound along x
  series_k: () => ndarray([1, 2, 3]),
  series_x: () => ndarray(range(0, 10).map((i) => i / 2)),
  series_data: () =>
    ndarray(
      range(0, 30).map(
        (i) =>
          (Math.floor(i / 10) + 1) * Math.exp(-(i % 10) / 6) +
          0.1 * Math.sin(5 * i),
      ),
      [3, 10],
    ),
  series_fit: () =>
    ndarray(
      range(0, 30).map(
        (i) => (Math.floor(i / 10) + 1) * Math.exp(-(i % 10) / 6),
      ),
      [3, 10],
    ),
  series_bound: () => ndarray(range(0, 10).map((i) => 4 * Math.exp(-i / 6))),
  // Reference lines and bands of a line view
  ref_vline: () => ndarray([7]),
  ref_band_y: () => ndarray([1e-4, 1e-2]),
  ref_band_x: () => ndarray([2, 4]),
  // Residual with exact zeros, a negative value and a missing one (log scale)
  residual_zeros: () =>
    ndarray([1e-2, 1e-4, 0, 1e-8, Number.NaN, -1e-9, 1e-12, 0]),
  // Spectra (as FockExpansion's at k = 2): a slow decay, and a spike over round-off along the
  // bottom; every quadrant of the plot has points, only the top-right corner is clear
  spectrum: () =>
    ndarray(
      range(0, 42).map((i) => {
        const [p, j] = [Math.floor(i / 21), i % 21];
        if (p === 1) {
          return j === 1 ? 1 : 1e-16 * (1 + (j % 3));
        }
        return 10 ** (-j / 4) * (j % 2 === 0 ? 1 : 0.3);
      }),
      [2, 21],
    ),
  cma_sigma: () => ndarray(range(0, 5).map((g) => 2 / (g + 1))),
  cma_landscapes: () => {
    const { data } = twoD();
    return ndarray(
      range(0, 5).flatMap((g) => data.map((val) => val + 10 * g)),
      [5, 20, 41],
    );
  },
} satisfies Record<string, () => NdArray<ArrayValue>>;
