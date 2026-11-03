import {
  CurveType,
  type CustomDomain,
  DataCurve,
  LineVis,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import {
  type ArrayShape,
  type Dataset,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import {
  type AxisScaleType,
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { getBounds } from '@h5web/shared/vis-utils';
import { type BoostMath } from 'boost-math-wasm';
import ndarray from 'ndarray';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { renderMarkup, renderSvgMarkup } from '../../view-hints/markup';
import { DEFAULT_DOMAIN } from '../utils';
import { type LineConfig } from './config';
import LineToolbar from './LineToolbar';
import { formatQQFit, getQQPlot } from './qq';

const FIT_COLOR = '#ff7f0e'; // orange, apart from the data's blue in light and dark themes
const BAND_COLOR = '#808080'; // neutral gray, readable on light and dark backgrounds

interface Props {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  numArray: NumArray; // unpacked
  ignoreValue?: IgnoreValue; // dropped, like values that are not finite
  boostMath: BoostMath;
  valueLabel?: string;
  title: string;
  toolbarContainer?: HTMLDivElement | undefined;
  config: LineConfig;
  dataColor?: string;
}

/* Q-Q plot of a 1D slice against a distribution (Boost.Math), with a fitted line and 95% band */
function QQLineVis(props: Props) {
  const { dataset, numArray, ignoreValue, boostMath, valueLabel } = props;
  const { title, toolbarContainer, config, dataColor } = props;
  const { qqDistribution: distribution } = config;

  const qq = useMemo(
    () => getQQPlot(boostMath, numArray, distribution, ignoreValue),
    [boostMath, numArray, distribution, ignoreValue],
  );

  // Own scales and domain: quantiles, not the signal's abscissas
  const [xScaleType, setXScaleType] = useState<AxisScaleType>(ScaleType.Linear);
  const [yScaleType, setYScaleType] = useState<AxisScaleType>(ScaleType.Linear);
  const [customDomain, setCustomDomain] = useState<CustomDomain>([null, null]);

  const dataDomain = useMemo<Domain>(() => {
    const bounds = [qq.ordered, qq.lower, qq.upper].map((arr) =>
      getBounds(arr),
    );
    const min = Math.min(...bounds.map((b) => b?.min ?? Infinity));
    const max = Math.max(...bounds.map((b) => b?.max ?? -Infinity));
    return min <= max ? [min, max] : DEFAULT_DOMAIN;
  }, [qq]);
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, yScaleType);

  const name = distribution.charAt(0).toUpperCase() + distribution.slice(1);
  const isLog = distribution === 'lognormal';
  const label = valueLabel || dataset.name;
  const yLabel = isLog ? `ln(${label})` : label;
  const dropped = qq.dropped > 0 ? `, ${qq.dropped} dropped` : ''; // not finite, or invalid

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <LineToolbar
            dataDomain={dataDomain}
            config={{
              ...config,
              customDomain,
              setCustomDomain,
              xScaleType,
              setXScaleType,
              yScaleType,
              setYScaleType,
            }}
            qq={{ value: true, onToggle: () => config.setShowQQ(false) }}
          />,
          toolbarContainer,
        )}

      <LineVis
        className={visualizerStyles.vis}
        dataArray={ndarray(qq.ordered)}
        dataLabel="Data"
        dataColor={dataColor}
        domain={safeDomain}
        scaleType={yScaleType}
        curveType={CurveType.GlyphsOnly}
        showGrid={config.showGrid}
        abscissaParams={{
          label: `${name} quantiles${isLog ? ' (of the logs)' : ''}`,
          value: qq.theoretical,
          scaleType: xScaleType,
        }}
        ordinateLabel={renderSvgMarkup(yLabel)}
        title={renderMarkup(
          `${title}, Q-Q (${distribution}): ${formatQQFit(distribution, qq.location, qq.scale)}${dropped}`,
        )}
        showLegend
        legendEntries={[
          { label: 'Least squares', color: FIT_COLOR },
          { label: '95% pointwise', color: BAND_COLOR, isBand: true },
        ]}
        testid="qq"
      >
        <DataCurve
          abscissas={qq.theoretical}
          ordinates={qq.line}
          color={BAND_COLOR}
          curveType={CurveType.LineOnly}
          band={{ lower: qq.lower, upper: qq.upper, opacity: 0.3, only: true }}
        />
        <DataCurve
          abscissas={qq.theoretical}
          ordinates={qq.line}
          color={FIT_COLOR}
          width={1.5}
          curveType={CurveType.LineOnly}
        />
      </LineVis>
    </>
  );
}

export default QQLineVis;
