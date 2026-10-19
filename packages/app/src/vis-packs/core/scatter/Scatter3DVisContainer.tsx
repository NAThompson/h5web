import { type VisContainerProps } from '../../models';
import PointsVisContainer from './PointsVisContainer';

function Scatter3DVisContainer(props: VisContainerProps) {
  return <PointsVisContainer {...props} is3D />;
}

export default Scatter3DVisContainer;
