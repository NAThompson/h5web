import {
  assertArrayShape,
  assertDataset,
  assertNumDims,
  assertNumericType,
} from '@h5web/shared/guards';

import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimUnits } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useVolumeConfig } from './config';
import MappedVolumeVis from './MappedVolumeVis';

function VolumeVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertNumDims(entity, 3);
  assertNumericType(entity);

  const config = useVolumeConfig();

  // Size the volume by its axes (and express gradients in their unit) only if they share a unit,
  // as `keepRatio` does for heatmaps
  const dimUnits = useDimUnits(entity);
  const withPhysicalAspect =
    dimUnits.length === 3 && dimUnits.every((unit) => unit === dimUnits[0]);

  return (
    <VisBoundary>
      <ValueFetcher
        dataset={entity}
        render={(value) => (
          <DimScalesFetcher
            dataset={entity}
            render={({ axisValues }) => (
              <MappedVolumeVis
                dataset={entity}
                value={value}
                toolbarContainer={toolbarContainer}
                config={config}
                axisValues={axisValues}
                withPhysicalAspect={withPhysicalAspect}
                axisUnit={withPhysicalAspect ? dimUnits[0] : undefined}
              />
            )}
          />
        )}
      />
    </VisBoundary>
  );
}

export default VolumeVisContainer;
