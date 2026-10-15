import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import {
  assertGroup,
  assertMinDims,
  assertNumericLikeType,
  assertValue,
  hasComplexType,
} from '@h5web/shared/guards';
import { useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import MappedComplexHeatmapVis from '../../core/complex/MappedComplexHeatmapVis';
import { useHeatmapConfig } from '../../core/heatmap/config';
import MappedHeatmapVis from '../../core/heatmap/MappedHeatmapVis';
import { guessKeepRatio } from '../../core/utils';
import { type VisContainerProps } from '../../models';
import { useNxSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import { getHeatmapSuggestions } from '../../view-hints/suggestions';
import VisBoundary from '../../VisBoundary';
import { useNxData, useNxHeatmapDataToFetch } from '../hooks';
import NxHeatmapSignalPicker from '../NxHeatmapSignalPicker';
import NxValuesFetcher from '../NxValuesFetcher';

function NxHeatmapContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  const nxData = useNxData(entity);

  const { signalDef, axisDefs, auxDefs, defaultSlice, silxStyle } = nxData;
  const [selectedDef, setSelectedDef] = useState(signalDef);
  const { dataset: selectedDataset } = selectedDef;

  assertMinDims(selectedDataset, 2);
  const { dims } = selectedDataset.shape;
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 2,
    defaultSlice,
  });

  const axisLabels = axisDefs.map((def) => def?.label);
  const xAxisDef = axisDefs[dimMapping.indexOf('x')];
  const yAxisDef = axisDefs[dimMapping.indexOf('y')];

  // `H5WEB_view` hint > NeXus `SILX_style` > heuristics
  const hint = useViewHint(entity, signalDef.dataset);
  const config = useHeatmapConfig(
    getHeatmapSuggestions(hint, selectedDataset.path, {
      scaleType: silxStyle.signalScaleType,
      keepRatio: guessKeepRatio(xAxisDef, yAxisDef),
    }),
  );

  const nxDataToFetch = useNxHeatmapDataToFetch(nxData, selectedDef);

  const { slicingProps, playbackRange } = useNxSlicingProps(
    nxDataToFetch,
    dimMapping,
    { withPlaybackRange: true },
  );

  return (
    <>
      {auxDefs.length > 0 && (
        <NxHeatmapSignalPicker
          definitions={[signalDef, ...auxDefs]}
          value={selectedDef}
          onChange={setSelectedDef}
          toolbarContainer={toolbarContainer}
        />
      )}

      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={axisLabels}
        dimMapping={dimMapping}
        {...slicingProps}
        onChange={setDimMapping}
      />

      <VisBoundary resetKey={dimMapping} playbackRange={playbackRange}>
        <NxValuesFetcher
          nxData={nxDataToFetch}
          selection={getSliceSelection(dimMapping)}
          render={(nxValues) => {
            const { signal, axisValues, title } = nxValues;

            if (hasComplexType(selectedDataset)) {
              assertValue(signal, selectedDataset);

              return (
                <MappedComplexHeatmapVis
                  value={signal}
                  dims={dims}
                  dimMapping={dimMapping}
                  axisLabels={axisLabels}
                  axisValues={axisValues}
                  title={title}
                  toolbarContainer={toolbarContainer}
                  config={config}
                />
              );
            }

            assertNumericLikeType(selectedDataset);
            assertValue(signal, selectedDataset);
            return (
              <MappedHeatmapVis
                dataset={selectedDataset}
                value={signal}
                dimMapping={dimMapping}
                axisLabels={axisLabels}
                axisValues={axisValues}
                title={title}
                toolbarContainer={toolbarContainer}
                config={config}
              />
            );
          }}
        />
      </VisBoundary>
    </>
  );
}

export default NxHeatmapContainer;
