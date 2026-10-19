import {
  type Domain,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import ndarray, { type NdArray } from 'ndarray';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import HeatmapVis from '../heatmap/HeatmapVis';
import styles from '../heatmap/HeatmapVis.module.css';
import { type ColorMap } from '../heatmap/models';
import {
  type Aspect,
  type AxisParams,
  type ClassStyleAttrs,
  type VisScaleType,
} from '../models';
import ArrowGlyphs from './ArrowGlyphs';
import {
  getMagnitude,
  getReferenceMagnitude,
  sampleField,
  type VectorField2D,
} from './field';
import LicMesh from './LicMesh';
import { DEFAULT_ARROW_DENSITY, VectorStyle } from './models';
import Streamlines from './Streamlines';

interface Props extends ClassStyleAttrs {
  field: VectorField2D;
  /* Scalar drawn below (e.g. magnitude, vorticity), on the field's grid; none: the magnitude
   * colours the arrows instead */
  background?: NdArray<NumArray>;
  domain: Domain; // of the background, else of the magnitude
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  invertColorMap?: boolean;
  colorBarLabel?: ReactNode;
  backgroundLabel?: string; // in the tooltip
  vectorStyle?: VectorStyle;
  arrowDensity?: number; // arrows per 100 CSS pixels (streamlines: about twice as dense)
  arrowScale?: number; // arrow length relative to the spacing, for the reference magnitude
  uniformArrows?: boolean; // arrows of the same length (direction only; magnitude by colour)
  title?: ReactNode;
  abscissaParams?: Omit<AxisParams, 'value'>;
  ordinateParams?: Omit<AxisParams, 'value'>;
  aspect?: Aspect;
  showGrid?: boolean;
}

const ALPHA_DOMAIN: Domain = [0, 1];
const LINE_COLOR = 'white';
const HALO_COLOR = 'black';
const PLAIN_LINE_COLOR = '#777'; // streamlines without background, readable on both themes

/*
 * 2D vector field on a (possibly non-uniform) grid: a heatmap of a scalar (axes, zoom, colour
 * bar), with arrows, streamlines or a line integral convolution on top. Arrows are scaled so that
 * a high percentile of the magnitude is `arrowScale` times their spacing, and capped at twice
 * that (e.g. near singularities); or all of the same length.
 */
function VectorVis(props: PropsWithChildren<Props>) {
  const {
    field,
    background,
    domain,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    colorBarLabel,
    backgroundLabel,
    vectorStyle = VectorStyle.Arrows,
    arrowDensity = DEFAULT_ARROW_DENSITY,
    arrowScale = 1,
    uniformArrows = false,
    title,
    abscissaParams,
    ordinateParams,
    aspect = 'equal',
    showGrid = false,
    children,
    className,
    style,
  } = props;

  const { xs, ys, u, v } = field;
  const shape = [ys.length, xs.length];
  const magnitude = useMemo(() => getMagnitude(u, v), [u, v]);
  const refMagnitude = useMemo(
    () => getReferenceMagnitude(magnitude),
    [magnitude],
  );

  // Without background, the magnitude colours the arrows (and the colour bar) only
  const dataArray = useMemo(
    () => background ?? ndarray(magnitude, shape),
    [background, magnitude, shape[0], shape[1]], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const alpha = useMemo(
    () =>
      background
        ? undefined
        : {
            array: ndarray(new Float32Array(magnitude.length), shape),
            domain: ALPHA_DOMAIN,
          },
    [background, magnitude, shape[0], shape[1]], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const arrowColor = useMemo(
    () => (background ? LINE_COLOR : { colorMap, invertColorMap, domain }),
    [background, colorMap, invertColorMap, domain],
  );

  const spacing = 100 / arrowDensity;
  const halo = background ? HALO_COLOR : undefined;

  return (
    <HeatmapVis
      className={className}
      style={style}
      dataArray={dataArray}
      domain={domain}
      colorMap={colorMap}
      scaleType={scaleType}
      invertColorMap={invertColorMap}
      alpha={alpha}
      title={title}
      colorBarLabel={colorBarLabel}
      aspect={aspect}
      showGrid={showGrid}
      abscissaParams={{ ...abscissaParams, value: xs }}
      ordinateParams={{ ...ordinateParams, value: ys }}
      renderTooltip={({ x, y, xi, yi }) => {
        const [fu, fv] = sampleField(field, x, y);
        return (
          <>
            {`${abscissaParams?.label ?? 'x'}=${formatTooltipVal(x)}, `}
            {`${ordinateParams?.label ?? 'y'}=${formatTooltipVal(y)}`}
            <div className={styles.tooltipValue}>
              <strong>
                {`(${formatTooltipVal(fu)}, ${formatTooltipVal(fv)})`}
              </strong>
              {` |v| = ${formatTooltipVal(Math.hypot(fu, fv))}`}
            </div>
            {background && backgroundLabel && (
              <div>{`${backgroundLabel} = ${formatTooltipVal(background.get(yi, xi))}`}</div>
            )}
          </>
        );
      }}
    >
      {vectorStyle === VectorStyle.Arrows && (
        <ArrowGlyphs
          field={field}
          spacing={spacing}
          pxPerUnit={(spacing * arrowScale) / refMagnitude}
          maxLength={2 * spacing * arrowScale}
          uniformLength={uniformArrows ? 0.8 * spacing * arrowScale : 0}
          color={arrowColor}
          halo={halo}
        />
      )}
      {vectorStyle === VectorStyle.Streamlines && (
        <Streamlines
          field={field}
          separation={spacing * 0.6}
          color={background ? LINE_COLOR : PLAIN_LINE_COLOR}
          halo={halo}
        />
      )}
      {vectorStyle === VectorStyle.Lic && (
        <LicMesh field={field} multiply={!!background} />
      )}
      {children}
    </HeatmapVis>
  );
}

export type { Props as VectorVisProps };
export default VectorVis;
