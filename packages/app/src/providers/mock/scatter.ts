import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { arrayShape, floatType, strType } from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';

/* Points (`H5WEB_vis = "scatter"` / `"scatter3d"`), cf. `H5WEB_VIEW_SCHEMA.md` */

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647; // Park-Miller
    return (state - 1) / 2_147_483_646;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

function floats(name: string, values: ArrayLike<number>, dims?: number[]) {
  return dataset(
    name,
    arrayShape(dims ?? [values.length]),
    floatType(64),
    Float64Array.from(values),
  );
}

function withAttrs<T extends { attributes: unknown[] }>(
  entity: T,
  attrs: Record<string, unknown>,
): T {
  entity.attributes.push(
    ...Object.entries(attrs).map(([name, value]) =>
      Array.isArray(value)
        ? arrayAttr(name, value, {
            type: typeof value[0] === 'string' ? strType() : floatType(64),
          })
        : scalarAttr(name, value),
    ),
  );
  return entity;
}

// Spiral galaxy: (n, 4) rows of x, y, z and energy; every 50th energy is NaN (hidden)
const GALAXY_COUNT = 600;
const galaxy = (() => {
  const rand = random(1);
  return Array.from({ length: GALAXY_COUNT }, (_, i) => {
    const arm = i % 2;
    const r = 0.2 + (5 * i) / GALAXY_COUNT;
    const theta = r * 1.2 + arm * Math.PI + 0.3 * gaussian(rand);
    return [
      r * Math.cos(theta),
      r * Math.sin(theta),
      0.2 * gaussian(rand) * Math.exp(-r / 3),
      i % 50 === 0 ? Number.NaN : 10 * Math.exp(-r / 2) + rand(),
    ];
  }).flat();
})();

// Gaussian mixture in 2D: three clusters of points sized by their weight
const MIXTURE_COUNT = 400;
const mixture = (() => {
  const rand = random(2);
  const centres = [
    [0, 0, 1],
    [4, 2, 0.5],
    [1, 5, 2],
  ];
  const x: number[] = [];
  const y: number[] = [];
  const weight: number[] = [];
  const cluster: number[] = [];
  for (let i = 0; i < MIXTURE_COUNT; i += 1) {
    const k = i % 3;
    const [cx, cy, spread] = centres[k];
    const [dx, dy] = [gaussian(rand) * spread, gaussian(rand) * spread];
    x.push(cx + dx);
    y.push(cy + dy);
    weight.push(Math.exp(-(dx ** 2 + dy ** 2) / (2 * spread ** 2)));
    cluster.push(k);
  }
  return { x, y, weight, cluster };
})();

// Measurements at scattered stations (CF `featureType = "point"`)
const STATION_COUNT = 250;
const stations = (() => {
  const rand = random(3);
  const lon = Array.from({ length: STATION_COUNT }, () => -10 + 30 * rand());
  const lat = Array.from({ length: STATION_COUNT }, () => 35 + 25 * rand());
  const alt = lon.map(() => 2000 * rand() ** 2);
  const temp = lon.map((_, i) => 25 - (lat[i] - 35) * 0.6 - alt[i] / 150);
  return { lon, lat, alt, temp };
})();

// One million points, generated when fetched: noisy trefoil knot, coloured along the knot
const BIG_COUNT = 1_000_000;
let bigCloud: Float32Array | undefined;
function getBigCloud(): Float32Array {
  if (!bigCloud) {
    const rand = random(4);
    bigCloud = new Float32Array(BIG_COUNT * 4);
    for (let i = 0; i < BIG_COUNT; i += 1) {
      const t = (2 * Math.PI * i) / BIG_COUNT;
      bigCloud.set(
        [
          Math.sin(t) + 2 * Math.sin(2 * t) + 0.15 * gaussian(rand),
          Math.cos(t) - 2 * Math.cos(2 * t) + 0.15 * gaussian(rand),
          -Math.sin(3 * t) + 0.15 * gaussian(rand),
          t,
        ],
        i * 4,
      );
    }
  }
  return bigCloud;
}

export function makeScatterGroup(): GroupWithChildren {
  return group('scatter', [
    withAttrs(floats('columns', galaxy, [GALAXY_COUNT, 4]), {
      H5WEB_vis: 'scatter3d',
      H5WEB_scatter_columns: 'x y z color',
      H5WEB_column_labels: ['x', 'y', 'z', 'energy'],
      H5WEB_title: 'Spiral galaxy',
    }),
    floats(
      'xy',
      mixture.x.flatMap((x, i) => [x, mixture.y[i]]),
      [MIXTURE_COUNT, 2],
    ),
    withAttrs(
      floats(
        'two_d',
        mixture.x.flatMap((x, i) => [x, mixture.y[i]]),
        [MIXTURE_COUNT, 2],
      ),
      {
        H5WEB_vis: 'scatter',
        H5WEB_color: 'crimson',
        H5WEB_point_size: 6,
      },
    ),
    withAttrs(floats('lon', stations.lon), { units: 'degrees_east' }),
    withAttrs(floats('lat', stations.lat), { units: 'degrees_north' }),
    withAttrs(floats('alt', stations.alt), { units: 'm', positive: 'up' }),
    withAttrs(floats('cf_points', stations.temp), {
      coordinates: 'alt lat lon', // roles from CF attributes, not order
      featureType: 'point',
      long_name: 'Temperature',
      units: 'degC',
    }),
    withAttrs(floats('cf_points_2d', stations.temp), {
      coordinates: 'lon lat',
      H5WEB_vis: 'scatter',
      H5WEB_colormap: 'auto',
      long_name: 'Temperature',
      units: 'degC',
    }),
    group(
      'group',
      [
        floats('x', mixture.x),
        floats('y', mixture.y),
        withAttrs(floats('weight', mixture.weight), { long_name: 'weight' }),
        floats('cluster', mixture.cluster),
      ],
      {
        attributes: [
          scalarAttr('H5WEB_vis', 'scatter'),
          scalarAttr('H5WEB_x', 'x'),
          scalarAttr('H5WEB_y', 'y'),
          scalarAttr('H5WEB_color', 'cluster'),
          scalarAttr('H5WEB_size', 'weight'),
          arrayAttr('H5WEB_size_range', [3, 16], { type: floatType(64) }),
          scalarAttr('H5WEB_colormap', 'Rainbow'),
          scalarAttr('H5WEB_title', 'Gaussian mixture'),
        ],
      },
    ),
    // Middle point at the centre of the view, in 2D and 3D (NaN colour: hidden)
    ...[2, Number.NaN].map((value, i) =>
      withAttrs(
        floats(
          i ? 'tiny_nan' : 'tiny',
          [-1, -1, -1, 1, 0, 0, 0, value, 1, 1, 1, 3],
          [3, 4],
        ),
        { H5WEB_vis: 'scatter3d', H5WEB_column_labels: 'x y z energy' },
      ),
    ),
    withAttrs(
      dataset('big', arrayShape([BIG_COUNT, 4]), floatType(32), getBigCloud),
      {
        H5WEB_vis: 'scatter3d',
        H5WEB_point_opacity: 0.2,
        H5WEB_point_size: 2,
        H5WEB_title: 'Trefoil knot (10⁶ points)',
      },
    ),
  ]);
}
