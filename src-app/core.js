// Host side of app-core (Rust -> WebAssembly). build-app.mjs fills in the base64 text of the compiled module.
// core.call(name, strings) -> result text, or null when the engine declined (callers then use their JS path).

const WASM_B64 = "__WASM_B64__";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let wasm = null;
let failed = false;

function engine() {
  if (wasm || failed) return wasm;
  try {
    const bin = atob(WASM_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
  } catch (_) {
    failed = true;
  }
  return wasm;
}

export const core = {
  ready() {
    return engine() !== null;
  },
  call(name, strings) {
    const w = engine();
    if (!w) return null;
    // worst case 3 UTF-8 bytes per UTF-16 unit, written straight into wasm memory
    let cap = 0;
    for (let i = 0; i < strings.length; i++) cap += 4 + strings[i].length * 3;
    const ptr = w.alloc(cap);
    const mem = new Uint8Array(w.memory.buffer, ptr, Math.max(cap, 1));
    const view = new DataView(w.memory.buffer, ptr, Math.max(cap, 1));
    let at = 0;
    for (let i = 0; i < strings.length; i++) {
      const { written } = encoder.encodeInto(strings[i], mem.subarray(at + 4));
      view.setUint32(at, written, true);
      at += 4 + written;
    }
    const size = at;
    const n = w[name](ptr, size);
    w.dealloc(ptr, Math.max(cap, 1));
    if (n < 0) return null;
    return decoder.decode(new Uint8Array(w.memory.buffer, w.out_ptr(), n));
  },
};
