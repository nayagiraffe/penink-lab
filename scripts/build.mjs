import { copyFile, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const copy = (from, to) => copyFile(new URL(from, root), new URL(to, root));
await copy("src/app.js", "assets/app.js");
await copy("src/app.css", "assets/app.css");

const app = await readFile(new URL("src/app.js", root), "utf8");
const version = /oo = `([^`]+)`/.exec(app)?.[1];
if (!version) throw new Error("Could not read the app version from src/app.js");

const htmlUrl = new URL("index.html", root);
let html = await readFile(htmlUrl, "utf8");
html = html.replace(/\.\/assets\/index-[^\"]+\.js/g, "./assets/app.js");
html = html.replace(/\.\/assets\/index-[^\"]+\.css/g, "./assets/app.css");
html = html.replace(/\.\/assets\/app\.js(?:\?v=[^\"]*)?/g, `./assets/app.js?v=${version}`);
html = html.replace(/\.\/assets\/app\.css(?:\?v=[^\"]*)?/g, `./assets/app.css?v=${version}`);
await writeFile(htmlUrl, html);

const swUrl = new URL("sw.js", root);
let sw = await readFile(swUrl, "utf8");
sw = sw.replace(/const CACHE = "[^"]+";/, `const CACHE = "pil2-v${version}-recovered-source";`);
sw = sw.replace(/\.\/assets\/index-[^\"]+\.js/g, "./assets/app.js");
sw = sw.replace(/\.\/assets\/index-[^\"]+\.css/g, "./assets/app.css");
sw = sw.replace(/\.\/assets\/app\.js(?:\?v=[^\"]*)?/g, `./assets/app.js?v=${version}`);
sw = sw.replace(/\.\/assets\/app\.css(?:\?v=[^\"]*)?/g, `./assets/app.css?v=${version}`);
await writeFile(swUrl, sw);
