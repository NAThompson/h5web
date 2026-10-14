import {
  type ArrayShape,
  type AttributeValues,
  type Dataset,
  type Entity,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import {
  assertMockAttribute,
  dataset,
  group,
  scalarAttr,
  withDimScales,
} from '@h5web/shared/mock-utils';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { type DataContextValue } from '../../../providers/DataProvider';
import { geometryQuery, getGeometryKind } from './hooks';
import { createGeometryContext, findGeometry, GeometryKind } from './utils';

const coords = ['x', 'y', 'z'].map((name) =>
  dataset(name, arrayShape([10]), floatType(), null),
);
const field = dataset('temp', arrayShape([10]), floatType(), null, {
  attributes: [
    scalarAttr('coordinates', 'x y z'),
    scalarAttr('featureType', 'trajectory'),
  ],
});
const root = group('root.h5', [...coords, field], { isRoot: true });

function networkError(): Error {
  return new TypeError('Failed to fetch'); // what `fetch` rejects with
}

function mockAttrValues(entity: Entity): AttributeValues {
  return Object.fromEntries(
    entity.attributes.map((attr) => {
      assertMockAttribute(attr);
      return [attr.name, attr.value];
    }),
  );
}

interface Behaviour {
  getEntity?: (path: string) => ProvidedEntity | Error;
  getAttrValues?: (entity: Entity) => AttributeValues | Error;
  getDimensionScales?: (path: string) => string[][] | null | Error;
}

function createDataContext(behaviour: Behaviour = {}): DataContextValue {
  const entities = new Map<string, ProvidedEntity>(
    [root, ...root.children].map((e) => [e.path, e as ProvidedEntity]),
  );

  const getEntity =
    behaviour.getEntity ??
    ((path: string) => entities.get(path) ?? new Error(`No entity at ${path}`));
  const getAttrValues =
    behaviour.getAttrValues ?? ((entity: Entity) => mockAttrValues(entity));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 'static' } },
  });

  return {
    filepath: 'test.h5',
    queryClient,
    queries: {
      entity: (path: string) =>
        queryOptions({
          queryKey: ['test.h5', 'entity', path],
          queryFn: async () => {
            const result = getEntity(path);
            if (result instanceof Error) {
              throw result;
            }
            return result;
          },
        }),
      attrValues: (entity: Entity) =>
        queryOptions({
          queryKey: ['test.h5', 'attrValues', entity.path],
          queryFn: async () => {
            const result = getAttrValues(entity);
            if (result instanceof Error) {
              throw result;
            }
            return result;
          },
        }),
      dimensionScales: (dset: Entity) =>
        queryOptions({
          queryKey: ['test.h5', 'dimensionScales', dset.path],
          queryFn: async () => {
            const result = behaviour.getDimensionScales?.(dset.path) ?? null;
            if (result instanceof Error) {
              throw result;
            }
            return result;
          },
        }),
    },
  } as unknown as DataContextValue;
}

describe('createGeometryContext', () => {
  it('should treat entities not found as missing coordinates', async () => {
    const dataContext = createDataContext({
      getEntity: (path) =>
        path === '/y'
          ? new Error('No entity found at /y')
          : ((root.children.find((c) => c.path === path) ??
              root) as ProvidedEntity),
    });

    await expect(
      findGeometry(field, createGeometryContext(dataContext)),
    ).resolves.toBeUndefined();
  });

  it('should treat unreadable attributes as missing', async () => {
    const dataContext = createDataContext({
      getAttrValues: () => new Error('Cannot decode attribute'),
    });

    await expect(
      findGeometry(field, createGeometryContext(dataContext)),
    ).resolves.toBeUndefined();
  });

  it('should reject on transport errors, which say nothing about the data', async () => {
    const entityFailure = createDataContext({
      getEntity: () => networkError(),
    });
    await expect(
      findGeometry(field, createGeometryContext(entityFailure)),
    ).rejects.toThrow('Failed to fetch');

    const attrFailure = createDataContext({
      getAttrValues: () => networkError(),
    });
    await expect(
      findGeometry(field, createGeometryContext(attrFailure)),
    ).rejects.toThrow('Failed to fetch');
  });
});

