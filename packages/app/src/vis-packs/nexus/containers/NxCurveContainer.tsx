import { assertGroup } from '@h5web/shared/guards';

import CurveVisContainer from '../../core/geometry/CurveVisContainer';
import { type VisContainerProps } from '../../models';
import { useNxData } from '../hooks';

/* NXdata group whose signal describes a curve, cf. `CurvesAndSurfaces.mdx` (Storybook) */
function NxCurveContainer(props: VisContainerProps) {
  const { entity } = props;
  assertGroup(entity);

  const { signalDef } = useNxData(entity);
  return <CurveVisContainer {...props} entity={signalDef.dataset} />;
}

export default NxCurveContainer;
