import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertMinDims,
  assertNumericLikeType,
} from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import { useValuesInCache } from '../../../hooks';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimHints, useDimUnits } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import VisBoundary from '../../VisBoundary';
import { guessKeepRatio } from '../utils';
import ValueFetcher from '../ValueFetcher';
import { useHeatmapConfig } from './config';
import MappedHeatmapVis from './MappedHeatmapVis';

function HeatmapVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertMinDims(entity, 2);
  assertNumericLikeType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 2,
  });

  const dimHints = useDimHints(entity);
  const dimUnits = useDimUnits(entity);

  // Suggest keeping the ratio only when the mapped axes share a unit, as NeXus does
  const config = useHeatmapConfig({
    keepRatio: guessKeepRatio(
      { unit: dimUnits[dimMapping.indexOf('x')] },
      { unit: dimUnits[dimMapping.indexOf('y')] },
    ),
  });
  const selection = getSliceSelection(dimMapping);

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimMapping={dimMapping}
        canSliceFast={useValuesInCache(entity)}
        onChange={setDimMapping}
      />
      <VisBoundary resetKey={dimMapping} isSlice={selection !== undefined}>
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <DimScalesFetcher
              dataset={entity}
              render={({ axisLabels, axisValues }) => (
                <MappedHeatmapVis
                  dataset={entity}
                  value={value}
                  dimMapping={dimMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  title={entity.name}
                  toolbarContainer={toolbarContainer}
                  config={config}
                />
              )}
            />
          )}
        />
      </VisBoundary>
    </>
  );
}

export default HeatmapVisContainer;
