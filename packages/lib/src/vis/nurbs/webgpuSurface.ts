import { type KnotSpan, type NurbsSurface } from './nurbs';
import { createBuffer, MAX_GPU_DEGREE, STORAGE, UNIFORM } from './webgpu';

const WORKGROUP_SIZE = 64;
export const SAMPLE_COUNT = 4; // multisampling, as WebGL's antialiasing
export const DEPTH_FORMAT = 'depth24plus';
const LUT_SIZE = 256;

/* Linear RGB of the colour map `lut` at `t` in [0, 1], and its conversion to sRGB */
export const COLOR_WGSL = /* wgsl */ `
  fn getColor(t: f32) -> vec3f {
    let x = clamp(t, 0.0, 1.0) * f32(${LUT_SIZE - 1});
    let i = u32(floor(x));
    return mix(lut[i], lut[min(i + 1u, ${LUT_SIZE - 1}u)], fract(x)).rgb;
  }

  fn toSrgb(c: vec3f) -> vec3f {
    return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, 12.92 * c, c <= vec3f(0.0031308));
  }
`;

/*
 * Position and normal of the surface at each vertex of the grid (A2.2/A2.3 + A3.5 + A4.4 of
 * "The NURBS Book"), like `evaluateNurbsSurface`. `.w` of each holds the position of the
 * vertex in "knot coordinates", whole at knots: span index plus fraction of the span.
 */
const EVALUATE_WGSL = /* wgsl */ `
  const ORDER = ${MAX_GPU_DEGREE + 1};
  const NUDGE = 1e-3; // fraction of span to find normals where they vanish (f32)

  struct Params {
    degrees: vec2u,
    countV: u32, // control points along v
    sizeV: u32, // vertices along v
    spanCounts: vec2u,
    total: u32, // vertices
    knotsV: u32, // offset of knots along v
  }
  struct Span { knot: u32, first: u32, count: u32 } // \`count\` steps from vertex \`first\`
  struct Vertex { position: vec4f, normal: vec4f }
  struct Basis { n: array<f32, ORDER>, d: array<f32, ORDER> }
  struct Point { position: vec3f, normal: vec3f }

  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<storage, read> points: array<vec4f>; // x w, y w, z w, w
  @group(0) @binding(2) var<storage, read> knots: array<f32>; // along u, then along v
  @group(0) @binding(3) var<storage, read> spans: array<Span>; // along u, then along v
  @group(0) @binding(4) var<storage, read_write> vertices: array<Vertex>;

  /* Last span from \`first\` (of \`count\`) starting at or before step \`i\` */
  fn findSpan(first: u32, count: u32, i: u32) -> u32 {
    var low = first;
    var high = first + count - 1u;
    while (low < high) {
      let mid = (low + high + 1u) / 2u;
      if (spans[mid].first <= i) { low = mid; } else { high = mid - 1u; }
    }
    return low;
  }

  /* Basis functions of span \`k\` at \`t\` and their derivatives, from those of degree \`p - 1\` */
  fn getBasis(offset: u32, p: u32, k: u32, t: f32) -> Basis {
    var b: Basis;
    var lower: array<f32, ORDER>;
    var left: array<f32, ORDER>;
    var right: array<f32, ORDER>;
    b.n[0] = 1.0;
    for (var j = 1u; j <= p; j++) {
      if (j == p) { lower = b.n; }
      left[j] = t - knots[offset + k + 1u - j];
      right[j] = knots[offset + k + j] - t;
      var saved = 0.0;
      for (var r = 0u; r < j; r++) {
        let temp = b.n[r] / (right[r + 1u] + left[j - r]);
        b.n[r] = saved + right[r + 1u] * temp;
        saved = left[j - r] * temp;
      }
      b.n[j] = saved;
    }
    for (var r = 0u; r <= p; r++) {
      var der = 0.0;
      if (r > 0u) {
        der += lower[r - 1u] / (knots[offset + k + r] - knots[offset + k + r - p]);
      }
      if (r < p) {
        der -= lower[r] / (knots[offset + k + r + 1u] - knots[offset + k + r + 1u - p]);
      }
      b.d[r] = f32(p) * der;
    }
    return b;
  }

  fn evaluate(ku: u32, kv: u32, u: f32, v: f32) -> Point {
    let p = params.degrees;
    let bu = getBasis(0u, p.x, ku, u);
    let bv = getBasis(params.knotsV, p.y, kv, v);

    var a = vec4f(0.0);
    var au = vec4f(0.0);
    var av = vec4f(0.0);
    for (var r = 0u; r <= p.x; r++) {
      for (var c = 0u; c <= p.y; c++) {
        let point = points[(ku - p.x + r) * params.countV + kv - p.y + c];
        a += bu.n[r] * bv.n[c] * point;
        au += bu.d[r] * bv.n[c] * point;
        av += bu.n[r] * bv.d[c] * point;
      }
    }
    let position = a.xyz / a.w;
    let du = (au.xyz - au.w * position) / a.w;
    let dv = (av.xyz - av.w * position) / a.w;
    let normal = cross(du, dv);
    let longest = max(dot(du, du), dot(dv, dv));
    let isDegenerate = dot(normal, normal) <= 1e-8 * longest * longest; // e.g. du = 0 at a pole
    return Point(position, select(normalize(normal), vec3f(0.0), isDegenerate));
  }

  @compute @workgroup_size(${WORKGROUP_SIZE})
  fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    if (i >= params.total) {
      return;
    }

    let steps = vec2u(i / params.sizeV, i % params.sizeV);
    let su = findSpan(0u, params.spanCounts.x, steps.x);
    let sv = findSpan(params.spanCounts.x, params.spanCounts.y, steps.y);
    let ku = spans[su].knot;
    let kv = spans[sv].knot;
    let fu = f32(steps.x - spans[su].first) / f32(spans[su].count);
    let fv = f32(steps.y - spans[sv].first) / f32(spans[sv].count);
    let u0 = knots[ku];
    let u1 = knots[ku + 1u];
    let v0 = knots[params.knotsV + kv];
    let v1 = knots[params.knotsV + kv + 1u];

    var point = evaluate(ku, kv, mix(u0, u1, fu), mix(v0, v1, fv));
    if (all(point.normal == vec3f(0.0))) {
      let nudged = mix(vec2f(fu, fv), vec2f(0.5), NUDGE);
      point.normal = evaluate(ku, kv, mix(u0, u1, nudged.x), mix(v0, v1, nudged.y)).normal;
    }

    vertices[i] = Vertex(
      vec4f(point.position, f32(su) + fu),
      vec4f(point.normal, f32(sv - params.spanCounts.x) + fv),
    );
  }
`;

