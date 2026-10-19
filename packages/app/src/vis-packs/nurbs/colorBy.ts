import {
  type ColorMap,
  type CustomDomain,
  type Domain,
  NurbsColorBy,
} from '@h5web/lib';
import { useState } from 'react';

import { type NurbsFieldInfo } from './hooks';

/* Option of the "Colour by" selector: colour mode, then index of the field, if any */
export type ColorByOption = `${NurbsColorBy}` | `${NurbsColorBy}:${number}`;

export function parseColorByOption(
  option: ColorByOption,
  fieldCount: number,
): { colorBy: NurbsColorBy; colorField: number } {
  const [colorBy, field = '0'] = option.split(':') as [NurbsColorBy, string?];
  const colorField = Number(field);
  const isField =
    colorBy === NurbsColorBy.Field || colorBy === NurbsColorBy.FieldGradient;
  return isField && colorField >= fieldCount
    ? { colorBy: NurbsColorBy.Height, colorField: 0 } // e.g. other group
    : { colorBy, colorField };
}

/* Options, stored values first, then quantities derived from the surface */
export function getColorByOptions(
  fields: NurbsFieldInfo[],
): Record<string, ColorByOption[]> {
  return {
    Stored: [
      NurbsColorBy.Height,
      ...fields.map((_, f): ColorByOption => `${NurbsColorBy.Field}:${f}`),
    ],
    Derived: [
      ...fields.map(
        (_, f): ColorByOption => `${NurbsColorBy.FieldGradient}:${f}`,
      ),
      NurbsColorBy.HeightGradient,
      NurbsColorBy.GaussianCurvature,
      NurbsColorBy.MeanCurvature,
    ],
  };
}

/* Label of the option in the selector */
export function getColorByOptionLabel(
  option: ColorByOption,
  fields: NurbsFieldInfo[],
): string {
  const { colorBy } = parseColorByOption(option, fields.length);
  return colorBy === NurbsColorBy.Height
    ? 'Height z'
    : getColorByLabel(option, fields);
}

/* Label of the colour bar */
export function getColorByLabel(
  option: ColorByOption,
  fields: NurbsFieldInfo[],
): string {
  const { colorBy, colorField } = parseColorByOption(option, fields.length);
  const field = fields[colorField] as NurbsFieldInfo | undefined;
  const unit = field?.unit ? ` (${field.unit})` : '';
  const labels: Record<NurbsColorBy, string> = {
    [NurbsColorBy.Height]: 'z',
    [NurbsColorBy.Field]: `${field?.label}${unit}`,
    [NurbsColorBy.FieldGradient]: `|∇ ${field?.label}|${field?.unit ? ` (${field.unit} per unit length)` : ''}`,
    [NurbsColorBy.HeightGradient]: '|∇ z|',
    [NurbsColorBy.GaussianCurvature]: 'Gaussian curvature K',
    [NurbsColorBy.MeanCurvature]: 'Mean curvature H',
  };
  return labels[colorBy];
}

/*
 * State of the colouring of a NURBS surface: what by, custom domain (reset with the former) and
 * data domain (from the vis), colour maps: diverging for Gaussian curvature, whose sign tells
 * elliptic from hyperbolic regions, sequential otherwise
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function useNurbsColoring(isSurface: boolean) {
  const [sequentialMap, setSequentialMap] = useState<[ColorMap, boolean]>([
    'Viridis',
    false,
  ]);
  const [divergingMap, setDivergingMap] = useState<[ColorMap, boolean]>([
    'RdBu',
    true, // blue below 0, red above
  ]);

  const [fields, setFields] = useState<NurbsFieldInfo[]>([]);
  const [option, setOption] = useState<ColorByOption>(NurbsColorBy.Height);
  const [customDomain, setCustomDomain] = useState<CustomDomain>([null, null]);
  const [dataDomain, setDataDomain] = useState<Domain>();
  const { colorBy, colorField } = parseColorByOption(option, fields.length);

  const isDiverging = isSurface && colorBy === NurbsColorBy.GaussianCurvature;
  const [colorMap, invertColorMap] = isDiverging ? divergingMap : sequentialMap;
  const setColorMaps = isDiverging ? setDivergingMap : setSequentialMap;
  const isCustom = dataDomain && customDomain.some((val) => val !== null);
  const domain: Domain | undefined = isCustom
    ? [customDomain[0] ?? dataDomain[0], customDomain[1] ?? dataDomain[1]]
    : undefined;

  return {
    fields,
    setFields,
    option,
    setOption: (val: ColorByOption) => {
      setOption(val);
      setCustomDomain([null, null]);
      setDataDomain(undefined);
    },
    colorBy,
    colorField,
    label: getColorByLabel(option, fields),
    customDomain,
    setCustomDomain,
    dataDomain,
    setDataDomain,
    domain,
    colorMap,
    invertColorMap,
    setColorMap: (map: ColorMap) => setColorMaps([map, invertColorMap]),
    toggleColorMapInversion: () => setColorMaps([colorMap, !invertColorMap]),
  };
}
