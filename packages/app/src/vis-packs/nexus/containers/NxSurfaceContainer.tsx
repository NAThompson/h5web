import { assertGroup } from '@h5web/shared/guards';

import ParamSurfaceVisContainer from '../../core/geometry/ParamSurfaceVisContainer';
import { type VisContainerProps } from '../../models';
import { useNxData } from '../hooks';

/* NXdata group whose signal is defined on a parametric surface, cf. `CurvesAndSurfaces.mdx` (Storybook) */
function NxSurfaceContainer(props: VisContainerProps) {
  const { entity } = props;
  assertGroup(entity);

  const { signalDef, defaultSlice } = useNxData(entity);
  return (
    <ParamSurfaceVisContainer
      {...props}
      entity={signalDef.dataset}
      defaultSlice={defaultSlice}
    />
  );
}

export default NxSurfaceContainer;
