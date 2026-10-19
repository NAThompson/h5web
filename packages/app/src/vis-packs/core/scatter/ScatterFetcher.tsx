import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { type ReactNode, useMemo } from 'react';

import { useValues } from '../../../hooks';
import LargeValueGuard from '../../LargeValueGuard';
import { useIgnoreValues, usePackings } from '../../netcdf/hooks';
import { toCoordinateArray } from '../geometry/hooks';
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

/* Column of an (n, k) array, as a typed array (no per-point objects) */
function getColumn(arr: NumArray, column: number, k: number): NumArray {
  const count = Math.floor(arr.length / k);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = arr[i * k + column];
  }
  return out;
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

  // Unpacked (NetCDF), invalid values as `NaN`, per dataset
  const arrays = useMemo(
    () =>
      new Map(
        datasets.map((dataset, i) => [
          dataset.path,
          toCoordinateArray(values[dataset.path], packings[i], ignoreValues[i]),
        ]),
      ),
    [datasets, values, packings, ignoreValues],
  );

  const data = useMemo(() => {
    const entries = getChannelDefs(source).map(([channel, def]) => {
      const arr = arrays.get(def.dataset.path) ?? [];
      const { dims } = def.dataset.shape;
      return [
        channel,
        def.column === undefined ? arr : getColumn(arr, def.column, dims[1]),
      ];
    });
    return Object.fromEntries(entries) as ScatterData;
  }, [source, arrays]);

  return render(source, data);
}

export default ScatterFetcher;
