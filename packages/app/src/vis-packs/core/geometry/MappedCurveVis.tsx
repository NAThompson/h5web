import {
  Curve3DVis,
  getDomain,
  useDomain,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import { type ArrayValue, type NumericType } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { unpackNumArray } from '../../netcdf/utils';
import { useStableDomain } from '../../playback-range';
import { renderMarkup } from '../../view-hints/markup';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type CurveConfig, LINE_WIDTH_PX } from './config';
import CurveToolbar from './CurveToolbar';
import { type GeometryData } from './GeometryFetcher';

interface Props {
  data: GeometryData;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: CurveConfig;
}

function MappedCurveVis(props: Props) {
  const { data, title, toolbarContainer, config } = props;
  const { x, y, z, values, shape, labels, ignoreValue, packing } = data;
  const {
    customDomain,
    colorMap,
    scaleType,
    invertColorMap,
    keepRatio,
    showGrid,
    curveType,
    lineWidth,
  } = config;

  // Without scalar field, colour curve by point index (i.e. by its parameter)
  const field = useMemo(
    () => values ?? Float64Array.from({ length: shape[0] }, (_, i) => i),
    [values, shape],
  );

  const dataDomain =
    useStableDomain(
      useDomain(field, { scaleType, ignoreValue }),
      scaleType,
      (seq) =>
        values // without scalar field, colour by point index, which doesn't change
          ? getDomain(
              toNumArray(
                unpackNumArray(seq as ArrayValue<NumericType>, packing),
              ),
              {
                scaleType,
                ignoreValue,
              },
            )
          : undefined,
    ) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <CurveToolbar dataDomain={dataDomain} config={config} />,
          toolbarContainer,
        )}

      <Curve3DVis
        className={visualizerStyles.vis}
        x={x}
        y={y}
        z={z}
        values={field}
        domain={safeDomain}
        colorMap={colorMap}
        scaleType={scaleType}
        invertColorMap={invertColorMap}
        title={renderMarkup(values ? title : `${title} (coloured by index)`)}
        xLabel={labels[0]}
        yLabel={labels[1]}
        zLabel={labels[2] ?? '𝑧'}
        keepRatio={keepRatio}
        showGrid={showGrid}
        curveType={curveType}
        lineWidth={LINE_WIDTH_PX[lineWidth]}
        ignoreValue={ignoreValue}
      />
    </>
  );
}

export default MappedCurveVis;
