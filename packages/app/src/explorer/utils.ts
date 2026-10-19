import {
  assertDefined,
  assertNonNull,
  hasChildren,
  hasNonNullShape,
  isDataset,
  isDatatype,
  isGroup,
} from '@h5web/shared/guards';
import {
  type AttributeValues,
  type ChildEntity,
  type Entity,
  type Group,
  type GroupWithChildren,
} from '@h5web/shared/hdf5-models';
import { castArray } from '@h5web/shared/vis-utils';
import { queryOptions } from '@tanstack/react-query';
import { type KeyboardEvent } from 'react';
import { type IconType } from 'react-icons';
import {
  FiChevronDown,
  FiChevronRight,
  FiHash,
  FiLayers,
  FiLink,
} from 'react-icons/fi';
import { PiEmptyBold, PiGridFourBold } from 'react-icons/pi';
import { RxDotFilled } from 'react-icons/rx';
import { TbCube, TbTimeline } from 'react-icons/tb';

import { type DataContextValue } from '../providers/DataProvider';
import { getCoordinatePaths } from '../vis-packs/core/geometry/utils';
import { isPhonyScaleName } from '../vis-packs/dimscales/utils';
import { getNxClass } from '../vis-packs/nexus/utils';
import {
  FIELDS_GROUP,
  isNurbsGeometry,
  isNurbsGroup,
} from '../vis-packs/nurbs/utils';
import { createAttrReader, splitNames } from '../vis-packs/view-hints/attrs';
import { getNxDefaultPath } from '../visualizer/utils';

const DATASET_ICONS = [RxDotFilled, TbTimeline, PiGridFourBold, TbCube];

export const EXPLORER_ID = 'h5web-explorer-tree';

export function getIcon(entity: ChildEntity, isExpanded: boolean): IconType {
  if (isGroup(entity)) {
    return isExpanded ? FiChevronDown : FiChevronRight;
  }

  if (isDataset(entity)) {
    if (hasNonNullShape(entity)) {
      return DATASET_ICONS[entity.shape.dims.length] || FiLayers;
    }

    return PiEmptyBold;
  }

  if (isDatatype(entity)) {
    return FiHash;
  }

  return FiLink;
}

function getButtonList(
  parent = document.querySelector(`#${EXPLORER_ID}`),
): HTMLButtonElement[] {
  assertNonNull(parent);
  return [...parent.querySelectorAll('button')];
}

export function focusParent(evt: KeyboardEvent<HTMLButtonElement>): void {
  const activeElement = evt.currentTarget;
  const { path } = activeElement.dataset;
  assertDefined(path);

  const buttonList = getButtonList();
  const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';

  const parentButton = buttonList.find(
    (element) => element.dataset.path === parentPath,
  );
  if (parentButton) {
    parentButton.focus();
    evt.preventDefault();
  }
}

export function focusNext(
  evt: KeyboardEvent<HTMLButtonElement>,
  childOnly = false,
): void {
  const activeElement = evt.currentTarget;
  const parent = childOnly ? activeElement.parentElement : undefined;
  const buttonList = getButtonList(parent);
  const activeIndex = buttonList.indexOf(activeElement);

  if (activeIndex !== -1 && activeIndex < buttonList.length - 1) {
    buttonList[activeIndex + 1].focus();
    evt.preventDefault();
  }
}

export function focusPrevious(evt: KeyboardEvent<HTMLButtonElement>): void {
  const activeElement = evt.currentTarget;
  const buttonList = getButtonList();
  const activeIndex = buttonList.indexOf(activeElement);

  if (activeIndex > 0) {
    buttonList[activeIndex - 1].focus();
    evt.preventDefault();
  }
}

export function focusFirst(evt: KeyboardEvent<HTMLButtonElement>): void {
  const buttonList = getButtonList();

  buttonList[0]?.focus();
  evt.preventDefault();
}

export function focusLast(evt: KeyboardEvent<HTMLButtonElement>): void {
  const buttonList = getButtonList();

  buttonList[buttonList.length - 1]?.focus();
  evt.preventDefault();
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function nxBadgeQuery(group: Group, dataContext: DataContextValue) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'nxBadge', group.path] as const,
    queryFn: async () => needsNxBadge(group, dataContext),
  });
}

