// Assembles dist-artifact/app.js + app.css into one artifact page (no <html>/<head>/<body>; the viewer adds the skeleton).
import { readFileSync, writeFileSync } from "node:fs";

const js = readFileSync("dist-artifact/app.js", "utf8").replace(/<\/script/gi, "<\\/script");
const css = readFileSync("dist-artifact/app.css", "utf8");
const page = `<title>On Cue: Touring</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;
writeFileSync("dist-artifact/on-cue-touring.html", page);
console.log(`wrote dist-artifact/on-cue-touring.html (${(page.length / 1024).toFixed(0)} KB)`);
