import { createContext, useContext } from 'react';

/* Select another entity, as in the explorer (e.g. a panel's dataset) */
export const SelectPathContext = createContext<
  ((path: string) => void) | undefined
>(undefined);

/* Switch the visualization of the current entity (by name) */
export const ActiveVisContext = createContext<
  ((name: string) => void) | undefined
>(undefined);

export function useSelectPath(): ((path: string) => void) | undefined {
  return useContext(SelectPathContext);
}

export function useSetActiveVis(): ((name: string) => void) | undefined {
  return useContext(ActiveVisContext);
}
