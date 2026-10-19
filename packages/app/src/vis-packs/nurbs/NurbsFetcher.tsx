import { type ColorMap, NurbsCurve3DVis, NurbsVis } from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';

import { useNurbsCurve } from './hooks';

interface Props {
  group: GroupWithChildren;
  className: string;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showControlPolygon: boolean;
  showAxes: boolean;
  showGrid: boolean;
}

/* NURBS curve of a group: 2D, or 3D in a box */
function NurbsFetcher(props: Props) {
  const { group, className, colorMap, invertColorMap, showAxes, ...visProps } =
    props;

  const curve = useNurbsCurve(group);

  if (curve.dims === 3) {
    return (
      <NurbsCurve3DVis
        className={className}
        curve={curve}
        title={group.name}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        showAxes={showAxes}
        {...visProps}
      />
    );
  }

  return (
    <NurbsVis
      className={className}
      curve={curve}
      title={group.name}
      abscissaLabel="𝑥"
      ordinateLabel="𝑦"
      {...visProps}
    />
  );
}

export default NurbsFetcher;
