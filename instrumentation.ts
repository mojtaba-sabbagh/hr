export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    if (process.env.OPS_MONITOR_DISABLED !== "1") {
      const { startOperationsMonitor } = await import("./app/lib/operations/monitor");
      startOperationsMonitor();
    }
    const { startClockSync } = await import("./app/lib/office/clock-sync");
    startClockSync();
  }
}
