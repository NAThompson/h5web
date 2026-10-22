import { assertDefined } from '@h5web/shared/guards';
import {
  type Attribute,
  type GroupWithChildren,
} from '@h5web/shared/hdf5-models';
import { assertMockAttribute, scalarAttr } from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { makeMockFile } from '../../../providers/mock/mock-file';
import { findMockEntity } from '../../../providers/mock/utils';
import { HintVis } from '../../view-hints/models';
import { type OverlayContext } from '../../view-hints/overlays';
import { findStrAttr } from '../geometry/utils';
import {
  findScatterSource,
  getAlongDim,
  getDefaultColumns,
  parseColumnLabels,
  parseScatterColumns,
} from './source';

describe('parseScatterColumns', () => {
  it('give the channel of each column', () => {
    expect(parseScatterColumns('x y z color', 4)).toEqual([
      'x',
      'y',
      'z',
      'color',
    ]);
    expect(parseScatterColumns(' t  X y - Colour size ', 6)).toBeUndefined(); // `t` unknown
    expect(parseScatterColumns('- x y - colour size', 7)).toEqual([
      undefined,
      'x',
      'y',
      undefined,
      'color',
      'size',
    ]);
  });

  it('reject invalid lists', () => {
    expect(parseScatterColumns('x y z', 2)).toBeUndefined(); // more names than columns
    expect(parseScatterColumns('x x', 2)).toBeUndefined(); // repeated
    expect(parseScatterColumns('x z color', 3)).toBeUndefined(); // no y
    expect(parseScatterColumns('', 3)).toBeUndefined();
  });
});

describe('getDefaultColumns', () => {
  it('put z third in 3D, colour third in 2D', () => {
    expect(getDefaultColumns(2, true)).toEqual(['x', 'y']);
    expect(getDefaultColumns(3, true)).toEqual(['x', 'y', 'z']);
    expect(getDefaultColumns(3, false)).toEqual(['x', 'y', 'color']);
    expect(getDefaultColumns(6, false)).toEqual(['x', 'y', 'color', 'size']);
  });
});

describe('parseColumnLabels', () => {
  it('accept arrays of strings or space-separated strings of the right length', () => {
    expect(parseColumnLabels(['a b', 'c'], 2)).toEqual(['a b', 'c']);
    expect(parseColumnLabels('x y energy', 3)).toEqual(['x', 'y', 'energy']);
    expect(parseColumnLabels('x y', 3)).toBeUndefined();
    expect(parseColumnLabels([1, 2], 2)).toBeUndefined();
  });
});

function createMockContext(root: GroupWithChildren): OverlayContext {
  return {
    getEntity: async (path) => {
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
      assertMockAttribute(attr);
      return typeof attr.value === 'string' ? attr.value : undefined;
    },
    getDimensionScales: async (dset) =>
      (dset as { dimScales?: string[][] }).dimScales ?? [],
    getAttrValues: async ({ attributes }: { attributes: Attribute[] }) =>
      Object.fromEntries(
        attributes.map((attr) => {
          assertMockAttribute(attr);
          return [attr.name, attr.value];
        }),
      ),
    getValue: async (dset) => (dset as { value?: unknown }).value,
  };
}

