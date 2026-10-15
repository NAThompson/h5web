import { type VisContainerProps } from '../../models';
import { type DefaultSlice } from '../../nexus/models';
import { useViewHint } from '../../view-hints/hooks';
import GeometryVisContainer from './GeometryVisContainer';
import MappedParamSurfaceVis from './MappedParamSurfaceVis';
import { useParamSurfaceConfig } from './surface-config';
import { GeometryKind } from './utils';

interface Props extends VisContainerProps {
  defaultSlice?: DefaultSlice; // NeXus
}

function ParamSurfaceVisContainer(props: Props) {
  const { entity, toolbarContainer } = props;
  const config = useParamSurfaceConfig();
  const hint = useViewHint(entity);

  return (
    <GeometryVisContainer
      {...props}
      kind={GeometryKind.Surface}
      render={(data, title) => (
        <MappedParamSurfaceVis
          data={data}
          title={title}
          toolbarContainer={toolbarContainer}
          config={config}
          hint={hint}
        />
      )}
    />
  );
}

export default ParamSurfaceVisContainer;
