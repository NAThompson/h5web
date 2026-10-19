import { type VisContainerProps } from '../../models';
import { useViewHint } from '../../view-hints/hooks';
import VisBoundary from '../../VisBoundary';
import { useScatterConfig } from './config';
import MappedPointsVis from './MappedPointsVis';
import ScatterFetcher from './ScatterFetcher';

/* Points of a dataset or group (`H5WEB_vis = "scatter"` / `"scatter3d"`, or CF `featureType =
 * "point"`), in 2D or 3D, cf. `source.ts` */
function PointsVisContainer(props: VisContainerProps & { is3D: boolean }) {
  const { entity, toolbarContainer, is3D } = props;
  const hint = useViewHint(entity);
  const config = useScatterConfig();

  return (
    <VisBoundary>
      <ScatterFetcher
        entity={entity}
        render={(source, data) => (
          <MappedPointsVis
            source={source}
            data={data}
            hint={hint}
            is3D={is3D}
            title={hint.title ?? entity.name}
            toolbarContainer={toolbarContainer}
            config={config}
          />
        )}
      />
    </VisBoundary>
  );
}

export default PointsVisContainer;
