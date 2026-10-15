import {
  assertDefined,
  hasChildren,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type Dataset,
  type Entity,
  type GroupWithChildren,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import {
  arrayShape,
  floatType,
  intType,
  scalarShape,
  strType,
} from '@h5web/shared/hdf5-utils';
import {
  arrayAttr,
  assertMockAttribute,
  dataset,
  group,
  scalarAttr,
  withDimScales,
} from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { makeMockFile } from '../../../providers/mock/mock-file';
import { findMockEntity } from '../../../providers/mock/utils';
import {
  type CoordinatesGeometry,
  findGeometry,
  findStrAttr,
  type GeometryContext,
  GeometryKind,
  getAxisLabel,
  getCoordinatePaths,
  getGeometryDefaultSlice,
  getGeometryDimsCount,
  identifyRole,
  identifyScaleRole,
  isMatchingCoordinate,
  normalizePath,
  parseCoordinatesAttr,
  pickXYZ,
} from './utils';

interface MockContext extends GeometryContext {
  calls: {
    getEntity: string[];
    getStrAttr: string[];
    getDimensionScales: string[];
  };
}

function createMockContext(root: GroupWithChildren): MockContext {
  const calls: MockContext['calls'] = {
    getEntity: [],
    getStrAttr: [],
    getDimensionScales: [],
  };

  return {
    calls,
    getEntity: async (path) => {
      calls.getEntity.push(path);
      try {
        return findMockEntity(root, path);
      } catch {
        return undefined;
      }
    },
    getStrAttr: async (entity, name) => {
      const attr = findStrAttr(entity, name);
      if (!attr) {
        return undefined;
      }

      calls.getStrAttr.push(`${entity.path}@${name}`);
      assertMockAttribute(attr);
      const value: unknown = Array.isArray(attr.value)
        ? attr.value[0]
        : attr.value;
      return typeof value === 'string' ? value : undefined;
    },
    getDimensionScales: async (dset) => {
      calls.getDimensionScales.push(dset.path);
      return (dset as { dimScales?: string[][] }).dimScales ?? [];
    },
  };
}

/* Attach dimension scales (by path) to the dimensions of a dataset, as `DIMENSION_LIST` does */
function withScales<T extends ReturnType<typeof coord>>(
  dset: T,
  scales: string[][],
): T {
  return withDimScales(dset, { scales });
}

function coord(
  name: string,
  dims: number[],
  attrs: Record<string, string> = {},
) {
  return dataset(name, arrayShape(dims), floatType(), null, {
    attributes: Object.entries(attrs).map(([key, val]) => scalarAttr(key, val)),
  });
}

function field(
  name: string,
  dims: number[],
  attrs: Record<string, string> = {},
) {
  return coord(name, dims, attrs);
}

/* Build a mock file with given children at the root, and return the context and one of its datasets.
 * The file is a CF trajectory file by default, so 1D coordinates make curves. */
const TRAJECTORY_FILE = { featureType: 'trajectory' };

function setup(
  children: ProvidedEntity[],
  path: string,
  rootAttrs: Record<string, string> = TRAJECTORY_FILE,
) {
  const root = group('root.h5', children, {
    isRoot: true,
    attributes: Object.entries(rootAttrs).map(([key, val]) =>
      scalarAttr(key, val),
    ),
  });
  const entity = findMockEntity(root, path);
  assertDefined(entity);
  return { ctx: createMockContext(root), entity: entity as Dataset };
}

async function findKind(
  entity: Dataset,
  ctx: GeometryContext,
): Promise<GeometryKind | undefined> {
  const geometry = await findGeometry(entity, ctx);
  return geometry?.kind;
}

async function findCoordinatesGeometry(
  entity: Dataset,
  ctx: GeometryContext,
): Promise<CoordinatesGeometry> {
  const geometry = await findGeometry(entity, ctx);
  if (!geometry || geometry.source === 'vertex') {
    throw new Error('Expected coordinates geometry');
  }
  return geometry;
}

function collectDatasets(entity: Entity): Dataset[] {
  if (isDataset(entity)) {
    return [entity];
  }

  return isGroup(entity) && hasChildren(entity)
    ? entity.children.flatMap((child) => collectDatasets(child))
    : [];
}

const xyz = [coord('x', [10]), coord('y', [10]), coord('z', [10])];

describe('parseCoordinatesAttr', () => {
  it('should split names on blanks', () => {
    expect(parseCoordinatesAttr('x y  z')).toEqual(['x', 'y', 'z']);
    expect(parseCoordinatesAttr(' lon\tlat\n')).toEqual(['lon', 'lat']);
    expect(parseCoordinatesAttr('')).toEqual([]);
  });
});

describe('normalizePath', () => {
  it('should resolve `.` and `..` segments', () => {
    expect(normalizePath('/a/b', '../x')).toBe('/a/x');
    expect(normalizePath('/a/b', './sub/x')).toBe('/a/b/sub/x');
    expect(normalizePath('/a', '../../x')).toBe('/x'); // never above root
    expect(normalizePath('/', 'x')).toBe('/x');
  });
});

describe('getCoordinatePaths', () => {
  it('should search bare names by proximity, from group of field up to root', () => {
    expect(getCoordinatePaths('/a/b/temp', 'x')).toEqual([
      '/a/b/x',
      '/a/x',
      '/x',
    ]);
    expect(getCoordinatePaths('/temp', 'x')).toEqual(['/x']);
  });

  it('should resolve relative paths against group of field', () => {
    expect(getCoordinatePaths('/a/b/temp', '../x')).toEqual(['/a/x']);
    expect(getCoordinatePaths('/a/b/temp', './sub/x')).toEqual(['/a/b/sub/x']);
    expect(getCoordinatePaths('/a/b/temp', 'sub/x')).toEqual(['/a/b/sub/x']);
  });

  it('should keep absolute paths', () => {
    expect(getCoordinatePaths('/a/temp', '/other/./x')).toEqual(['/other/x']);
  });
});

describe('identifyRole', () => {
  it('should identify role by `axis` attribute first', () => {
    expect(identifyRole({ axis: 'x', standardName: 'latitude' })).toBe('X');
    expect(identifyRole({ axis: 'T' })).toBe('T');
  });

  it('should identify role by `standard_name`', () => {
    expect(identifyRole({ standardName: 'longitude' })).toBe('X');
    expect(identifyRole({ standardName: 'projection_y_coordinate' })).toBe('Y');
    expect(identifyRole({ standardName: 'altitude' })).toBe('Z');
    expect(identifyRole({ standardName: 'height' })).toBe('Z');
    expect(identifyRole({ standardName: 'time' })).toBe('T');
  });

  it('should identify role by `units`', () => {
    expect(identifyRole({ units: 'degrees_east' })).toBe('X');
    expect(identifyRole({ units: 'degree_E' })).toBe('X');
    expect(identifyRole({ units: 'degrees_north' })).toBe('Y');
    expect(identifyRole({ units: 'degreesN' })).toBe('Y');
    expect(identifyRole({ units: 's since 2000-01-01' })).toBe('T');
    expect(identifyRole({ units: 'days since 1970-01-01 00:00' })).toBe('T');
    expect(identifyRole({ units: 'm' })).toBeUndefined();
  });

  it('should identify vertical coordinate by `positive`', () => {
    expect(identifyRole({ units: 'm', positive: 'up' })).toBe('Z');
    expect(identifyRole({ units: 'm', positive: 'DOWN' })).toBe('Z');
  });

  it('should not identify unknown coordinates', () => {
    expect(identifyRole({})).toBeUndefined();
    expect(identifyRole({ axis: 'W', standardName: 'foo' })).toBeUndefined();
  });
});

describe('pickXYZ', () => {
  it('should pick by role, leaving out time', () => {
    expect(pickXYZ(['t', 'z', 'y', 'x'], ['T', 'Z', 'Y', 'X'])).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('should fall back to listed order only when no role is identified', () => {
    expect(pickXYZ(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
    expect(pickXYZ(['t', 'a', 'b', 'c'], ['T'])).toEqual(['a', 'b', 'c']);
    expect(pickXYZ(['a', 'b'], [])).toBeUndefined();
    expect(pickXYZ(['a', 'b', 'c', 'd'], [])).toBeUndefined();
  });

  it('should give single missing role to single unidentified coordinate', () => {
    expect(pickXYZ(['alt', 'lat', 'lon'], [undefined, 'Y', 'X'])).toEqual([
      'lon',
      'lat',
      'alt',
    ]);
  });

  it('should not guess more than one role, nor accept duplicate roles', () => {
    expect(
      pickXYZ(['a', 'b', 'lon'], [undefined, undefined, 'X']),
    ).toBeUndefined();
    expect(pickXYZ(['a', 'b', 'c'], ['X', 'X', 'Y'])).toBeUndefined();
  });
});

describe('isMatchingCoordinate', () => {
  it('should match 1D or 2D coordinates with trailing dimensions of field', () => {
    expect(isMatchingCoordinate([10], [10])).toBe(true);
    expect(isMatchingCoordinate([5, 10], [10])).toBe(true);
    expect(isMatchingCoordinate([4, 5], [4, 5])).toBe(true);
    expect(isMatchingCoordinate([3, 4, 5], [4, 5])).toBe(true);
  });

  it('should not match other shapes', () => {
    expect(isMatchingCoordinate([10], [9])).toBe(false);
    expect(isMatchingCoordinate([10, 5], [10])).toBe(false); // leading dimension
    expect(isMatchingCoordinate([10], [1, 10])).toBe(false);
    expect(isMatchingCoordinate([2, 3, 4], [2, 3, 4])).toBe(false); // 3D coordinates
    expect(isMatchingCoordinate([10], [])).toBe(false); // scalar coordinate
  });
});

describe('getAxisLabel', () => {
  it('should prefer long name and append units', () => {
    expect(getAxisLabel('x', undefined, undefined)).toBe('x');
    expect(getAxisLabel('x', undefined, 'm')).toBe('x (m)');
    expect(getAxisLabel('x', 'Position', 'm')).toBe('Position (m)');
    expect(getAxisLabel('x', 'Position (m)', 'm')).toBe('Position (m)');
  });
});

describe('findGeometry with `coordinates` attribute', () => {
  it('should detect curve from 1D coordinates', async () => {
    const { ctx, entity } = setup(
      [...xyz, field('temp', [10], { coordinates: 'x y z' })],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.kind).toBe(GeometryKind.Curve);
    expect(geometry.coords.map((c) => c?.dataset.path)).toEqual([
      '/x',
      '/y',
      '/z',
    ]);
  });

  it('should detect surface from 2D coordinates', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [4, 5]),
        coord('y', [4, 5]),
        coord('z', [4, 5]),
        field('K', [4, 5], { coordinates: 'x y z' }),
      ],
      '/K',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Surface);
  });

  it('should allow leading dimensions in field (e.g. time)', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [4, 5]),
        coord('y', [4, 5]),
        coord('z', [4, 5]),
        field('K', [7, 4, 5], { coordinates: 'x y z' }),
      ],
      '/K',
    );

    const geometry = await findGeometry(entity, ctx);
    expect(geometry?.kind).toBe(GeometryKind.Surface);
    expect(geometry && getGeometryDimsCount(geometry)).toBe(2);
  });

  it('should resolve coordinates relative to group of field, or absolute', async () => {
    const { ctx, entity } = setup(
      [
        group('grp', [
          coord('x', [10]),
          coord('y', [10]),
          field('temp', [10], { coordinates: 'x y /other/z' }),
        ]),
        group('other', [coord('z', [10])]),
      ],
      '/grp/temp',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });

  it('should order coordinates by CF `axis` attribute when present', async () => {
    const { ctx, entity } = setup(
      [
        coord('alt', [10], { axis: 'Z' }),
        coord('lat', [10], { axis: 'Y' }),
        coord('lon', [10], { axis: 'X' }),
        coord('time', [10], { axis: 'T' }),
        field('temp', [10], { coordinates: 'time alt lat lon' }),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.name)).toEqual([
      'lon',
      'lat',
      'alt',
    ]);
  });

  it('should leave out time coordinate when no spatial axis is specified', async () => {
    const { ctx, entity } = setup(
      [
        ...xyz,
        coord('time', [10], { axis: 'T' }),
        field('temp', [10], { coordinates: 'time x y z' }),
      ],
      '/temp',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });

  it('should ignore non-matching variables (scalar coordinates, labels)', async () => {
    const { ctx, entity } = setup(
      [
        ...xyz,
        dataset('time', scalarShape(), floatType(), 0),
        dataset('label', arrayShape([10]), strType(), null),
        field('temp', [10], { coordinates: 'time x label y z' }),
      ],
      '/temp',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });

  it('should get axis labels from long names and units', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { units: 'm' }),
        coord('y', [10], { long_name: 'Height', units: 'km' }),
        coord('z', [10]),
        field('temp', [10], { coordinates: 'x y z' }),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.label)).toEqual([
      'x (m)',
      'Height (km)',
      'z',
    ]);
  });

  it.each([
    ['fewer than three coordinates (e.g. lon/lat grid)', 'x y'],
    ['missing coordinate', 'x y unknown'],
    ['more than three unordered coordinates', 'x y z x2'],
    ['field itself among coordinates', 'x y temp'],
    ['empty attribute', ''],
  ])('should not detect geometry with %s', async (_, coordinates) => {
    const { ctx, entity } = setup(
      [...xyz, coord('x2', [10]), field('temp', [10], { coordinates })],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should not detect geometry when coordinates do not match field', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [9]),
        coord('y', [9]),
        coord('z', [9]),
        field('temp', [10], { coordinates: 'x y z' }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should not detect geometry when coordinates have different ranks', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [5]),
        coord('y', [4, 5]),
        coord('z', [4, 5]),
        field('K', [4, 5], { coordinates: 'x y z' }),
      ],
      '/K',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should not detect surface with a single row or column', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [1, 5]),
        coord('y', [1, 5]),
        coord('z', [1, 5]),
        field('K', [1, 5], { coordinates: 'x y z' }),
      ],
      '/K',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should not detect geometry when more than one role is unidentified', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { axis: 'X' }),
        coord('y', [10]),
        coord('z', [10]),
        field('temp', [10], { coordinates: 'x y z' }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should identify longitude, latitude and altitude by `standard_name` and `units`', async () => {
    const { ctx, entity } = setup(
      [
        coord('time', [10], { units: 'seconds since 2000-01-01' }),
        coord('alt', [10], { standard_name: 'altitude', units: 'm' }),
        coord('la', [10], { units: 'degrees_north' }),
        coord('lo', [10], { units: 'degrees_east' }),
        field('temp', [10], { coordinates: 'time alt la lo' }),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.name)).toEqual([
      'lo',
      'la',
      'alt',
    ]);
  });

  it('should take altitude as Z when longitude and latitude are identified', async () => {
    const { ctx, entity } = setup(
      [
        coord('lat', [10], { units: 'degrees_north' }),
        coord('lon', [10], { units: 'degrees_east' }),
        coord('elevation', [10], { units: 'm' }),
        field('temp', [10], { coordinates: 'lat lon elevation' }),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.name)).toEqual([
      'lon',
      'lat',
      'elevation',
    ]);
  });

  it('should not detect geometry for non-numeric field', async () => {
    const { ctx, entity } = setup(
      [
        ...xyz,
        dataset('temp', arrayShape([10]), strType(), null, {
          attributes: [scalarAttr('coordinates', 'x y z')],
        }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });
});

describe('findGeometry: CF `featureType`', () => {
  const children = [...xyz, field('temp', [10], { coordinates: 'x y z' })];

  it('should draw 1D coordinates as curve only for trajectories', async () => {
    const trajectory = setup(children, '/temp', { featureType: 'trajectory' });
    await expect(findKind(trajectory.entity, trajectory.ctx)).resolves.toBe(
      GeometryKind.Curve,
    );

    const others = ['timeSeries', 'point', 'profile'].map((featureType) =>
      setup(children, '/temp', { featureType }),
    );
    await expect(
      Promise.all(others.map(async (o) => findGeometry(o.entity, o.ctx))),
    ).resolves.toEqual([undefined, undefined, undefined]);

    const none = setup(children, '/temp', {});
    await expect(findGeometry(none.entity, none.ctx)).resolves.toBeUndefined();
  });

  it('should accept `featureType` on field itself, overriding global attribute', async () => {
    const optIn = setup(
      [
        ...xyz,
        field('temp', [10], {
          coordinates: 'x y z',
          featureType: 'trajectory',
        }),
      ],
      '/temp',
      {},
    );
    await expect(findKind(optIn.entity, optIn.ctx)).resolves.toBe(
      GeometryKind.Curve,
    );

    const optOut = setup(
      [
        ...xyz,
        field('temp', [10], { coordinates: 'x y z', featureType: 'point' }),
      ],
      '/temp',
      { featureType: 'trajectory' },
    );
    await expect(
      findGeometry(optOut.entity, optOut.ctx),
    ).resolves.toBeUndefined();
  });

  it('should not require `featureType` for surfaces (grid connectivity is implied)', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [4, 5]),
        coord('y', [4, 5]),
        coord('z', [4, 5]),
        field('K', [4, 5], { coordinates: 'x y z' }),
      ],
      '/K',
      {},
    );
    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Surface);
  });
});

