import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import {
  arrayShape,
  floatType,
  intType,
  strType,
} from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';

/* VTKHDF `UnstructuredGrid`: ball of radius 1 cut out of a grid of 6³ cubes over [-1, 1]³,
 * each split into six tetrahedra, with a smooth point field, a vector field and cell indices */

const N = 6; // cubes along each side
const HEX_TETS = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];

function pointIndex(i: number, j: number, k: number): number {
  return (k * (N + 1) + j) * (N + 1) + i;
}

function makeMesh() {
  const points: number[] = [];
  for (let k = 0; k <= N; k += 1) {
    for (let j = 0; j <= N; j += 1) {
      for (let i = 0; i <= N; i += 1) {
        points.push((2 * i) / N - 1, (2 * j) / N - 1, (2 * k) / N - 1);
      }
    }
  }

  const connectivity: number[] = [];
  for (let k = 0; k < N; k += 1) {
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const [x, y, z] = [i, j, k].map((n) => (2 * n + 1) / N - 1);
        if (x ** 2 + y ** 2 + z ** 2 > 1) {
          continue;
        }
        const hex = [
          pointIndex(i, j, k),
          pointIndex(i + 1, j, k),
          pointIndex(i + 1, j + 1, k),
          pointIndex(i, j + 1, k),
          pointIndex(i, j, k + 1),
          pointIndex(i + 1, j, k + 1),
          pointIndex(i + 1, j + 1, k + 1),
          pointIndex(i, j + 1, k + 1),
        ];
        for (const tet of HEX_TETS) {
          connectivity.push(...tet.map((v) => hex[v]));
        }
      }
    }
  }

  return { points, connectivity };
}

export function makeVtkhdfGroup(): GroupWithChildren {
  const { points, connectivity } = makeMesh();
  const nPoints = points.length / 3;
  const nCells = connectivity.length / 4;
  const xyz = Array.from({ length: nPoints }, (_, i) =>
    points.slice(i * 3, i * 3 + 3),
  );
  const int64 = intType(true, 64);

  return group('vtkhdf', [
    group(
      'VTKHDF',
      [
        dataset('NumberOfPoints', arrayShape([1]), int64, [nPoints]),
        dataset('NumberOfCells', arrayShape([1]), int64, [nCells]),
        dataset('NumberOfConnectivityIds', arrayShape([1]), int64, [
          connectivity.length,
        ]),
        dataset('Points', arrayShape([nPoints, 3]), floatType(64), points),
        dataset(
          'Connectivity',
          arrayShape([connectivity.length]),
          int64,
          BigInt64Array.from(connectivity, BigInt),
        ),
        dataset(
          'Offsets',
          arrayShape([nCells + 1]),
          int64,
          BigInt64Array.from({ length: nCells + 1 }, (_, i) => BigInt(i * 4)),
        ),
        dataset(
          'Types',
          arrayShape([nCells]),
          intType(false, 8),
          Array.from({ length: nCells }, () => 10), // tetrahedra
        ),
        group('PointData', [
          dataset(
            'gaussian',
            arrayShape([nPoints]),
            floatType(),
            xyz.map(([x, y, z]) =>
              Math.exp(-2 * ((x - 0.3) ** 2 + y ** 2 + z ** 2)),
            ),
          ),
          dataset(
            'swirl',
            arrayShape([nPoints, 3]),
            floatType(),
            xyz.flatMap(([x, y, z]) => [-y, x, z / 2]),
          ),
          dataset('name', arrayShape([1]), strType(), ['ignored']),
        ]),
        group('CellData', [
          dataset(
            'cell_index',
            arrayShape([nCells]),
            floatType(),
            Array.from({ length: nCells }, (_, i) => i),
          ),
        ]),
      ],
      {
        attributes: [
          arrayAttr('Version', [2, 4], { type: int64 }),
          scalarAttr('Type', 'UnstructuredGrid'),
        ],
      },
    ),
  ]);
}
