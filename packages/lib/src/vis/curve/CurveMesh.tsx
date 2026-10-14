import { extend, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  SRGBColorSpace,
} from 'three';
import { LineMaterial as ThreeLineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 as ThreeLineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { updateColorAttribute } from '../three-d/utils';
import { type CurveBuffers, gatherColors, updateLineColors } from './utils';

const LineSegments2 = extend(ThreeLineSegments2);
const LineMaterial = extend(ThreeLineMaterial);

interface Props {
  buffers: CurveBuffers;
  colors: Float32Array; // linear RGB colour of each point of the curve
  showLine: boolean;
  lineWidth: number; // CSS pixels
  showPoints: boolean;
  pointSize: number; // CSS pixels
}

function createDiscTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Curve as thick line segments (constant width on screen) and/or round points, coloured per point. */
function CurveMesh(props: Props) {
  const { buffers, colors, showLine, lineWidth, showPoints, pointSize } = props;
  const { segmentPositions, segmentIndices, pointPositions, pointIndices } =
    buffers;

  const invalidate = useThree((state) => state.invalidate);

  const lineGeometry = useMemo(() => {
    const geom = new LineSegmentsGeometry();
    geom.setPositions(segmentPositions);
    return geom;
  }, [segmentPositions]);

  const pointsGeometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(pointPositions, 3));
    return geom;
  }, [pointPositions]);

  const discTexture = useMemo(createDiscTexture, []);

  useEffect(() => () => lineGeometry.dispose(), [lineGeometry]);
  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);
  useEffect(() => () => discTexture.dispose(), [discTexture]);

  // Update colours alone when colour map, domain or scale change (before next frame is rendered)
  useLayoutEffect(() => {
    if (segmentIndices.length > 0) {
      updateLineColors(lineGeometry, gatherColors(colors, segmentIndices));
    }

    updateColorAttribute([pointsGeometry], gatherColors(colors, pointIndices));
    invalidate();
  }, [
    lineGeometry,
    pointsGeometry,
    colors,
    segmentIndices,
    pointIndices,
    invalidate,
  ]);

  return (
    <>
      {segmentIndices.length > 0 && (
        <LineSegments2 geometry={lineGeometry} visible={showLine}>
          <LineMaterial vertexColors linewidth={lineWidth} />
        </LineSegments2>
      )}
      <points geometry={pointsGeometry} visible={showPoints}>
        <pointsMaterial
          vertexColors
          size={pointSize} // in CSS pixels: three.js applies the pixel ratio
          sizeAttenuation={false}
          map={discTexture}
          alphaTest={0.5}
        />
      </points>
    </>
  );
}

export default CurveMesh;
