import { DimensionMapper, getSliceSelection, ScaleType } from '@h5web/lib';
import { assertGroup, isAxisScaleType } from '@h5web/shared/guards';
import { useMemo, useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useLineConfig } from '../../core/line/config';
import MappedLineVis from '../../core/line/MappedLineVis';
import { getMultiPlotMapping } from '../../core/line/utils';
import { type VisContainerProps } from '../../models';
import { useNxSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { getLineSuggestions } from '../../view-hints/suggestions';
import { getHintNotes } from '../../view-hints/utils';
import VisBoundary from '../../VisBoundary';
import { assertNumericLikeNxData } from '../guards';
import { useNxData } from '../hooks';
import NxLineSignalPicker from '../NxLineSignalPicker';
import NxValuesFetcher from '../NxValuesFetcher';
import { areSameDims, getAxisNames } from '../utils';

function NxLineContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  const nxData = useNxData(entity);
  assertNumericLikeNxData(nxData);

  const { signalDef, axisDefs, auxDefs, defaultSlice, silxStyle } = nxData;
  const signalDims = signalDef.dataset.shape.dims;
  const errorDims = signalDef.errorDataset?.shape.dims;

  if (errorDims && !areSameDims(signalDims, errorDims)) {
    const dimsStr = JSON.stringify({ signalDims, errorsDims: errorDims });
    throw new Error(`Signal and errors dimensions don't match: ${dimsStr}`);
  }

  const [dimMapping, setDimMapping, storedMultiDim, setMultiDim] =
    useDimMappingState({ dims: signalDims, axesCount: 1, defaultSlice });

  // Multi-plotting is not supported alongside auxiliary signals
  const canMultiPlot = auxDefs.length === 0;
  const multiDim = canMultiPlot ? storedMultiDim : undefined;
  const lineMapping = useMemo(
    () => getMultiPlotMapping(dimMapping, multiDim),
    [dimMapping, multiDim],
  );

  const auxLabels = auxDefs.map((def) => def.label);
  const axisLabels = axisDefs.map((def) => def?.label);
  const xDimIndex = dimMapping.indexOf('x');

  const [isSignalVisible, setSignalVisible] = useState(true);
  const [auxVisible, setAuxVisible] = useState(auxDefs.map(() => true));

  // `H5WEB_*` view hint > NeXus `SILX_style`
  const hint = useViewHint(entity, signalDef.dataset);
  const config = useLineConfig(
    getLineSuggestions(hint, {
      xScaleType: silxStyle.axisScaleTypes?.[xDimIndex],
      yScaleType: isAxisScaleType(silxStyle.signalScaleType)
        ? silxStyle.signalScaleType
        : ScaleType.Linear,
    }),
  );

  const { slicingProps, playbackRange } = useNxSlicingProps(
    nxData,
    dimMapping,
    {
      mapMapping: (m) => getMultiPlotMapping(m, multiDim),
      withPlaybackRange: true,
    },
  );

  return (
    <>
      {auxDefs.length > 0 && (
        <NxLineSignalPicker
          signalLabel={signalDef.label}
          signalChecked={isSignalVisible}
          auxLabels={auxLabels}
          auxChecked={auxVisible}
          onSignalChange={setSignalVisible}
          onAuxChange={setAuxVisible}
          toolbarContainer={toolbarContainer}
        />
      )}

      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={signalDims}
        dimHints={axisLabels}
        dimLabels={getAxisNames(axisDefs)}
        dimMapping={dimMapping}
        {...slicingProps}
        onChange={setDimMapping}
        multiDim={multiDim}
        onMultiDimChange={canMultiPlot ? setMultiDim : undefined}
      />

      <VisBoundary resetKey={lineMapping} playbackRange={playbackRange}>
        <NxValuesFetcher
          nxData={nxData}
          selection={getSliceSelection(lineMapping)}
          render={(nxValues) => {
            const { signal, errors, axisValues, auxValues, auxErrors, title } =
              nxValues;

            return (
              <MappedLineVis
                dataset={signalDef.dataset}
                value={signal}
                valueLabel={signalDef.label}
                valueVisible={isSignalVisible}
                errors={errors}
                errorsDataset={signalDef.errorDataset}
                auxLabels={auxLabels}
                auxValues={auxValues}
                auxDatasets={auxDefs.map((def) => def.dataset)}
                auxErrors={auxErrors}
                auxErrorsDatasets={auxDefs.map((def) => def.errorDataset)}
                auxVisible={auxVisible}
                dimMapping={lineMapping}
                axisLabels={axisLabels}
                axisValues={axisValues}
                title={hint.title ?? title}
                toolbarContainer={toolbarContainer}
                config={config}
                symlogThreshold={hint.symlogThreshold}
              />
            );
          }}
        />
      </VisBoundary>
      <OverlayNotes notes={getHintNotes(hint)} />
    </>
  );
}

export default NxLineContainer;
