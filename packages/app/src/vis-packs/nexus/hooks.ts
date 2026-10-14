import {
  type ComplexType,
  type GroupWithChildren,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { useSuspenseQuery } from '@tanstack/react-query';

import {
  type DataContextValue,
  useDataContext,
} from '../../providers/DataProvider';
import { type FieldDef, type NxData } from './models';
import {
  assertNxDataGroup,
  findAuxErrorDataset,
  findAuxiliaryDatasets,
  findAxesDatasets,
  findErrorDataset,
  findSignalDataset,
  findTitleDataset,
  getDefaultSlice,
  getFieldInfo,
  getSilxStyle,
} from './utils';

export function useNxData(
  group: GroupWithChildren,
  opts: { signalOnly?: boolean } = {},
): NxData {
  const { signalOnly = false } = opts;
  const dataContext = useDataContext();

  return useSuspenseQuery({
    queryKey: [dataContext.filepath, 'nxData', group.path, signalOnly],
    queryFn: async () => getNxData(group, dataContext, signalOnly),
  }).data;
}

/* With `signalOnly`, auxiliary signals and errors are neither resolved nor validated
 * (e.g. for volumes, to which they don't apply) */
export async function getNxData(
  group: GroupWithChildren,
  dataContext: DataContextValue,
  signalOnly = false,
): Promise<NxData> {
  await assertNxDataGroup(group, dataContext);
  const signalDataset = await findSignalDataset(group, dataContext);
  const axisDatasets = await findAxesDatasets(
    group,
    signalDataset,
    dataContext,
  );
  const auxSignals = signalOnly
    ? []
    : await findAuxiliaryDatasets(group, signalDataset, dataContext);

  return {
    titleDataset: findTitleDataset(group),
    signalDef: {
      dataset: signalDataset,
      errorDataset: signalOnly
        ? undefined
        : findErrorDataset(group, signalDataset.name),
      ...(await getFieldInfo(signalDataset, dataContext)),
    },
    auxDefs: await Promise.all(
      auxSignals.map(async (auxSignal) => ({
        dataset: auxSignal,
        errorDataset: findAuxErrorDataset(group, auxSignal),
        ...(await getFieldInfo(auxSignal, dataContext)),
      })),
    ),
    axisDefs: await Promise.all(
      axisDatasets.map(
        async (dataset) =>
          dataset && { dataset, ...(await getFieldInfo(dataset, dataContext)) },
      ),
    ),
    defaultSlice: await getDefaultSlice(
      group,
      signalDataset.shape.dims,
      dataContext,
    ),
    silxStyle: await getSilxStyle(group, dataContext),
  };
}

export function useNxHeatmapDataToFetch<
  T extends NumericLikeType | ComplexType,
>(nxData: NxData<T>, selectedDef: FieldDef<T>): NxData<T> {
  const { signalDef, titleDataset } = nxData;

  return {
    ...nxData,
    signalDef: selectedDef,
    auxDefs: [], // fetch selected signal only
    titleDataset:
      selectedDef.dataset === signalDef.dataset
        ? titleDataset
        : // when auxiliary signal is selected, don't fetch title dataset (i.e. use the auxiliary's label as title)
          undefined,
  };
}
