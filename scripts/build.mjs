import { copyFile, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const copy = (from, to) => copyFile(new URL(from, root), new URL(to, root));
await copy("src/app.js", "assets/app.js");
await copy("src/app.css", "assets/app.css");

const htmlUrl = new URL("index.html", root);
let html = await readFile(htmlUrl, "utf8");
html = html.replace(/\.\/assets\/index-[^\"]+\.js/g, "./assets/app.js");
html = html.replace(/\.\/assets\/index-[^\"]+\.css/g, "./assets/app.css");
await writeFile(htmlUrl, html);

const app = await readFile(new URL("src/app.js", root), "utf8");
const version = /oo = `([^`]+)`/.exec(app)?.[1];
if (!version) throw new Error("Could not read the app version from src/app.js");
const swUrl = new URL("sw.js", root);
let sw = await readFile(swUrl, "utf8");
sw = sw.replace(/const CACHE = "[^"]+";/, `const CACHE = "pil2-v${version}-recovered-source";`);
sw = sw.replace(/\.\/assets\/index-[^\"]+\.js/g, "./assets/app.js");
sw = sw.replace(/\.\/assets\/index-[^\"]+\.css/g, "./assets/app.css");
await writeFile(swUrl, sw);
