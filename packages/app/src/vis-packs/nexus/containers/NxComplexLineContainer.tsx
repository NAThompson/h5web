import { DimensionMapper, getSliceSelection, ScaleType } from '@h5web/lib';
import { assertGroup, isAxisScaleType } from '@h5web/shared/guards';
import { useState } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import MappedComplexLineVis from '../../core/complex/MappedComplexLineVis';
import { useLineConfig } from '../../core/line/config';
import { type VisContainerProps } from '../../models';
import { useNxSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import { getComplexLineSuggestions } from '../../view-hints/suggestions';
import VisBoundary from '../../VisBoundary';
import { assertComplexNxData } from '../guards';
import { useNxData } from '../hooks';
import NxLineSignalPicker from '../NxLineSignalPicker';
import NxValuesFetcher from '../NxValuesFetcher';
import { getAxisNames } from '../utils';

function NxComplexLineContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  const nxData = useNxData(entity);
  assertComplexNxData(nxData);

  const { signalDef, axisDefs, auxDefs, defaultSlice, silxStyle } = nxData;
  const { dims: signalDims } = signalDef.dataset.shape;

  const [dimMapping, setDimMapping] = useDimMappingState({
    dims: signalDims,
    axesCount: 1,
    defaultSlice,
  });

  const auxLabels = auxDefs.map((def) => def.label);
  const axisLabels = axisDefs.map((def) => def?.label);
  const xDimIndex = dimMapping.indexOf('x');

  const [isSignalVisible, setSignalVisible] = useState(true);
  const [auxVisible, setAuxVisible] = useState(auxDefs.map(() => true));

  // `H5WEB_*` view hint > NeXus `SILX_style`
  const hint = useViewHint(entity, signalDef.dataset);
  const config = useLineConfig(
    getComplexLineSuggestions(hint, {
      xScaleType: silxStyle.axisScaleTypes?.[xDimIndex],
      yScaleType: isAxisScaleType(silxStyle.signalScaleType)
        ? silxStyle.signalScaleType
        : ScaleType.Linear,
    }),
  );

  const { slicingProps, playbackRange } = useNxSlicingProps(
    nxData,
    dimMapping,
    { withPlaybackRange: true },
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
      />
      <VisBoundary resetKey={dimMapping} playbackRange={playbackRange}>
        <NxValuesFetcher
          nxData={nxData}
          selection={getSliceSelection(dimMapping)}
          render={(nxValues) => {
            const { signal, axisValues, auxValues, title } = nxValues;

            return (
              <MappedComplexLineVis
                value={signal}
                valueLabel={signalDef.label}
                valueVisible={isSignalVisible}
                auxLabels={auxLabels}
                auxValues={auxValues}
                auxVisible={auxVisible}
                dims={signalDims}
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

export default NxComplexLineContainer;
