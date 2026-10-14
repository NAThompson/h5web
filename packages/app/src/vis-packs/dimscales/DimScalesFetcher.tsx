import { type ArrayShape, type Dataset } from '@h5web/shared/hdf5-models';
import { type ReactNode } from 'react';

import { type DimScaleAxes, useDimScales } from './hooks';

interface Props {
  dataset: Dataset<ArrayShape>;
  render: (axes: DimScaleAxes) => ReactNode;
}

/* Fetch dimension scales within a `VisBoundary`, so a fetch error is shown in
 * the vis area like any other value fetch error. Render it once the dataset's
 * value is fetched (i.e. within `ValueFetcher`): value fetches must not start
 * while the boundary's loader is already showing, as they update its progress. */
function DimScalesFetcher(props: Props): ReactNode {
  const { dataset, render } = props;

  return render(useDimScales(dataset));
}

export default DimScalesFetcher;
