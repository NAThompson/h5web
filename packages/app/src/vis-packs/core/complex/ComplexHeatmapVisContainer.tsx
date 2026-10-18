import { DimensionMapper, type Domain, getSliceSelection } from '@h5web/lib';
import {
  assertArrayShape,
  assertComplexType,
  assertDataset,
  assertMinDims,
} from '@h5web/shared/guards';
import { useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import DimScalesFetcher from '../../dimscales/DimScalesFetcher';
import { useDimInfo } from '../../dimscales/hooks';
import { type VisContainerProps } from '../../models';
import { useDatasetSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
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

  const { dimHints, dimLabels, sliceLabels, dimUnits } = useDimInfo(entity);

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
        dimLabels={dimLabels}
        sliceLabels={sliceLabels}
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
                  title={hint.title ?? entity.name}
                  toolbarContainer={toolbarContainer}
                  config={config}
                  onDataDomainChange={setDataDomain}
                />
              )}
            />
          )}
        />
      </VisBoundary>
      <OverlayNotes notes={hint.notes} />
    </>
  );
}

export default ComplexHeatmapVisContainer;
