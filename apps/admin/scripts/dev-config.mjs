// Writes dev-config.json for `vite dev`: the production config with the local redirect URI.
import { writeFile } from "node:fs/promises";

const res = await fetch("https://admin.oki-dev.xyz/config.json");
if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
const config = { ...(await res.json()), redirectUri: "http://localhost:5173/" };
await writeFile(
  new URL("../dev-config.json", import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
);
console.log("wrote apps/admin/dev-config.json");
