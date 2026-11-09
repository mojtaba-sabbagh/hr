export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.OPS_MONITOR_DISABLED !== "1"
  ) {
    const { startOperationsMonitor } = await import("./app/lib/operations/monitor");
    startOperationsMonitor();
  }
}
