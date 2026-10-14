import { type Domain } from '@h5web/shared/vis-models';

import { type ColorMap } from '../heatmap/models';
import Headlight from './Headlight';
import IsosurfaceMesh from './IsosurfaceMesh';
import { IsoColorMode, type IsosurfaceParams } from './models';

interface Props {
  isosurfaces: IsosurfaceParams[];
  shape: number[];
  boxSize: [number, number, number];
  colorMode: IsoColorMode | undefined;
  gradientDomain: Domain | undefined;
  colorMap: ColorMap;
  invertColorMap: boolean;
}

/* Lit isosurface meshes, in the coordinate system of the volume's bounding box */
function Isosurfaces(props: Props) {
  const { isosurfaces, colorMode = IsoColorMode.Solid, ...meshProps } = props;

  if (isosurfaces.length === 0) {
    return null;
  }

  return (
    <>
      <Headlight />
      {isosurfaces.map(({ id, geometry, color, opacity }, i) => (
        <IsosurfaceMesh
          key={id ?? i}
          geometry={geometry}
          color={color}
          opacity={opacity}
          colorMode={colorMode}
          renderOrder={opacity < 1 ? i + 2 : 0} // transparent surfaces after the box edges
          {...meshProps}
        />
      ))}
    </>
  );
}

export default Isosurfaces;
