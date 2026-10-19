import { Separator, SnapshotBtn, ToggleBtn, Toolbar } from '@h5web/lib';
import { assertGroup, hasArrayShape, isDataset } from '@h5web/shared/guards';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MdGridOn, MdTimeline } from 'react-icons/md';

import { useVisArea } from '../../visualizer/vis-area';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { type VisContainerProps } from '../models';
import VisBoundary from '../VisBoundary';
import NurbsFetcher from './NurbsFetcher';

/* NURBS curve of a group with `H5WEB_geometry = "nurbs"` */
function NurbsVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  // 3D curves are drawn by `Curve3DVis`, without control points
  const points = entity.children.find(({ name }) => name === 'control_points');
  const is3D =
    points && isDataset(points) && hasArrayShape(points)
      ? points.shape.dims[1] === 3
      : false;

  const visArea = useVisArea();
  const [showControlPolygon, setShowControlPolygon] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <Toolbar>
            {!is3D && (
              <ToggleBtn
                label="Control points"
                Icon={MdTimeline}
                value={showControlPolygon}
                onToggle={() => setShowControlPolygon(!showControlPolygon)}
              />
            )}
            <ToggleBtn
              label="Grid"
              Icon={MdGridOn}
              value={showGrid}
              onToggle={() => setShowGrid(!showGrid)}
            />
            <Separator />
            <SnapshotBtn target={visArea} />
          </Toolbar>,
          toolbarContainer,
        )}

      <VisBoundary>
        <NurbsFetcher
          className={visualizerStyles.vis}
          group={entity}
          showControlPolygon={showControlPolygon}
          showGrid={showGrid}
        />
      </VisBoundary>
    </>
  );
}

export default NurbsVisContainer;
