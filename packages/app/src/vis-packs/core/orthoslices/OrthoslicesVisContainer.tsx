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
import { useViewHint, useVolumeOverlays } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { getOrthoslicesSuggestions } from '../../view-hints/suggestions';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useOrthoslicesConfig } from './config';
import MappedOrthoslicesVis from './MappedOrthoslicesVis';

/* The last three dimensions form the volume (`[z, y, x]`), fetched once and sliced locally into
 * three planes through a point; leading dimensions, if any, are sliced by the dimension mapper */
function OrthoslicesVisContainer(props: VisContainerProps) {
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
  const overlays = useVolumeOverlays(entity, hint, dimMapping);
  const config = useOrthoslicesConfig(getOrthoslicesSuggestions(hint));

  const { dimHints, dimLabels, sliceLabels, dimUnits } = useDimInfo(entity);
  const dimScales = useCachedDimScales(entity);

  // Stable dimensions, so that slicing leading dimensions doesn't make new data arrays needlessly
  const volumeDims = useMemo(() => dims.slice(-3), [dims]);

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    {
      withPlaybackRange: true,
      playbackDim: hint.playbackDim,
      getExtraRequests: overlays.getSliceRequests, // points follow playback
    },
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
              render={({ axisLabels, axisValues, axisTicks }) => (
                <MappedOrthoslicesVis
                  dataset={entity}
                  points={overlays.points}
                  legend={overlays.legend}
                  value={value}
                  dims={volumeDims}
                  axisLabels={axisLabels.slice(-3)}
                  axisValues={axisValues.slice(-3)}
                  axisTicks={axisTicks.slice(-3)}
                  dimLabels={dimLabels.slice(-3)}
                  title={hint.title ?? entity.name}
                  valueLabel={hint.valueLabel}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  initialPosition={hint.slicePosition}
                  axisUnits={dimUnits.slice(-3)}
                  symlogThreshold={hint.symlogThreshold}
                  valueTransform={hint.valueTransform}
                  specialColors={hint}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[...overlays.notes, ...getDimScaleNotes(dimScales)]}
      />
    </>
  );
}

export default OrthoslicesVisContainer;
