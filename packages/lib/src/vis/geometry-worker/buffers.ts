type TypedArrayCtor<T> = new (length: number) => T;

/* Append-only typed array that grows geometrically */
export class GrowableArray<T extends Float32Array | Uint32Array> {
  public length = 0;
  private data: T;

  public constructor(
    private readonly Ctor: TypedArrayCtor<T>,
    initialCapacity = 1024,
  ) {
    this.data = new Ctor(initialCapacity);
  }

  public push(val: number): void {
    if (this.length === this.data.length) {
      const grown = new this.Ctor(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length] = val;
    this.length += 1;
  }

  public at(index: number): number {
    return this.data[index];
  }

  public toArray(): T {
    return this.data.slice(0, this.length) as T;
  }
}
