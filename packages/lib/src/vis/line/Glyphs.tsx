import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type ThreeElements } from '@react-three/fiber';
import { useMemo } from 'react';

import { useUpdateGeometry } from '../hooks';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { hasR3FEventHandlers } from '../utils';
import GlyphMaterial from './GlyphMaterial';
import GlyphsGeometry from './glyphsGeometry';
import { GlyphType } from './models';

interface Props {
  abscissas: NumArray;
  ordinates: NumArray;
  glyphType?: GlyphType;
  color: string;
  size?: number;
  visible?: boolean;
  ignoreValue?: IgnoreValue;
  isolatedOnly?: boolean; // only points without valid neighbours (e.g. alongside a line)
}

function Glyphs(props: Props & ThreeElements['points']) {
  const {
    abscissas,
    ordinates,
    glyphType = GlyphType.Cross,
    color,
    size = 6,
    visible = true,
    ignoreValue,
    isolatedOnly,
    ...pointsProps
  } = props;

  const { abscissaScale, ordinateScale } = useVisCanvasContext();

  const geometry = useMemo(
    () =>
      new GlyphsGeometry({
        abscissas,
        ordinates,
        abscissaScale,
        ordinateScale,
        ignoreValue,
        isolatedOnly,
      }),
    [
      abscissaScale,
      abscissas,
      ignoreValue,
      isolatedOnly,
      ordinateScale,
      ordinates,
    ],
  );

  useUpdateGeometry(geometry, {
    skipUpdates: !visible,
    isInteractive: hasR3FEventHandlers(pointsProps),
  });

  return (
    <points geometry={geometry} visible={visible} {...pointsProps}>
      <GlyphMaterial glyphType={glyphType} color={color} size={size} />
    </points>
  );
}

export type { Props as GlyphsProps };
export default Glyphs;
