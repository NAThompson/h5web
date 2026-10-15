import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertMinDims,
  assertNumericType,
} from '@h5web/shared/guards';
import { useMemo } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useCachedDimScales, useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import { getDimScaleNotes } from '../../view-hints/axis-scales';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { getVolumeSuggestions } from '../../view-hints/suggestions';
import { getHintNotes } from '../../view-hints/utils';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useSuggestedIsoLevels, useVolumeConfig } from './config';
import MappedVolumeVis from './MappedVolumeVis';

/* The last three dimensions form the volume (`[z, y, x]`); leading dimensions, if any, are sliced */
function VolumeVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertMinDims(entity, 3);
  assertNumericType(entity);

  const { dims } = entity.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 0,
    lockedDimsCount: 3,
  });
  const selection = getSliceSelection(dimMapping);

  const hint = useViewHint(entity);
  const config = useSuggestedIsoLevels(
    useVolumeConfig(getVolumeSuggestions(hint)),
    hint.isoLevels,
  );

  // Size the volume by its axes (and express gradients in their unit) only if they share a unit,
  // as `keepRatio` does for heatmaps
  const {
    dimHints,
    dimLabels,
    sliceLabels,
    dimUnits: allUnits,
  } = useDimInfo(entity);
  const dimScales = useCachedDimScales(entity);
  const dimUnits = allUnits.slice(-3);
  const withPhysicalAspect =
    dimUnits.length === 3 && dimUnits.every((unit) => unit === dimUnits[0]);

  // Stable dimensions, so that presentation changes don't make a new data array (and drop cached isosurfaces)
  const volumeDims = useMemo(() => dims.slice(-3), [dims]);

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    { withPlaybackRange: true, playbackDim: hint.playbackDim },
  );

  return (
    <>
      {selection !== undefined && ( // only when there are dimensions to slice
        <DimensionMapper
          className={visualizerStyles.dimMapper}
          dims={dims}
          dimHints={dimHints}
          dimLabels={dimLabels}
          sliceLabels={sliceLabels}
          dimMapping={dimMapping}
          {...slicingProps}
          onChange={setDimMapping}
        />
      )}
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
              render={({ axisValues }) => (
                <MappedVolumeVis
                  dataset={entity}
                  value={value}
                  dims={volumeDims}
                  title={hint.title}
                  symlogThreshold={hint.symlogThreshold}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  axisValues={axisValues.slice(-3)}
                  withPhysicalAspect={withPhysicalAspect}
                  axisUnit={withPhysicalAspect ? dimUnits[0] : undefined}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[...getHintNotes(hint), ...getDimScaleNotes(dimScales)]}
      />
    </>
  );
}

export default VolumeVisContainer;
