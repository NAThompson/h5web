import {
  type CustomDomain,
  type DimensionMapping,
  LineVis,
  useDomain,
  useSafeDomain,
  useVisDomain,
} from '@h5web/lib';
import { type ArrayValue, type NumericType } from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import {
  type AxisScaleType,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type BoostMath } from 'boost-math-wasm';
import ndarray from 'ndarray';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { renderMarkup } from '../../view-hints/markup';
import { useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type LineConfig } from './config';
import LineToolbar from './LineToolbar';
import { getSpectrumAxis } from './spectrum';

interface Props {
  numArray: NumArray; // unpacked, all finite and valid
  boostMath: BoostMath;
  dimMapping: DimensionMapping;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  title: string;
  toolbarContainer?: HTMLDivElement | undefined;
  config: LineConfig;
  dataColor?: string;
}

/* Power spectrum of a 1D slice (Boost.Math, one-sided: sums to the mean of the squares) */
function SpectrumLineVis(props: Props) {
  const {
    numArray,
    boostMath,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    title,
    toolbarContainer,
    config,
    dataColor,
  } = props;

  const numAxisArrays = useToNumArrays(axisValues);

  const xDimIndex = dimMapping.indexOf('x');
  const xValues = numAxisArrays[xDimIndex];
  const xLabel = axisLabels[xDimIndex];
  const axis = useMemo(
    () => getSpectrumAxis(numArray.length, xValues, xLabel),
    [numArray.length, xValues, xLabel],
  );
  const dataArray = useMemo(
    () => ndarray(boostMath.power_spectrum(numArray)),
    [boostMath, numArray],
  );

  // Own x scale and domain: frequencies and powers, not the signal's
  const [xScaleType, setXScaleType] = useState<AxisScaleType>(ScaleType.Linear);
  const [customDomain, setCustomDomain] = useState<CustomDomain>([null, null]);
  const yScaleType = config.spectrumScaleType;

  const dataDomain =
    useDomain(dataArray, { scaleType: yScaleType }) ?? DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, yScaleType);

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
              setYScaleType: config.setSpectrumScaleType,
            }}
            spectrum={{
              value: true,
              onToggle: () => config.setShowSpectrum(false),
            }}
          />,
          toolbarContainer,
        )}

      <LineVis
        className={visualizerStyles.vis}
        dataArray={dataArray}
        dataColor={dataColor}
        domain={safeDomain}
        scaleType={yScaleType}
        curveType={config.curveType}
        showGrid={config.showGrid}
        abscissaParams={{
          label: axis.label,
          value: axis.frequencies,
          scaleType: xScaleType,
        }}
        ordinateLabel="Power"
        title={renderMarkup(`${title}, power spectrum`)}
        interpolation={config.interpolation}
        testid="spectrum"
      />
    </>
  );
}

export default SpectrumLineVis;
