import { useOrthoslicesConfig } from '../core/orthoslices/config';
import MappedOrthoslicesVis from '../core/orthoslices/MappedOrthoslicesVis';
import { type VisContainerProps } from '../models';
import VtkGridVisContainer from './VtkGridVisContainer';

const AXIS_LABELS = ['z', 'y', 'x'];

function VtkOrthoslicesContainer(props: VisContainerProps) {
  const { toolbarContainer } = props;
  const config = useOrthoslicesConfig();

  return (
    <VtkGridVisContainer
      {...props}
      render={(field, { values, grid, axisValues }) => (
        <MappedOrthoslicesVis
          dataset={field.dataset}
          value={values}
          dims={grid.shape}
          axisLabels={AXIS_LABELS}
          axisValues={axisValues}
          title={field.dataset.name}
          toolbarContainer={toolbarContainer}
          config={config}
          withPhysicalAspect
        />
      )}
    />
  );
}

export default VtkOrthoslicesContainer;
