import { type VisContainerProps } from '../../models';
import PointsVisContainer from './PointsVisContainer';

function ScatterVisContainer(props: VisContainerProps) {
  return <PointsVisContainer {...props} is3D={false} />;
}

export default ScatterVisContainer;
