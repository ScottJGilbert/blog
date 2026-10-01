/**
 * Webpack (pre) loader for the Lexical editor package's CSS.
 *
 * `@scottjgilbert/lexical-blog-editor/build/index.css` starts with
 *   @import "https://fonts.googleapis.com/css?family=Reenie+Beanie";
 * (a handwriting font for sticky notes). A failing @import makes the browser report the whole stylesheet as failed,
 * which Next surfaces as a ChunkLoadError and crashes the editor page when the font host is blocked/offline/behind a
 * TLS-intercepting proxy. We do not modify the package: we only drop remote @imports while bundling its CSS.
 * Everything else (all editor styles) is untouched.
 */
module.exports = function stripRemoteCssImports(source) {
  return String(source).replace(/^[ \t]*@import\s+(?:url\(\s*)?["']?https?:\/\/[^;\n]*;?[ \t]*$/gim, "/* remote @import removed by build-tools/strip-remote-css-imports.cjs */");
};
