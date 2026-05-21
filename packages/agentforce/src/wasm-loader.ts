/**
 * WASM constants loader.
 *
 * Dynamically imports the generated WASM constants file.
 * In parser-javascript builds, this entire module is stubbed out by esbuild
 * so the wasm-constants-generated reference never appears in compiled output.
 */

export async function loadWasmModule(): Promise<
  | {
      TREE_SITTER_ENGINE_BASE64?: string[];
      TREE_SITTER_AGENTSCRIPT_BASE64?: string[];
    }
  | undefined
> {
  try {
    const wasmModuleName = './wasm-constants-generated';
    return (await import(/* @vite-ignore */ `${wasmModuleName}.js`)) as {
      TREE_SITTER_ENGINE_BASE64?: string[];
      TREE_SITTER_AGENTSCRIPT_BASE64?: string[];
    };
  } catch {
    return undefined;
  }
}
