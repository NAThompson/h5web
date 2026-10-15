import {
  ColorMapSelector,
  ComplexVisTypeSelector,
  type Domain,
  DomainWidget,
  ExportMenu,
  ScaleSelector,
  Separator,
  SnapshotBtn,
  ToggleBtn,
  Toolbar,
} from '@h5web/lib';
import {
  COLOR_SCALE_TYPES,
  type ComplexHeatmapVisType,
  ComplexVisType,
  type ExportEntry,
  ScaleType,
} from '@h5web/shared/vis-models';
import {
  MdAspectRatio,
  MdGridOn,
  MdShowChart,
  MdSwapHoriz,
  MdSwapVert,
  MdViewInAr,
  MdWbSunny,
} from 'react-icons/md';

import { useVisArea } from '../../../visualizer/vis-area';
import { getImageInteractions, SURFACE_INTERACTIONS } from '../utils';
import { type HeatmapConfig } from './config';
import ContoursControl from './ContoursControl';
import HeightScaleSlider from './HeightScaleSlider';

const COMPLEX_VIS_TYPES: ComplexHeatmapVisType[] = [
  ComplexVisType.Amplitude,
  ComplexVisType.Phase,
  ComplexVisType.PhaseAmplitude,
];

interface Props {
  dataDomain: Domain;
  isSlice?: boolean;
  isComplex?: boolean;
  withSurface?: boolean;
  config: HeatmapConfig;
  exportEntries?: ExportEntry[];
  /* Automatic contour levels; contour controls are shown only when provided */
  autoContourLevels?: number[];
  customContourLevels?: number[];
  onCustomContourLevelsChange?: (levels: number[]) => void;
  withProbe?: boolean; // probe pixels of a stack
}

/**
 * Settings that toolbar controls are bound to, depending on what is shown:
 * - 3D surfaces have their own keep-ratio setting;
 * - 3D surfaces of complex values have their own complex mode and height domain;
 * - phase of complex values is coloured with its own (cyclic) colour map, in 2D and 3D;
 * - phase as height is always linear.
 */
function getBoundSettings(
  config: HeatmapConfig,
  isComplex: boolean,
  showSurface: boolean,
) {
  const isComplexSurface = isComplex && showSurface;
  const complexVisType = isComplexSurface
    ? config.surfaceComplexVisType
    : config.complexVisType;
  const showsPhaseColors =
    isComplex && complexVisType !== ComplexVisType.Amplitude;

  return {
    complexVisType,
    setComplexVisType: isComplexSurface
      ? config.setSurfaceComplexVisType
      : config.setComplexVisType,
    customDomain: isComplexSurface
      ? config.surfaceCustomDomain
      : config.customDomain,
    setCustomDomain: isComplexSurface
      ? config.setSurfaceCustomDomain
      : config.setCustomDomain,
    keepRatio: showSurface ? config.surfaceKeepRatio : config.keepRatio,
    setKeepRatio: showSurface
      ? config.setSurfaceKeepRatio
      : config.setKeepRatio,
    colorMap: showsPhaseColors ? config.phaseColorMap : config.colorMap,
    setColorMap: showsPhaseColors
      ? config.setPhaseColorMap
      : config.setColorMap,
    invertColorMap: showsPhaseColors
      ? config.invertPhaseColorMap
      : config.invertColorMap,
    setInvertColorMap: showsPhaseColors
      ? config.setInvertPhaseColorMap
      : config.setInvertColorMap,
    scaleType: isComplexSurface ? config.surfaceScaleType : config.scaleType,
    setScaleType: isComplexSurface
      ? config.setSurfaceScaleType
      : config.setScaleType,
    withScale: !(isComplexSurface && complexVisType === ComplexVisType.Phase),
  };
}

