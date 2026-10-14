import { type VisContainerProps } from '../../models';
import { type DefaultSlice } from '../../nexus/models';
import GeometryVisContainer from './GeometryVisContainer';
import MappedParamSurfaceVis from './MappedParamSurfaceVis';
import { useParamSurfaceConfig } from './surface-config';
import { GeometryKind } from './utils';

interface Props extends VisContainerProps {
  defaultSlice?: DefaultSlice; // NeXus
}

function ParamSurfaceVisContainer(props: Props) {
  const { toolbarContainer } = props;
  const config = useParamSurfaceConfig();

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
        />
      )}
    />
  );
}

export default ParamSurfaceVisContainer;
