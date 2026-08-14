import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../live.html", import.meta.url), "utf8");

assert.match(source, /className='product-image-fallback'/, "O hotsite precisa renderizar uma contingência para imagem ausente.");
assert.match(source, /image\.onerror=\(\)=>\{image\.remove\(\);parent\.append\(fallback\)?/, "Falhas de imagem precisam trocar para a contingência visual.");
assert.match(source, /\.product \.product-image-fallback/, "O card de produto precisa dimensionar a contingência visual.");
assert.match(source, /\.featured \.product-image-fallback/, "O produto em destaque precisa dimensionar a contingência visual.");
assert.match(source, /String\(url\)\.startsWith\('\/manus-storage\/'\)/, "O hotsite precisa evitar renderizar caminhos internos como imagem pública.");

const workerSource = await readFile(new URL("../flowlive-public-hotsite-worker.js", import.meta.url), "utf8");
assert.match(workerSource, /function publicAssetUrl\(value, limit = 1024\)/, "O Worker precisa normalizar ativos antes da projeção pública.");
assert.match(workerSource, /candidate\.startsWith\("\/manus-storage\/"\)\) return null/, "Caminhos internos não podem ser projetados ao hotsite.");
assert.match(workerSource, /publicAssetUrl\(product\.imageUrl\)/, "Imagens internas de catálogo precisam virar contingência pública.");

console.log("hotsite-public-assets: ok");
