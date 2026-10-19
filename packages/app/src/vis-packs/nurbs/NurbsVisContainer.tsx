import {
  type ColorMap,
  ColorMapSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import { assertGroup, hasArrayShape, isDataset } from '@h5web/shared/guards';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MdGridOn,
  MdLineStyle,
  MdOutlineViewInAr,
  MdTimeline,
} from 'react-icons/md';

import { useVisArea } from '../../visualizer/vis-area';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { type VisContainerProps } from '../models';
import VisBoundary from '../VisBoundary';
import NurbsFetcher from './NurbsFetcher';
import NurbsSurfaceFetcher from './NurbsSurfaceFetcher';
import { isNurbsSurfaceGroup } from './utils';

/* NURBS curve or surface of a group with `H5WEB_geometry = "nurbs"` */
function NurbsVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  // Surfaces and 3D curves are drawn in a box
  const isSurface = isNurbsSurfaceGroup(entity);
  const points = entity.children.find(({ name }) => name === 'control_points');
  const is3D =
    isSurface ||
    (points && isDataset(points) && hasArrayShape(points)
      ? points.shape.dims[1] === 3
      : false);

  const visArea = useVisArea();
  const [showControlPolygon, setShowControlPolygon] = useState(false);
  const [showKnotLines, setShowKnotLines] = useState(false);
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [colorMap, setColorMap] = useState<ColorMap>('Viridis');
  const [invertColorMap, setInvertColorMap] = useState(false);

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <Toolbar>
            {is3D && (
              <>
                <ColorMapSelector
                  value={colorMap}
                  onValueChange={setColorMap}
                  invert={invertColorMap}
                  onInversionChange={() => setInvertColorMap(!invertColorMap)}
                />
                <Separator />
              </>
            )}
            <ToggleBtn
              label={isSurface ? 'Control net' : 'Control points'}
              Icon={MdTimeline}
              value={showControlPolygon}
              onToggle={() => setShowControlPolygon(!showControlPolygon)}
            />
            {isSurface && (
              <ToggleBtn
                label="Knot lines"
                Icon={MdLineStyle}
                value={showKnotLines}
                onToggle={() => setShowKnotLines(!showKnotLines)}
              />
            )}
            {is3D && (
              <ToggleBtn
                label="Axes"
                Icon={MdOutlineViewInAr}
                value={showAxes}
                onToggle={() => setShowAxes(!showAxes)}
              />
            )}
            <ToggleBtn
              label="Grid"
              Icon={MdGridOn}
              value={showGrid}
              disabled={!showAxes && is3D}
              onToggle={() => setShowGrid(!showGrid)}
            />
            <Separator />
            <SnapshotBtn target={visArea} />
          </Toolbar>,
          toolbarContainer,
        )}

      <VisBoundary>
        {isSurface ? (
          <NurbsSurfaceFetcher
            className={visualizerStyles.vis}
            group={entity}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            showControlNet={showControlPolygon}
            showKnotLines={showKnotLines}
            showAxes={showAxes}
            showGrid={showGrid}
          />
        ) : (
          <NurbsFetcher
            className={visualizerStyles.vis}
            group={entity}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            showControlPolygon={showControlPolygon}
            showAxes={showAxes}
            showGrid={showGrid}
          />
        )}
      </VisBoundary>
    </>
  );
}

export default NurbsVisContainer;
