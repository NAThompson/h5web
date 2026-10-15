import { DimensionMapper, getSliceSelection } from '@h5web/lib';
import { assertGroup, assertMinDims } from '@h5web/shared/guards';
import { useMemo } from 'react';

import { useDimMappingState } from '../../../dim-mapping-store';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  useSuggestedIsoLevels,
  useVolumeConfig,
} from '../../core/volume/config';
import MappedVolumeVis from '../../core/volume/MappedVolumeVis';
import { type VisContainerProps } from '../../models';
import { useNxSlicingProps } from '../../slicing';
import { useViewHint } from '../../view-hints/hooks';
import OverlayNotes from '../../view-hints/OverlayNotes';
import { getVolumeSuggestions } from '../../view-hints/suggestions';
import { getHintNotes } from '../../view-hints/utils';
import VisBoundary from '../../VisBoundary';
import { assertNumericNxData } from '../guards';
import { useNxData } from '../hooks';
import NxValuesFetcher from '../NxValuesFetcher';
import { getVolumeDefaultSlice } from '../utils';

/*
 * The last three dimensions of the signal form the volume (`[z, y, x]`); leading dimensions,
 * if any, are sliced. Auxiliary signals and errors don't apply to volumes and are not fetched.
 */
function NxVolumeContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  // Auxiliary signals and errors don't apply to volumes: don't resolve, validate nor fetch them
  const nxDataToFetch = useNxData(entity, { signalOnly: true });
  assertNumericNxData(nxDataToFetch);

  const { signalDef, axisDefs, defaultSlice, silxStyle } = nxDataToFetch;
  assertMinDims(signalDef.dataset, 3);

  const { dims } = signalDef.dataset.shape;
  const volumeDefaultSlice = useMemo(
    () => defaultSlice && getVolumeDefaultSlice(defaultSlice),
    [defaultSlice],
  );
  const [dimMapping, setDimMapping] = useDimMappingState({
    dims,
    axesCount: 0,
    lockedDimsCount: 3,
    defaultSlice: volumeDefaultSlice,
  });

  const hint = useViewHint(entity, signalDef.dataset);
  const config = useSuggestedIsoLevels(
    useVolumeConfig(
      getVolumeSuggestions(hint, { scaleType: silxStyle.signalScaleType }),
    ),
    hint.isoLevels,
  );

  // Size the volume by its axes (and express gradients in their unit) only if all three share a unit
  const volumeAxisDefs = axisDefs.slice(-3);
  const axisUnit = volumeAxisDefs[0]?.unit;
  const withPhysicalAspect =
    volumeAxisDefs.length === 3 &&
    volumeAxisDefs.every((def) => def && def.unit === axisUnit);

  // Stable dimensions, so that presentation changes don't make a new data array (and drop cached isosurfaces)
  const volumeDims = useMemo(() => dims.slice(-3), [dims]);

  const { slicingProps, playbackRange } = useNxSlicingProps(
    nxDataToFetch,
    dimMapping,
    { withPlaybackRange: true },
  );

  return (
    <>
      <DimensionMapper
        className={visualizerStyles.dimMapper}
        dims={dims}
        dimHints={axisDefs.map((def) => def?.label)}
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

            return (
              <MappedVolumeVis
                dataset={signalDef.dataset}
                value={signal}
                dims={volumeDims}
                axisValues={axisValues.slice(-3)}
                title={hint.title ?? title}
                toolbarContainer={toolbarContainer}
                config={config}
                withPhysicalAspect={withPhysicalAspect}
                axisUnit={withPhysicalAspect ? axisUnit : undefined}
              />
            );
          }}
        />
      </VisBoundary>
      <OverlayNotes notes={getHintNotes(hint)} />
    </>
  );
}

export default NxVolumeContainer;
