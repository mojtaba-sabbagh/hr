// Read the final runtime roster, including generated employees and later role patches.
// This only runs the local HTML prototype; it never connects to the application database.
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {createHash} = require("node:crypto");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const source = "materials/itfco-portal(5).html";
  const browser = await chromium.launch({channel: "msedge", headless: true});
  try {
    const page = await browser.newPage({timezoneId: "Asia/Tehran"});
    await page.route("http**://**", request => request.abort());
    await page.goto(pathToFileURL(path.resolve(source)).href);
    const data = await page.evaluate(() => {
      if (!P.db) P.seed.run();
      const contracts = P.kgz.S().ctr;
      const users = [...Object.values(P.USERS).filter(u => u.role !== "system"), ...Object.values(P.SUPS), ...EMP.map(e => P.empUser(e))];
      return {
        roles: Object.fromEntries(Object.entries(P.ROLES).map(([key, role]) => [key, {name: role.label, level: role.level}])),
        acl: P.ACL,
        requestTypes: P.REQ_TYPES,
        accounts: users.map(user => {
          const employee = P.kgz2.E(user.id), contract = contracts[user.id];
          return {
            sourceId: user.id, name: user.name, roleKey: user.role,
            email: user.email || user.id.toLowerCase() + "@prototype.itfco.example",
            generatedEmail: !user.email,
            department: employee.dept || user.unit, jobTitle: user.title,
            worksite: employee.site || "دفتر مرکزی", phone: user.phone || "", education: employee.edu || "",
            startDate: contract?.start ? new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Tehran"}).format(new Date(contract.start)) : null,
            prototypeContractType: contract?.type || null,
            managerSourceId: P.supervisorOf(user.id),
          };
        }),
      };
    });
    const result = {version: 1, source, sourceSha256: createHash("sha256").update(fs.readFileSync(source)).digest("hex"), ...data};
    fs.writeFileSync("prisma/prototype-access.json", JSON.stringify(result, null, 2) + "\n");
    console.log(`Extracted ${data.accounts.length} accounts and ${Object.keys(data.roles).length} roles.`);
  } finally {await browser.close();}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
