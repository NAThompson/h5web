import { useVolumeConfig } from '../core/volume/config';
import MappedVolumeVis from '../core/volume/MappedVolumeVis';
import { type VisContainerProps } from '../models';
import VtkGridVisContainer from './VtkGridVisContainer';

function VtkVolumeContainer(props: VisContainerProps) {
  const { toolbarContainer } = props;
  const config = useVolumeConfig();

  return (
    <VtkGridVisContainer
      {...props}
      render={(field, { values, coverage, grid, axisValues }) => (
        <MappedVolumeVis
          dataset={field.dataset}
          value={values}
          coverage={coverage}
          dims={grid.shape}
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

export default VtkVolumeContainer;