/*
 * Two triangles per cell of the grid, lit like \`meshLambertMaterial\` (both sides) with the
 * ambient and directional lights of \`Vis3DLayout\`, coloured by height with the colour map.
 */
const DRAW_WGSL = /* wgsl */ `
  const KNOT_COLOR = vec3f(0.0);

  struct Params { degrees: vec2u, countV: u32, sizeV: u32 }
  struct View {
    viewProjection: mat4x4f, // WebGL clip space
    camera: vec4f, // position
    light: vec4f, // direction to light, share of ambient light
    zRange: vec2f, // heights at ends of colour map
    knotLines: f32, // width in device pixels, 0 to hide
  }
  struct Vertex { position: vec4f, normal: vec4f }

  struct Varyings {
    @builtin(position) position: vec4f,
    @location(0) world: vec3f,
    @location(1) normal: vec3f,
    @location(2) knot: vec2f,
  }

  @group(0) @binding(0) var<uniform> params: Params;
  @group(0) @binding(1) var<uniform> view: View;
  @group(0) @binding(2) var<storage, read> vertices: array<Vertex>;
  @group(0) @binding(3) var<storage, read> lut: array<vec4f>; // linear RGB

  @vertex
  fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
    let cell = index / 6u;
    let cols = params.sizeV - 1u;
    var du = array(0u, 1u, 0u, 0u, 1u, 1u);
    var dv = array(0u, 0u, 1u, 1u, 0u, 1u);
    let corner = index % 6u;
    let vertex = vertices[(cell / cols + du[corner]) * params.sizeV + cell % cols + dv[corner]];

    var clip = view.viewProjection * vec4f(vertex.position.xyz, 1.0);
    clip.z = 0.5 * (clip.z + clip.w); // to WebGPU's [0, 1]

    var out: Varyings;
    out.position = clip;
    out.world = vertex.position.xyz;
    out.normal = vertex.normal.xyz;
    out.knot = vec2f(vertex.position.w, vertex.normal.w);
    return out;
  }

  ${COLOR_WGSL}

  @fragment
  fn fragmentMain(in: Varyings) -> @location(0) vec4f {
    let knotWidth = fwidth(in.knot);

    // Facing the camera (both sides are lit)
    let n = normalize(in.normal);
    let normal = select(n, -n, dot(n, view.camera.xyz - in.world) < 0.0);

    let range = view.zRange.y - view.zRange.x;
    let albedo = getColor(select(0.5, (in.world.z - view.zRange.x) / range, range > 0.0));
    let ambient = view.light.w;
    var color = albedo * (ambient + (1.0 - ambient) * max(dot(normal, view.light.xyz), 0.0));

    // Iso-parameter lines at the knots (whole knot coordinates)
    if (view.knotLines > 0.0) {
      let d = abs(in.knot - round(in.knot)) / max(knotWidth, vec2f(1e-6));
      let coverage = clamp(0.5 * view.knotLines + 0.5 - min(d.x, d.y), 0.0, 1.0);
      color = mix(color, KNOT_COLOR, 0.85 * coverage);
    }

    return vec4f(toSrgb(color), 1.0);
  }
`;

