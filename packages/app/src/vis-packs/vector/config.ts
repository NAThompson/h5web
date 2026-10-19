import {
  type Axis3D,
  type ColorMap,
  type CustomDomain,
  DEFAULT_ARROW_DENSITY,
  VectorBackground,
  VectorStyle,
} from '@h5web/lib';
import { type ColorScaleType, ScaleType } from '@h5web/shared/vis-models';
import { useState } from 'react';

import { type ViewHint } from '../view-hints/models';
import { type VectorHint } from './utils';

/* Settings of the vector vis, initialized from the file's hints; kept while slicing */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function useVectorConfig(hint: ViewHint, vectorHint: VectorHint) {
  const [style, setStyle] = useState(vectorHint.style ?? VectorStyle.Arrows);
  const [background, setBackgroundState] = useState(
    vectorHint.background ?? VectorBackground.Magnitude,
  );
  const [colorMap, setColorMap] = useState<ColorMap | undefined>(
    hint.colorMap === 'auto' ? undefined : hint.colorMap,
  );
  const [invertColorMap, setInvertColorMap] = useState(hint.invertColorMap);
  const [scaleType, setScaleType] = useState<ColorScaleType>(
    hint.scaleType ?? ScaleType.Linear,
  );
  const [customDomain, setCustomDomain] = useState<CustomDomain>(
    Array.isArray(hint.domain) ? hint.domain : [null, null],
  );
  const [arrowScale, setArrowScale] = useState(1);
  const [arrowDensity, setArrowDensity] = useState(
    vectorHint.arrowDensity ?? DEFAULT_ARROW_DENSITY,
  );
  const [keepRatio, setKeepRatio] = useState<boolean | undefined>(
    hint.keepRatio,
  );
  const [uniformArrows, setUniformArrows] = useState(
    vectorHint.uniformArrows ?? false,
  );
  const [showGrid, setShowGrid] = useState(false);
  const [showAxes, setShowAxes] = useState(true);
  const [plane, setPlane] = useState<Axis3D | undefined>();
  const [planeIndex, setPlaneIndex] = useState(0);

  return {
    style,
    setStyle,
    background,
    // Another quantity: automatic domain again
    setBackground: (value: VectorBackground) => {
      setBackgroundState(value);
      setCustomDomain([null, null]);
    },
    colorMap,
    setColorMap,
    invertColorMap,
    setInvertColorMap,
    scaleType,
    setScaleType,
    customDomain,
    setCustomDomain,
    arrowScale,
    setArrowScale,
    arrowDensity,
    setArrowDensity,
    keepRatio,
    setKeepRatio,
    uniformArrows,
    setUniformArrows,
    showGrid,
    setShowGrid,
    showAxes,
    setShowAxes,
    plane,
    setPlane,
    planeIndex,
    setPlaneIndex,
  };
}

export type VectorConfig = ReturnType<typeof useVectorConfig>;
