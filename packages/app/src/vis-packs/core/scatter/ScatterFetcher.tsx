import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type ReactNode } from 'react';

import { useValues } from '../../../hooks';
import LargeValueGuard from '../../LargeValueGuard';
import { useIgnoreValues, usePackings } from '../../netcdf/hooks';
import { type Packing } from '../../netcdf/utils';
import { splitVertices, toCoordinateArray } from '../geometry/hooks';
import { type NumDataset } from '../geometry/utils';
import { useScatterSource } from './hooks';
import {
  type ChannelDef,
  type ScatterChannel,
  type ScatterSource,
} from './source';

export type ScatterData = Partial<Record<ScatterChannel, NumArray>> & {
  x: NumArray;
  y: NumArray;
};

interface Props {
  entity: ProvidedEntity;
  render: (source: ScatterSource, data: ScatterData) => ReactNode;
}

interface Prepared {
  packing: Packing | undefined;
  ignoreValue: IgnoreValue | undefined;
  array: NumArray; // unpacked (NetCDF), invalid values as `NaN`
  columns?: NumArray[]; // of an (n, k) array, split once
}

/* Per fetched value (stable in the query cache), so that re-renders (e.g. toolbar clicks) give
 * the same arrays and the point buffers are not rebuilt */
const prepared = new WeakMap<object, Prepared>();

function getChannelArray(
  value: Parameters<typeof toCoordinateArray>[0],
  packing: Packing | undefined,
  ignoreValue: IgnoreValue | undefined,
  def: ChannelDef,
): NumArray {
  let entry = prepared.get(value);
  if (
    !entry ||
    entry.packing !== packing ||
    entry.ignoreValue !== ignoreValue
  ) {
    entry = {
      packing,
      ignoreValue,
      array: toCoordinateArray(value, packing, ignoreValue),
    };
    prepared.set(value, entry);
  }
  if (def.column === undefined) {
    return entry.array;
  }
  if (!entry.columns) {
    entry.columns = splitVertices(entry.array, def.dataset.shape.dims[1]);
  }
  return entry.columns[def.column];
}

function getChannelDefs(source: ScatterSource): [string, ChannelDef][] {
  return Object.entries(source.channels); // defined channels only
}

/* Resolve the points of an entity, then fetch each dataset of their channels once (render within a `VisBoundary`) */
function ScatterFetcher(props: Props): ReactNode {
  const { entity, render } = props;
  const source = useScatterSource(entity);
  const datasets = [
    ...new Map(
      getChannelDefs(source).map(([, def]) => [def.dataset.path, def.dataset]),
    ).values(),
  ];

  return (
    <LargeValueGuard requests={datasets.map((dataset) => ({ dataset }))}>
      <ScatterValues source={source} datasets={datasets} render={render} />
    </LargeValueGuard>
  );
}

function ScatterValues(props: {
  source: ScatterSource;
  datasets: NumDataset[];
  render: Props['render'];
}): ReactNode {
  const { source, datasets, render } = props;
  const values = useValues(
    Object.fromEntries(datasets.map((dataset) => [dataset.path, dataset])),
  );
  const packings = usePackings(datasets);
  const ignoreValues = useIgnoreValues(datasets);

  const data = Object.fromEntries(
    getChannelDefs(source).map(([channel, def]) => {
      const i = datasets.findIndex(({ path }) => path === def.dataset.path);
      return [
        channel,
        getChannelArray(
          values[def.dataset.path],
          packings[i],
          ignoreValues[i],
          def,
        ),
      ];
    }),
  ) as ScatterData;

  return render(source, data);
}

export default ScatterFetcher;
