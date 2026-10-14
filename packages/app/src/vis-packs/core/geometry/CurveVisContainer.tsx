import { type VisContainerProps } from '../../models';
import { type DefaultSlice } from '../../nexus/models';
import { useCurveConfig } from './config';
import GeometryVisContainer from './GeometryVisContainer';
import MappedCurveVis from './MappedCurveVis';
import { GeometryKind } from './utils';

interface Props extends VisContainerProps {
  defaultSlice?: DefaultSlice; // NeXus
}

function CurveVisContainer(props: Props) {
  const { toolbarContainer } = props;
  const config = useCurveConfig();

  return (
    <GeometryVisContainer
      {...props}
      kind={GeometryKind.Curve}
      render={(data, title) => (
        <MappedCurveVis
          data={data}
          title={title}
          toolbarContainer={toolbarContainer}
          config={config}
        />
      )}
    />
  );
}

export default CurveVisContainer;
