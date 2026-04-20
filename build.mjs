import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const distDir = "dist";
const rendererDist = join(distDir, "renderer");

mkdirSync(distDir, { recursive: true });
mkdirSync(rendererDist, { recursive: true });

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["electron"],
  outfile: join(distDir, "main.js"),
});

const rendererEntries = ["app", "parser", "waybar", "schema", "system"];
for (const file of rendererEntries) {
  await esbuild.build({
    entryPoints: [`renderer/${file}.ts`],
    bundle: false,
    platform: "browser",
    target: "es2020",
    format: "esm",
    outfile: join(rendererDist, `${file}.js`),
  });
}

if (existsSync("preload.js")) cpSync("preload.js", join(distDir, "preload.js"));
if (existsSync("renderer/index.html")) cpSync("renderer/index.html", join(rendererDist, "index.html"));
if (existsSync("renderer/style.css")) cpSync("renderer/style.css", join(rendererDist, "style.css"));
if (existsSync("assets")) cpSync("assets", join(distDir, "assets"), { recursive: true });

console.log("build complete > dist/");