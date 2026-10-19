/*
 * GLSL 3 sampling of a 2D vector field stored in textures: `fieldTex` (RGBA float, nx × ny:
 * u, v, validity), `xsTex` and `ysTex` (R float, n × 1: sample positions, ascending or
 * descending), `fieldSize` (nx, ny). Positions are found by binary search, so non-uniform grids
 * are sampled exactly as on the CPU (cf. `sampleField`).
 */
export const GLSL_SAMPLE_FIELD = /* glsl */ `
  uniform highp sampler2D fieldTex;
  uniform highp sampler2D xsTex;
  uniform highp sampler2D ysTex;
  uniform ivec2 fieldSize;

  // Fractional index of x along an axis, or -1 outside it
  float findIndex(highp sampler2D axis, int n, float x) {
    float first = texelFetch(axis, ivec2(0, 0), 0).r;
    if (n == 1) {
      return x == first ? 0.0 : -1.0;
    }
    float last = texelFetch(axis, ivec2(n - 1, 0), 0).r;
    float s = last >= first ? 1.0 : -1.0;
    float sx = s * x;
    if (sx < s * first || sx > s * last) {
      return -1.0;
    }
    int lo = 0;
    int hi = n - 1;
    for (int it = 0; it < 32; it++) {
      if (hi - lo <= 1) {
        break;
      }
      int mid = (lo + hi) / 2;
      if (s * texelFetch(axis, ivec2(mid, 0), 0).r <= sx) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    float a = texelFetch(axis, ivec2(lo, 0), 0).r;
    float b = texelFetch(axis, ivec2(hi, 0), 0).r;
    return float(lo) + (b == a ? 0.0 : (x - a) / (b - a));
  }

  // Field at a data position by bilinear interpolation; false outside the grid or next to a
  // missing value
  bool sampleField(vec2 p, out vec2 uv) {
    float fi = findIndex(xsTex, fieldSize.x, p.x);
    float fj = findIndex(ysTex, fieldSize.y, p.y);
    if (fi < 0.0 || fj < 0.0) {
      return false;
    }
    ivec2 c0 = ivec2(floor(fi), floor(fj));
    ivec2 c1 = min(c0 + 1, fieldSize - 1);
    vec2 t = vec2(fi, fj) - vec2(c0);
    vec4 a = texelFetch(fieldTex, c0, 0);
    vec4 b = texelFetch(fieldTex, ivec2(c1.x, c0.y), 0);
    vec4 c = texelFetch(fieldTex, ivec2(c0.x, c1.y), 0);
    vec4 d = texelFetch(fieldTex, c1, 0);
    if (a.z * b.z * c.z * d.z == 0.0) {
      return false;
    }
    uv = mix(mix(a.xy, b.xy, t.x), mix(c.xy, d.xy, t.x), t.y).xy;
    return true;
  }
`;
