# Source and build path

The public repository history contains only the deployed static site: hashed JavaScript/CSS bundles, HTML, icons, and service worker. It has no original component source, package manifest, build configuration, or source maps. The authored pre-bundle source therefore cannot be recovered from this checkout.

`src/app.js` and `src/app.css` are preserved working copies of the current deployed application bundle and styles. They are the editable source of truth for this recovered static workflow, but they are **not** the original authored source. Run `npm run build` to copy them to `assets/app.js` and `assets/app.css` and update the HTML/service worker references. No transpilation or dependency installation is required.

When original source becomes available, replace this recovered workflow with the original modular source and its actual build toolchain.
