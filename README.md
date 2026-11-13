# STL / OBJ Viewer

A browser-based 3D model viewer for 3D-printing files, built with **React + TypeScript + Three.js (WebGL)**.

**Live demo:** https://alicewwei.github.io/stl-viewer/

![screenshot](docs/screenshot.png)

## Features

- Load **STL** (binary and ASCII) and **OBJ** files via file picker or drag-and-drop
- Orbit / zoom / pan camera controls with damping
- Hemisphere + key/fill directional lighting, PBR material
- Converts CAD **Z-up** coordinates to Three.js **Y-up**, centres the model and places it on the build plate
- Auto-frames the camera to fit the model
- Shows triangle count and bounding-box dimensions

## Architecture

```
src/
├── viewer/
│   ├── Viewer.ts      # Framework-agnostic Three.js viewer (scene, camera, lights, render loop, disposal)
│   └── loadModel.ts   # File → BufferGeometry parsing (STL / OBJ, OBJ meshes merged)
├── components/
│   └── ViewerCanvas.tsx  # Thin React wrapper: mounts/disposes the Viewer, pushes new geometry
└── App.tsx            # UI: file input, drag-and-drop, model info panel
```

The rendering code lives in a plain TypeScript class rather than inside React components. React only owns the lifecycle (create on mount, `dispose()` on unmount), which keeps the 3D logic unit-testable and portable (e.g. to an Electron shell). GPU resources (geometries, materials, the WebGL context) are released explicitly, since JavaScript garbage collection does not free GPU memory.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

A sample model is included at `public/samples/box.stl`.

## Roadmap

- [ ] Measurement tool (point-to-point distance)
- [ ] Bounding box overlay
- [ ] Volume calculation (signed tetrahedron method) and print-material estimate
- [ ] Slice preview (cross-section at a given Z height)
- [ ] Unit tests (Vitest) for geometry utilities
- [ ] Electron desktop packaging

## Tech stack

React 19 · TypeScript · Vite · Three.js · GitHub Actions / Pages
