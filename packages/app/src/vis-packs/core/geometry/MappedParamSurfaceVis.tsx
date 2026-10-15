import {
  getDomain,
  ParamSurfaceVis,
  useDomain,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import { type ArrayValue, type NumericType } from '@h5web/shared/hdf5-models';
import ndarray from 'ndarray';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { unpackNumArray } from '../../netcdf/utils';
import { useStableDomain } from '../../playback-range';
import { type ViewHint } from '../../view-hints/models';
import {
  getColorSuggestions,
  getParamSurfaceSuggestions,
} from '../../view-hints/suggestions';
import { useSuggestions } from '../hooks';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type GeometryData } from './GeometryFetcher';
import ParamSurfaceToolbar from './ParamSurfaceToolbar';
import { type ParamSurfaceConfig } from './surface-config';

interface Props {
  data: GeometryData;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: ParamSurfaceConfig;
  hint: ViewHint;
}

function MappedParamSurfaceVis(props: Props) {
  const { data, title, toolbarContainer, config: storedConfig, hint } = props;
  const { x, y, z, values, shape, labels, ignoreValue, packing } = data;

  // A file's `H5WEB_view` hint: scale first, since the data domain depends on it
  const hinted = useSuggestions(storedConfig, getParamSurfaceSuggestions(hint));
  const { scaleType } = hinted;

  const arrays = useMemo(() => {
    if (!z || !values) {
      throw new Error('Expected surface with Z coordinates and scalar field');
    }

    return {
      x: ndarray(x, shape),
      y: ndarray(y, shape),
      z: ndarray(z, shape),
      values: ndarray(values, shape),
    };
  }, [x, y, z, values, shape]);

  const dataDomain =
    useStableDomain(
      useDomain(arrays.values.data, { scaleType, ignoreValue }),
      scaleType,
      (seq) =>
        getDomain(
          toNumArray(unpackNumArray(seq as ArrayValue<NumericType>, packing)),
          {
            scaleType,
            ignoreValue,
          },
        ),
    ) || DEFAULT_DOMAIN;

  const config = useSuggestions(hinted, getColorSuggestions(hint, dataDomain));
  const {
    customDomain,
    colorMap,
    invertColorMap,
    keepRatio,
    showGrid,
    representation,
    shading,
  } = config;

  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <ParamSurfaceToolbar dataDomain={dataDomain} config={config} />,
          toolbarContainer,
        )}

      <ParamSurfaceVis
        className={visualizerStyles.vis}
        {...arrays}
        domain={safeDomain}
        colorMap={colorMap}
        scaleType={scaleType}
        invertColorMap={invertColorMap}
        title={title}
        xLabel={labels[0]}
        yLabel={labels[1]}
        zLabel={labels[2]}
        keepRatio={keepRatio}
        showGrid={showGrid}
        representation={representation}
        shading={shading}
        ignoreValue={ignoreValue}
      />
    </>
  );
}

export default MappedParamSurfaceVis;
