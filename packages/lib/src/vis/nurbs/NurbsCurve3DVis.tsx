import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import { type ClassStyleAttrs } from '../models';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import {
  getBoxSize,
  getExtentDomain,
  getLinearColorLut,
  getWorldTransform,
} from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import { useGpuDevice } from './hooks';
import { getKnotSpans, type NurbsCurve } from './nurbs';
import NurbsControlNet from './NurbsControlNet';
import NurbsGpuCurve3D from './NurbsGpuCurve3D';

const CONTROL_POLYGON_COLOR = '#d6266e'; // as control nets

interface Props extends ClassStyleAttrs {
  curve: NurbsCurve; // spatial (`dims: 3`), valid (cf. `getNurbsError`)
  title?: ReactNode;
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  colorMap?: ColorMap; // by parameter `u`
  invertColorMap?: boolean;
  width?: number; // line width in CSS pixels
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  showControlPolygon?: boolean; // dashed, with markers at the control points
}

/*
 * NURBS curve in a 3D box with orbit controls, evaluated and drawn with WebGPU (compute shader,
 * finer as the camera gets closer), coloured by `u`. Throws without WebGPU (cf. `useGpuDevice`).
 */
function NurbsCurve3DVis(props: PropsWithChildren<Props>) {
  const {
    curve,
    title,
    xLabel = '𝑥',
    yLabel = '𝑦',
    zLabel = '𝑧',
    colorMap = 'Viridis',
    invertColorMap = false,
    width = 2,
    keepRatio = true,
    showAxes = true,
    showGrid = true,
    showControlPolygon = false,
    children,
    className,
    style,
  } = props;

  const device = useGpuDevice(curve.degree);
  const spans = useMemo(() => getKnotSpans(curve), [curve]);

  // The curve lies within the convex hull of its control points
  const domains = useMemo(
    () =>
      [0, 1, 2].map((d) =>
        getExtentDomain(curve.points.filter((_, i) => i % 3 === d)),
      ) as [Domain, Domain, Domain],
    [curve],
  );
  const [w, h, d] = getBoxSize(domains, keepRatio);

  const worldCurve = useMemo(() => {
    const transform = getWorldTransform(domains, [w, h, d]);
    const { points } = curve;
    const worldPoints = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 3) {
      worldPoints.set(transform(points[i], points[i + 1], points[i + 2]), i);
    }
    return { ...curve, points: worldPoints };
  }, [curve, domains, w, h, d]);

  const uDomain = useMemo<[number, number]>(
    () => [
      curve.knots[curve.degree],
      curve.knots[curve.knots.length - curve.degree - 1],
    ],
    [curve],
  );

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  const [xConfig, yConfig, zConfig] = useMemo<Axis3DConfig[]>(
    () => [
      { domain: domains[0], label: xLabel },
      { domain: domains[1], label: yLabel },
      { domain: domains[2], label: zLabel },
    ],
    [domains, xLabel, yLabel, zLabel],
  );

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={[w, h, d]}
      domain={uDomain}
      scaleType={ScaleType.Linear}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel="𝑢"
      renderer={device && 'webgpu'}
    >
      {device && (
        <NurbsGpuCurve3D
          device={device}
          curve={worldCurve}
          spans={spans}
          colorLut={colorLut}
          uRange={uDomain}
          width={width}
        />
      )}
      {showControlPolygon && (
        <NurbsControlNet
          surface={{
            shape: [curve.weights.length, 1],
            points: worldCurve.points,
          }}
          color={CONTROL_POLYGON_COLOR}
        />
      )}
      {showAxes && (
        <Axes3D
          boxSize={[w, h, d]}
          xConfig={xConfig}
          yConfig={yConfig}
          zConfig={zConfig}
          showGrid={showGrid}
        />
      )}
      {children}
    </Vis3DLayout>
  );
}

export type { Props as NurbsCurve3DVisProps };
export default NurbsCurve3DVis;
