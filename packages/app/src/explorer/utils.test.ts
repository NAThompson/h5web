import {
  assertDefined,
  assertGroup,
  assertGroupWithChildren,
} from '@h5web/shared/guards';
import { type Entity } from '@h5web/shared/hdf5-models';
import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import {
  assertMockAttribute,
  dataset,
  group,
  scalarAttr,
} from '@h5web/shared/mock-utils';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { type DataContextValue } from '../providers/DataProvider';
import { findMockEntity } from '../providers/mock/utils';
import { getAuxRoles } from './utils';

function data(name: string, attrs: [string, string][] = []) {
  return dataset(name, arrayShape([2]), floatType(), undefined, {
    attributes: attrs.map(([attr, val]) => scalarAttr(attr, val)),
  });
}

const root = group(
  '',
  [
    group('blend', [
      data('R', [['CLASS', 'DIMENSION_SCALE']]),
      data('Z', [['H5WEB_overlays', 'zone coalescence/e_n']]),
      data('zone', [['H5WEB_geometry', 'band']]),
      data('W', [['H5WEB_role', 'axis']]),
      data('fit', [['H5WEB_series', 'W']]),
      data('field', [['coordinates', 'lon lat']]),
      data('lon', [['H5WEB_role', 'data']]),
      data('lat'),
      group('coalescence', [
        data('e_n', [['H5WEB_geometry', 'curve']]),
        data('e_e', [['H5WEB_geometry', 'points']]),
        data('pair', [
          ['CLASS', 'DIMENSION_SCALE'],
          ['NAME', 'This is a netCDF dimension but not a netCDF variable. 2'],
        ]),
      ]),
    ]),
  ],
  { isRoot: true },
);

const dataContext = {
  queryClient: new QueryClient(),
  queries: {
    entity: (path: string) => ({
      queryKey: ['entity', path],
      queryFn: () => findMockEntity(root, path),
    }),
    attrValues: (entity: Entity) => ({
      queryKey: ['attrValues', entity.path],
      queryFn: () =>
        Object.fromEntries(
          entity.attributes.map((attr) => {
            assertMockAttribute(attr);
            return [attr.name, attr.value];
          }),
        ),
    }),
  },
} as unknown as DataContextValue;

async function getRoles(path: string) {
  const grp = findMockEntity(root, path);
  assertDefined(grp);
  assertGroup(grp);
  assertGroupWithChildren(grp);
  return Object.fromEntries(await getAuxRoles(grp, dataContext));
}

describe('getAuxRoles', () => {
  it('find axes, auxiliary coordinates and overlays of a group', async () => {
    await expect(getRoles('/blend')).resolves.toEqual({
      R: 'axis (dimension scale)',
      zone: 'overlay',
      W: 'axis', // `H5WEB_role`
      lat: 'auxiliary coordinate', // not `lon`: `H5WEB_role = "data"`
    });
  });

  it('find overlays listed by siblings of the group', async () => {
    await expect(getRoles('/blend/coalescence')).resolves.toEqual({
      e_n: 'overlay',
      e_e: 'overlay', // `H5WEB_geometry`, though not listed
      pair: 'netCDF dimension (not a variable)',
    });
  });
});
