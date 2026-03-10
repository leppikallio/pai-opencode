import type { Plugin } from "@opencode-ai/plugin";

// Compatibility shim: RTK rewrite now runs via canonical pai-cc-hooks tool-before path.
const PaiRtkPlugin: Plugin = async () => {
  return {};
};

export default PaiRtkPlugin;
