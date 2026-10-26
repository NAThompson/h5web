import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { arrayShape, floatType, intType } from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';

/* Integer labels / classes, shown with categorical colors: CF flags turn them on, else
 * `H5WEB_categorical` (cf. `core/categorical.ts`) */

const [ROWS, COLS] = [48, 64];

function grid<T>(fn: (row: number, col: number) => T): T[] {
  return Array.from({ length: ROWS * COLS }, (_, i) =>
    fn(Math.floor(i / COLS), i % COLS),
  );
}

// Segmentation mask: background 0, five overlapping blobs of classes 1 to 5, a few of 9
const BLOBS = [
  [12, 14, 9, 1],
  [30, 20, 11, 2],
  [18, 40, 10, 3],
  [36, 48, 8, 4],
  [10, 56, 6, 5],
];
const segmentation = grid((row, col) => {
  const blob = BLOBS.findLast(
    ([r, c, radius]) => (row - r) ** 2 + (col - c) ** 2 < radius ** 2,
  );
  return blob?.[3] ?? (row > 42 && col < 6 ? 9 : 0);
});

// Land cover (CF flags): bands of classes by latitude and longitude, lake and city, fill -1
const LAND_COVER = [
  'water',
  'forest',
  'grassland',
  'cropland',
  'urban',
  'bare_soil',
];
const landCover = grid((row, col) => {
  if (row < 3 && col > 50) {
    return -1; // missing (`_FillValue`)
  }
  if ((row - 30) ** 2 + (col - 15) ** 2 < 36) {
    return 1; // lake
  }
  if ((row - 12) ** 2 + (col - 44) ** 2 < 20) {
    return 5; // city
  }
  const band = Math.floor((row + 6 * Math.sin(col / 6)) / 12); // 0 to 3
  return [2, 3, 4, 6][Math.min(Math.max(band, 0), 3)];
});

// Instance segmentation: 64 sparse IDs (many classes: colors beyond Tableau10)
const instances = grid((row, col) => {
  const cell = Math.floor(row / 6) * 8 + Math.floor(col / 8);
  return cell * 97 + 1000;
});

// Material IDs of a volume (z, y, x), for orthoslices: shells around the centre
const [DEPTH, HEIGHT, WIDTH] = [12, 16, 20];
const materials = Array.from({ length: DEPTH * HEIGHT * WIDTH }, (_, i) => {
  const x = i % WIDTH;
  const y = Math.floor(i / WIDTH) % HEIGHT;
  const z = Math.floor(i / (WIDTH * HEIGHT));
  const r = Math.hypot((x - 10) / 10, (y - 8) / 8, (z - 6) / 6);
  return Math.min(Math.floor(r * 4), 4);
});

// Labelled point cloud: twelve Gaussian clusters on a helix, with their cluster ID
const CLUSTER_COUNT = 12;
const POINTS_PER_CLUSTER = 50;
const cloud = Array.from(
  { length: CLUSTER_COUNT * POINTS_PER_CLUSTER },
  (_, i) => {
    const k = Math.floor(i / POINTS_PER_CLUSTER);
    const t = (2 * Math.PI * k) / CLUSTER_COUNT;
    // Deterministic jitter (no random state): golden-angle spiral within each cluster
    const j = i % POINTS_PER_CLUSTER;
    const radius = 0.35 * Math.sqrt(j / POINTS_PER_CLUSTER);
    const angle = j * 2.399_963;
    return [
      3 * Math.cos(t) + radius * Math.cos(angle),
      3 * Math.sin(t) + radius * Math.sin(angle),
      k / 3 + radius * Math.sin(angle * 0.5),
      k,
    ];
  },
);

export function makeCategoricalGroup(): GroupWithChildren {
  return group('categorical', [
    dataset(
      'segmentation',
      arrayShape([ROWS, COLS]),
      intType(false, 8),
      Uint8Array.from(segmentation),
      {
        attributes: [
          scalarAttr('H5WEB_categorical', 1, { type: intType(false, 8) }),
          scalarAttr('long_name', 'Class'),
        ],
      },
    ),
    dataset(
      'land_cover',
      arrayShape([ROWS, COLS]),
      intType(true, 8),
      Int8Array.from(landCover),
      {
        attributes: [
          scalarAttr('long_name', 'Land cover'),
          arrayAttr('flag_values', [1, 2, 3, 4, 5, 6], {
            type: intType(true, 8),
          }),
          scalarAttr('flag_meanings', LAND_COVER.join(' ')),
          scalarAttr('_FillValue', -1, { type: intType(true, 8) }),
        ],
      },
    ),
    dataset(
      'instances',
      arrayShape([ROWS, COLS]),
      intType(false, 16),
      Uint16Array.from(instances),
      {
        attributes: [
          scalarAttr('H5WEB_categorical', 1, { type: intType(false, 8) }),
          scalarAttr('H5WEB_palette', 'glasbey'),
        ],
      },
    ),
    dataset(
      'materials',
      arrayShape([DEPTH, HEIGHT, WIDTH]),
      intType(false, 8),
      Uint8Array.from(materials),
      {
        attributes: [
          scalarAttr('H5WEB_vis', 'orthoslices'),
          arrayAttr('flag_values', [0, 1, 2, 3, 4], {
            type: intType(false, 8),
          }),
          scalarAttr(
            'flag_meanings',
            'core inner_shell outer_shell coating air',
          ),
        ],
      },
    ),
    dataset(
      'clusters',
      arrayShape([cloud.length, 4]),
      floatType(32),
      Float32Array.from(cloud.flat()),
      {
        attributes: [
          scalarAttr('H5WEB_vis', 'scatter3d'),
          scalarAttr('H5WEB_scatter_columns', 'x y z color'),
          scalarAttr('H5WEB_column_labels', 'x y z cluster'),
          scalarAttr('H5WEB_categorical', 1, { type: intType(false, 8) }),
          scalarAttr('H5WEB_title', 'Labelled point cloud'),
        ],
      },
    ),
  ]);
}
