import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../live.html", import.meta.url), "utf8");

assert.match(source, /className='product-image-fallback'/, "O hotsite precisa renderizar uma contingência para imagem ausente.");
assert.match(source, /image\.onerror=\(\)=>\{image\.remove\(\);parent\.append\(fallback\)?/, "Falhas de imagem precisam trocar para a contingência visual.");
assert.match(source, /\.product \.product-image-fallback/, "O card de produto precisa dimensionar a contingência visual.");
assert.match(source, /\.featured \.product-image-fallback/, "O produto em destaque precisa dimensionar a contingência visual.");

console.log("hotsite-public-assets: ok");
