import { type VisContainerProps } from '../../models';
import { useCurveConfig } from './config';
import GeometryVisContainer from './GeometryVisContainer';
import MappedCurveVis from './MappedCurveVis';
import { GeometryKind } from './utils';

function CurveVisContainer(props: VisContainerProps) {
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
