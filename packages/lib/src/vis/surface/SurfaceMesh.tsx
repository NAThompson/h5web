import {
  type Domain,
  type IgnoreValue,
  type NumArray,
} from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { type NdArray } from 'ndarray';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';

import { type ColorMap } from '../heatmap/models';
import { type VisScaleType } from '../models';
import {
  getColorParams,
  getLinearColorLut,
  getVertexColors,
} from '../three-d/utils';
import { buildSurfaceBuffers, flattenArray, getSurfaceColors } from './utils';

interface Props {
  values: NdArray<NumArray>;
  xCoords: number[];
  yCoords: number[];
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  ignoreValue?: IgnoreValue;
  zHeight: number;
  shading: boolean;
  /* Colour vertices by another field than height (same shape as `values`), e.g. phase of complex values */
  colorField?: {
    values: NdArray<NumArray>;
    domain: Domain;
    scaleType: VisScaleType;
  };
}

function SurfaceMesh(props: Props) {
  const {
    values,
    xCoords,
    yCoords,
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    ignoreValue,
    zHeight,
    shading,
    colorField,
  } = props;

  const invalidate = useThree((state) => state.invalidate);

  const colorLut = useMemo(
    () => getLinearColorLut(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  // Rebuild geometry (positions, triangles, normals) only when data, scale or domain change
  const geometry = useMemo(() => {
    const { positions, index } = buildSurfaceBuffers({
      values,
      xCoords,
      yCoords,
      domain,
      scaleType,
      ignoreValue,
    });

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(new BufferAttribute(index, 1));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    return geom;
  }, [values, xCoords, yCoords, domain, scaleType, ignoreValue]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // Update colours alone when colour map changes (before next frame is rendered)
  useLayoutEffect(() => {
    const positions = geometry.getAttribute('position').array as Float32Array;
    const colors = colorField
      ? getVertexColors(
          getColorParams(
            flattenArray(colorField.values),
            colorField.domain,
            colorField.scaleType,
          ),
          colorLut,
        )
      : getSurfaceColors(positions, colorLut);

    if (geometry.hasAttribute('color')) {
      const attr = geometry.getAttribute('color') as BufferAttribute;
      (attr.array as Float32Array).set(colors); // reuse GPU buffer
      attr.needsUpdate = true;
    } else {
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
    }

    invalidate();
  }, [geometry, colorLut, colorField, invalidate]);

  // Geometry height is normalized; stretching the mesh keeps normals correct (via normal matrix)
  return (
    <mesh geometry={geometry} scale={[1, 1, zHeight]}>
      {shading ? (
        <meshLambertMaterial key="lit" vertexColors side={DoubleSide} />
      ) : (
        <meshBasicMaterial key="unlit" vertexColors side={DoubleSide} />
      )}
    </mesh>
  );
}

export default SurfaceMesh;
