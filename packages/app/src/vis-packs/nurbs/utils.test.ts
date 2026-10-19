import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import { dataset, group, scalarAttr } from '@h5web/shared/mock-utils';
import { expect, test } from 'vitest';

import { isNurbsMultiPatchGroup, isNurbsSurfaceGroup } from './utils';

const attributes = [scalarAttr('H5WEB_geometry', 'nurbs')];
const surface = group('patch', [
  dataset('control_points', arrayShape([4, 4, 3]), floatType(64)),
]);

test('tell multi-patch groups from surface groups', () => {
  const multiPatch = group('teapot', [surface, group('lid')], { attributes });
  expect(isNurbsMultiPatchGroup(multiPatch)).toBe(true);
  expect(isNurbsSurfaceGroup(multiPatch)).toBe(false);

  // Control points of its own: a single surface, even with subgroups
  const single = group('patch', [...surface.children, group('extra')]);
  expect(isNurbsMultiPatchGroup(single)).toBe(false);
  expect(isNurbsMultiPatchGroup(group('empty', [], { attributes }))).toBe(
    false,
  );
});
