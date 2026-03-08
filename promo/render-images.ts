import { readFileSync, writeFileSync } from "fs";

// Read SVGs and create HTML wrappers for rendering
const ogSvg = readFileSync("/Users/satchmo/code/neighborhood/promo/og-image.svg", "utf-8");
const heroSvg = readFileSync("/Users/satchmo/code/neighborhood/promo/hero-banner.svg", "utf-8");

// Write HTML files that can be screenshot'd
const ogHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;}</style></head><body>${ogSvg}</body></html>`;
const heroHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;}</style></head><body>${heroSvg}</body></html>`;

writeFileSync("/Users/satchmo/code/neighborhood/promo/og-render.html", ogHtml);
writeFileSync("/Users/satchmo/code/neighborhood/promo/hero-render.html", heroHtml);

console.log("HTML render files created. Use browser screenshot to capture as PNG.");
