import { type ColorMap, NurbsSurfaceVis } from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';

import { useNurbsSurface } from './hooks';

interface Props {
  group: GroupWithChildren;
  className: string;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showControlNet: boolean;
  showKnotLines: boolean;
  showAxes: boolean;
  showGrid: boolean;
}

/* NURBS surface of a group */
function NurbsSurfaceFetcher(props: Props) {
  const { group, ...visProps } = props;

  const surface = useNurbsSurface(group);
  return <NurbsSurfaceVis surface={surface} title={group.name} {...visProps} />;
}

export default NurbsSurfaceFetcher;
