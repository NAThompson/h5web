import { type VisibleDomains } from '@h5web/shared/vis-models';

/* Data domains in view in the last panel zoomed or panned, which linked panels show too */
export class ViewLink {
  private state: { domains: VisibleDomains; source: string } | undefined;
  private readonly listeners = new Set<() => void>();

  public get = (): typeof this.state => this.state;

  public set(domains: VisibleDomains, source: string): void {
    this.state = { domains, source };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