export interface SurfaceGpuView {
  viewProjection: number[]; // column-major, as `Matrix4.elements`
  camera: [number, number, number];
  light: [number, number, number, number]; // unit direction, share of ambient light
  zRange: [number, number];
  knotLines: number; // width in device pixels, 0 to hide
  size: [number, number]; // of canvas in device pixels
}

/*
 * Draws a NURBS surface (in world coordinates) in a WebGPU canvas: a compute shader evaluates
 * positions and normals on a grid whenever the number of steps of the knot spans changes (i.e.
 * as the camera moves closer or away), and a render pass draws the grid with a depth buffer.
 */
export class NurbsSurfaceGpuRenderer {
  private readonly context: GPUCanvasContext;
  private readonly format = navigator.gpu.getPreferredCanvasFormat();
  private readonly evaluatePipeline: GPUComputePipeline;
  private readonly drawPipeline: GPURenderPipeline;
  private readonly params: GPUBuffer;
  private readonly points: GPUBuffer;
  private readonly knots: GPUBuffer;
  private readonly spanTable: GPUBuffer;
  private readonly view: GPUBuffer;
  private readonly lut: GPUBuffer;
  private vertices?: GPUBuffer;
  private drawBindGroup?: GPUBindGroup;
  private targets?: RenderTargets;
  private cellCount = 0;
  private counts?: [Uint32Array, Uint32Array];