async function needsNxBadge(
  group: Group,
  dataContext: DataContextValue,
): Promise<boolean> {
  const { queryClient, queries } = dataContext;

  const nxClass = await getNxClass(group, dataContext);
  if (nxClass === 'NXdata' || nxClass === 'NXnote') {
    return true;
  }

  const nxDefaultPath = await getNxDefaultPath(group, dataContext);
  if (!nxDefaultPath) {
    return false;
  }

  const defaultEntity = await queryClient.query(queries.entity(nxDefaultPath));
  if (!isGroup(defaultEntity)) {
    return false;
  }

  return dataContext.queryClient.query(
    nxBadgeQuery(defaultEntity, dataContext),
  );
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function auxRolesQuery(
  group: GroupWithChildren,
  dataContext: DataContextValue,
) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'auxRoles', group.path] as const,
    queryFn: async () => getAuxRoles(group, dataContext),
  });
}

interface Referrer {
  entity: Entity;
  values?: AttributeValues;
}

function readStr({ entity, values }: Referrer, name: string) {
  return values && createAttrReader(entity, values, []).str(name);
}

const NX_ATTRS = ['H5WEB_overlays', 'axes', 'signal']; // of the group itself

function isIndicesAttr(name: string): boolean {
  return name.endsWith('_indices') && name !== '_indices';
}

/* Children of an NXdata group named in its `axes` (or `AXISNAME_indices`) attributes, and
 * uncertainties (`errors`, `<name>_errors`) of its signal, axes and auxiliary signals */
function getNxRoles({ entity, values }: Referrer): Map<string, string> {
  const roles = new Map<string, string>();
  if (!values || readStr({ entity, values }, 'NX_class') !== 'NXdata') {
    return roles;
  }

  function names(attr: string): string[] {
    return castArray(values?.[attr] ?? []).filter(
      (name): name is string => typeof name === 'string' && name !== '.',
    );
  }
  const axes = [
    ...names('axes'),
    ...entity.attributes
      .filter(({ name }) => isIndicesAttr(name))
      .map(({ name }) => name.slice(0, -'_indices'.length)),
  ];
  const dataNames = [...names('signal'), ...names('auxiliary_signals')];
  for (const name of [...axes, ...dataNames].map((n) => `${n}_errors`)) {
    roles.set(name, 'uncertainties');
  }
  roles.set('errors', 'uncertainties');
  for (const name of axes) {
    roles.set(name, 'axis (NeXus)');
  }
  for (const name of dataNames) {
    roles.delete(name); // data, even if also listed as an axis
  }
  return roles;
}

/* Role of a child of a group that is auxiliary data, if it is: `H5WEB_role`, else dimension
 * scale, else listed in a sibling's CF `coordinates` or in `H5WEB_overlays`, else overlay data
 * (`H5WEB_geometry`) that nothing lists */
function getAuxRole(
  child: Referrer,
  referenced: Map<string, string>,
): string | undefined {
  const role = readStr(child, 'H5WEB_role')?.toLowerCase();
  if (role === 'axis' || role === 'auxiliary' || role === 'data') {
    return role === 'data' ? undefined : role;
  }

  if (readStr(child, 'CLASS') === 'DIMENSION_SCALE') {
    return isPhonyScaleName(readStr(child, 'NAME'))
      ? 'netCDF dimension (not a variable)'
      : 'axis (dimension scale)';
  }

  return (
    referenced.get(child.entity.path) ??
    (child.entity.attributes.some(({ name }) => name === 'H5WEB_geometry') &&
    !isNurbsGeometry(readStr(child, 'H5WEB_geometry')) // drawn on its own
      ? 'overlay'
      : undefined)
  );
}

const NURBS_ROLES: Record<string, string> = {
  control_points: 'NURBS control points',
  weights: 'NURBS weights',
  knots: 'NURBS knot vector',
  knots_u: 'NURBS knot vector',
  knots_v: 'NURBS knot vector',
};

