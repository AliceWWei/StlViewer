# Sample models

| File | Source | License |
|------|--------|---------|
| `3DBenchy.stl` | [3DBenchy](https://www.3dbenchy.com/) by Creative Tools, from [CreativeTools/3DBenchy](https://github.com/CreativeTools/3DBenchy) (unmodified) | [CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/) |
| `gear.stl`, `teapot.stl`, `vase.stl` | Generated with Three.js by `scripts/generate-samples.mjs` | Same as this repository |
| `box.stl` | Hand-written ASCII STL | Same as this repository |

Note: `3DBenchy.stl` is a *binary* STL whose 80-byte header happens to start with the text `solid`,
so a loader cannot tell ASCII from binary by the first word alone. Three.js' `STLLoader` checks
whether the file size equals `84 + 50 × triangleCount` instead.