  public constructor(
    private readonly device: GPUDevice,
    private readonly canvas: HTMLCanvasElement,
    surface: NurbsSurface,
    private readonly spans: [KnotSpan[], KnotSpan[]],
  ) {
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
      throw new Error('Expected WebGPU canvas context');
    }
    this.context = context;
    context.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.evaluatePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: EVALUATE_WGSL }) },
    });

    const drawModule = device.createShaderModule({ code: DRAW_WGSL });
    this.drawPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule },
      fragment: { module: drawModule, targets: [{ format: this.format }] },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: { count: SAMPLE_COUNT },
    });

    const { degrees, shape, points, weights, knots } = surface;
    const homogeneous = new Float32Array(weights.length * 4);
    weights.forEach((w, i) => {
      homogeneous.set(
        [points[i * 3] * w, points[i * 3 + 1] * w, points[i * 3 + 2] * w, w],
        i * 4,
      );
    });

    this.params = createBuffer(device, 32, UNIFORM);
    this.points = createBuffer(device, homogeneous, STORAGE);
    this.knots = createBuffer(
      device,
      Float32Array.from([...knots[0], ...knots[1]]),
      STORAGE,
    );
    this.spanTable = createBuffer(
      device,
      (spans[0].length + spans[1].length) * 12,
      STORAGE,
    );
    this.view = createBuffer(device, 112, UNIFORM);
    this.lut = createLutBuffer(device);

    device.queue.writeBuffer(
      this.params,
      0,
      Uint32Array.from([
        ...degrees,
        shape[1],
        0,
        spans[0].length,
        spans[1].length,
        0,
        knots[0].length,
      ]),
    );
  }

  public setColorLut(lut: Float32Array): void {
    writeColorLut(this.device, this.lut, lut);
  }

  /* Evaluates the surface again if the spans need other numbers of steps */
  public setSampleCounts(counts: [Uint32Array, Uint32Array]): void {
    const { device, spans, counts: prev } = this;
    if (
      prev &&
      counts.every((arr, dir) => arr.every((n, i) => n === prev[dir][i]))
    ) {
      return;
    }
    this.counts = counts;

    const [sizeU, sizeV] = counts.map((arr) =>
      arr.reduce((acc, n) => acc + n, 1),
    );
    const total = sizeU * sizeV;
    this.cellCount = (sizeU - 1) * (sizeV - 1);

    const table = new Uint32Array((spans[0].length + spans[1].length) * 3);
    let offset = 0;
    for (const dir of [0, 1]) {
      let first = 0;
      for (const [s, { index }] of spans[dir].entries()) {
        table.set([index, first, counts[dir][s]], offset);
        offset += 3;
        first += counts[dir][s];
      }
    }

    if (!this.vertices || this.vertices.size < total * 32) {
      this.vertices?.destroy();
      this.vertices = createBuffer(
        device,
        2 ** Math.ceil(Math.log2(total * 32)), // room to move closer
        STORAGE,
      );
      this.drawBindGroup = device.createBindGroup({
        layout: this.drawPipeline.getBindGroupLayout(0),
        entries: [this.params, this.view, this.vertices, this.lut].map(
          (buffer, binding) => ({ binding, resource: { buffer } }),
        ),
      });
    }

    device.queue.writeBuffer(this.spanTable, 0, table);
    device.queue.writeBuffer(this.params, 12, Uint32Array.of(sizeV));
    device.queue.writeBuffer(this.params, 24, Uint32Array.of(total));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.evaluatePipeline);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: this.evaluatePipeline.getBindGroupLayout(0),
        entries: [
          this.params,
          this.points,
          this.knots,
          this.spanTable,
          this.vertices,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      }),
    );
    pass.dispatchWorkgroups(Math.ceil(total / WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /* Flags the canvas with `data-drawn` once drawn (e.g. for tests) */
  public async draw(view: SurfaceGpuView): Promise<void> {
    const { device } = this;
    const { viewProjection, camera, light, zRange, knotLines, size } = view;

    device.queue.writeBuffer(
      this.view,
      0,
      Float32Array.from([
        ...viewProjection,
        ...camera,
        0,
        ...light,
        ...zRange,
        knotLines,
        0,
      ]),
    );

    this.targets = getTargets(device, this.format, size, this.targets);
    this.redraw();
    await device.queue.onSubmittedWorkDone();
    this.canvas.dataset.drawn = '';
  }

  /* Draws again with the last view, e.g. right before copying the canvas */
  public redraw(): void {
    const { device, drawBindGroup, targets } = this;
    if (!targets) {
      return;
    }

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targets.color.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: targets.depth.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    if (drawBindGroup && this.cellCount > 0) {
      pass.setPipeline(this.drawPipeline);
      pass.setBindGroup(0, drawBindGroup);
      pass.draw(this.cellCount * 6);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  public dispose(): void {
    this.context.unconfigure();
    for (const buffer of [
      this.params,
      this.points,
      this.knots,
      this.spanTable,
      this.view,
      this.lut,
      this.vertices,
    ]) {
      buffer?.destroy();
    }
    this.targets?.color.destroy();
    this.targets?.depth.destroy();
  }
}

export function createLutBuffer(device: GPUDevice): GPUBuffer {
  return createBuffer(device, LUT_SIZE * 16, STORAGE);
}

/* Colour map, `LUT_SIZE × 3` linear RGB values (cf. `getLinearColorLut`) */
export function writeColorLut(
  device: GPUDevice,
  buffer: GPUBuffer,
  lut: Float32Array,
): void {
  const padded = new Float32Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    padded.set(lut.subarray(i * 3, i * 3 + 3), i * 4);
  }
  device.queue.writeBuffer(buffer, 0, padded);
}

export interface RenderTargets {
  color: GPUTexture; // multisampled
  depth: GPUTexture;
}

/* Multisampled colour and depth textures of the canvas size, new if `targets` aren't */
export function getTargets(
  device: GPUDevice,
  format: GPUTextureFormat,
  size: [number, number],
  targets?: RenderTargets,
): RenderTargets {
  if (targets?.color.width === size[0] && targets.color.height === size[1]) {
    return targets;
  }
  targets?.color.destroy();
  targets?.depth.destroy();
  const desc = { size, sampleCount: SAMPLE_COUNT, usage: 0x10 }; // `RENDER_ATTACHMENT`
  return {
    color: device.createTexture({ ...desc, format }),
    depth: device.createTexture({ ...desc, format: DEPTH_FORMAT }),
  };
}
