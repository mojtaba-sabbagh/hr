import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { scanOperations } from "../app/lib/operations/monitor";
import { prisma } from "../app/lib/prisma";

async function run() {
  const once = process.argv.includes("--once");
  do {
    try {
      await scanOperations();
    } catch (error) {
      if (once) throw error;
      console.error("Operations scan failed", error instanceof Error ? error.name : "Error");
    }
    if (!once) await new Promise((resolve) => setTimeout(resolve, 150_000));
  } while (!once);
}
run()
  .catch(() => {
    process.exitCode = 1;
    console.error("Operations scan failed");
  })
  .finally(() => prisma.$disconnect());
