import { assertGroup } from '@h5web/shared/guards';

import ParamSurfaceVisContainer from '../../core/geometry/ParamSurfaceVisContainer';
import { type VisContainerProps } from '../../models';
import { useNxData } from '../hooks';

/* NXdata group whose signal is defined on a parametric surface, cf. `CONVENTION.md` */
function NxSurfaceContainer(props: VisContainerProps) {
  const { entity } = props;
  assertGroup(entity);

  const { signalDef } = useNxData(entity);
  return <ParamSurfaceVisContainer {...props} entity={signalDef.dataset} />;
}

export default NxSurfaceContainer;
