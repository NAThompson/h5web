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
    getDimensionScales: async () => [],
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

  async function find(path: string, vis?: HintVis) {
    const entity = findMockEntity(root, path);
    assertDefined(entity);
    return findScatterSource(entity, vis, ctx);
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
});