describe('getGeometryKind', () => {
  it('should detect curve', async () => {
    await expect(getGeometryKind(field, createDataContext())).resolves.toBe(
      GeometryKind.Curve,
    );
  });

  it('should never reject, and not cache transient failures', async () => {
    let online = false;
    const dataContext = createDataContext({
      getAttrValues: (entity) =>
        online ? mockAttrValues(entity) : networkError(),
    });
    const { queryKey } = geometryQuery(field, dataContext);

    // Selector does not break: vis is just not offered this time
    await expect(getGeometryKind(field, dataContext)).resolves.toBeUndefined();
    expect(dataContext.queryClient.getQueryState(queryKey)).toBeUndefined();

    // Detection is attempted again (attribute query failed, so is not cached either)
    dataContext.queryClient.removeQueries({
      queryKey: ['test.h5', 'attrValues'],
    });
    online = true;
    await expect(getGeometryKind(field, dataContext)).resolves.toBe(
      GeometryKind.Curve,
    );
  });

  it('should cache datasets that are not geometries', async () => {
    const plain = dataset('plain', arrayShape([10, 3]), floatType(), null, {
      attributes: [scalarAttr('interpretation', 'spectrum')],
    });
    const dataContext = createDataContext();

    await expect(getGeometryKind(plain, dataContext)).resolves.toBeUndefined();
    expect(
      dataContext.queryClient.getQueryData(
        geometryQuery(plain, dataContext).queryKey,
      ),
    ).toBeNull();
  });
});

describe('dimension scales in geometry detection', () => {
  const scaleRoot = group(
    'root.h5',
    [
      ...['x', 'y'].map((name) =>
        dataset(name, arrayShape([10]), floatType(), null, {
          attributes: [scalarAttr('NAME', name)],
        }),
      ),
      withDimScales(
        dataset('t', arrayShape([10]), floatType(), null, {
          attributes: [scalarAttr('featureType', 'trajectory')],
        }),
        { scales: [['/x', '/y']] },
      ),
    ],
    { isRoot: true },
  );
  const t = scaleRoot.children[2] as Dataset<ArrayShape>;

  function scaleContext(getDimensionScales: Behaviour['getDimensionScales']) {
    return createDataContext({
      getEntity: (path) =>
        (scaleRoot.children.find((c) => c.path === path) ??
          scaleRoot) as ProvidedEntity,
      getDimensionScales,
    });
  }

  it('should detect curve from scales returned by shared query', async () => {
    const dataContext = scaleContext(() => [['/x', '/y']]);
    await expect(getGeometryKind(t, dataContext)).resolves.toBe(
      GeometryKind.Curve,
    );
    expect(
      dataContext.queryClient.getQueryData(
        dataContext.queries.dimensionScales(t).queryKey,
      ),
    ).toEqual([['/x', '/y']]); // cached for dimension scales of other visualizations too
  });

  it('should treat data errors as no scales, but not cache transport errors', async () => {
    const dataError = scaleContext(() => new Error('Unlinked scale'));
    await expect(getGeometryKind(t, dataError)).resolves.toBeUndefined();
    expect(
      dataError.queryClient.getQueryData(geometryQuery(t, dataError).queryKey),
    ).toBeNull(); // definitely not a curve

    let online = false;
    const transport = scaleContext(() =>
      online ? [['/x', '/y']] : networkError(),
    );
    await expect(getGeometryKind(t, transport)).resolves.toBeUndefined();
    expect(
      transport.queryClient.getQueryState(geometryQuery(t, transport).queryKey),
    ).toBeUndefined();
    expect(
      transport.queryClient.getQueryState(
        transport.queries.dimensionScales(t).queryKey,
      ),
    ).toBeUndefined(); // failed scales query removed too

    online = true;
    await expect(getGeometryKind(t, transport)).resolves.toBe(
      GeometryKind.Curve,
    );
  });
});
