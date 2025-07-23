import { config } from "@/config";
import { httpServer } from "@/http/server";

async function main() {
  await httpServer.listen(config.server.port);
}

main().catch(console.error);
