import { createContext, type ReactNode } from 'react';
import { type OrthographicCamera, type Scene } from 'three';

import { type AxisOffsets } from '../models';
import { ViewLink } from './view-link';

export interface CanvasPanelEntry {
  scene: Scene;
  camera: OrthographicCamera;
  element: HTMLElement; // area the panel is drawn in (its `r3fRoot`)
  width: number;
  height: number;
  node: ReactNode; // R3F children of the panel
}

/* Panels of a `MultiVisCanvas`: each one is drawn in its element's area of the shared canvas.
 * Listeners of the list of panels and of each panel are notified separately, so that updating a
 * panel doesn't re-render the others. */
export class CanvasPanelRegistry {
  public readonly entries = new Map<string, CanvasPanelEntry>();

  private ids: string[] = [];
  private readonly idsListeners = new Set<() => void>();
  private readonly entryListeners = new Map<string, Set<() => void>>();
  private readonly viewLinks = new Map<string, ViewLink>();

  public set(id: string, entry: CanvasPanelEntry): void {
    const isNew = !this.entries.has(id);
    this.entries.set(id, entry);
    if (isNew) {
      this.ids = [...this.entries.keys()];
      this.notify(this.idsListeners);
    }
    this.notify(this.entryListeners.get(id));
  }

  public delete(id: string): void {
    if (this.entries.delete(id)) {
      this.ids = [...this.entries.keys()];
      this.notify(this.idsListeners);
    }
  }

  public getIds = (): string[] => this.ids;

  public subscribeIds = (listener: () => void): (() => void) => {
    this.idsListeners.add(listener);
    return () => this.idsListeners.delete(listener);
  };

  public subscribeEntry(id: string, listener: () => void): () => void {
    const listeners = this.entryListeners.get(id) ?? new Set();
    this.entryListeners.set(id, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.entryListeners.delete(id);
      }
    };
  }

  /* View shared by the panels with the same link key */
  public getViewLink(linkKey: string): ViewLink {
    let link = this.viewLinks.get(linkKey);
    if (!link) {
      link = new ViewLink();
      this.viewLinks.set(linkKey, link);
    }
    return link;
  }

  private notify(listeners: Set<() => void> | undefined): void {
    for (const listener of listeners ?? []) {
      listener();
    }
  }
}

export const MultiCanvasContext = createContext<CanvasPanelRegistry | null>(
  null,
);

/* How a visualization is drawn as a panel of a `MultiVisCanvas` */
export interface VisPanelOptions {
  linkKey?: string; // panels with the same key zoom and pan together (same data in view)
  axes?: { x: boolean; y: boolean }; // axes shown (default: both), e.g. only along edges of a grid
  tooltip?: boolean; // default: true (e.g. not in small panels, with a readout instead)
}

/* Offsets of the axes that are shown; the top and right margins (for the axes' end tick labels)
 * are kept, so that panels with and without axes have plots of the same size */
export function withoutHiddenAxes(
  offsets: AxisOffsets,
  axes: VisPanelOptions['axes'],
): AxisOffsets {
  if (!axes) {
    return offsets;
  }
  const { left, bottom } = offsets;
  return {
    ...offsets,
    left: axes.y ? left : 0,
    bottom: axes.x ? bottom : 0,
  };
}

export const VisPanelContext = createContext<VisPanelOptions>({});

/* Panel that R3F children are drawn in, if within a `MultiVisCanvas` */
export interface PanelInternals {
  id: string;
  root: HTMLElement; // its `r3fRoot` element
  viewLink?: ViewLink;
}

export const PanelInternalsContext = createContext<PanelInternals | null>(null);