describe('findScatterSource', () => {
  const root = makeMockFile();
  const ctx = createMockContext(root);

  async function find(path: string, vis?: HintVis, xDim?: number) {
    const entity = findMockEntity(root, path);
    assertDefined(entity);
    return findScatterSource(entity, vis, ctx, xDim);
  }

  it('find columns of hinted (n, k) datasets only', async () => {
    const source = await find('/scatter/columns', HintVis.Scatter3D);
    expect(source?.form).toBe('columns');
    expect(source?.count).toBe(600);
    expect(source?.channels.z?.column).toBe(2);
    expect(source?.channels.color).toMatchObject({
      column: 3,
      label: 'energy',
    });

    await expect(find('/scatter/xy')).resolves.toBeUndefined();
    await expect(find('/scatter/xy', HintVis.Heatmap)).resolves.toBeUndefined();
  });

  it('fall back to columns of hinted (n, k) dataset with CF coordinates', async () => {
    const columns = findMockEntity(root, '/scatter/columns');
    assertDefined(columns);
    const withCoords = {
      ...columns,
      attributes: [...columns.attributes, scalarAttr('coordinates', 'a b')],
    };
    const source = await findScatterSource(withCoords, HintVis.Scatter, ctx);
    expect(source?.form).toBe('columns');
  });

  it('read colour of all points and point size', async () => {
    const source = await find('/scatter/two_d', HintVis.Scatter);
    expect(source?.channels.color).toBeUndefined();
    expect(source?.solidColor).toBe('crimson'); // as is without DOM
    expect(source?.pointSize).toBe(6);
  });

  it('find CF point coordinates in X, Y, Z order', async () => {
    const source = await find('/scatter/cf_points'); // `featureType = "point"`: no hint needed
    expect(source?.form).toBe('coordinates');
    expect(source?.channels.x.label).toBe('lon (°E)');
    expect(source?.channels.y.label).toBe('lat (°N)');
    expect(source?.channels.z?.label).toBe('alt (m)');
    expect(source?.channels.color?.dataset.name).toBe('cf_points');

    const planar = await find('/scatter/cf_points_2d', HintVis.Scatter);
    expect(planar?.channels.z).toBeUndefined();
    await expect(find('/scatter/cf_points_2d')).resolves.toBeUndefined(); // no hint, no point feature
  });

  it('find datasets named by group', async () => {
    const source = await find('/scatter/group', HintVis.Scatter);
    expect(source?.form).toBe('group');
    expect(source?.channels.size?.label).toBe('weight');
    expect(source?.channels.color?.dataset.path).toBe('/scatter/group/cluster');
    expect(source?.sizeRange).toEqual([3, 16]);
    await expect(find('/scatter/group')).resolves.toBeUndefined();
  });

  it('find rows of (G, P) dataset along `H5WEB_x_dim`', async () => {
    const source = await find('/scatter/fitness', HintVis.Scatter, 0);
    expect(source?.form).toBe('rows');
    expect(source?.count).toBe(800);
    expect(source?.channels.x).toMatchObject({
      label: 'Generation',
      alongDim: { dims: [40, 20], dim: 0, isIndex: false },
    });
    expect(source?.channels.x.dataset.name).toBe('generation');
    expect(source?.channels.y.label).toBe('Fitness');
    expect(source?.channels.color).toBeUndefined();
    expect(source?.solidColor).toBe('steelblue');

    const byIndex = await find('/scatter/fitness', HintVis.Scatter, 1); // no scale: index
    expect(byIndex?.channels.x).toMatchObject({
      label: 'index',
      alongDim: { isIndex: true },
    });
    expect(byIndex?.channels.x.dataset.name).toBe('fitness');
  });

  it('fall back to columns without valid `H5WEB_x_dim`', async () => {
    const source = await find('/scatter/fitness', HintVis.Scatter, 2);
    expect(source?.form).toBe('columns');
    expect(source?.notes).toEqual([
      '"H5WEB_x_dim": no dimension 2, drawn as columns',
    ]);
    const in3D = await find('/scatter/fitness', HintVis.Scatter3D, 0);
    expect(in3D?.notes).toEqual([
      '"H5WEB_x_dim": only with "scatter", drawn as columns',
    ]);
    const plain = await find('/scatter/fitness', HintVis.Scatter);
    expect(plain?.form).toBe('columns');
    expect(plain?.notes).toEqual([]);
  });
});

describe('getAlongDim', () => {
  it('give the scale value (or index) of each value along a dimension', () => {
    expect([...getAlongDim([10, 20], [2, 3], 0)]).toEqual([
      10, 10, 10, 20, 20, 20,
    ]);
    expect([...getAlongDim(undefined, [2, 3], 1)]).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
