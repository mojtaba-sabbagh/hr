const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {PrismaClient} = require("@prisma/client");
const {loadEnvConfig} = require("@next/env");

// Set DATABASE_URL before importing the service or starting Next. Both must
// use the same disposable schema as the fixtures.
async function createMeetingDatabase() {
  loadEnvConfig(process.cwd());
  const source = process.env.DATABASE_URL;
  assert.ok(source, "DATABASE_URL is required");
  const schema = `hrmeet_test_${process.pid}_${Date.now()}`;
  const url = new URL(source);
  url.searchParams.set("schema", schema);
  const control = new PrismaClient({datasources: {db: {url: source}}});
  let db;
  let created = false;
  async function close() {
    try {
      await db?.$disconnect();
      if (created) {
        assert.match(schema, /^hrmeet_test_\d+_\d+$/);
        await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    } finally {
      process.env.DATABASE_URL = source;
      await control.$disconnect();
    }
  }
  try {
    process.env.DATABASE_URL = url.toString();
    await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {env: process.env, stdio: "pipe"});
    db = require("../app/lib/prisma.ts").prisma;
    return {db, close};
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = {createMeetingDatabase};
