import { DimensionMapper, type Domain, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertDataset,
  assertMinDims,
  assertNumericLikeType,
} from '@h5web/shared/guards';
import { useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimHints, useDimUnits } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import { useLinkedOverlays, useViewHint } from '../../view-hints/hooks';
import LinkedDimMapper from '../../view-hints/LinkedDimMapper';
import OverlayLegend from '../../view-hints/OverlayLegend';
import OverlayNotes from '../../view-hints/OverlayNotes';
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

  const dimHints = useDimHints(entity);
  const dimUnits = useDimUnits(entity);

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
  const { extraSlider } = overlays;

  const { slicingProps, playbackRange } = useDatasetSlicingProps(
    entity,
    dimMapping,
    { withPlaybackRange: true, getExtraRequests: overlays.getSliceRequests },
  );

  const dimMapper = (
    <DimensionMapper
      className={extraSlider ? undefined : visualizerStyles.dimMapper}
      dims={dims}
      dimHints={dimHints}
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
              render={({ axisLabels, axisValues }) => (
                <MappedHeatmapVis
                  dataset={entity}
                  value={value}
                  dimMapping={dimMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  title={hint.title ?? entity.name}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  overlays={overlays.shapes}
                  onDataDomainChange={setDataDomain}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes
        notes={[
          ...overlays.notes,
          ...(config.surface ? overlays.notesIn3D : []),
        ]}
      />
      <OverlayLegend items={overlays.legend} />
    </>
  );
}

export default HeatmapVisContainer;
