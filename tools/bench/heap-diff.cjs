// Compare two V8 heap snapshots (bench:client --snapshots): growth by category (JS objects,
// compiled code, V8 internals, Blink/native) and, for live JS objects only, by type:name.
//   node tools/bench/heap-diff.cjs a.heapsnapshot b.heapsnapshot
const fs = require("fs");
const JS = new Set(["object", "array", "string", "closure", "number", "regexp", "concatenated string", "sliced string", "bigint", "symbol", "object shape"]);
function load(file) {
  const s = JSON.parse(fs.readFileSync(file, "utf8"));
  const m = s.snapshot.meta, F = m.node_fields, T = m.node_types[0], n = F.length;
  const iT = F.indexOf("type"), iN = F.indexOf("name"), iS = F.indexOf("self_size");
  const cat = {}, js = new Map();
  for (let i = 0; i < s.nodes.length; i += n) {
    let t = T[s.nodes[i + iT]];
    const name = String(s.strings[s.nodes[i + iN]]);
    const size = s.nodes[i + iS];
    if (t === "native") t = name.startsWith("system /") ? "native:v8-internal" : "native:blink";
    cat[t] = (cat[t] || 0) + size;
    if (JS.has(t)) { const k = `${t}:${name.slice(0, 70).replace(/\n/g, " ")}`; const e = js.get(k) ?? { c: 0, z: 0 }; e.c++; e.z += size; js.set(k, e); }
  }
  return { cat, js };
}
const a = load(process.argv[2]), b = load(process.argv[3]);
const kb = (x) => (x / 1024).toFixed(0).padStart(7);
console.log("by category (self size, KB):");
for (const k of Object.keys({ ...a.cat, ...b.cat }).sort((x, y) => (b.cat[y] || 0) - (a.cat[y] || 0) - ((b.cat[x] || 0) - (a.cat[x] || 0)))) console.log(`  ${k.padEnd(22)}${kb(a.cat[k] || 0)} ->${kb(b.cat[k] || 0)}  ${kb((b.cat[k] || 0) - (a.cat[k] || 0))}`);
const tot = (m) => [...m.values()].reduce((s, e) => s + e.z, 0);
const ta = tot(a.js), tb = tot(b.js);
console.log(`\nlive JS objects: ${(ta / 1e6).toFixed(3)} MB -> ${(tb / 1e6).toFixed(3)} MB (${(100 * (tb - ta) / ta).toFixed(1)}%); biggest growth:`);
const rows = [...b.js].map(([k, v]) => { const o = a.js.get(k) ?? { c: 0, z: 0 }; return [k, v.c - o.c, v.z - o.z]; }).sort((x, y) => y[2] - x[2]);
for (const [k, c, z] of rows.slice(0, 12)) console.log(`  ${String(c).padStart(6)} objs ${(z / 1024).toFixed(1).padStart(7)} KB  ${k}`);
