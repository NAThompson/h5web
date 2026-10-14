import {
  getBoxSizeFromAxes,
  getGradientDomain,
  useIsosurfaces,
  useSafeDomain,
  useVisDomain,
  useVolumeDomain,
  VolumeVis,
} from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import { useAttrValue } from '../../../hooks';
import { findScalarStrAttr } from '../../../utils';
import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  useIgnoreValue,
  usePacking,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { useBaseArray, useToNumArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type VolumeConfig } from './config';
import VolumeToolbar from './VolumeToolbar';

interface Props {
  dataset: Dataset<ArrayShape, NumericType>;
  value: ArrayValue<NumericType>;
  toolbarContainer: HTMLDivElement | undefined;
  config: VolumeConfig;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  /* Whether axis values can be used to size the volume and for gradients (i.e. they share a unit) */
  withPhysicalAspect?: boolean;
  axisUnit?: string;
}

function MappedVolumeVis(props: Props) {
  const {
    dataset,
    value,
    toolbarContainer,
    config,
    axisValues = [],
    withPhysicalAspect = false,
    axisUnit,
  } = props;
  const {
    customDomain,
    colorMap,
    scaleType,
    invertColorMap,
    mode,
    opacity,
    threshold,
    quality,
    showVolume,
    isoLevels,
    isoColorMode,
  } = config;

  const packing = usePacking(dataset); // NetCDF `scale_factor`/`add_offset`
  const numArray = useToNumArray(useUnpackedNumArray(value, packing));
  const dataArray = useBaseArray(numArray, dataset.shape.dims);

  const ignoreValue = useIgnoreValue(dataset);
  const dataDomain =
    useVolumeDomain(dataArray, { scaleType, ignoreValue }) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);

  // Axis values are mapped to dimensions `[z, y, x]`; isosurfaces expect them along x, y, z
  const [zValues, yValues, xValues] = useToNumArrays([
    axisValues[0],
    axisValues[1],
    axisValues[2],
  ]);
  const axisCoords = useMemo(
    (): [NumArray | undefined, NumArray | undefined, NumArray | undefined] => [
      xValues,
      yValues,
      zValues,
    ],
    [xValues, yValues, zValues],
  );
  const boxSize = withPhysicalAspect
    ? getBoxSizeFromAxes(dataArray.shape, axisCoords)
    : undefined;

  // Gradients in axis units only if all three axes are usable and share a unit; otherwise per voxel
  const isoAxisValues = useMemo(
    () => (boxSize ? axisCoords : undefined),
    [boxSize !== undefined, axisCoords], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dataUnit = useAttrValue(dataset, findScalarStrAttr(dataset, 'units'));
  const gradientLabel = getGradientLabel(
    dataUnit,
    isoAxisValues ? (axisUnit ?? 'axis unit') : 'voxel',
  );

  const visibleLevels = isoLevels.filter((level) => level.visible);
  const { geometries, progress, step, error, workerError } = useIsosurfaces(
    dataArray,
    visibleLevels.map((level) => level.value),
    { scaleType, ignoreValue, axisValues: isoAxisValues },
  );

  const message = error
    ? `Isosurface extraction failed: ${error.message}`
    : !showVolume && visibleLevels.length === 0
      ? 'Volume hidden and no visible isosurface: add a level or show the volume'
      : workerError
        ? `${workerError.message}: extracting on the main thread`
        : undefined;

  const isosurfaces = visibleLevels.flatMap((level, i) => {
    const geometry = geometries[i];
    return geometry
      ? [
          {
            id: level.id,
            geometry,
            color: level.color,
            opacity: level.opacity,
          },
        ]
      : [];
  });
  const gradientDomain = useMemo(
    () => getGradientDomain(geometries),
    [geometries],
  );

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <VolumeToolbar
            dataDomain={dataDomain}
            config={config}
            isoStep={step}
          />,
          toolbarContainer,
        )}

      <VolumeVis
        className={visualizerStyles.vis}
        dataArray={dataArray}
        domain={safeDomain}
        colorMap={colorMap}
        scaleType={scaleType}
        invertColorMap={invertColorMap}
        mode={mode}
        opacity={opacity}
        threshold={threshold}
        quality={quality}
        showVolume={showVolume}
        isosurfaces={isosurfaces}
        isoColorMode={isoColorMode}
        gradientDomain={gradientDomain}
        isoProgress={progress}
        isoMessage={message}
        gradientLabel={gradientLabel}
        boxSize={boxSize}
      />
    </>
  );
}

function getGradientLabel(dataUnit: string | undefined, per: string): string {
  return `|∇f| (${dataUnit ? `${dataUnit} ` : ''}per ${per})`;
}

export default MappedVolumeVis;
