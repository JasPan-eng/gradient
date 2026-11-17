# Gradient

A small web tool for making gradients.

**Live:** https://jaspan-eng.github.io/gradient/

- Build linear, radial and conic gradients. Click the bar to add a stop, drag to move it, drag the preview to turn the gradient or move its center.
- **Hotspots:** place points, or a smooth curve through them, right on the canvas; the gradient starts there and spreads outward.
- **Reaction:** a Gray-Scott reaction-diffusion simulation, after Karl Sims's tutorial, grown from the hotspots and colored by the gradient. It runs on the GPU (WebGL2) with a JavaScript fallback.
- Pull a gradient out of an image: drop, paste or browse for one, then either drag a line across it or take its main colors. Images are read in the browser and never uploaded.
- Export as CSS, SVG, JSON, PNG or JPG at any size, or copy a link that reopens the same gradient.
- **Effects:** color grades (ten built in, or load your own `.cube` LUTs, which stay in your browser), blur (soft, motion, zoom, spin), halftone (color dots, two inks, CMYK, lines), print texture, and ready-made looks such as Riso and Newsprint.
- **Formula:** a cloner-style composition from three variables, arrangement × shape × effector, colored by the gradient. "Today's" gives a formula seeded by the date. New variables are one line each in the three tables in `app.js`.
- **Type:** kicker, headline, body and footer in ready-made layouts (poster, editorial, centered, split, statement) that keep margins, wrap to a column and step the sizes down. A grid overlay, a shade for readability, and carousel slides with page numbers.
- **Social sizes:** Instagram 4:5, Story 9:16, Square, Threads 3:4 and X 16:9, or all five in one zip. Carousels download as a zip of slides.
- **Steps** cuts the gradient into flat bands. Drag the dots on the canvas to move stops; drag a stop off the bar to remove it. Save gradients to reuse them later.
- Presets, film grain (baked into PNG and JPG downloads), undo and redo, light and dark themes, a focus mode that hides the controls (`F`), and keyboard shortcuts (`?` lists them).
- "Smooth" blending mixes colors in OKLab, which avoids the muddy middle that plain sRGB blending gives.

No build step and no dependencies: `index.html`, `style.css`, `app.js`. Open `index.html` to run it locally.
