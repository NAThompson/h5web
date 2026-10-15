import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertNumericLikeType,
} from '@h5web/shared/guards';
import { useMemo } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useCachedDimScales, useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import {
  getAxisScaleHint,
  getDimScaleNotes,
} from '../../view-hints/axis-scales';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import {
  getLineDimSuggestions,
  getLineSuggestions,
} from '../../view-hints/suggestions';
import { getHintNotes } from '../../view-hints/utils';
import VisBoundary from '../../VisBoundary';
import ValueFetcher from '../ValueFetcher';
import { useLineConfig } from './config';
import MappedLineVis from './MappedLineVis';
import { getMultiPlotMapping } from './utils';

function LineVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertDataset(entity);
  assertArrayShape(entity);
  assertNumericLikeType(entity);

  const { dims } = entity.shape;
  const hint = useViewHint(entity);
  const { defaultSlice, defaultMultiDim } = useMemo(
    () => getLineDimSuggestions(hint, dims),
    [hint, dims],
  );
  const [dimMapping, setDimMapping, multiDim, setMultiDim] = useDimMappingState(
    { dims, axesCount: 1, defaultSlice, defaultMultiDim },
  );

  const lineMapping = useMemo(
    () => getMultiPlotMapping(dimMapping, multiDim),
    [dimMapping, multiDim],
  );

  // `H5WEB_axis_scale` of the scale on the x axis, once dimension scales are resolved
  const dimScales = useCachedDimScales(entity);
  const xAxisScale = getAxisScaleHint(dimScales, lineMapping, dims, 'x', false);
  const config = useLineConfig({
    ...getLineSuggestions(hint),
    xScaleType: xAxisScale.scaleType,
  });
  const selection = getSliceSelection(lineMapping);

  const { dimHints, dimLabels, sliceLabels } = useDimInfo(entity);

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    {
      mapMapping: (m) => getMultiPlotMapping(m, multiDim),
      withPlaybackRange: true,
      skipEmpty: hint.playbackSkipEmpty,
      playbackDefaults: hint.playback,
      onSkipEmptyStart: setDimMapping,
    },
  );

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={dimHints}
        dimLabels={dimLabels}
        sliceLabels={sliceLabels}
        dimMapping={dimMapping}
        {...slicingProps}
        onChange={setDimMapping}
        multiDim={multiDim}
        onMultiDimChange={setMultiDim}
      />
      <VisBoundary
        resetKey={lineMapping}
        isSlice={selection !== undefined}
        playbackRange={playbackRange}
      >
        <ValueFetcher
          dataset={entity}
          selection={selection}
          render={(value) => (
            <DimScalesFetcher
              dataset={entity}
              render={({ axisLabels, axisValues, axisTicks, axisScales }) => (
                <MappedLineVis
                  dataset={entity}
                  value={value}
                  dimMapping={lineMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  axisTicks={axisTicks}
                  multiSliceLabels={
                    multiDim === undefined ? undefined : sliceLabels[multiDim]
                  }
                  xSymlogConstant={
                    axisScales[lineMapping.indexOf('x')]?.symlogConstant
                  }
                  title={hint.title ?? entity.name}
                  valueLabel={hint.valueLabel}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  symlogThreshold={hint.symlogThreshold}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[
          ...getHintNotes(hint),
          ...getDimScaleNotes(dimScales),
          ...xAxisScale.notes,
        ]}
      />
    </>
  );
}

export default LineVisContainer;
