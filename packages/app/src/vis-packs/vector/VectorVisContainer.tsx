import { type VisContainerProps } from '../models';
import VisBoundary from '../VisBoundary';
import VectorFieldVis from './VectorFieldVis';

/* Vector field of a dataset (last dimension: components) or of a group naming its components,
 * resolved within a boundary (e.g. a missing component is shown as an error in the vis area);
 * leading dimensions are sliced (and played) like other views */
function VectorVisContainer(props: VisContainerProps) {
  return (
    <VisBoundary>
      <VectorFieldVis {...props} />
    </VisBoundary>
  );
}

export default VectorVisContainer;
