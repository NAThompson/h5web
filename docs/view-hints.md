# View hints: `H5WEB_*` attributes

View hints let an HDF5 file say how it is meant to be viewed in H5Web: which
visualization to open, with which scale, color map, contours, overlays and so
on. They are plain native HDF5 attributes whose names start with `H5WEB_`,
written on the objects they describe (no JSON, no references, no compounds), so
they also work in netCDF-4 files.

```python
import h5py
import numpy as np

with h5py.File("hints.h5", "w") as f:
    field = f.create_dataset("field", data=np.random.randn(64, 64))
    field.attrs.update({"H5WEB_vis": "heatmap", "H5WEB_scale": "symlog",
                        "H5WEB_colormap": "auto", "H5WEB_keep_ratio": 1})
```

Open `field` in H5Web and it shows as a heatmap with a symlog scale and a
diverging color map centered on 0. Every hint is optional, and files without
hints are shown as before.

The demo file has an entry for nearly every hint, under `/view_hints` and, for
the axis hints of dimension scales, `/axis_hints` (see
[Demo entries](#demo-entries)).

## Principles

The space of visualizations is infinite, and a viewer with an option for
everything becomes unusable. Instead, the **file declares how it is meant to be
viewed**: view settings go on the dataset (or `NXdata` group), and overlay
geometry and style go on the overlay object. H5Web opens the declared
visualization with the declared settings, so the toolbar can stay small. Files
without hints are shown using heuristics, as before.

- **Types**: strings (case-insensitive values; fixed- or variable-length),
  numbers, 1D float arrays; a scalar may be stored as a 1-element array
  (netCDF-4). Booleans are integers of any width (nonzero = true) or h5py
  booleans. Paths to other objects are space-separated strings, as CF
  `coordinates`. Everything works in netCDF-4 (no references, no compounds).
- **Forgiving**: unknown `H5WEB_*` attributes are ignored; an attribute of the
  wrong type or value is ignored, with a small note over the visualization;
  attributes that can't be read drop the hint (the entity opens as without
  hint). Nothing is logged to the console.
- **Suggestions, not locks**: hinted settings apply when the dataset is opened;
  any change by the user wins while the dataset stays open (like NeXus
  `SILX_style`). The hinted visualization is selected each time the dataset is
  opened (like NeXus `interpretation`).
- **Precedence**: `H5WEB_*` attributes win over NeXus (`default`,
  `interpretation`, `SILX_style`), which wins over heuristics. On an `NXdata`
  group, the signal's attributes apply, overridden attribute by attribute by the
  group's; overlay paths are relative to the object that lists them.

## Dataset attributes

### Visualization and color

| Attribute                                   | Type          | Meaning                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_vis`                                 | string        | `heatmap`, `surface`, `line`, `curve`, `volume`, `orthoslices`, `matrix`, `scalar`, `rgb`, `compound`, `scatter`, `scatter3d`, `vector`, `complex_heatmap`, `complex_surface`, `complex_line`, `complex_curve`, `complex_points`, `param_surface` (`-`, `_` and spaces ignored). `surface`: parametric surface with CF `coordinates` ([Curves and surfaces §1](#related-pages)), else heatmap in 3D. |
| `H5WEB_title`, `long_name` (CF)             | string        | Title of the figure, on every visualization that shows one (heatmap, line, complex, orthoslices, scatter, curve and surface, volume, vector, panels); default: `long_name` (datasets with `H5WEB_*` attributes only), else the dataset name. `_{…}` and `^{…}` are drawn as sub/superscripts.                                                                                                        |
| `H5WEB_scale`                               | string        | `linear`, `log`, `symlog`, `sqrt`, `root`: color scale (and height of surfaces); y scale of line plots (`sqrt` and `root` excepted). `gamma` is not supported (ignored with a note).                                                                                                                                                                                                                 |
| `H5WEB_root_n`                              | float         | Degree n of the `root` scale (default 3), snapped to the slider grid: 0.1 to 10 by 0.05. Ignored with a note without `H5WEB_scale = "root"`.                                                                                                                                                                                                                                                         |
| `H5WEB_symlog_threshold`                    | float         | Width of the linear band around 0 of `symlog` scales (e.g. 10⁻¹² for data spanning many decades).                                                                                                                                                                                                                                                                                                    |
| `H5WEB_colormap`                            | string        | Color map name (`Viridis`, `RdBu`...), or `auto`: diverging (`RdBu`, symmetric domain unless one is given) centered on `H5WEB_center` if the shown range (fixed `H5WEB_domain` ends, else the data) spans it or with `H5WEB_symmetric`; sequential (`Viridis`) otherwise.                                                                                                                            |
| `H5WEB_invert_colormap`, `H5WEB_keep_ratio` | int           | Booleans. Default of `H5WEB_keep_ratio` on heatmaps: on when both axes have values in one unit; off when their units differ, when only one axis has values, or when an axis is labelled by strings (e.g. a string-valued scale); else as last set.                                                                                                                                                   |
| `H5WEB_domain`                              | float[2]      | Color domain; NaN = automatic bound.                                                                                                                                                                                                                                                                                                                                                                 |
| `H5WEB_symmetric`, `H5WEB_center`           | int, float    | Domain center ± max \|v − center\|; a finite end of `H5WEB_domain` wins. Center of symmetric domains and `auto` maps (default 0).                                                                                                                                                                                                                                                                    |
| `H5WEB_nan_color`                           | string        | CSS color of NaN and ignored values (3D: drawn on the floor, not as holes; log line plots: values that can't be drawn are marked on the bottom edge).                                                                                                                                                                                                                                                |
| `H5WEB_below_color`, `H5WEB_above_color`    | string        | CSS colors of values below and above the color domain (default: the end colors of the map).                                                                                                                                                                                                                                                                                                          |
| `H5WEB_categorical`                         | int           | Boolean: integer classes, one color per value and a discrete legend. Default: on with CF `flag_values` (labelled by the words of `flag_meanings`, underscores shown as spaces); CF `flag_masks` (bit fields) don't turn it on.                                                                                                                                                                       |
| `H5WEB_palette`                             | string        | `Category10`, `Tableau10`, `Glasbey`: colors of the categories, and of the curves of line multi-plots (cycled).                                                                                                                                                                                                                                                                                      |
| `H5WEB_palette_by`                          | string        | Line multi-plots: path of a 1D string dataset along `H5WEB_multi_dim`; curves with the same label get the same color. Ignored with a note without `H5WEB_palette`.                                                                                                                                                                                                                                   |
| `H5WEB_value_transform`                     | string        | `exp10`, `exp2`: the values are base-10 or base-2 logarithms, labelled as powers.                                                                                                                                                                                                                                                                                                                    |
| `H5WEB_complex`                             | string        | `amplitude`, `phase`, `phase_unwrapped`, `phase_amplitude`.                                                                                                                                                                                                                                                                                                                                          |
| `H5WEB_z_scale`, `H5WEB_z_stretch`          | string, float | 3D surfaces: scale of the height when it differs from the color scale (complex surfaces); height relative to the footprint.                                                                                                                                                                                                                                                                          |
| `H5WEB_legend`                              | int           | Boolean. The legend of labelled overlays is shown by default.                                                                                                                                                                                                                                                                                                                                        |

### Contours and volumes

| Attribute                                                        | Type          | Meaning                                                                                                             |
| ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_contour_levels`, `H5WEB_contour_count`                    | float[], int  | Heatmap contours: explicit levels, or a number of automatic levels (0 = default).                                   |
| `H5WEB_contour_labels`, `H5WEB_contour_color`                    | int, string   | Boolean: level labels on the contours; CSS color of the contours.                                                   |
| `H5WEB_contour_emphasize`                                        | float[]       | Levels drawn emphasized, even if they are not among the regular levels (e.g. `0` for nodal lines).                  |
| `H5WEB_contour_emphasize_width`, `H5WEB_contour_emphasize_color` | float, string | Width of emphasized levels in CSS pixels (default: twice the regular width); their CSS color.                       |
| `H5WEB_contour_of`                                               | string        | Path of another dataset on the same grid, whose contours are drawn instead of this dataset's.                       |
| `H5WEB_iso_levels`                                               | float[]       | Initial isosurfaces of volumes.                                                                                     |
| `H5WEB_iso_smooth`                                               | int           | Boolean. Volumes: isosurfaces and pass region follow a cubic spline through the data (default: on grids up to 40³). |
| `H5WEB_pass_min`, `H5WEB_pass_max`                               | float, float  | Volumes: closed region where min ≤ value ≤ max (either bound optional), with the fraction of the box it fills.      |
| `H5WEB_slice_position`                                           | int[3]        | Orthoslices: indices of the crosshair along the last three dimensions.                                              |

### Line plots

| Attribute                                                 | Type                       | Meaning                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_x_dim`, `H5WEB_multi_dim`                          | string or int              | Dimension on the x axis; dimension whose slices are all plotted. By dimension-scale name (dataset name or `NAME`), dimension label (`DIMENSION_LABELS`), or index.                                                                                                                                                                        |
| `H5WEB_label`, `H5WEB_color`, `H5WEB_width`, `H5WEB_dash` | string, string, float, int | The dataset's own curve: legend entry (default: CF `long_name`; complex points: no legend entry without `H5WEB_label`, and the points are named after the dataset), CSS color (not in multi-plots), width in CSS pixels, dashed (boolean). On scatter plots, `H5WEB_color` is the path of the color values or a CSS color for all points. |
| `H5WEB_interpolation`                                     | string                     | Between samples: `linear`, `constant` (steps), `pchip`, `spline` (C² cubic, not-a-knot).                                                                                                                                                                                                                                                  |
| `H5WEB_series`                                            | string                     | Paths of extra datasets drawn on the same axes and sliced along with this one. Each is styled by its own `H5WEB_label` (default: CF `long_name`), `H5WEB_color`, `H5WEB_width` and `H5WEB_dash`.                                                                                                                                          |
| `H5WEB_band`                                              | string                     | Paths of the lower and upper bounds (same shape as the data) of a filled area around each curve.                                                                                                                                                                                                                                          |
| `H5WEB_band_opacity`, `H5WEB_band_only`                   | float, int                 | Opacity of the band, in (0, 1] (default 0.25); boolean: band without its curve. Both are ignored with a note without `H5WEB_band`.                                                                                                                                                                                                        |
| `H5WEB_envelope`                                          | string                     | `cummin`, `cummax`: running minimum or maximum.                                                                                                                                                                                                                                                                                           |
| `H5WEB_envelope_mode`, `H5WEB_envelope_direction`         | string, string             | `add` (default: drawn over the data) or `replace`; `forward` (default) or `reverse` (from each value to the end).                                                                                                                                                                                                                         |
| `H5WEB_marker`, `H5WEB_size`                              | string, float              | Complex points: marker of the dataset's own points (`dot`, `x`, `o`) and radius in CSS pixels. On scatter plots, `H5WEB_size` is the path of the size values.                                                                                                                                                                             |

### Stacks, playback and panels

| Attribute                                     | Type                  | Meaning                                                                                                                                      |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_probe_dim`                             | string or int         | Heatmap stacks: clicking a pixel plots its values along this dimension (same forms as `H5WEB_x_dim`).                                        |
| `H5WEB_projection`, `H5WEB_projection_dim`    | string, string or int | Heatmap stacks: `max`, `min`, `mean`, `sum` reduce a dimension instead of slicing it; the dimension reduced (default: the first sliced one). |
| `H5WEB_playback_dim`                          | string or int         | Dimension played by default.                                                                                                                 |
| `H5WEB_playback_fps`                          | float                 | Initial playback speed, in frames per second.                                                                                                |
| `H5WEB_playback_mode`, `H5WEB_playback_range` | string, string        | `loop`, `bounce`, `once`; `sequence` or `frame` (fetch one slice at a time).                                                                 |
| `H5WEB_playback_skip_empty`                   | int                   | Boolean: playback and steps skip slices that are all NaN or ignored.                                                                         |
| `H5WEB_multiples_dim`                         | string or int[]       | Small multiples: a panel per index of one or two dimensions (rows, then columns), as space-separated names or as indices.                    |
| `H5WEB_multiples_columns`                     | int                   | Small multiples of one dimension: panels per row.                                                                                            |
| `H5WEB_link_axes`, `H5WEB_link_cursor`        | int                   | Booleans (default: on): panels (small multiples or `H5WEB_panels`) zoom and pan together; crosshair at the same coordinates in every panel.  |
| `H5WEB_overlays`                              | string                | Paths of the objects drawn on top, space-separated, in drawing order (see [Overlays](#overlays)).                                            |
| `H5WEB_slice_by`                              | string                | Dimension scale linking the overlays when the dataset has no such dimension (see [Linking](#linking-shared-dimension-scales)).               |

### Scatter plots

With `H5WEB_vis = "scatter"` or `"scatter3d"`, points come from the columns of
an `(n, k)` dataset, from the rows of a `(G, P)` dataset with `H5WEB_x_dim`
(each value against its index, or its dimension scale, along that dimension),
from a 1D dataset with 1D CF `coordinates` (colored by its values), or from a
group naming 1D datasets of the same length:

| Attribute               | Type               | Meaning                                                                                                                                                                                                              |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_x`, `H5WEB_y`    | string             | Group form: paths of the x and y datasets (both required), resolved like overlay paths.                                                                                                                              |
| `H5WEB_z`               | string             | Group form: path of the z dataset (3D).                                                                                                                                                                              |
| `H5WEB_color`           | string             | Group form: path of the color values, or a CSS color for all points; columns form: CSS color of all points without a color column.                                                                                   |
| `H5WEB_size`            | string             | Group and CF `coordinates` forms: path of the size values.                                                                                                                                                           |
| `H5WEB_scatter_columns` | string             | Columns form: channel of each column, space-separated, among `x`, `y`, `z`, `color`, `size`, or `-` to skip a column (columns beyond the list are skipped). Default: `x y color size` (2D), `x y z color size` (3D). |
| `H5WEB_column_labels`   | string or string[] | Columns form: label of each column, space-separated or as an array (default: a string dimension scale on the columns, else the channel name).                                                                        |
| `H5WEB_size_range`      | float[2]           | Diameters, in CSS pixels, of the smallest and largest size values (at most 100).                                                                                                                                     |
| `H5WEB_point_size`      | float              | Diameter of the points without size values, in CSS pixels (at most 100).                                                                                                                                             |
| `H5WEB_point_opacity`   | float              | Opacity of the points, in (0, 1].                                                                                                                                                                                    |

### Vector fields

With `H5WEB_vis = "vector"`, a dataset whose last dimension holds the
components, `(…, ny, nx, 2)` or `(…, nz, ny, nx, 3)`, or a group naming one
dataset per component, is drawn as a vector field:

| Attribute                       | Type   | Meaning                                                                                                                                                   |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_u`, `H5WEB_v`, `H5WEB_w` | string | Group form: paths of the x, y and (3D) z components, numeric arrays of the same shape, resolved like overlay paths. `H5WEB_u` and `H5WEB_v` are required. |
| `H5WEB_vector_style`            | string | `arrows`, `streamlines` or `lic` (line integral convolution).                                                                                             |
| `H5WEB_vector_background`       | string | `magnitude`, `none`, `divergence`, `curl` (scalar vorticity, 2D), or the path of a scalar dataset (relative to the object holding the attribute).         |
| `H5WEB_arrow_length`            | string | `magnitude` (arrows scaled by it) or `uniform`.                                                                                                           |
| `H5WEB_arrow_density`           | float  | Arrows per 100 CSS pixels, clamped to 0.5 to 20 (default 3).                                                                                              |

### Panels

A group with `H5WEB_panels` shows datasets side by side, each as a line (1D, or
`H5WEB_vis = "line"`) or as a heatmap; this view is selected before NeXus views.
The group can also carry `H5WEB_symmetric`, `H5WEB_center`, `H5WEB_link_axes`
and `H5WEB_link_cursor`, with the same meaning as above.

| Attribute             | Type     | Meaning                                                                                                            |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `H5WEB_panels`        | string   | Paths of the datasets, space-separated, relative to the group. Those that can't be shown are left out with a note. |
| `H5WEB_layout`        | int[2]   | Rows and columns of the grid of panels.                                                                            |
| `H5WEB_shared_domain` | float[2] | Color domain shared by the heatmap panels; NaN = automatic bound.                                                  |

### Explorer

| Attribute    | Type   | Meaning                                                                                                                                                                       |
| ------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_role` | string | How the explorer lists the object: `axis` or `auxiliary` (muted, as auxiliary data), or `data` (not muted, even if it is a dimension scale, a CF coordinate or overlay data). |

### Dimension scales

These attributes go on a dimension scale (or, for `H5WEB_slice_labels`, also on
the dataset itself) and apply to every dataset it is attached to:

| Attribute                | Type   | Meaning                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H5WEB_axis_scale`       | string | `linear`, `log`, `symlog`: scale of the axis (linear with a note if the values can't be shown, e.g. non-positive values on a log axis).                                                                                                                                                                                                                  |
| `H5WEB_symlog_threshold` | float  | Width of the linear band around 0 of a `symlog` axis.                                                                                                                                                                                                                                                                                                    |
| `H5WEB_ticks`            | string | `pi`: ticks at multiples of π.                                                                                                                                                                                                                                                                                                                           |
| `H5WEB_slice_labels`     | string | Path of a 1D string dataset (at most 10000 strings) labelling the indices of the dimension on its slider. On a numeric scale, labels its dimension; on a dataset, labels the dimension that shares a dimension scale with the labels, else the only one of their length. A string-valued scale attached to a dimension labels it without this attribute. |

## Overlays

`H5WEB_overlays` lists objects to draw on top of the dataset (the **base**), in
its **data coordinates**: values of its axes (dimension scales or NeXus axes),
not indices. Overlays are drawn on heatmaps, 3D surfaces and, for reference
lines and bands, line plots; other visualizations note that overlays are not
drawn. Each listed object says what it draws with `H5WEB_geometry` and carries
its own style, written once and shared by every dataset that lists it:

| `H5WEB_geometry` | Object                                                                    | Draws                                                                                                     |
| ---------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `points`         | `(N, d)` dataset (or `(d,)` for one point; complex `(N,)` as re, im)      | markers                                                                                                   |
| `curve`          | `(N, d)` dataset                                                          | polyline; a row with a NaN breaks it                                                                      |
| `circle`         | `(3,)` dataset `[cx, cy, r]`, or `(G, 3)` sliced along a linked dimension | circle, e.g. the unit circle of a z-plane                                                                 |
| `ellipse`        | group with `H5WEB_mean` and `H5WEB_cov`                                   | covariance ellipses of N(mean, σ² cov) at `nsigma` standard deviations, marginal on the two shown columns |
| `text`           | scalar string dataset (the text) with `H5WEB_at`                          | text annotation                                                                                           |
| `hline`, `vline` | scalar or `(1,)` dataset                                                  | line plots: reference line at that y or x value                                                           |
| `band`           | `(2,)` dataset `[lo, hi]` with `H5WEB_axis`                               | line plots: shaded interval along that axis                                                               |

Attributes of the overlay object (all optional, except those its geometry
needs):

| Attribute            | Type     | Meaning                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `H5WEB_columns`      | string   | `"alpha theta"` names the base dimension (by dimension-scale name) held by each column, and by each component of `H5WEB_at`; columns naming no base dimension are not drawn. Default: column 0 = last HDF5 dimension (x), column 1 = second-to-last (y). Writers should always give it. Overlays follow the axes when the user swaps them. |
| `H5WEB_color`        | string   | CSS color of lines, of points without `H5WEB_color_by`, and of text.                                                                                                                                                                                                                                                                       |
| `H5WEB_color_by`     | string   | Path of an `(N,)` dataset coloring the points with the base color map.                                                                                                                                                                                                                                                                     |
| `H5WEB_marker`       | string   | Points: `dot` (default), `x`, `o`.                                                                                                                                                                                                                                                                                                         |
| `H5WEB_size`         | float    | Point radius, in CSS pixels.                                                                                                                                                                                                                                                                                                               |
| `H5WEB_width`        | float    | Line width, in CSS pixels.                                                                                                                                                                                                                                                                                                                 |
| `H5WEB_dash`         | int      | Boolean: dashed lines.                                                                                                                                                                                                                                                                                                                     |
| `H5WEB_halo`         | int      | Boolean (default 1): contrasting halo around lines, points and text.                                                                                                                                                                                                                                                                       |
| `H5WEB_stroke`       | string   | CSS color of point outlines.                                                                                                                                                                                                                                                                                                               |
| `H5WEB_label`        | string   | Label of the overlay.                                                                                                                                                                                                                                                                                                                      |
| `H5WEB_label_mode`   | string   | `legend` (default) or `inline`: drawn next to the overlay.                                                                                                                                                                                                                                                                                 |
| `H5WEB_legend_label` | string   | Legend entry regardless of `H5WEB_label` (e.g. with an inline label); alike entries are shown once.                                                                                                                                                                                                                                        |
| `H5WEB_z`            | string   | 3D points: path of an `(N,)` dataset of heights, `value` (the `H5WEB_color_by` values), or `surface` (default). Without `H5WEB_columns`, the third column of `(N, 3)` points is their height.                                                                                                                                              |
| `H5WEB_trail`        | int      | Boolean, curves: rows up to the current index only (see [Linking](#linking-shared-dimension-scales)).                                                                                                                                                                                                                                      |
| `H5WEB_slice_by`     | string   | Dimension scale linking the overlay's leading dimension (see [Linking](#linking-shared-dimension-scales)).                                                                                                                                                                                                                                 |
| `H5WEB_mean`         | string   | Ellipses: path of the `(d,)` mean.                                                                                                                                                                                                                                                                                                         |
| `H5WEB_cov`          | string   | Ellipses: path of the `(d, d)` covariance.                                                                                                                                                                                                                                                                                                 |
| `H5WEB_sigma`        | string   | Ellipses: path of a scalar dataset σ (step size).                                                                                                                                                                                                                                                                                          |
| `H5WEB_nsigma`       | float[]  | Ellipses: numbers of standard deviations (default `[1, 2]`).                                                                                                                                                                                                                                                                               |
| `H5WEB_at`           | float[2] | Text: position, in axis values (components ordered like columns).                                                                                                                                                                                                                                                                          |
| `H5WEB_anchor`       | string   | Text: side of `H5WEB_at` where the text goes: `top`, `bottom`, `left`, `right`, `center` (default).                                                                                                                                                                                                                                        |
| `H5WEB_axis`         | string   | Bands: `x` or `y`, the axis of `[lo, hi]`.                                                                                                                                                                                                                                                                                                 |

- **Paths**: absolute (`/coalescence/edge`), relative to the base's group
  (`../run/mean`, `sub/x`), or a bare name also searched in ancestor groups
  (CF-style, see [Curves and surfaces §1](#related-pages)). For a hint on an
  `NXdata` group, relative to that group. Paths written on an overlay object
  (`H5WEB_color_by`, `H5WEB_z`, `H5WEB_mean`...) are relative to the group
  holding that object (bare names are searched from there up), so one overlay
  can be shared by bases anywhere.
- **Coordinates are sample positions**: a coordinate equal to an axis value is
  where that sample is drawn: at the center of its pixel on heatmaps (which draw
  each of N axis values as the start of a pixel; with N + 1 bin edges,
  coordinates are used as is), at the vertex on 3D surfaces.
- **Robustness**: overlays are drawn above the image, so NaN pixels never hide
  them, and they are not clipped at the edges of the domain. An overlay that
  can't be resolved (missing object, no geometry, wrong shape, unreadable
  values) is skipped with a small note; it never breaks the base view. Values
  larger than the automatic fetch limit (500 MB) are skipped with a note; point
  sets of more than 5000 points are drawn as plain GL points.
- **3D**: text overlays, dashes and inline labels are not drawn on 3D surfaces
  (a note says so).
- **Style is per overlay object**: to draw the same data twice in different
  styles (e.g. a mean as a trail and as an ellipse center), the ellipse
  references the data by path and only the drawn object carries style.

## Linking: shared dimension scales

Datasets are **linked** (sliced and played together) when the **same HDF5
dimension scale** is attached to one of their dimensions (e.g. `generation` on
the first dimension of the population, fitness, mean, covariance and step size
of an optimizer; h5py: `make_scale`, `dims[0].attach_scale`):

- if the base has a dimension with that scale (e.g. a landscape per generation
  `(G, ny, nx)`), its slider slices the overlays too, and playback prefetches
  their slices with the base's;
- if it doesn't (e.g. a fixed landscape `f(x, y)`), H5Web adds a **linked
  slider** named after the scale below the dimension mapper.
  `H5WEB_slice_by = "<scale name or path>"` on the base names the scale; on an
  overlay object, it names the scale linking the overlay's leading dimension,
  attached or not (e.g. netCDF-4 data whose dimensions are phony). Else the
  scale on the first dimension of an overlay dataset that needs slicing is used.
- scales of the base's axes (its last two dimensions) are never taken as links
  unless named by `H5WEB_slice_by`: a curve along the x axis with the x scale
  attached is drawn whole.
- netCDF-4 phony dimension scales (`NAME` "This is a netCDF dimension but not a
  netCDF variable") are never axes, links, nor column names.
- `H5WEB_trail = 1` (curves): rows up to the current index only, e.g. the path
  of the mean so far.

Overlay datasets with no linked dimension are drawn whole on every slice (static
overlays). A dataset with no dimension scale at all whose first dimension has
the linked length is linked by that dimension (for providers that cannot read
dimension scales).

## Examples (h5py)

```python
# Field on [0, π]²: symlog, automatic diverging map, static overlays given as [alpha, theta]
c = f.create_group("coalescence")
for name, data, geometry, label in [("electron_nucleus_1", [[0, 0], [0, np.pi]], "curve", "r_{1} = 0"),
                                    ("electron_electron", [[np.pi / 2, 0]], "points", "r_{12} = 0")]:
    c[name] = data
    c[name].attrs.update({"H5WEB_geometry": geometry, "H5WEB_columns": "alpha theta",
                          "H5WEB_color": "#000", "H5WEB_label": label, "H5WEB_label_mode": "inline"})
f["psi30"].attrs.update({"long_name": "ψ_{3,0}(α, θ)", "H5WEB_vis": "heatmap", "H5WEB_scale": "symlog",
                         "H5WEB_colormap": "auto", "H5WEB_keep_ratio": 1,
                         "H5WEB_overlays": "/coalescence/electron_nucleus_1 /coalescence/electron_electron"})

# Optimizer run on a landscape, linked by the `generation` scale
gen = run.create_dataset("generation", data=np.arange(G))
gen.make_scale("generation")
for name in ("population", "fitness", "mean", "C", "sigma"):  # (G, λ, 2), (G, λ), (G, 2), (G, 2, 2), (G,)
    run[name].dims[0].attach_scale(gen)
run["population"].attrs.update({"H5WEB_geometry": "points", "H5WEB_color_by": "fitness", "H5WEB_columns": "x y"})
run["mean"].attrs.update({"H5WEB_geometry": "curve", "H5WEB_trail": 1, "H5WEB_columns": "x y", "H5WEB_label": "mean"})
ellipse = run.create_group("ellipse")
ellipse.attrs.update({"H5WEB_geometry": "ellipse", "H5WEB_mean": "mean", "H5WEB_cov": "C",
                      "H5WEB_sigma": "sigma", "H5WEB_columns": "x y"})
run["f"].attrs.update({"H5WEB_vis": "heatmap", "H5WEB_slice_by": "generation",  # no generation dimension
                       "H5WEB_overlays": "population ellipse mean"})

# Convergence curves: (G, n) with generation on dim 0, all n lines, log y
conv["sqrt_eigenvalues"].attrs.update({"H5WEB_vis": "line", "H5WEB_scale": "log",
                                       "H5WEB_x_dim": "generation", "H5WEB_multi_dim": 1})
```

## Demo entries

The mock file of the demo app
([`packages/app/src/providers/mock/mock-file.ts`](../packages/app/src/providers/mock/mock-file.ts))
has a `/view_hints` group with an entry per hint, and an `/axis_hints` group for
the attributes of dimension scales. Open them in the mock demo (`pnpm start`,
then "Mock data", or the `/mock` route) to see each hint in action. Entries of
`/view_hints`:

| Entry                                                                                 | Shows                                                                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `landscape`, `landscapes`                                                             | overlays linked by the `generation` scale: points colored by fitness, ellipse, mean trail; `H5WEB_slice_by`                             |
| `landscape_broken`, `bad_attrs`, `line_overlays`                                      | notes for missing overlays and attributes of the wrong type                                                                             |
| `psi`, `psi_pi`, `line_pi`                                                            | `symlog` with an `auto` map; curve, point and text overlays with inline labels; `H5WEB_ticks = "pi"`                                    |
| `symlog_heatmap`, `symlog_line`, `root`                                               | `H5WEB_symlog_threshold`; `root` scale with `H5WEB_root_n`                                                                              |
| `nodal`, `nodal_amplitude`, `contour_of_mismatch`                                     | emphasized contour levels and labels; `H5WEB_contour_of`                                                                                |
| `probe_stack`, `probe_log`                                                            | `H5WEB_probe_dim`                                                                                                                       |
| `nan_color`, `beyond_colors`                                                          | `H5WEB_nan_color`; `H5WEB_below_color`, `H5WEB_above_color`                                                                             |
| `skip_blank`, `skip_blank_start`, `playback_settings`                                 | `H5WEB_playback_skip_empty`; `H5WEB_playback_fps`, `_mode`, `_range`                                                                    |
| `volume_iso`, `volume_smooth`, `volume_pass`, `volume_points`                         | `H5WEB_iso_levels`, smooth isosurfaces, pass region, points overlay in 3D                                                               |
| `landscape_large`                                                                     | large point sets and values over the fetch limit                                                                                        |
| `surface`, `constant`                                                                 | `H5WEB_z_stretch`; `auto` map on constant data                                                                                          |
| `line`, `line_curves`, `line_nan_curves`, `legend_spectrum`                           | `H5WEB_x_dim`, `H5WEB_multi_dim`                                                                                                        |
| `line_palette`, `line_band`, `line_band_only`                                         | `H5WEB_interpolation`, `H5WEB_palette`, `H5WEB_palette_by`; `H5WEB_band`                                                                |
| `value_transform_line`, `value_transform_heatmap`                                     | `H5WEB_value_transform`                                                                                                                 |
| `envelope_add`, `envelope_replace`                                                    | `H5WEB_envelope`, `_mode`, `_direction`                                                                                                 |
| `series_data`                                                                         | `H5WEB_series` with styled series                                                                                                       |
| `line_references`, `line_zeros`                                                       | `hline`, `vline` and `band` overlays; zeros on a log scale                                                                              |
| `nx_overlay`, `nx_merged`, `nx_line`                                                  | hints on `NXdata` groups                                                                                                                |
| `phony_stack`, `cf_heatmap`, `cf_line`, `stack_overlays`                              | netCDF-4 phony dimensions, CF data, overlays on stacks                                                                                  |
| `ortho`, `ortho_stack`, `volume_stack`, `volume_flat`                                 | `orthoslices` with `H5WEB_slice_position`; volumes                                                                                      |
| `projection_max`, `projection_mean`                                                   | `H5WEB_projection`, `H5WEB_projection_dim`                                                                                              |
| `multiples`, `multiples_k`                                                            | `H5WEB_multiples_dim`, `H5WEB_multiples_columns`                                                                                        |
| `complex_phase`                                                                       | `H5WEB_complex`                                                                                                                         |
| `panels`                                                                              | `H5WEB_panels`, `H5WEB_layout`                                                                                                          |
| `band_no_axis`, `volume_flat`                                                         | `H5WEB_role`                                                                                                                            |
| `scatter/columns`, `scatter/two_d`, `scatter/group`, `scatter/fitness`, `scatter/big` | scatter forms, `H5WEB_scatter_columns`, `H5WEB_column_labels`, `H5WEB_x`, `H5WEB_size_range`, `H5WEB_point_size`, `H5WEB_point_opacity` |
| `vector/vortex`, `vector/dipole`, `vector/components`                                 | `H5WEB_vector_style`, `H5WEB_vector_background`, `H5WEB_arrow_length`, `H5WEB_arrow_density`, `H5WEB_u`                                 |
| `categorical/segmentation`, `categorical/land_cover`, `categorical/clusters`          | `H5WEB_categorical`, CF `flag_values`, `H5WEB_palette`                                                                                  |
| `pole_zero/poles`, `pole_zero/s_poles`                                                | `complex_points` with `H5WEB_marker`, `circle` and `vline` overlays                                                                     |

Entries of `/axis_hints`:

| Entry                                                              | Shows                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `log_heatmap`, `log_line` (scales `rho`, `chi`)                    | `H5WEB_axis_scale` (`log`, `symlog`) with `H5WEB_symlog_threshold`             |
| `log_fallback`                                                     | notes for an invalid `H5WEB_axis_scale` and non-positive values on a log axis  |
| `packages`, `own_labels`, `bad_labels`, `too_many_labels`, `blend` | `H5WEB_slice_labels`                                                           |
| `jacobian` (scales `component`, `input`)                           | string-valued scale: no square pixels by default                               |
| `playback_dim`                                                     | `H5WEB_playback_dim` as the path of a scale                                    |
| `volume_log`, `volume_exp10`, `volume_symlog`                      | `H5WEB_scale` and `H5WEB_value_transform` of volumes, `H5WEB_symlog_threshold` |

## Related pages

The [Curves and surfaces](../apps/storybook/src/CurvesAndSurfaces.mdx) page of
the Storybook site describes the conventions that view hints build on: §1, a
field on a curve or surface with CF `coordinates` (also how bare names are
searched in ancestor groups); §2, HDF5 dimension scales; §3, NeXus
`interpretation="vertex"`; §4, NeXus.
