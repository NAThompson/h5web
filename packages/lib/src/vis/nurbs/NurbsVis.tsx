import { type Domain } from '@h5web/shared/vis-models';
import { getBounds } from '@h5web/shared/vis-utils';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import DefaultInteractions, {
  type DefaultInteractionsConfig,
} from '../../interactions/DefaultInteractions';
import ResetZoomButton from '../../toolbar/floating/ResetZoomButton';
import { useCssColors } from '../hooks';
import DataCurve from '../line/DataCurve';
import styles from '../line/LineVis.module.css';
import { CurveType } from '../line/models';
import { type Aspect, type ClassStyleAttrs } from '../models';
import VisCanvas from '../shared/VisCanvas';
import { extendDomain, getTextContent } from '../utils';
import { useGpuDevice } from './hooks';
import { getKnotSpans, type NurbsCurve } from './nurbs';
import NurbsCpuLine from './NurbsCpuLine';
import NurbsGpuLine from './NurbsGpuLine';
import { MAX_GPU_DEGREE } from './webgpu';

interface Props extends ClassStyleAttrs {
  curve: NurbsCurve; // planar (`dims: 2`), valid (cf. `getNurbsError`)
  title?: ReactNode;
  abscissaLabel?: string;
  ordinateLabel?: string;
  color?: string; // default: `--h5w-line--color`
  width?: number; // line width in CSS pixels
  aspect?: Aspect;
  showGrid?: boolean;
  showControlPolygon?: boolean; // dashed, with markers at the control points
  interactions?: DefaultInteractionsConfig;
}

/*
 * NURBS curve on 2D axes, evaluated with WebGPU (compute shader) if available, else on the CPU
 * and drawn with WebGL. The WebGPU canvas lies over the WebGL one and follows its camera.
 */
function NurbsVis(props: PropsWithChildren<Props>) {
  const {
    curve,
    title,
    abscissaLabel,
    ordinateLabel,
    color,
    width = 2,
    aspect = 'equal',
    showGrid = true,
    showControlPolygon = false,
    interactions,
    children,
    className = '',
    style,
  } = props;

  const device = useGpuDevice(curve.degree <= MAX_GPU_DEGREE);

  // The curve lies within the convex hull of its control points
  const [xs, ys] = useMemo(
    () =>
      [0, 1].map((d) =>
        Float64Array.from(
          { length: curve.points.length / 2 },
          (_, i) => curve.points[i * 2 + d],
        ),
      ),
    [curve],
  );
  const [xDomain, yDomain] = useMemo(
    () => [xs, ys].map((arr) => getExtent(arr)),
    [xs, ys],
  );
  const origin = useMemo<[number, number]>(
    () => [(xDomain[0] + xDomain[1]) / 2, (yDomain[0] + yDomain[1]) / 2],
    [xDomain, yDomain],
  );

  const [[cssCurveColor, auxColors], rootRef] = useCssColors([
    '--curve-color',
    '--aux-colors',
  ]);
  const spans = useMemo(() => getKnotSpans(curve), [curve]);
  const lineProps = { curve, spans, color: color ?? cssCurveColor, width };

  return (
    <figure
      ref={rootRef}
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
      data-renderer={
        device === undefined ? undefined : device ? 'webgpu' : 'webgl'
      }
    >
      <VisCanvas
        title={title}
        aspect={aspect}
        abscissaConfig={{
          visDomain: extendDomain(xDomain, 0.05),
          showGrid,
          label: abscissaLabel,
        }}
        ordinateConfig={{
          visDomain: extendDomain(yDomain, 0.05),
          showGrid,
          label: ordinateLabel,
        }}
      >
        <DefaultInteractions {...interactions} />
        <ResetZoomButton />

        {showControlPolygon && (
          <DataCurve
            abscissas={xs}
            ordinates={ys}
            color={auxColors.split(',')[0].trim()}
            curveType={CurveType.LineAndGlyphs}
            dash
          />
        )}

        {device ? (
          <NurbsGpuLine device={device} origin={origin} {...lineProps} />
        ) : (
          device === null && <NurbsCpuLine {...lineProps} />
        )}

        {children}
      </VisCanvas>
    </figure>
  );
}

/* Smallest domain of the values, widened if empty */
function getExtent(values: Float64Array): Domain {
  const { min, max } = getBounds(values) ?? { min: 0, max: 0 };
  return min < max ? [min, max] : [min - 1, max + 1];
}

export type { Props as NurbsVisProps };
export default NurbsVis;
