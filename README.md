# Gradient

A small web tool for making gradients.

**Live:** https://jaspan-eng.github.io/gradient/

- Build linear, radial and conic gradients. Click the bar to add a stop, drag to move it, drag the preview to turn the gradient or move its center.
- **Hotspots:** place points, or a smooth curve through them, right on the canvas; the gradient starts there and spreads outward.
- **Reaction:** a Gray-Scott reaction-diffusion simulation, after Karl Sims's tutorial, grown from the hotspots and colored by the gradient. It runs on the GPU (WebGL2) with a JavaScript fallback.
- Pull a gradient out of an image: drop, paste or browse for one, then either drag a line across it or take its main colors. Images are read in the browser and never uploaded.
- Export as CSS, SVG, JSON, PNG or JPG at any size, or copy a link that reopens the same gradient.
- Presets, film grain (baked into PNG and JPG downloads), undo and redo, light and dark themes, a focus mode that hides the controls (`F`), and keyboard shortcuts (`?` lists them).
- "Smooth" blending mixes colors in OKLab, which avoids the muddy middle that plain sRGB blending gives.

No build step and no dependencies: `index.html`, `style.css`, `app.js`. Open `index.html` to run it locally.
