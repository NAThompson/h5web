import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { extend, type ThreeElement } from '@react-three/fiber';
import { useMemo } from 'react';
import { Line2 as ThreeLine2 } from 'three/addons/lines/Line2.js';
import {
  LineMaterial as ThreeLineMaterial,
  type LineMaterialParameters,
} from 'three/addons/lines/LineMaterial.js';

import { useUpdateGeometry } from '../hooks';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { hasR3FEventHandlers } from '../utils';
import LineConstantGeometry from './lineConstantGeometry';
import { DASH_SIZE, GAP_SIZE, useDashDistances } from './lineDash';
import LineGeometry from './lineGeometry';
import LinePchipGeometry, {
  pchipOnBeforeCompile,
  pchipOnBeforeRender,
  splineOnBeforeCompile,
} from './linePchipGeometry';
import LineSplineGeometry from './lineSplineGeometry';
import { Interpolation } from './models';

const Line2 = extend(ThreeLine2);
const LineMaterial = extend(ThreeLineMaterial);

interface Props extends ThreeElement<typeof ThreeLine2> {
  abscissas: NumArray;
  ordinates: NumArray;
  color: string;
  width?: number;
  dash?: boolean;
  interpolation?: Interpolation;
  materialProps?: LineMaterialParameters;
  visible?: boolean;
  ignoreValue?: IgnoreValue;
}

function Line(props: Props) {
  const {
    abscissas,
    ordinates,
    color,
    interpolation,
    width = 1,
    dash = false,
    materialProps = {},
    visible = true,
    ignoreValue,
    ...lineProps
  } = props;

  const { abscissaScale, ordinateScale } = useVisCanvasContext();

  const isPchip =
    interpolation === Interpolation.Pchip ||
    interpolation === Interpolation.Spline; // both cubic Hermite
  const Geometry =
    interpolation === Interpolation.Constant
      ? LineConstantGeometry
      : interpolation === Interpolation.Spline
        ? LineSplineGeometry
        : isPchip
          ? LinePchipGeometry
          : LineGeometry;

  const geometry = useMemo(
    () =>
      new Geometry({
        abscissas,
        ordinates,
        abscissaScale,
        ordinateScale,
        ignoreValue,
      }),
    [Geometry, abscissaScale, abscissas, ignoreValue, ordinateScale, ordinates],
  );

  useUpdateGeometry(geometry, {
    skipUpdates: !visible,
    isInteractive: hasR3FEventHandlers(lineProps),
  });
  useDashDistances(geometry, dash && visible);

  return (
    <Line2 geometry={geometry} visible={visible} {...lineProps}>
      <LineMaterial
        key={interpolation} // recompile shader when switching to/from PCHIP or spline
        color={color}
        linewidth={width}
        dashed={dash}
        dashSize={DASH_SIZE}
        gapSize={GAP_SIZE}
        onBeforeCompile={
          interpolation === Interpolation.Spline
            ? splineOnBeforeCompile
            : isPchip
              ? pchipOnBeforeCompile
              : undefined
        }
        onBeforeRender={isPchip ? pchipOnBeforeRender : undefined}
        {...materialProps}
      />
    </Line2>
  );
}

export type { Props as LineProps };
export default Line;
