import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useSuspenseQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { useDataContext } from '../../providers/DataProvider';
import {
  getVtkGridInfo,
  type ResampledField,
  resampleVtkField,
  type VtkField,
  type VtkGridInfo,
} from './utils';

export function useVtkGridInfo(group: GroupWithChildren): VtkGridInfo {
  const dataContext = useDataContext();
  return useSuspenseQuery({
    queryKey: [dataContext.cacheScope, 'vtkGrid', group.path],
    queryFn: async () => getVtkGridInfo(group, dataContext),
  }).data;
}

/* Field resampled onto a grid; grids are large, so only kept briefly once no longer shown */
export function useResampledField(
  group: GroupWithChildren,
  info: VtkGridInfo,
  field: VtkField,
  resolution: number,
): ResampledField {
  const dataContext = useDataContext();
  return useSuspenseQuery({
    queryKey: [
      dataContext.cacheScope,
      'vtkResampled',
      group.path,
      field.dataset.path,
      resolution,
    ],
    queryFn: async ({ signal }) =>
      resampleVtkField(group, info, field, resolution, dataContext, signal),
    gcTime: 10_000,
  }).data;
}

interface VtkSelection {
  fieldPath?: string; // default field if undefined
  resolution?: number; // automatic if undefined
}

const useSelectionStore = create<{
  selections: Record<string, VtkSelection | undefined>;
  select: (key: string, update: VtkSelection) => void;
}>()((set) => ({
  selections: {},
  select: (key, update) => {
    set(({ selections }) => ({
      selections: { ...selections, [key]: { ...selections[key], ...update } },
    }));
  },
}));

/* Field and resolution of a group, shared by its visualizations */
export function useVtkSelection(
  group: GroupWithChildren,
): [VtkSelection, (update: VtkSelection) => void] {
  const { filepath } = useDataContext();
  const key = `${filepath}:${group.path}`;
  const selection = useSelectionStore((state) => state.selections[key]);
  const select = useSelectionStore((state) => state.select);
  return [selection ?? {}, (update) => select(key, update)];
}
