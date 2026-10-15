import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import { assertGroup } from '@h5web/shared/guards';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useComplexCurveConfig } from '../../core/complex/curve-config';
import MappedComplexCurveVis from '../../core/complex/MappedComplexCurveVis';
import { type VisContainerProps } from '../../models';
import { useNxSlicingProps } from '../../slicing';
import VisBoundary from '../../VisBoundary';
import { assertComplexNxData } from '../guards';
import { useNxData } from '../hooks';
import NxValuesFetcher from '../NxValuesFetcher';
import { getAxisNames } from '../utils';

/** Complex NeXus signal along one axis as a 3D curve (abscissa from NeXus axes, real, imaginary). */
function NxComplexCurveContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  // Errors and auxiliary signals are not drawn: don't resolve, validate nor fetch them
  const signalOnly = useNxData(entity, { signalOnly: true });
  assertComplexNxData(signalOnly);

  const { signalDef, axisDefs, defaultSlice } = signalOnly;
  const { dims: signalDims } = signalDef.dataset.shape;

  const [dimMapping, setDimMapping] = useDimMappingState({
    dims: signalDims,
    axesCount: 1,
    defaultSlice,
  });

  const axisLabels = axisDefs.map((def) => def?.label);
  const config = useComplexCurveConfig();
  const { slicingProps, playbackRange } = useNxSlicingProps(
    signalOnly,
    dimMapping,
    { withPlaybackRange: true },
  );

  return (
    <>
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
          nxData={signalOnly}
          selection={getSliceSelection(dimMapping)}
          render={(nxValues) => {
            const { signal, axisValues, title } = nxValues;

            return (
              <MappedComplexCurveVis
                value={signal}
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

export default NxComplexCurveContainer;
