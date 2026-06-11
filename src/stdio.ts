import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMusicServer } from "./mcp.js";

/**
 * stdio entry. Note: the widget streams audio via the HTTP proxy routes,
 * so for actual playback you also need the HTTP server running
 * (`npm start`) and PUBLIC_BASE_URL pointing at it.
 */
async function main() {
  const config = loadConfig();
  const server = createMusicServer(config);
  await server.connect(new StdioServerTransport());
  console.error("music-mcp running on stdio");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
