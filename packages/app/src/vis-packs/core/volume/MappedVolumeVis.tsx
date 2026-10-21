import {
  getBoxSizeFromAxes,
  getDomain,
  getGradientDomain,
  useIsosurfaces,
  useSafeDomain,
  useVisDomain,
  useVolumeDomain,
  type ValueTransform,
  type VolumePointSet,
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
import { unpackNumArray } from '../../netcdf/utils';
import { useStableDomain } from '../../playback-range';
import { formatUnits } from '../../units';
import {
  useTransformIgnoreValue,
  useVisScaleType,
} from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { useBaseArray, useToNumArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type VolumeConfig } from './config';
import VolumeToolbar from './VolumeToolbar';

interface Props {
  dataset: Dataset<ArrayShape, NumericType>;
  value: ArrayValue<NumericType>;
  toolbarContainer: HTMLDivElement | undefined;
  config: VolumeConfig;
  /* Dimensions of the volume, if `value` is a slice of a dataset with more than three dimensions */
  dims?: number[];
  /* Values along dimensions `[z, y, x]` of the volume */
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  title?: string;
  /* Whether axis values can be used to size the volume and for gradients (i.e. they share a unit) */
  withPhysicalAspect?: boolean;
  axisUnit?: string;
  symlogThreshold?: number; // width of the linear band around 0 of the symlog scale
  valueTransform?: ValueTransform; // values are logarithms: ±∞ (e.g. log of 0) ignored
  points?: VolumePointSet[]; // e.g. overlays declared by a file's `H5WEB_*` view hint
  coverage?: Uint8Array; // smooth boundary of values that are NaN outside a mesh (cf. `VolumeVis`)
}

function MappedVolumeVis(props: Props) {
  const {
    dataset,
    value,
    toolbarContainer,
    config,
    dims = dataset.shape.dims,
    axisValues = [],
    withPhysicalAspect = false,
    axisUnit,
    title,
    symlogThreshold,
    valueTransform,
    points,
    coverage,
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
  const dataArray = useBaseArray(numArray, dims);

  const ignoreValue = useTransformIgnoreValue(
    useIgnoreValue(dataset),
    valueTransform,
  );
  // During playback of a volume sequence (NX Volume), use range of whole sequence when affordable
  const dataDomain =
    useStableDomain(
      useVolumeDomain(dataArray, { scaleType, ignoreValue }),
      scaleType,
      (seq) =>
        getDomain(
          toNumArray(unpackNumArray(seq as ArrayValue<NumericType>, packing)),
          { scaleType, ignoreValue },
        ),
    ) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);
  const visScaleType = useVisScaleType(
    scaleType,
    symlogThreshold,
    config.rootN,
  );

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
    { scaleType: visScaleType, ignoreValue, axisValues: isoAxisValues },
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
        title={renderMarkup(title)}
        dataArray={dataArray}
        domain={safeDomain}
        colorMap={colorMap}
        scaleType={visScaleType}
        invertColorMap={invertColorMap}
        valueTransform={valueTransform}
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
        axisValues={axisCoords}
        points={points}
        coverage={coverage}
      />
    </>
  );
}

function getGradientLabel(dataUnit: string | undefined, per: string): string {
  const unit = dataUnit && formatUnits(dataUnit);
  return `|∇𝑓| (${unit ? `${unit} ` : ''}per ${formatUnits(per) || per})`;
}

export default MappedVolumeVis;
