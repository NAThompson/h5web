import { type VisContainerProps } from '../../models';
import GeometryVisContainer from './GeometryVisContainer';
import MappedParamSurfaceVis from './MappedParamSurfaceVis';
import { useParamSurfaceConfig } from './surface-config';
import { GeometryKind } from './utils';

function ParamSurfaceVisContainer(props: VisContainerProps) {
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
