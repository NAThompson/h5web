import {
  type ColorMap,
  type Domain,
  type NurbsColorBy,
  NurbsSurfaceVis,
} from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useEffect, useMemo } from 'react';

import { type NurbsFieldInfo, useNurbsFields, useNurbsSurfaces } from './hooks';

interface Props {
  group: GroupWithChildren;
  className: string;
  colorBy: NurbsColorBy;
  colorField: number;
  colorBarLabel: string;
  domain?: Domain;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showControlNet: boolean;
  showKnotLines: boolean;
  showAxes: boolean;
  showGrid: boolean;
  onFieldsChange: (fields: NurbsFieldInfo[]) => void;
  onDataDomainChange: (domain: Domain) => void;
}

/* NURBS surface of a group, or patches of a multi-patch group, with their fields */
function NurbsSurfaceFetcher(props: Props) {
  const { group, onFieldsChange, ...visProps } = props;

  const surfaces = useNurbsSurfaces(group);
  const { fields, values } = useNurbsFields(group);
  const withFields = useMemo(
    () => surfaces.map((surface, p) => ({ ...surface, fields: values[p] })),
    [surfaces, values],
  );
  useEffect(() => onFieldsChange(fields), [fields, onFieldsChange]);

  return (
    <NurbsSurfaceVis surfaces={withFields} title={group.name} {...visProps} />
  );
}

export default NurbsSurfaceFetcher;
