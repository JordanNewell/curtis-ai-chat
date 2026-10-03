// Stub for the `obsidian` module when bundling dev/test entries with esbuild
// (node has no Obsidian runtime). The MCP smoke test injects its own HTTP
// sender, so requestUrl must never be reached.
export function requestUrl(): never {
	throw new Error('requestUrl called in node test — inject an HttpSender instead');
}
export default {};
