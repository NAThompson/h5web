import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { type ReactElement } from 'react';

import { useResampledField } from './hooks';
import { type ResampledField, type VtkField, type VtkGridInfo } from './utils';

interface Props {
  group: GroupWithChildren;
  info: VtkGridInfo;
  field: VtkField;
  resolution: number;
  render: (resampled: ResampledField) => ReactElement;
}

function ResampledFetcher(props: Props): ReactElement {
  const { group, info, field, resolution, render } = props;
  return render(useResampledField(group, info, field, resolution));
}

export default ResampledFetcher;
