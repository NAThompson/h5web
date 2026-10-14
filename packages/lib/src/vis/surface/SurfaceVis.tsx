import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type PropsWithChildren, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import {
  type AxisParams,
  type ClassStyleAttrs,
  type VisScaleType,
} from '../models';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import Vis3DLayout from '../three-d/Vis3DLayout';
import { createScale, DEFAULT_DOMAIN } from '../utils';
import SurfaceMesh from './SurfaceMesh';
import {
  DEFAULT_MAX_VERTICES,
  getCellCenters,
  getCoordsDomain,
  getDownsamplingStride,
  getFootprint,
  getSampledIndices,
  isSurfaceSupported,
  sampleArray,
} from './utils';

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  domain: Domain | undefined;
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  invertColorMap?: boolean;
  title?: string;
  abscissaParams?: AxisParams;
  ordinateParams?: AxisParams;
  valueLabel?: string;
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  keepRatio?: boolean;
  heightScale?: number;
  showAxes?: boolean;
  showGrid?: boolean;
  shading?: boolean;
  ignoreValue?: IgnoreValue;
  maxVertices?: number;
}

function SurfaceVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    domain = DEFAULT_DOMAIN,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    title,
    abscissaParams = {},
    ordinateParams = {},
    valueLabel,
    flipXAxis = false,
    flipYAxis = false,
    keepRatio = true,
    heightScale = 0.5,
    showAxes = true,
    showGrid = true,
    shading = true,
    ignoreValue,
    maxVertices = DEFAULT_MAX_VERTICES,
    children,
    className = '',
    style,
  } = props;

  if (dataArray.shape.length !== 2) {
    throw new Error('Expected two-dimensional array');
  }

  if (!isSurfaceSupported(dataArray.shape)) {
    throw new Error('Expected at least two rows and two columns');
  }

  const { label: abscissaLabel, value: abscissaValue } = abscissaParams;
  const { label: ordinateLabel, value: ordinateValue } = ordinateParams;
  const [rows, cols] = dataArray.shape;

  const xCenters = useMemo(
    () => getCellCenters(abscissaValue, cols),
    [abscissaValue, cols],
  );
  const yCenters = useMemo(
    () => getCellCenters(ordinateValue, rows),
    [ordinateValue, rows],
  );

  const xDomain = useMemo(() => getCoordsDomain(xCenters), [xCenters]);
  const yDomain = useMemo(() => getCoordsDomain(yCenters), [yCenters]);
  const [w, h] = getFootprint(xDomain, yDomain, keepRatio);

  // Downsample large datasets
  const { values, xCoords, yCoords } = useMemo(() => {
    const stride = getDownsamplingStride(rows, cols, maxVertices);
    const rowIndices = getSampledIndices(rows, stride);
    const colIndices = getSampledIndices(cols, stride);

    const xScale = createScale(ScaleType.Linear, {
      domain: xDomain,
      range: flipXAxis ? [w / 2, -w / 2] : [-w / 2, w / 2],
    });
    const yScale = createScale(ScaleType.Linear, {
      domain: yDomain,
      range: flipYAxis ? [h / 2, -h / 2] : [-h / 2, h / 2],
    });

    return {
      values: sampleArray(dataArray, rowIndices, colIndices),
      xCoords: colIndices.map((i) => xScale(xCenters[i])),
      yCoords: rowIndices.map((i) => yScale(yCenters[i])),
    };
  }, [
    dataArray,
    rows,
    cols,
    maxVertices,
    xCenters,
    yCenters,
    xDomain,
    yDomain,
    w,
    h,
    flipXAxis,
    flipYAxis,
  ]);

  const abscissaConfig = useMemo<Axis3DConfig>(
    () => ({
      domain: xDomain,
      isIndexAxis: !abscissaValue,
      label: abscissaLabel,
      flip: flipXAxis,
    }),
    [xDomain, abscissaValue, abscissaLabel, flipXAxis],
  );

  const ordinateConfig = useMemo<Axis3DConfig>(
    () => ({
      domain: yDomain,
      isIndexAxis: !ordinateValue,
      label: ordinateLabel,
      flip: flipYAxis,
    }),
    [yDomain, ordinateValue, ordinateLabel, flipYAxis],
  );

  const valueConfig = useMemo<Axis3DConfig>(
    () => ({ domain, scaleType, label: valueLabel }),
    [domain, scaleType, valueLabel],
  );

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={[w, h, heightScale]}
      domain={domain}
      scaleType={scaleType}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
    >
      <SurfaceMesh
        values={values}
        xCoords={xCoords}
        yCoords={yCoords}
        domain={domain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        ignoreValue={ignoreValue}
        zHeight={heightScale}
        shading={shading}
      />
      {showAxes && (
        <Axes3D
          boxSize={[w, h, heightScale]}
          xConfig={abscissaConfig}
          yConfig={ordinateConfig}
          zConfig={valueConfig}
          showGrid={showGrid}
        />
      )}
      {children}
    </Vis3DLayout>
  );
}

export type { Props as SurfaceVisProps };
export default SurfaceVis;
