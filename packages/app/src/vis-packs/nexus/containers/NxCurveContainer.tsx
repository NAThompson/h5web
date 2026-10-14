import { assertGroup } from '@h5web/shared/guards';

import CurveVisContainer from '../../core/geometry/CurveVisContainer';
import { type VisContainerProps } from '../../models';
import { useNxData } from '../hooks';

/* NXdata group whose signal describes a curve, cf. `CurvesAndSurfaces.mdx` (Storybook) */
function NxCurveContainer(props: VisContainerProps) {
  const { entity } = props;
  assertGroup(entity);

  const { signalDef, defaultSlice } = useNxData(entity);
  return (
    <CurveVisContainer
      {...props}
      entity={signalDef.dataset}
      defaultSlice={defaultSlice}
    />
  );
}

export default NxCurveContainer;
