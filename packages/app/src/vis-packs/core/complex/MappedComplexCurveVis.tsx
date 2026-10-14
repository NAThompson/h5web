import {
  Curve3DVis,
  type DimensionMapping,
  type Domain,
  useDomain,
  useSafeDomain,
  useSlicedDimsAndMapping,
  useVisDomain,
} from '@h5web/lib';
import {
  type ArrayValue,
  type ComplexType,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { ComplexVisType, ScaleType } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useStableDomain } from '../../playback-range';
import { LINE_WIDTH_PX } from '../geometry/config';
import { useMappedArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import ComplexCurveToolbar from './ComplexCurveToolbar';
import { type ComplexCurveConfig } from './curve-config';
import { usePhaseAmplitude, useRealImag } from './hooks';
import {
  decimateCurve,
  getCurveAbscissas,
  getPhaseAmplitudeDomain,
  getRealImagDomain,
} from './utils';

// Colour domain of phase: fixed, so that a cyclic colour map wraps around at ±π
const PHASE_DOMAIN: Domain = [-Math.PI, Math.PI];

interface Props {
  value: ArrayValue<ComplexType>;
  dims: number[];
  dimMapping: DimensionMapping;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: ComplexCurveConfig;
}

/**
 * Complex values along one dimension as a 3D curve: x = abscissa, y = real part, z = imaginary part,
 * coloured by amplitude or phase (e.g. ζ(1/2 + it) winds through the origin at each zero).
 */
function MappedComplexCurveVis(props: Props) {
  const {
    value,
    dims,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    title,
    toolbarContainer,
    config,
  } = props;

  const {
    customDomain,
    colorMap,
    scaleType,
    invertColorMap,
    keepRatio,
    showGrid,
    curveType,
    lineWidth,
    colorBy,
    phaseColorMap,
  } = config;

  const { real, imag } = useRealImag(value);
  const { phase, amplitude } = usePhaseAmplitude(value);
  const numAxisArrays = useToNumArrays(axisValues);

  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);
  const realArray = useMappedArray(real, ...mappingArgs);
  const imagArray = useMappedArray(imag, ...mappingArgs);
  const phaseArray = useMappedArray(phase, ...mappingArgs);
  const amplitudeArray = useMappedArray(amplitude, ...mappingArgs);

  // During playback, use amplitude range of whole sequence (cf. `useStableDomain`)
  const amplitudeDomain =
    useStableDomain(
      useDomain(amplitudeArray, { scaleType }),
      `amplitude:${scaleType}`,
      (seq) =>
        getPhaseAmplitudeDomain(seq as typeof value, 'amplitude', scaleType),
    ) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, amplitudeDomain);
  const [safeDomain] = useSafeDomain(visDomain, amplitudeDomain, scaleType);

  // During playback, keep Re and Im axes still: include ranges of whole sequence (or of slices shown so far)
  const realDomain = useStableDomain(useDomain(realArray), 'real', (seq) =>
    getRealImagDomain(seq as typeof value, 'real'),
  );
  const imagDomain = useStableDomain(useDomain(imagArray), 'imag', (seq) =>
    getRealImagDomain(seq as typeof value, 'imag'),
  );

  const xDimIndex = dimMapping.indexOf('x');
  const count = realArray.size;
  const abscissas = useMemo(
    () => getCurveAbscissas(numAxisArrays[xDimIndex], count),
    [numAxisArrays, xDimIndex, count],
  );

  const byPhase = colorBy === ComplexVisType.Phase;

  // Decimate very long curves for display
  const [x, y, z, field] = useMemo(
    () =>
      decimateCurve([
        abscissas,
        realArray.data,
        imagArray.data,
        byPhase ? phaseArray.data : amplitudeArray.data,
      ]),
    [abscissas, realArray, imagArray, phaseArray, amplitudeArray, byPhase],
  );

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <ComplexCurveToolbar
            amplitudeDomain={amplitudeDomain}
            config={config}
          />,
          toolbarContainer,
        )}

      <Curve3DVis
        className={visualizerStyles.vis}
        x={x}
        y={y}
        z={z}
        values={field}
        domain={byPhase ? PHASE_DOMAIN : safeDomain}
        scaleType={byPhase ? ScaleType.Linear : scaleType}
        colorMap={byPhase ? phaseColorMap : colorMap}
        invertColorMap={invertColorMap}
        title={`${title} (coloured by ${byPhase ? 'phase' : 'amplitude'})`}
        xLabel={axisLabels[xDimIndex] ?? 'x'}
        yLabel="Re"
        zLabel="Im"
        keepRatio={keepRatio}
        showGrid={showGrid}
        curveType={curveType}
        lineWidth={LINE_WIDTH_PX[lineWidth]}
        axisDomains={[undefined, realDomain, imagDomain]}
      />
    </>
  );
}

export default MappedComplexCurveVis;
