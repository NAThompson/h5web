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
  assertMockAttribute,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { makeMockFile } from '../../../providers/mock/mock-file';
import { findMockEntity } from '../../../providers/mock/utils';
import { findScalarStrAttr } from '../../../utils';
import {
  type CoordinatesGeometry,
  findGeometry,
  type GeometryContext,
  GeometryKind,
  getAxisLabel,
  getGeometryDimsCount,
  isMatchingCoordinate,
  parseCoordinatesAttr,
  resolveCoordinatePath,
} from './utils';

function createMockContext(root: GroupWithChildren): GeometryContext {
  return {
    getEntity: async (path) => {
      try {
        return findMockEntity(root, path);
      } catch {
        return undefined;
      }
    },
    getStrAttr: async (entity, name) => {
      const attr = findScalarStrAttr(entity, name);
      if (!attr) {
        return undefined;
      }

      assertMockAttribute(attr);
      return attr.value as string;
    },
  };
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

/* Build a mock file with given children at the root, and return the context and one of its datasets */
function setup(children: ProvidedEntity[], path: string) {
  const root = group('root.h5', children, { isRoot: true });
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
  if (geometry?.source !== 'coordinates') {
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

describe('resolveCoordinatePath', () => {
  it('should resolve names relative to group of field', () => {
    expect(resolveCoordinatePath('/grp/temp', 'x')).toBe('/grp/x');
    expect(resolveCoordinatePath('/temp', 'x')).toBe('/x');
    expect(resolveCoordinatePath('/grp/temp', 'sub/x')).toBe('/grp/sub/x');
  });

  it('should keep absolute paths', () => {
    expect(resolveCoordinatePath('/grp/temp', '/other/x')).toBe('/other/x');
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
    expect(geometry.coords.map((c) => c.dataset.path)).toEqual([
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

    await expect(findKind(entity, ctx)).resolves.toBe(GeometryKind.Surface);
    expect(getGeometryDimsCount(entity, GeometryKind.Surface)).toBe(2);
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
    expect(geometry.coords.map((c) => c.dataset.name)).toEqual([
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
    expect(geometry.coords.map((c) => c.label)).toEqual([
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

  it('should not detect geometry with incomplete `axis` attributes', async () => {
    const { ctx, entity } = setup(
      [
        coord('x', [10], { axis: 'X' }),
        coord('y', [10], { axis: 'Y' }),
        coord('z', [10]),
        field('temp', [10], { coordinates: 'x y z' }),
      ],
      '/temp',
    );

    await expect(findGeometry(entity, ctx)).resolves.toBeUndefined();
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
    expect(getGeometryDimsCount(entity, GeometryKind.Curve)).toBe(2);

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
        '/geometry/torus_curvature': GeometryKind.Surface,
        '/geometry/torus_waves': GeometryKind.Surface,
        '/geometry/helix': GeometryKind.Curve,
        '/geometry/nx_torus/curvature': GeometryKind.Surface,
      },
    );
  });
});
