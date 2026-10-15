import { DimensionMapper, type Domain, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertMinDims,
  assertNumericLikeType,
} from '@h5web/shared/guards';
import { Suspense, useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import {
  useContourSource,
  useLinkedOverlays,
  useViewHint,
} from '../../view-hints/hooks';
import LinkedDimMapper from '../../view-hints/LinkedDimMapper';
import OverlayLegend from '../../view-hints/OverlayLegend';
import OverlayNotes from '../../view-hints/OverlayNotes';
import {
  getProbeDim,
  getProbeSelection,
  type ProbePoint,
} from '../../view-hints/probe';
import ProbePanel from '../../view-hints/ProbePanel';
import { getHeatmapSuggestions } from '../../view-hints/suggestions';
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

  const { dimHints, dimLabels, dimUnits } = useDimInfo(entity);

  // Suggest keeping the ratio only when the mapped axes share a unit, as NeXus does
  const hint = useViewHint(entity);
  const [dataDomain, setDataDomain] = useState<Domain>(); // for hints that depend on the data
  const config = useHeatmapConfig(
    getHeatmapSuggestions(
      hint,
      entity.path,
      {
        keepRatio: guessKeepRatio(
          { unit: dimUnits[dimMapping.indexOf('x')] },
          { unit: dimUnits[dimMapping.indexOf('y')] },
        ),
      },
      dataDomain,
    ),
  );
  const selection = getSliceSelection(dimMapping);

  // Overlays declared by the hint, sliced along a linked dimension (e.g. `generation`)
  const overlays = useLinkedOverlays(entity, hint, dimMapping);
  const contourOf = useContourSource(entity, hint, dimMapping);
  const { extraSlider } = overlays;

  // Probe: values of a clicked pixel along a sliced dimension
  const [probePoint, setProbePoint] = useState<ProbePoint>();
  const [chosenProbeDim, setChosenProbeDim] = useState<number>();
  const probeDim = getProbeDim(dimMapping, chosenProbeDim ?? hint.probeDim);
  const showProbe =
    config.probe &&
    !config.surface &&
    probeDim !== undefined &&
    probePoint !== undefined &&
    getProbeSelection(dimMapping, probeDim, probePoint) !== undefined;

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    {
      withPlaybackRange: true,
      getExtraRequests: overlays.getSliceRequests,
      skipEmpty: hint.playbackSkipEmpty,
      playbackDefaults: hint.playback,
    },
  );

  const dimMapper = (
    <DimensionMapper
      className={extraSlider ? undefined : visualizerStyles.dimMapper}
      dims={dims}
      dimHints={dimHints}
      dimLabels={dimLabels}
      dimMapping={dimMapping}
      {...slicingProps}
      onChange={setDimMapping}
    />
  );

  return (
    <>
      {extraSlider ? (
        <LinkedDimMapper {...extraSlider}>{dimMapper}</LinkedDimMapper>
      ) : (
        dimMapper
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
                <MappedHeatmapVis
                  dataset={entity}
                  value={value}
                  dimMapping={dimMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  axisTicks={axisTicks}
                  title={hint.title ?? entity.name}
                  valueLabel={hint.valueLabel}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  overlays={overlays.shapes}
                  symlogThreshold={hint.symlogThreshold}
                  specialColors={hint}
                  onDataDomainChange={setDataDomain}
                  contourSource={contourOf.source}
                  emphasisStyle={{
                    width: hint.contourEmphasizeWidth,
                    color: hint.contourEmphasizeColor,
                  }}
                  probe={
                    probeDim === undefined
                      ? undefined
                      : { point: probePoint, onProbe: setProbePoint }
                  }
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[
          ...overlays.notes,
          ...contourOf.notes,
          ...(config.surface ? overlays.notesIn3D : []),
        ]}
      />
      <OverlayLegend items={overlays.legend} />
      {showProbe && (
        <Suspense fallback={null}>
          <ProbePanel
            key={probeDim} // no values of another dimension kept while loading
            dataset={entity}
            dimMapping={dimMapping}
            probeDim={probeDim}
            point={probePoint}
            valueLabel={hint.valueLabel || hint.longName} // else the dataset's name
            scaleType={config.scaleType}
            symlogThreshold={hint.symlogThreshold}
            onProbeDimChange={setChosenProbeDim}
            onClose={() => setProbePoint(undefined)}
          />
        </Suspense>
      )}
    </>
  );
}

export default HeatmapVisContainer;
