import { config } from "@/config";
import { httpServer } from "@/http/server";

async function main() {
  await httpServer.listen(config.server.socketPath);
}

main().catch(console.error);
