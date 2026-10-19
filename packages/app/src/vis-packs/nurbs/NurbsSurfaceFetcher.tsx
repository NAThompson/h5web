import { type ColorMap, NurbsSurfaceVis } from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';

import { useNurbsSurfaces } from './hooks';

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

/* NURBS surface of a group, or patches of a multi-patch group */
function NurbsSurfaceFetcher(props: Props) {
  const { group, ...visProps } = props;

  const surfaces = useNurbsSurfaces(group);
  return (
    <NurbsSurfaceVis surfaces={surfaces} title={group.name} {...visProps} />
  );
}

export default NurbsSurfaceFetcher;
