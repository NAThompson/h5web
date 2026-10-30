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
import { toUnicodeScripts } from '../../view-hints/attrs';
import {
  getAxisScaleHint,
  getDimScaleNotes,
} from '../../view-hints/axis-scales';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { usePaletteColors } from '../../view-hints/palette';
import { useLineOverlays } from '../../view-hints/references';
import { useLineBand, useLineSeries } from '../../view-hints/series';
import {
  getLineDimSuggestions,
  getLineSuggestions,
} from '../../view-hints/suggestions';
import { getRootScaleNotes } from '../../view-hints/utils';
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

  // Extra curves of the hint, sliced along with the dataset
  const series = useLineSeries(entity, hint, lineMapping);
  const band = useLineBand(entity, hint, selection);
  const references = useLineOverlays(entity, hint, lineMapping);
  const palette = usePaletteColors(
    hint,
    entity.path,
    multiDim,
    multiDim === undefined ? undefined : dims[multiDim],
  );
  const extras = useMemo(
    () => ({
      series: series.curves,
      references: references.shapes,
      legendEntries: references.legend,
      band: band.band,
    }),
    [series.curves, references.shapes, references.legend, band.band],
  );
  const hasExtraCurves =
    hint.envelope?.mode === 'add' ||
    series.curves.length > 0 ||
    references.legend.length > 0; // the dataset's curve is named in the legend

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    {
      mapMapping: (m) => getMultiPlotMapping(m, multiDim),
      withPlaybackRange: true,
      skipEmpty: hint.playbackSkipEmpty,
      playbackDefaults: hint.playback,
      playbackDim: hint.playbackDim,
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
                  multiSliceColors={palette.colors}
                  xSymlogConstant={
                    axisScales[lineMapping.indexOf('x')]?.symlogConstant
                  }
                  xTickLabels={axisScales[lineMapping.indexOf('x')]?.tickLabels}
                  title={hint.title ?? entity.name}
                  valueLabel={hint.valueLabel}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  symlogThreshold={hint.symlogThreshold}
                  valueTransform={hint.valueTransform}
                  envelope={hint.envelope}
                  extras={extras}
                  dataLabel={
                    hasExtraCurves
                      ? (toUnicodeScripts(hint.curveLabel ?? hint.longName) ??
                        entity.name)
                      : undefined
                  }
                  dataColor={hint.curveColor}
                  dataWidth={hint.curveWidth}
                  dataDash={hint.curveDash}
                  legend={hint.legend}
                  nanColor={hint.nanColor}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[
          ...references.notes,
          ...getRootScaleNotes(hint),
          ...series.notes,
          ...band.notes,
          ...palette.notes,
          ...getDimScaleNotes(dimScales),
          ...xAxisScale.notes,
        ]}
      />
    </>
  );
}

export default LineVisContainer;
