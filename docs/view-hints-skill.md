---
name: h5web-view-hints
description: Use when writing or editing HDF5 (or netCDF-4) files meant to be viewed in H5Web or the H5Web VS Code extension (h5web fork), e.g. with h5py, HighFive or the HDF5 C/C++ API, and you want a dataset to open in a specific view (heatmap, line, volume, isosurfaces, overlays, playback, log/symlog scale, color map, titles, legends). Covers the native `H5WEB_*` attributes ("view hints") and where their full reference lives.
---

# H5Web view hints

<!-- Installed by the H5Web (fork) VS Code extension from docs/view-hints-skill.md
     in NAThompson/h5web; replaced on each update, so edit it there. -->

H5Web (Nick Thompson's fork, also packaged as the VS Code extension
`nathompson.vscode-h5web`) reads **native HDF5 attributes named `H5WEB_*`** on
datasets and `NXdata` groups to choose the visualization and its settings. Plain
strings, numbers and 1D float arrays only (no JSON, no references, no
compounds), so they work in netCDF-4 too. Unknown attributes are ignored;
invalid values are ignored with a small note over the visualization.

## Full reference: read it before writing hints

The cheat sheet below is incomplete. Read the full table of every attribute,
which matches the installed viewer version:

    {{VIEW_HINTS_PATH}}

(else https://github.com/NAThompson/h5web/blob/fork/docs/view-hints.md). It has
tables per topic (visualization and color, contours and volumes, line plots,
stacks and playback, scatter, vector, panels, dimension scales, overlays),
linking via shared dimension scales, h5py examples, and demo entries
(`/view_hints/*`, `/axis_hints/*` in the H5Web demo file).

## Cheat sheet (h5py)

```python
# Heatmap: symlog color scale, diverging map centered on 0, square pixels
f["psi"].attrs.update({"H5WEB_vis": "heatmap", "H5WEB_scale": "symlog",
                       "H5WEB_colormap": "auto", "H5WEB_keep_ratio": 1,
                       "H5WEB_title": "ψ₃₀(α, θ)"})

# Volume with two isosurfaces and a "spec passing" region min ≤ f ≤ max
f["density"].attrs.update({"H5WEB_vis": "volume", "H5WEB_iso_levels": [0.2, 0.5],
                           "H5WEB_pass_min": 0.5})

# Lines: (G, n) with the `generation` dimension scale on x, all n curves, log y
f["err"].attrs.update({"H5WEB_vis": "line", "H5WEB_scale": "log",
                       "H5WEB_x_dim": "generation", "H5WEB_multi_dim": 1,
                       "H5WEB_label": "error", "H5WEB_dash": 1})
```

- `H5WEB_vis`: `heatmap`, `line`, `curve`, `surface`, `volume`, `orthoslices`,
  `matrix`, `scalar`, `rgb`, `scatter`, `scatter3d`, `vector`, `complex_*`...
- `H5WEB_scale`: `linear`, `log`, `symlog`, `sqrt`, `root`. `H5WEB_domain`:
  `[min, max]`, NaN for an automatic bound.
- Booleans are integers (nonzero = true). Dimensions are named by dimension
  scale, `DIMENSION_LABELS` entry, or index.
- Overlays: `H5WEB_overlays` = space-separated paths of objects carrying
  `H5WEB_geometry` (`points`, `curve`, `ellipse`, `circle`, `hline`, `vline`,
  `band`...) and `H5WEB_columns` (which axis each column holds; always give it).
- Axis scale of a dimension scale: `H5WEB_axis_scale` on the scale dataset.

Check exact names, types and defaults in the full reference; don't invent
attributes. H5Web reports a misspelled hint value as a note in the viewer.
