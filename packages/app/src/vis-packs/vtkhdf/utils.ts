import {
  getGridSpec,
  getMeshBounds,
  type GridSpec,
  mergePieces,
  resampleMeshInWorker,
} from '@h5web/lib';
import {
  assertValue,
  hasArrayShape,
  hasChildren,
  hasNumericType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type GroupWithChildren,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';

import { type DataContextValue } from '../../providers/DataProvider';
import {
  findScalarStrAttr,
  getAttributeValue,
  hasAttribute,
} from '../../utils';
import { toNumArray } from '../core/utils';

type NumDataset = Dataset<ArrayShape, NumericType>;

export interface VtkField {
  dataset: NumDataset;
  association: 'point' | 'cell';
  components: number;
}

export interface ResampledField {
  values: Float32Array<ArrayBuffer>;
  grid: GridSpec;
  axisValues: Float64Array[]; // coordinates of the samples along `[z, y, x]`
}

const MESH_DATASETS = [
  'Points',
  'Connectivity',
  'Offsets',
  'Types',
  'NumberOfPoints',
  'NumberOfCells',
  'NumberOfConnectivityIds',
] as const;

/* VTKHDF group (e.g. `/VTKHDF`) with `Type = "UnstructuredGrid"` and a `Version` */
export async function isVtkUnstructuredGrid(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<boolean> {
  const typeAttr = findScalarStrAttr(group, 'Type');
  if (!typeAttr || !hasAttribute(group, 'Version')) {
    return false;
  }
  const type = await getAttributeValue(group, typeAttr, dataContext);
  return type === 'UnstructuredGrid';
}

/* `VTKHDF` child of a group (e.g. of the root of a `.vtkhdf` file), shown in its place */
export function findVtkhdfChildPath(
  group: GroupWithChildren,
): string | undefined {
  return group.children.find(
    (child) => child.name === 'VTKHDF' && isGroup(child),
  )?.path;
}

export function getMeshDatasets(
  group: GroupWithChildren,
): Record<(typeof MESH_DATASETS)[number], NumDataset> {
  return Object.fromEntries(
    MESH_DATASETS.map((name) => {
      const child = group.children.find((entity) => entity.name === name);
      if (
        !child ||
        !isDataset(child) ||
        !hasArrayShape(child) ||
        !hasNumericType(child)
      ) {
        throw new Error(`Expected numeric "${name}" dataset in VTKHDF group`);
      }
      return [name, child];
    }),
  ) as Record<(typeof MESH_DATASETS)[number], NumDataset>;
}

/* Numeric arrays of `PointData` and `CellData` (others, e.g. strings, are ignored); vectors
 * (one row per point or cell) are resampled by magnitude */
export async function getVtkFields(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<VtkField[]> {
  const { queryClient, queries } = dataContext;
  const sources = [
    ['PointData', 'point'],
    ['CellData', 'cell'],
  ] as const;

  const groups = await Promise.all(
    sources.map(async ([name]) => {
      const child = group.children.find((entity) => entity.name === name);
      return child && isGroup(child)
        ? queryClient.query(queries.entity(child.path))
        : undefined;
    }),
  );

  return groups.flatMap((dataGroup, i) => {
    if (!dataGroup || !isGroup(dataGroup) || !hasChildren(dataGroup)) {
      return [];
    }
    return dataGroup.children.flatMap((child): VtkField[] => {
      if (
        !isDataset(child) ||
        !hasArrayShape(child) ||
        !hasNumericType(child) ||
        child.shape.dims.length > 2
      ) {
        return [];
      }
      const { dims } = child.shape;
      return [
        {
          dataset: child,
          association: sources[i][1],
          components: dims.length === 2 ? dims[1] : 1,
        },
      ];
    });
  });
}

/* Number of steps of a temporal grid (`Steps` group) and of pieces of its first step */
async function getSteps(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<{ nSteps: number; nParts?: number } | undefined> {
  const { queryClient, queries } = dataContext;
  const child = group.children.find((entity) => entity.name === 'Steps');
  if (!child || !isGroup(child)) {
    return undefined;
  }

  const steps = await queryClient.query(queries.entity(child.path));
  if (!isGroup(steps) || !hasChildren(steps)) {
    return undefined;
  }
  const attrs = await queryClient.query(queries.attrValues(steps));
  const nSteps = Number(attrs.NSteps);
  if (!Number.isInteger(nSteps) || nSteps < 1) {
    throw new Error('Expected "NSteps" attribute on Steps group');
  }
  const parts = steps.children.find(({ name }) => name === 'NumberOfParts');
  if (parts && isDataset(parts) && hasArrayShape(parts)) {
    const value = await queryClient.query(queries.value(parts));
    return { nSteps, nParts: Number((value as ArrayLike<number | bigint>)[0]) };
  }
  return { nSteps };
}

async function fetchNumArray(
  dataset: NumDataset,
  dataContext: DataContextValue,
): Promise<NumArray> {
  const { queryClient, queries } = dataContext;
  const value = await queryClient.query(queries.value(dataset));
  assertValue(value, dataset);
  return toNumArray(value);
}

function sum(arr: number[]): number {
  return arr.reduce((acc, val) => acc + val, 0);
}

function head(arr: NumArray, length: number): NumArray {
  return arr.length === length ? arr : arr.slice(0, length);
}

export interface VtkGridInfo {
  fields: VtkField[];
  nSteps?: number; // of a temporal grid, of which only the first step is shown
  counts: { points: number[]; cells: number[]; connectivityIds: number[] }; // per piece
  pointCount: number;
  cellCount: number;
}

/* Fields and size of a VTKHDF group (of its first step, if temporal) */
export async function getVtkGridInfo(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<VtkGridInfo> {
  const datasets = getMeshDatasets(group);
  const [fields, steps, nPoints, nCells, nConnectivityIds] = await Promise.all([
    getVtkFields(group, dataContext),
    getSteps(group, dataContext),
    fetchNumArray(datasets.NumberOfPoints, dataContext),
    fetchNumArray(datasets.NumberOfCells, dataContext),
    fetchNumArray(datasets.NumberOfConnectivityIds, dataContext),
  ]);

  // Pieces of all steps are stored one after the other
  const nParts = steps
    ? (steps.nParts ?? nCells.length / steps.nSteps)
    : nCells.length;
  if (
    !Number.isInteger(nParts) ||
    nParts < 1 ||
    [nPoints, nCells, nConnectivityIds].some((arr) => arr.length < nParts)
  ) {
    throw new Error(
      steps
        ? 'Expected NumberOfPoints, NumberOfCells and NumberOfConnectivityIds to have NumberOfParts values per step'
        : 'Expected NumberOfPoints, NumberOfCells and NumberOfConnectivityIds to have the same length',
    );
  }

  const counts = {
    points: [...head(nPoints, nParts)],
    cells: [...head(nCells, nParts)],
    connectivityIds: [...head(nConnectivityIds, nParts)],
  };
  return {
    fields,
    nSteps: steps?.nSteps,
    counts,
    pointCount: sum(counts.points),
    cellCount: sum(counts.cells),
  };
}

/* Check that mesh arrays are long enough for the pieces, and that the offsets of each piece
 * end at its number of connectivity IDs */
function checkMesh(
  info: VtkGridInfo,
  arrays: Record<'points' | 'connectivity' | 'offsets' | 'types', NumArray>,
): void {
  const { counts, pointCount, cellCount } = info;
  const { points, connectivity, offsets, types } = arrays;
  if (
    points.length < pointCount * 3 ||
    types.length < cellCount ||
    offsets.length < cellCount + counts.cells.length ||
    connectivity.length < sum(counts.connectivityIds)
  ) {
    throw new Error(
      'Expected Points, Types, Offsets and Connectivity to match NumberOfPoints, NumberOfCells and NumberOfConnectivityIds',
    );
  }

  let start = 0;
  for (const [piece, nPieceCells] of counts.cells.entries()) {
    if (offsets[start + nPieceCells] !== counts.connectivityIds[piece]) {
      throw new Error(
        `Expected Offsets of piece ${piece} to end at its NumberOfConnectivityIds`,
      );
    }
    start += nPieceCells + 1;
  }
}

/* Fetch the mesh and a field of a VTKHDF group (whole datasets, even if temporal), and
 * resample the field onto a grid with `resolution` samples along the longest side */
export async function resampleVtkField(
  group: GroupWithChildren,
  info: VtkGridInfo,
  field: VtkField,
  resolution: number,
  dataContext: DataContextValue,
  signal?: AbortSignal,
): Promise<ResampledField> {
  const datasets = getMeshDatasets(group);
  const [points, connectivity, offsets, types, fieldValues] = await Promise.all(
    [
      datasets.Points,
      datasets.Connectivity,
      datasets.Offsets,
      datasets.Types,
      field.dataset,
    ].map(async (dataset) => fetchNumArray(dataset, dataContext)),
  );
  checkMesh(info, { points, connectivity, offsets, types });

  const { pointCount, cellCount } = info;
  const { association, components } = field;
  const valueCount = association === 'point' ? pointCount : cellCount;
  if (fieldValues.length < valueCount * components) {
    throw new Error(
      `Expected ${field.dataset.name} to have values for every ${association}`,
    );
  }

  const meshPoints = head(points, pointCount * 3);
  const grid = getGridSpec(getMeshBounds(meshPoints), resolution);
  const resampled = await resampleMeshInWorker(
    points, // cached value of this provider: a new mesh if fetched again (e.g. another file)
    () =>
      mergePieces(
        {
          points: meshPoints,
          connectivity,
          offsets,
          types: head(types, cellCount),
        },
        info.counts,
      ),
    { values: fieldValues, association, components },
    grid,
    signal,
  );
  if (!resampled.some(Number.isFinite)) {
    throw new Error('No 3D cells to resample (tetrahedra, hexahedra, etc.)');
  }

  const axisValues = [2, 1, 0].map((axis) => {
    const n = grid.shape[2 - axis];
    const [min, max] = [grid.min[axis], grid.max[axis]];
    return Float64Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return min * (1 - t) + max * t; // exact 0 at the middle of symmetric bounds
    });
  });
  return { values: resampled, grid, axisValues };
}

/* First scalar point field, else first scalar cell field, else first vector field */
export function getDefaultField(fields: VtkField[]): VtkField | undefined {
  return (
    fields.find((f) => f.components === 1 && f.association === 'point') ??
    fields.find((f) => f.components === 1) ??
    fields[0]
  );
}
