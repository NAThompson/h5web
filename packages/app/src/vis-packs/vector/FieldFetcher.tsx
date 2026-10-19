import { type VectorField2D, type VectorField3D } from '@h5web/lib';
import { type ReactNode, useMemo } from 'react';

import { useValues } from '../../hooks';
import { type ValueQueryParams } from '../../providers/models';
import { useDimScales } from '../dimscales/hooks';
import { getAxisCoords, splitComponents, type VectorSource } from './utils';

interface Props {
  source: VectorSource;
  requests: ValueQueryParams[]; // components (one dataset or one per component), background
  hasBackground: boolean; // last request
  render: (
    field: VectorField2D | VectorField3D,
    background: Float32Array | undefined,
    axisLabels: (string | undefined)[],
  ) => ReactNode;
}

/* Values of a slice of the field (and of its background), with the axes of its dimension
 * scales (fetched once the values are, cf. `DimScalesFetcher`) */
function FieldFetcher(props: Props): ReactNode {
  const { source, requests, hasBackground, render } = props;
  const { rank } = source;
  const isDatasetForm = source.kind === 'dataset';
  const base = isDatasetForm ? source.dataset : source.components[0];
  const { dims } = base.shape;
  const last = dims.length - (isDatasetForm ? 2 : 1); // x dimension

  const record = useValues(
    Object.fromEntries(requests.map((req, i) => [i, req])),
  );
  const values = requests.map(
    (_, i) => record[i] as ArrayLike<number | bigint>,
  );
  const { axisLabels, axisValues } = useDimScales(base);

  const field = useMemo(() => {
    const comps = isDatasetForm
      ? splitComponents(values[0], rank)
      : values.slice(0, rank).map((val) => Float32Array.from(val, Number));
    const xs = getAxisCoords(axisValues[last], dims[last]);
    const ys = getAxisCoords(axisValues[last - 1], dims[last - 1]);
    if (rank === 3) {
      const zs = getAxisCoords(axisValues[last - 2], dims[last - 2]);
      return { xs, ys, zs, u: comps[0], v: comps[1], w: comps[2] };
    }
    return { xs, ys, u: comps[0], v: comps[1] };
  }, [values[0], values[1], values[2], axisValues]); // eslint-disable-line react-hooks/exhaustive-deps -- source fixed per entity

  const bgValue = hasBackground ? values.at(-1) : undefined;
  const background = useMemo(
    () => bgValue && Float32Array.from(bgValue, Number),
    [bgValue],
  );

  return render(field, background, axisLabels);
}

export default FieldFetcher;
