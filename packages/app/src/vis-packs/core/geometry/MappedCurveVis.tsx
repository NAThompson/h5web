import {
  Curve3DVis,
  getDomain,
  useDomain,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useStableDomain } from '../../playback-range';
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
  const { x, y, z, values, shape, labels, ignoreValue } = data;
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
          ? getDomain(toNumArray(seq as typeof values), {
              scaleType,
              ignoreValue,
            })
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
        title={values ? title : `${title} (coloured by index)`}
        xLabel={labels[0]}
        yLabel={labels[1]}
        zLabel={labels[2] ?? 'z'}
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