function HeatmapToolbar(props: Props) {
  const visArea = useVisArea();
  const {
    dataDomain,
    isSlice,
    isComplex,
    withSurface,
    config,
    exportEntries,
    autoContourLevels,
    customContourLevels = [],
    onCustomContourLevelsChange = () => {},
    withProbe,
  } = props;
  const {
    showGrid,
    flipXAxis,
    flipYAxis,
    surface,
    heightScale,
    shading,
    setShowGrid,
    setFlipXAxis,
    setFlipYAxis,
    setSurface,
    setHeightScale,
    setShading,
  } = config;

  const showSurface = !!withSurface && surface;
  const {
    complexVisType,
    setComplexVisType,
    customDomain,
    setCustomDomain,
    keepRatio,
    setKeepRatio,
    colorMap,
    setColorMap,
    invertColorMap,
    setInvertColorMap,
    scaleType,
    setScaleType,
    withScale,
  } = getBoundSettings(config, !!isComplex, showSurface);

  return (
    <Toolbar
      interactions={
        showSurface ? SURFACE_INTERACTIONS : getImageInteractions(keepRatio)
      }
    >
      {withSurface && (
        <>
          <ToggleBtn
            label="3D"
            aria-label="Show as 3D surface"
            Icon={MdViewInAr}
            value={surface}
            onToggle={() => setSurface(!surface)}
          />

          {surface && (
            <>
              <HeightScaleSlider
                value={heightScale}
                onChange={setHeightScale}
              />
              <ToggleBtn
                label="Shading"
                Icon={MdWbSunny}
                value={shading}
                onToggle={() => setShading(!shading)}
              />
            </>
          )}

          <Separator />
        </>
      )}

      <DomainWidget
        dataDomain={dataDomain}
        customDomain={customDomain}
        scaleType={withScale ? scaleType : ScaleType.Linear}
        onCustomDomainChange={setCustomDomain}
      />
      <Separator />

      <ColorMapSelector
        value={colorMap}
        onValueChange={setColorMap}
        invert={invertColorMap}
        onInversionChange={() => setInvertColorMap(!invertColorMap)}
      />

      <Separator />

      {/* Phase as height is always linear */}
      {withScale && (
        <ScaleSelector
          value={scaleType}
          onScaleChange={setScaleType}
          options={COLOR_SCALE_TYPES}
        />
      )}

      {isComplex && (
        <ComplexVisTypeSelector
          value={complexVisType}
          onChange={setComplexVisType}
          options={COMPLEX_VIS_TYPES}
        />
      )}

      <Separator />

      {autoContourLevels && !showSurface && (
        <>
          <ContoursControl
            mode={config.contourMode}
            count={config.contourCount}
            customLevels={customContourLevels}
            autoLevels={autoContourLevels}
            colorMode={config.contourColorMode}
            color={config.contourColor}
            showLabels={config.contourLabels}
            onModeChange={config.setContourMode}
            onCountChange={config.setContourCount}
            onCustomLevelsChange={onCustomContourLevelsChange}
            onColorModeChange={config.setContourColorMode}
            onColorChange={config.setContourColor}
            onShowLabelsChange={config.setContourLabels}
            emphasis={config.contourEmphasis}
            onEmphasisChange={config.setContourEmphasis}
          />
          <Separator />
        </>
      )}

      {withProbe && !showSurface && (
        <>
          <ToggleBtn
            label="Probe"
            Icon={MdShowChart}
            value={config.probe}
            onToggle={() => config.setProbe(!config.probe)}
          />
          <Separator />
        </>
      )}

      <ToggleBtn
        label="X"
        aria-label="Flip X"
        Icon={MdSwapHoriz}
        value={flipXAxis}
        onToggle={() => setFlipXAxis(!flipXAxis)}
      />
      <ToggleBtn
        label="Y"
        aria-label="Flip Y"
        Icon={MdSwapVert}
        value={flipYAxis}
        onToggle={() => setFlipYAxis(!flipYAxis)}
      />

      <ToggleBtn
        label="Keep ratio"
        Icon={MdAspectRatio}
        value={keepRatio}
        onToggle={() => setKeepRatio(!keepRatio)}
      />

      <ToggleBtn
        label="Grid"
        Icon={MdGridOn}
        value={showGrid}
        onToggle={() => setShowGrid(!showGrid)}
      />

      <Separator />

      {exportEntries && exportEntries.length > 0 && (
        <ExportMenu isSlice={isSlice} entries={exportEntries} />
      )}

      <SnapshotBtn target={visArea} />
    </Toolbar>
  );
}

export default HeatmapToolbar;
