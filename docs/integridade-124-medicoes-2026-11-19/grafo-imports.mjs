import { build } from "esbuild";
import { execSync } from "node:child_process";
const [base, head, ...entradas] = process.argv.slice(2);
const mudados = new Set(execSync(`git diff --name-only ${base}...${head}`).toString().trim().split("\n"));
for (const e of entradas) {
  const r = await build({ entryPoints: [e], bundle: true, platform: "node", write: false, metafile: true, logLevel: "silent", packages: "external", alias: { "@": "." }, tsconfig: "tsconfig.json" });
  const inputs = Object.keys(r.metafile.inputs).map((p) => p.split(String.fromCharCode(92)).join("/"));
  const toca = inputs.filter((p) => mudados.has(p));
  console.log(`${e}: ${inputs.length} módulos; alterados pelo PR no grafo: ${toca.length ? toca.join(", ") : "nenhum"}`);
}
