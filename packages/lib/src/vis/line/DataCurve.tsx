import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type ThreeEvent } from '@react-three/fiber';
import { type LineMaterialParameters } from 'three/addons/lines/LineMaterial.js';

import Band from './Band';
import ErrorBars from './ErrorBars';
import Glyphs from './Glyphs';
import Line from './Line';
import {
  type BandParams,
  CurveType,
  GlyphType,
  type Interpolation,
} from './models';
import { useEventHandler } from './utils';

interface Props {
  abscissas: NumArray;
  ordinates: NumArray;
  errors?: NumArray;
  showErrors?: boolean;
  color: string;
  curveType?: CurveType;
  width?: number;
  dash?: boolean;
  interpolation?: Interpolation;
  glyphType?: GlyphType;
  glyphSize?: number;
  materialProps?: LineMaterialParameters;
  visible?: boolean;
  onLineClick?: (index: number, event: ThreeEvent<MouseEvent>) => void;
  onLineEnter?: (index: number, event: ThreeEvent<PointerEvent>) => void;
  onLineLeave?: (index: number, event: ThreeEvent<PointerEvent>) => void;
  onDataPointClick?: (index: number, evt: ThreeEvent<MouseEvent>) => void;
  onDataPointEnter?: (index: number, evt: ThreeEvent<PointerEvent>) => void;
  onDataPointLeave?: (index: number, evt: ThreeEvent<PointerEvent>) => void;
  ignoreValue?: IgnoreValue;
  band?: BandParams;
}

function DataCurve(props: Props) {
  const {
    abscissas,
    ordinates,
    errors,
    showErrors = true,
    color,
    width,
    dash,
    interpolation,
    curveType = CurveType.LineOnly,
    glyphType = GlyphType.Circle,
    glyphSize = 7,
    materialProps = {},
    visible = true,
    onLineClick,
    onLineEnter,
    onLineLeave,
    onDataPointClick,
    onDataPointEnter,
    onDataPointLeave,
    ignoreValue,
    band,
  } = props;
  const curveVisible = visible && !band?.only;

  return (
    <>
      {band && (
        <Band
          abscissas={abscissas}
          lower={band.lower}
          upper={band.upper}
          color={color}
          opacity={band.opacity}
          interpolation={interpolation}
          visible={visible}
        />
      )}
      <Line
        abscissas={abscissas}
        ordinates={ordinates}
        color={color}
        width={width}
        dash={dash}
        interpolation={interpolation}
        ignoreValue={ignoreValue}
        materialProps={materialProps}
        visible={curveType !== CurveType.GlyphsOnly && curveVisible}
        onClick={useEventHandler(onLineClick)}
        onPointerEnter={useEventHandler(onLineEnter)}
        onPointerLeave={useEventHandler(onLineLeave)}
      />
      <Glyphs
        abscissas={abscissas}
        ordinates={ordinates}
        glyphType={glyphType}
        color={color}
        size={glyphSize}
        ignoreValue={ignoreValue}
        isolatedOnly={curveType === CurveType.LineOnly} // else invisible without segments
        visible={curveVisible}
        onClick={useEventHandler(onDataPointClick)}
        onPointerEnter={useEventHandler(onDataPointEnter)}
        onPointerLeave={useEventHandler(onDataPointLeave)}
      />
      {errors && (
        <ErrorBars
          abscissas={abscissas}
          ordinates={ordinates}
          errors={errors}
          color={color}
          ignoreValue={ignoreValue}
          visible={curveVisible && showErrors}
        />
      )}
    </>
  );
}

export type { Props as DataCurveProps };
export default DataCurve;