describe('findGeometry: group references', () => {
  it('should resolve `../` paths and search bare names in ancestor groups', async () => {
    const { ctx, entity } = setup(
      [
        coord('z', [10]), // root: found by proximity search
        group('a', [
          coord('x', [10]),
          group('b', [
            coord('x', [10], { long_name: 'nearest x' }), // nearest wins
            field('temp', [10], { coordinates: 'x ../y z' }),
          ]),
          coord('y', [10]),
        ]),
      ],
      '/a/b/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.path)).toEqual([
      '/a/b/x',
      '/a/y',
      '/z',
    ]);
    expect(geometry.coords[0].label).toBe('nearest x');
  });
});

describe('findGeometry: requests', () => {
  it('should not fetch any coordinate when fewer than three names are listed', async () => {
    const { ctx, entity } = setup(
      [
        coord('lon', [4, 5]),
        coord('lat', [4, 5]),
        field('temp', [4, 5], { coordinates: 'lon lat' }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
    expect(ctx.calls.getEntity).toEqual([]);
    expect(ctx.calls.getStrAttr).toEqual(['/temp@coordinates']);
  });

  it('should not fetch attributes of coordinates when fewer than three match', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { units: 'm' }),
        coord('y', [10], { units: 'm' }),
        dataset('t', scalarShape(), floatType(), 0),
        field('temp', [10], { coordinates: 'x y t' }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
    expect(ctx.calls.getStrAttr).toEqual(['/temp@coordinates']);
  });
});

describe('findGeometry: non-scalar attributes', () => {
  it('should accept `coordinates` stored as single-element string array', async () => {
    const { ctx, entity } = setup(
      [
        ...xyz,
        dataset('temp', arrayShape([10]), floatType(), null, {
          attributes: [arrayAttr('coordinates', ['x y z'])],
        }),
      ],
      '/temp',
    );

    const geometry = await findGeometry(entity, ctx);
    expect(geometry?.kind).toBe(GeometryKind.Curve);
    expect(geometry && getGeometryDimsCount(geometry)).toBe(1);
  });

  it('should not detect geometry when `coordinates` is not a string', async () => {
    const { ctx, entity } = setup(
      [
        ...xyz,
        dataset('temp', arrayShape([10]), floatType(), null, {
          attributes: [scalarAttr('coordinates', 42)],
        }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should accept `interpretation` stored as single-element string array', async () => {
    const { ctx, entity } = setup(
      [
        dataset('pts', arrayShape([10, 3]), floatType(), null, {
          attributes: [arrayAttr('interpretation', ['vertex'])],
        }),
      ],
      '/pts',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });
});

describe('findGeometry with `vertex` interpretation', () => {
  it('should detect curve from (N, 3) or (N, 2) vertices', async () => {
    const { ctx, entity } = setup(
      [field('pts', [10, 3], { interpretation: 'vertex', units: 'mm' })],
      '/pts',
    );

    const geometry = await findGeometry(entity, ctx);
    expect(geometry).toMatchObject({
      source: 'vertex',
      kind: GeometryKind.Curve,
      unit: 'mm',
    });
    expect(geometry && getGeometryDimsCount(geometry)).toBe(2);

    const planar = setup(
      [field('pts', [10, 2], { interpretation: 'vertex' })],
      '/pts',
    );
    await expect(findKind(planar.entity, planar.ctx)).resolves.toBe(
      GeometryKind.Curve,
    );
  });

  it('should allow leading dimensions', async () => {
    const { ctx, entity } = setup(
      [field('pts', [4, 10, 3], { interpretation: 'vertex' })],
      '/pts',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });

  it.each([
    ['no interpretation', [10, 3], {}],
    ['other interpretation', [10, 3], { interpretation: 'spectrum' }],
    ['last dimension not 2 or 3', [10, 4], { interpretation: 'vertex' }],
    ['1D dataset', [3], { interpretation: 'vertex' }],
    [
      'non-matching `coordinates` attribute',
      [10, 3],
      { interpretation: 'vertex', coordinates: 'unknown' },
    ],
  ])('should not detect curve with %s', async (_, dims, attrs) => {
    const { ctx, entity } = setup([field('pts', dims, attrs)], '/pts');
    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should support integer vertices', async () => {
    const { ctx, entity } = setup(
      [
        dataset('pts', arrayShape([10, 3]), intType(), null, {
          attributes: [scalarAttr('interpretation', 'vertex')],
        }),
      ],
      '/pts',
    );

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Curve);
  });
});

describe('findGeometry on mock file', () => {
  it('should only detect curves and surfaces in `geometry` group (no false positive)', async () => {
    const mockFile = makeMockFile();
    const ctx = createMockContext(mockFile);

    const detected = await Promise.all(
      collectDatasets(mockFile).map(async (d) => {
        const geometry = await findGeometry(d, ctx);
        return geometry ? [d.path, geometry.kind] : undefined;
      }),
    );

    expect(Object.fromEntries(detected.filter((d) => d !== undefined))).toEqual(
      {
        '/geometry/knot_speed': GeometryKind.Curve,
        '/geometry/knot_speed_dimscales': GeometryKind.Curve,
        '/geometry/knot_speed_phases_dimscales': GeometryKind.Curve,
        '/geometry/torus_curvature': GeometryKind.Surface,
        '/geometry/torus_hinted': GeometryKind.Surface,
        '/geometry/torus_waves': GeometryKind.Surface,
        '/geometry/helix': GeometryKind.Curve,
        '/geometry/nx_torus/curvature': GeometryKind.Surface,
        '/geometry/nx_torus_waves/waves': GeometryKind.Surface,
      },
    );
  });
});

describe('getGeometryDefaultSlice', () => {
  it('should keep default slice of leading dimensions', () => {
    expect(getGeometryDefaultSlice([5, '.', '.'], 2)).toEqual([5, '.', '.']);
    expect(getGeometryDefaultSlice([1, 2, '.'], 1)).toEqual([1, 2, '.']);
    expect(getGeometryDefaultSlice(['.', '.'], 2)).toEqual(['.', '.']);
  });

  it('should ignore default slice incompatible with geometry dimensions', () => {
    expect(getGeometryDefaultSlice(['.', 5, '.'], 2)).toBeUndefined();
    expect(getGeometryDefaultSlice([5, 3, '.'], 2)).toBeUndefined();
    expect(getGeometryDefaultSlice(['.'], 2)).toBeUndefined();
    expect(getGeometryDefaultSlice(undefined, 2)).toBeUndefined();
  });
});

describe('findGeometry with dimension scales', () => {
  const scales = [
    coord('x', [10], { NAME: 'x' }),
    coord('y', [10], { NAME: 'y' }),
    coord('z', [10], { NAME: 'z' }),
  ];
  const xyzScales = [['/x', '/y', '/z']];

  it('should detect curve from scales named x, y and z attached to last dimension', async () => {
    const { ctx, entity } = setup(
      [...scales, withScales(field('t', [10]), xyzScales)],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.source).toBe('dimension-scales');
    expect(geometry.kind).toBe(GeometryKind.Curve);
    expect(geometry.coords.map((c) => c?.dataset.path)).toEqual([
      '/x',
      '/y',
      '/z',
    ]);
    expect(getGeometryDimsCount(geometry)).toBe(1);
  });

  it('should identify scales by CF attributes, whatever their order', async () => {
    const { ctx, entity } = setup(
      [
        coord('alt', [10], { standard_name: 'altitude', units: 'km' }),
        coord('lat', [10], { units: 'degrees_north' }),
        coord('lon', [10], { units: 'degrees_east' }),
        coord('time', [10], { units: 's since 2000-01-01' }),
        withScales(field('temp', [10]), [['/time', '/alt', '/lat', '/lon']]),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.name)).toEqual([
      'lon',
      'lat',
      'alt',
    ]);
  });

  it('should detect planar curve from X and Y scales only', async () => {
    const { ctx, entity } = setup(
      [...scales, withScales(field('t', [10]), [['/x', '/y']])],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords[2]).toBeUndefined();
  });

  it('should support leading dimensions, with scales on last dimension', async () => {
    const { ctx, entity } = setup(
      [...scales, withScales(field('t', [4, 10]), [[], ['/x', '/y', '/z']])],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(getGeometryDimsCount(geometry)).toBe(1);
  });

  it('should give precedence to `coordinates` attribute', async () => {
    const { ctx, entity } = setup(
      [
        ...scales,
        ...xyz.map((c) => ({ ...c, name: `c${c.name}`, path: `/c${c.name}` })),
        withScales(field('t', [10], { coordinates: 'cx cy cz' }), xyzScales),
      ],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.source).toBe('coordinates');
  });

  it('should not detect curve from alternative scales of the same dimension', async () => {
    const { ctx, entity } = setup(
      [
        coord('time_s', [10], { units: 's since 2000-01-01' }),
        coord('time_h', [10], { units: 'hours since 2000-01-01' }),
        coord('index', [10], { NAME: 'sample' }),
        withScales(field('temp', [10]), [['/time_s', '/time_h', '/index']]),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });

  it('should not detect curve for station time series (not a trajectory)', async () => {
    const children = [
      coord('lat', [10], { units: 'degrees_north' }),
      coord('lon', [10], { units: 'degrees_east' }),
      coord('alt', [10], { standard_name: 'altitude', units: 'm' }),
      withScales(field('temp', [5, 10]), [[], ['/lat', '/lon', '/alt']]),
    ];

    const stations = setup(children, '/temp', { featureType: 'timeSeries' });
    await expect(
      findGeometry(stations.entity, stations.ctx),
    ).resolves.toBeUndefined();

    const noFeatureType = setup(children, '/temp', {});
    await expect(
      findGeometry(noFeatureType.entity, noFeatureType.ctx),
    ).resolves.toBeUndefined();
  });

  it('should not detect curve with ambiguous or missing spatial scales', async () => {
    const ambiguous = setup(
      [
        coord('x', [10], { NAME: 'x' }),
        coord('x2', [10], { axis: 'X' }),
        coord('y', [10], { NAME: 'y' }),
        withScales(field('t', [10]), [['/x', '/x2', '/y']]),
      ],
      '/t',
    );
    await expect(
      findGeometry(ambiguous.entity, ambiguous.ctx),
    ).resolves.toBeUndefined();

    const noY = setup(
      [...scales, withScales(field('t', [10]), [['/x', '/z']])],
      '/t',
    );
    await expect(findGeometry(noY.entity, noY.ctx)).resolves.toBeUndefined();
  });

  it('should ignore scales that do not match the dimension', async () => {
    const { ctx, entity } = setup(
      [
        ...scales,
        coord('bins', [11], { NAME: 'z' }), // bin edges
        withScales(field('t', [10]), [['/x', '/y', '/bins']]),
      ],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords[2]).toBeUndefined();
  });

  it('should not fetch scales when fewer than two are attached to last dimension', async () => {
    const { ctx, entity } = setup(
      [...scales, withScales(field('t', [10]), [['/x']])],
      '/t',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
    expect(ctx.calls.getDimensionScales).toEqual(['/t']);
    expect(ctx.calls.getEntity).toEqual(['/']); // root, for its `featureType`: no scale fetched
  });

  it('should not look for scales without `DIMENSION_LIST` or without provider support', async () => {
    const withoutList = setup(
      [...scales, { ...field('t', [10]), dimScales: xyzScales }],
      '/t',
    );
    await expect(
      findGeometry(withoutList.entity, withoutList.ctx),
    ).resolves.toBeUndefined();
    expect(withoutList.ctx.calls.getDimensionScales).toEqual([]);

    const unsupported = setup(
      [...scales, withScales(field('t', [10]), xyzScales)],
      '/t',
    );
    await expect(
      findGeometry(unsupported.entity, {
        ...unsupported.ctx,
        getDimensionScales: async () => null, // provider can't dereference `DIMENSION_LIST`
      }),
    ).resolves.toBeUndefined();
  });
});

describe('identifyScaleRole', () => {
  it('should identify scales named x, y, z as last resort', () => {
    expect(identifyScaleRole({ scaleName: 'x' })).toBe('X');
    expect(identifyScaleRole({ scaleName: 'Z' })).toBe('Z');
    expect(identifyScaleRole({ scaleName: 'time' })).toBeUndefined();
    expect(identifyScaleRole({ scaleName: 'x', units: 'degrees_north' })).toBe(
      'Y',
    );
    expect(identifyRole({ scaleName: 'x' })).toBeUndefined(); // not for `coordinates`
  });
});

describe('findGeometry: dimension scales vs other rules', () => {
  it('should not use scale `NAME` to identify `coordinates` (listed order still applies)', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { CLASS: 'DIMENSION_SCALE', NAME: 'x' }),
        coord('y', [10]),
        coord('z', [10]),
        field('temp', [10], { coordinates: 'x y z' }),
      ],
      '/temp',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.dataset.name)).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('should not ask provider for scales of datasets that are not trajectories', async () => {
    const children = [
      coord('x', [10], { NAME: 'x' }),
      coord('y', [10], { NAME: 'y' }),
      withScales(field('t', [10]), [['/x', '/y']]),
    ];

    const timeSeries = setup(children, '/t', { featureType: 'timeSeries' });
    await expect(
      findGeometry(timeSeries.entity, timeSeries.ctx),
    ).resolves.toBeUndefined();
    expect(timeSeries.ctx.calls.getDimensionScales).toEqual([]);

    const none = setup(children, '/t', {});
    await expect(findGeometry(none.entity, none.ctx)).resolves.toBeUndefined();
    expect(none.ctx.calls.getDimensionScales).toEqual([]);
  });

  it('should fall through to `vertex` interpretation when scales do not make a curve', async () => {
    const { ctx, entity } = setup(
      [
        coord('t', [10], { units: 's since 2000-01-01' }),
        withScales(field('pts', [10, 3], { interpretation: 'vertex' }), [
          ['/t'],
          [],
        ]),
      ],
      '/pts',
    );

    const geometry = await findGeometry(entity, ctx);
    expect(geometry?.source).toBe('vertex');
    expect(geometry && getGeometryDimsCount(geometry)).toBe(2);
  });

  it('should label scale axes by `long_name`, else `NAME`, else name, with units', async () => {
    const { ctx, entity } = setup(
      [
        coord('xs', [10], { NAME: 'x', units: 'm' }),
        coord('ys', [10], { axis: 'Y', long_name: 'Height' }),
        coord('zs', [10], { axis: 'Z' }),
        withScales(field('t', [10]), [['/xs', '/ys', '/zs']]),
      ],
      '/t',
    );

    const geometry = await findCoordinatesGeometry(entity, ctx);
    expect(geometry.coords.map((c) => c?.label)).toEqual([
      'x (m)',
      'Height',
      'zs',
    ]);
  });

  it('should not detect curve when scale list does not match dimensions', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { NAME: 'x' }),
        coord('y', [10], { NAME: 'y' }),
        withScales(field('t', [4, 10]), [['/x', '/y']]), // one list for two dimensions
      ],
      '/t',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
  });
});