/* Datasets that define a NURBS group (or patch), and the control values of its fields */
async function getNurbsRoles(
  group: GroupWithChildren,
  parent: Entity | undefined,
  dataContext: DataContextValue,
): Promise<Map<string, string>> {
  const datasets = group.children.filter(isDataset);
  if (await isNurbsGroup(group, dataContext)) {
    return new Map(
      datasets.flatMap(({ name }) =>
        name in NURBS_ROLES ? [[name, NURBS_ROLES[name]] as const] : [],
      ),
    );
  }

  const isFields =
    group.name === FIELDS_GROUP &&
    parent &&
    isGroup(parent) &&
    hasChildren(parent) &&
    (await isNurbsGroup(parent, dataContext));
  return new Map(
    isFields
      ? datasets.map(({ name }) => [name, 'NURBS field coefficients'] as const)
      : [],
  );
}

/**
 * Roles of the children of a group that are auxiliary data (muted in the explorer), by name.
 * `H5WEB_overlays` is looked for on the group, its children and its siblings (overlays often live
 * in a subgroup), `coordinates` on its children. Only the attribute values of entities that have
 * one of these attributes are fetched (cached, as for the visualizations).
 */
export async function getAuxRoles(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<Map<string, string>> {
  const { queryClient, queries } = dataContext;

  async function tryQuery<T>(query: () => Promise<T>): Promise<T | undefined> {
    try {
      return await query();
    } catch {
      return undefined; // e.g. network error: nothing muted
    }
  }

  async function toReferrer(
    entity: Entity,
    names: string[],
    isRelevant = (name: string) => names.includes(name),
  ) {
    const hasAttr = entity.attributes.some(({ name }) => isRelevant(name));
    const values = hasAttr
      ? await tryQuery(async () =>
          queryClient.query(queries.attrValues(entity)),
        )
      : undefined;
    return { entity, values };
  }

  const parentPath = group.path.slice(0, group.path.lastIndexOf('/')) || '/';
  const parent =
    group.path === '/'
      ? undefined
      : await tryQuery(async () =>
          queryClient.query(queries.entity(parentPath)),
        );

  const [children, others, nurbsRoles] = await Promise.all([
    Promise.all(
      group.children.map(async (child) =>
        toReferrer(child, [
          'H5WEB_role',
          'CLASS',
          'coordinates',
          'H5WEB_overlays',
          'H5WEB_geometry',
        ]),
      ),
    ),
    Promise.all(
      [group, ...(parent && isGroup(parent) ? parent.children : [])].map(
        async (entity) =>
          entity === group
            ? toReferrer(
                entity,
                NX_ATTRS,
                (name) => NX_ATTRS.includes(name) || isIndicesAttr(name),
              )
            : toReferrer(entity, ['H5WEB_overlays']),
      ),
    ),
    tryQuery(async () => getNurbsRoles(group, parent, dataContext)),
  ]);

  // Paths resolved like CF `coordinates`, kept if they name a child of the group
  const childPaths = new Set(children.map(({ entity }) => entity.path));
  const referenced = new Map(
    [...getNxRoles(others[0]), ...(nurbsRoles ?? [])].map(([name, role]) => [
      `${group.path === '/' ? '' : group.path}/${name}`,
      role,
    ]),
  );
  const refs = [
    ...[...children, ...others].map((ref) => ['H5WEB_overlays', ref] as const),
    ...children.map((ref) => ['coordinates', ref] as const),
  ];
  for (const [attr, ref] of refs) {
    const anchor = isGroup(ref.entity)
      ? `${ref.entity.path}/.`
      : ref.entity.path;
    for (const name of splitNames(readStr(ref, attr) ?? '')) {
      const path = getCoordinatePaths(anchor, name).find((p) =>
        childPaths.has(p),
      );
      if (path) {
        referenced.set(
          path,
          attr === 'coordinates' ? 'auxiliary coordinate' : 'overlay',
        );
      }
    }
  }

  return new Map(
    children.flatMap((child) => {
      const role = getAuxRole(child, referenced);
      return role ? [[child.entity.name, role] as const] : [];
    }),
  );
}
