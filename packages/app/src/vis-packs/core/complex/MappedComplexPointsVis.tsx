import {
  DefaultInteractions,
  PALETTES,
  ResetZoomButton,
  VisCanvas,
} from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type ComplexType,
  type Dataset,
} from '@h5web/shared/hdf5-models';
import { ScaleType } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  getOverlayLegend,
  type LegendItem,
  useOverlayShapes,
  useResolvedOverlays,
} from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { type ViewHint } from '../../view-hints/models';
import OverlayLayer2D, {
  type ColorParams,
} from '../../view-hints/OverlayLayer2D';
import OverlayLegend from '../../view-hints/OverlayLegend';
import OverlayNotes from '../../view-hints/OverlayNotes';
import {
  buildOverlayShapes,
  isReference,
  type OverlayPoints,
  type ShapeBuilder,
} from '../../view-hints/overlays';
import ReferenceLayer from '../../view-hints/ReferenceLayer';
import {
  buildReferenceShapes,
  type ReferenceShape,
} from '../../view-hints/references';
import styles from '../../view-hints/ViewHints.module.css';
import { useSuggestions } from '../hooks';
import { type ScatterConfig } from '../scatter/config';
import PointsToolbar from '../scatter/PointsToolbar';
import { useRealImag } from './hooks';
import {
  getPlaneDomains,
  MERGE_TOLERANCE,
  mergeCoincidentPoints,
  withPlaneStyle,
} from './points';
import PointsTooltip from './PointsTooltip';

const PALETTE = PALETTES.Tableau10;
const POINT_SIZE = 5; // px, radius
const AXES = { x: 0, y: -1 }; // overlay columns 0 and 1 (cf. `getColumnOf` on a 1D base)
const COLOR_PARAMS: ColorParams = {
  domain: [0, 1],
  scaleType: ScaleType.Linear,
  colorMap: 'Viridis',
  invertColorMap: false,
};

interface PlaneShapes {
  shapes: ReturnType<typeof buildOverlayShapes>;
  references: ReferenceShape[];
}

function buildPlaneShapes(
  ...args: Parameters<ShapeBuilder<PlaneShapes>>
): PlaneShapes {
  return {
    shapes: buildOverlayShapes(...args),
    references: buildReferenceShapes(...args),
  };
}

/* Overlays on the complex plane, reference lines included (e.g. the imaginary axis of an
 * s-plane), with their legend and notes */
function usePlaneOverlays(base: Dataset<ArrayShape>, hint: ViewHint) {
  const resolved = useResolvedOverlays(base, hint);
  const styled = useMemo(
    () =>
      resolved && {
        ...resolved,
        overlays: withPlaneStyle(resolved.overlays, PALETTE),
      },
    [resolved],
  );
  const { shapes, notes } = useOverlayShapes(
    styled,
    undefined,
    AXES,
    buildPlaneShapes,
  );
  return {
    shapes,
    notes: [...new Set([...hint.notes, ...notes])],
    legend: getOverlayLegend(hint, styled?.overlays ?? [], true),
    hasReferences: styled?.overlays.some(({ hint: o }) => isReference(o)),
  };
}

interface Props {
  dataset: Dataset<ArrayShape, ComplexType>;
  value: ArrayValue<ComplexType>;
  hint: ViewHint;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: ScatterConfig;
}

/**
 * Complex values as points of the complex plane: x = real part, y = imaginary part, e.g. poles of
 * a transfer function, with zeros and the unit circle as overlays. Coincident points are drawn
 * once, labelled by their multiplicity.
 */
function MappedComplexPointsVis(props: Props) {
  const { dataset, value, hint, title, toolbarContainer } = props;
  const { config: storedConfig } = props;
  const config = useSuggestions(storedConfig, {
    keepRatio: hint.keepRatio ?? true,
  });
  const { keepRatio, showGrid, sizeScale } = config;

  const { real, imag } = useRealImag(value);
  const overlays = usePlaneOverlays(dataset, hint);
  const { shapes, references = [] } = overlays.shapes ?? {};

  const basePoints = useMemo<OverlayPoints>(
    () => ({
      x: [...real],
      y: [...imag],
      marker: hint.marker,
      fill: hint.curveColor ?? PALETTE[0],
      size: hint.markerSize ?? POINT_SIZE,
      halo: false,
      label: hint.curveLabel ?? dataset.name,
    }),
    [real, imag, hint, dataset.name],
  );

  const { xDomain, yDomain, extent } = useMemo(
    () =>
      getPlaneDomains(
        [basePoints, ...(shapes?.points ?? [])],
        shapes?.lines ?? [],
        references,
      ),
    [basePoints, shapes, references],
  );

  const drawn = useMemo(() => {
    const points = [basePoints, ...(shapes?.points ?? [])].map((pts) => ({
      ...mergeCoincidentPoints(pts, MERGE_TOLERANCE * extent),
      size: pts.size * sizeScale,
    }));
    return {
      points,
      lines: shapes?.lines ?? [],
      texts: shapes?.texts ?? [],
    };
  }, [basePoints, shapes, extent, sizeScale]);

  const baseLegend: LegendItem[] =
    hint.legend === false || !hint.curveLabel
      ? []
      : [
          {
            label: hint.curveLabel,
            color: basePoints.fill,
            kind: 'points',
            dash: false,
            marker: hint.marker,
          },
        ];

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <PointsToolbar
            dataDomain={undefined}
            config={config}
            is3D={false}
            isPlane
          />,
          toolbarContainer,
        )}

      <figure
        className={`${visualizerStyles.vis} ${styles.plane}`}
        aria-label={title}
      >
        <VisCanvas
          title={renderMarkup(title)}
          aspect={keepRatio ? 'equal' : 'auto'}
          abscissaConfig={{ visDomain: xDomain, showGrid, label: 'ℜ' }}
          ordinateConfig={{ visDomain: yDomain, showGrid, label: 'ℑ' }}
        >
          <DefaultInteractions />
          <ResetZoomButton />
          <PointsTooltip points={drawn.points} />
          {overlays.hasReferences && <ReferenceLayer shapes={references} />}
          <OverlayLayer2D shapes={drawn} colorParams={COLOR_PARAMS} />
        </VisCanvas>
      </figure>
      <OverlayNotes notes={overlays.notes} />
      <OverlayLegend items={[...baseLegend, ...overlays.legend]} />
    </>
  );
}

export default MappedComplexPointsVis;
