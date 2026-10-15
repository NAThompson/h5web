import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertComplexType,
  assertDataset,
  assertMinDims,
} from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimHints, useDimUnits } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import { getHeatmapSuggestions } from '../../view-hints/suggestions';
import VisBoundary from '../../VisBoundary';
import { useHeatmapConfig } from '../heatmap/config';
import { guessKeepRatio } from '../utils';
import ValueFetcher from '../ValueFetcher';
import MappedComplexHeatmapVis from './MappedComplexHeatmapVis';

function ComplexHeatmapVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertMinDims(entity, 2);
  assertComplexType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 2,
  });

  const dimHints = useDimHints(entity);
  const dimUnits = useDimUnits(entity);

  // Suggest keeping the ratio only when the mapped axes share a unit, as NeXus does
  const hint = useViewHint(entity);
  const config = useHeatmapConfig(
    getHeatmapSuggestions(hint, entity.path, {
      keepRatio: guessKeepRatio(
        { unit: dimUnits[dimMapping.indexOf('x')] },
        { unit: dimUnits[dimMapping.indexOf('y')] },
      ),
    }),
  );
  const selection = getSliceSelection(dimMapping);

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    { withPlaybackRange: true },
  );

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimMapping={dimMapping}
        {...slicingProps}
        onChange={setDimMapping}
      />
      <VisBoundary
        resetKey={dimMapping}
        isSlice={selection !== undefined}
        playbackRange={playbackRange}
      >
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <DimScalesFetcher
              dataset={entity}
              render={({ axisLabels, axisValues }) => (
                <MappedComplexHeatmapVis
                  value={value}
                  dims={dims}
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

export default ComplexHeatmapVisContainer;
