import { assertDefined } from '@h5web/shared/guards';
import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { type RGBColor } from 'd3-color';
import { type NdArray } from 'ndarray';
import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  NearestFilter,
} from 'three';

import DefaultInteractions, {
  type DefaultInteractionsConfig,
} from '../../interactions/DefaultInteractions';
import ResetZoomButton from '../../toolbar/floating/ResetZoomButton';
import CategoryLegend from '../categorical/CategoryLegend';
import { type CategoryArray, useCategoryArray } from '../categorical/hooks';
import { type Category } from '../categorical/models';
import { findCategory } from '../categorical/utils';
import { useAxisDomain, useValueToIndexScale } from '../hooks';
import {
  type Aspect,
  type AxisParams,
  type ClassStyleAttrs,
  type ValueTransform,
  type VisScaleType,
} from '../models';
import TooltipMesh from '../shared/TooltipMesh';
import VisCanvas from '../shared/VisCanvas';
import {
  DEFAULT_DOMAIN,
  getIndexLabels,
  getRealValue,
  getTextContent,
  isIntegerAxis,
} from '../utils';
import ColorBar from './ColorBar';
import HeatmapMesh, { type HeatmapMeshProps } from './HeatmapMesh';
import styles from './HeatmapVis.module.css';
import { useHeatmapAxis, useMask, useTextureSafeNdArray } from './hooks';
import { type ColorMap, type TooltipData } from './models';
import { getAxisType } from './utils';

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  domain: Domain | undefined;
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  aspect?: Aspect;
  showGrid?: boolean;
  title?: ReactNode;
  colorBarLabel?: ReactNode;
  dtype?: string;
  invertColorMap?: boolean;
  abscissaParams?: AxisParams;
  ordinateParams?: AxisParams;
  alpha?: {
    array: NdArray<NumArray>;
    domain: Domain;
    log?: boolean;
    gamma?: number; // exponent of the normalized brightness
  };
  magFilter?: MagnificationTextureFilter;
  minFilter?: MinificationTextureFilter;
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  renderTooltip?: (data: TooltipData) => ReactElement;
  interactions?: DefaultInteractionsConfig;
  ignoreValue?: IgnoreValue;
  ignoredColor?: RGBColor | string;
  belowColor?: string; // CSS colour of values below the domain (default: colour of its lower end)
  aboveColor?: string;
  valueTransform?: ValueTransform; // values are logarithms: shown as powers in the colour bar
  showColorBar?: boolean; // e.g. not on panels that share one
  /* Integer labels / classes: a discrete color per category (nearest sampling) and a legend
   * instead of the color bar; other values are drawn as ignored */
  categories?: Category[];
}

/* Values and coloring of the mesh: indices of categories looked up in their colors, without
 * interpolation, else values as given */
function getMeshColoring(
  dataArray: NdArray<NumArray>,
  categorical: CategoryArray | undefined,
  props: Pick<
    HeatmapMeshProps,
    | 'domain'
    | 'scaleType'
    | 'magFilter'
    | 'minFilter'
    | 'belowColor'
    | 'aboveColor'
  >,
): {
  values: NdArray<NumArray>;
  colorProps: Partial<HeatmapMeshProps> &
    Pick<HeatmapMeshProps, 'domain' | 'scaleType'>;
} {
  if (!categorical) {
    return { values: dataArray, colorProps: props };
  }
  return {
    values: categorical.indices,
    colorProps: {
      domain: categorical.domain,
      scaleType: categorical.scaleType,
      magFilter: NearestFilter,
      minFilter: NearestFilter,
      categoryColors: categorical.colors,
    },
  };
}

function HeatmapVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    domain = DEFAULT_DOMAIN,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    aspect = 'equal',
    showGrid = false,
    invertColorMap = false,
    title,
    colorBarLabel,
    dtype,
    abscissaParams = {},
    ordinateParams = {},
    alpha,
    magFilter,
    minFilter,
    flipXAxis,
    flipYAxis,
    renderTooltip,
    children,
    interactions,
    ignoreValue,
    ignoredColor,
    belowColor,
    aboveColor,
    valueTransform,
    showColorBar = true,
    categories,
    className = '',
    style,
  } = props;
  const {
    label: abscissaLabel,
    value: abscissaValue,
    ticks: abscissaTicks,
  } = abscissaParams;
  const {
    label: ordinateLabel,
    value: ordinateValue,
    ticks: ordinateTicks,
  } = ordinateParams;
  const abscissaTickLabels = getIndexLabels(abscissaParams);
  const ordinateTickLabels = getIndexLabels(ordinateParams);
  const [rows, cols] = dataArray.shape;

  // Log and symlog axes are non-uniform axes in the scale's space (cf. `getHeatmapAxis`)
  const xAxis = useHeatmapAxis(abscissaValue, cols, abscissaParams);
  const yAxis = useHeatmapAxis(ordinateValue, rows, ordinateParams);

  const abscissas = xAxis.edges;
  const abscissaDomain = useAxisDomain(abscissas);
  assertDefined(abscissaDomain, 'Abscissas have undefined domain');

  const ordinates = yAxis.edges;
  const ordinateDomain = useAxisDomain(ordinates);
  assertDefined(ordinateDomain, 'Ordinates have undefined domain');

  const abscissaToIndex = useValueToIndexScale(abscissas);
  const ordinateToIndex = useValueToIndexScale(ordinates);

  // Non-uniform pixels: mesh remapped to the edges; pixel values (if given) are pixel centres
  const xCentres = xAxis.centres;
  const yCentres = yAxis.centres;

  // Categories: indices of the values, looked up in a texture of their colors (not interpolated)
  const categorical = useCategoryArray(dataArray, categories);
  const { values, colorProps } = getMeshColoring(dataArray, categorical, {
    domain,
    scaleType,
    magFilter,
    minFilter,
    belowColor,
    aboveColor,
  });

  const safeDataArray = useTextureSafeNdArray(values);
  const safeAlphaArray = useTextureSafeNdArray(alpha?.array);
  const maskArray = useMask(dataArray, ignoreValue);

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
    >
      <VisCanvas
        title={title}
        aspect={aspect}
        abscissaConfig={{
          visDomain: abscissaDomain,
          showGrid,
          scaleType: xAxis.scaleType,
          isIndexAxis: isIntegerAxis(abscissaValue, getAxisType(xAxis)),
          label: abscissaLabel,
          flip: flipXAxis,
          ticks: abscissaTicks,
          tickLabels: abscissaTickLabels,
          tickLabelsOffset: 0.5, // pixel `i` spans `[i, i + 1]`
        }}
        ordinateConfig={{
          visDomain: ordinateDomain,
          showGrid,
          scaleType: yAxis.scaleType,
          isIndexAxis: isIntegerAxis(ordinateValue, getAxisType(yAxis)),
          label: ordinateLabel,
          flip: flipYAxis,
          ticks: ordinateTicks,
          tickLabels: ordinateTickLabels,
          tickLabelsOffset: 0.5,
        }}
      >
        <DefaultInteractions {...interactions} />
        <ResetZoomButton />

        <TooltipMesh
          guides="both"
          renderTooltip={(x, y) => {
            const xi = abscissaToIndex(x);
            const yi = ordinateToIndex(y);
            const abscissa = (xCentres ?? abscissas)[xi];
            const ordinate = (yCentres ?? ordinates)[yi];

            if (renderTooltip) {
              return renderTooltip({ abscissa, ordinate, xi, yi, x, y });
            }
            const category = findCategory(categories, dataArray.get(yi, xi));

            return (
              <>
                {`${abscissaLabel ?? 'x'}=${abscissaTickLabels?.[xi] ?? formatTooltipVal(abscissa)}, `}
                {`${ordinateLabel ?? 'y'}=${ordinateTickLabels?.[yi] ?? formatTooltipVal(ordinate)}`}
                <div className={styles.tooltipValue}>
                  <strong>
                    {formatTooltipVal(
                      valueTransform
                        ? getRealValue(dataArray.get(yi, xi), valueTransform)
                        : dataArray.get(yi, xi),
                    )}
                  </strong>
                  {dtype && <em>{` (${dtype})`}</em>}
                  {category?.label && ` ${category.label}`}
                  {alpha && ` (${formatTooltipVal(alpha.array.get(yi, xi))})`}
                </div>
              </>
            );
          }}
        />

        <HeatmapMesh
          values={safeDataArray}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
          {...colorProps}
          alphaValues={safeAlphaArray}
          alphaDomain={alpha?.domain}
          alphaLog={alpha?.log}
          alphaGamma={alpha?.gamma}
          scale={[flipXAxis ? -1 : 1, flipYAxis ? -1 : 1, 1]}
          mask={maskArray}
          badColor={ignoredColor}
          xEdges={xAxis.meshEdges}
          yEdges={yAxis.meshEdges}
          xCentres={xAxis.meshCentres}
          yCentres={yAxis.meshCentres}
        />

        {children}
      </VisCanvas>

      {showColorBar &&
        (categories ? (
          <CategoryLegend categories={categories} label={colorBarLabel} />
        ) : (
          <ColorBar
            domain={domain}
            scaleType={scaleType}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            withBounds
            label={colorBarLabel}
            belowColor={belowColor}
            aboveColor={aboveColor}
            valueTransform={valueTransform}
          />
        ))}
    </figure>
  );
}

export type { Props as HeatmapVisProps };
export default HeatmapVis;
