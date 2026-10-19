import {
  ColorMapSelector,
  DomainWidget,
  ScaleType,
  Selector,
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
import {
  getColorByOptionLabel,
  getColorByOptions,
  useNurbsColoring,
} from './colorBy';
import NurbsFetcher from './NurbsFetcher';
import NurbsSurfaceFetcher from './NurbsSurfaceFetcher';
import { isNurbsMultiPatchGroup, isNurbsSurfaceGroup } from './utils';

/* NURBS curve or surface of a group with `H5WEB_geometry = "nurbs"` */
function NurbsVisContainer(props: VisContainerProps) {
  const { entity, toolbarContainer } = props;
  assertGroup(entity);

  // Surfaces and 3D curves are drawn in a box
  const isSurface =
    isNurbsSurfaceGroup(entity) || isNurbsMultiPatchGroup(entity);
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
  const coloring = useNurbsColoring(isSurface);
  const { fields, dataDomain, colorMap, invertColorMap } = coloring;

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <Toolbar>
            {is3D && (
              <>
                {isSurface && (
                  <>
                    <Selector
                      label="Colour by"
                      value={coloring.option}
                      onChange={coloring.setOption}
                      options={getColorByOptions(fields)}
                      renderOption={(option) =>
                        getColorByOptionLabel(option, fields)
                      }
                    />
                    <Separator />
                    <DomainWidget
                      dataDomain={dataDomain ?? [0, 1]}
                      customDomain={coloring.customDomain}
                      scaleType={ScaleType.Linear}
                      disabled={!dataDomain}
                      onCustomDomainChange={coloring.setCustomDomain}
                    />
                    <Separator />
                  </>
                )}
                <ColorMapSelector
                  value={colorMap}
                  onValueChange={coloring.setColorMap}
                  invert={invertColorMap}
                  onInversionChange={coloring.toggleColorMapInversion}
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
            colorBy={coloring.colorBy}
            colorField={coloring.colorField}
            colorBarLabel={coloring.label}
            domain={coloring.domain}
            colorMap={colorMap}
            invertColorMap={invertColorMap}
            onFieldsChange={coloring.setFields}
            onDataDomainChange={coloring.setDataDomain}
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
