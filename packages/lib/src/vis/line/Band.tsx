import { type NumArray } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import {
  CustomBlending,
  DoubleSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
} from 'three';

import { useUpdateGeometry } from '../hooks';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import BandGeometry from './bandGeometry';
import { type Interpolation } from './models';

interface Props {
  abscissas: NumArray;
  lower: NumArray;
  upper: NumArray;
  color: string;
  opacity?: number;
  interpolation?: Interpolation;
  visible?: boolean;
}

/* Filled area between two curves (e.g. spread of runs), beneath the lines */
function Band(props: Props) {
  const {
    abscissas,
    lower,
    upper,
    color,
    opacity = 0.25,
    interpolation,
    visible = true,
  } = props;
  const { abscissaScale, ordinateScale } = useVisCanvasContext();

  const geometry = useMemo(
    () =>
      new BandGeometry({
        abscissas,
        lower,
        upper,
        abscissaScale,
        ordinateScale,
        interpolation,
      }),
    [abscissas, lower, upper, abscissaScale, ordinateScale, interpolation],
  );
  useUpdateGeometry(geometry, { skipUpdates: !visible });

  // Blended, yet drawn with opaque objects, before the lines: beneath all of them
  return (
    <group renderOrder={-1}>
      <mesh geometry={geometry} visible={visible}>
        <meshBasicMaterial
          color={color}
          opacity={opacity}
          blending={CustomBlending} // as `NormalBlending`, though not `transparent`
          blendSrcAlpha={OneFactor}
          blendDstAlpha={OneMinusSrcAlphaFactor}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export type { Props as BandProps };
export default Band;
