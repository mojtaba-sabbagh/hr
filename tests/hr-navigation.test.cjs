// The HR workspace information architecture — pure functions, no database.
//
// The point of this file is drift control: `views` in app/components/hr-portal.tsx
// is the list of available screens, and HR_VIEW_GROUP decides where each one
// appears. Adding a 42nd view without a group would silently drop it from the
// sidebar, so the first test reads the component source and fails instead.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nav = require("../app/lib/hr-navigation.ts");

function viewIds() {
  const source = fs.readFileSync(path.join(process.cwd(), "app/components/hr-portal.tsx"), "utf8");
  return [...source.matchAll(/\{id: "([a-z-]+)", resource:/g)].map(match => match[1]);
}

test("every view in hr-portal.tsx has a group, and no group is imaginary", () => {
  const ids = viewIds();
  assert.ok(ids.length >= 41, `only ${ids.length} views parsed from hr-portal.tsx`);
  const missing = ids.filter(id => !nav.HR_VIEW_GROUP[id]);
  assert.deepEqual(missing, [], `add these to HR_VIEW_GROUP: ${missing.join(", ")}`);
  const stale = Object.keys(nav.HR_VIEW_GROUP).filter(id => !ids.includes(id));
  assert.deepEqual(stale, [], `HR_VIEW_GROUP mentions views that no longer exist: ${stale.join(", ")}`);
  assert.equal(new Set(ids).size, ids.length, "duplicate view ids");
});

test("every view has a one-line sidebar label", () => {
  const missing = viewIds().filter(id => !nav.HR_VIEW_SHORT[id]);
  assert.deepEqual(missing, [], `add a short label for: ${missing.join(", ")}`);
});

test("groupViews returns every view exactly once, in group order", () => {
  const views = viewIds().map(id => ({id, title: id}));
  const sections = nav.groupViews(views);
  const seen = sections.flatMap(section => section.items.map(view => view.id));
  assert.equal(seen.length, views.length);
  assert.deepEqual([...seen].sort(), [...views.map(view => view.id)].sort());
  assert.deepEqual(sections.map(section => section.group.id), ["home", "me", "team", "file", "meet", "ops", "talent", "insight"]);
});

test("groupViews drops empty groups so a narrow permission set has no dead headings", () => {
  const sections = nav.groupViews([{id: "dashboard"}, {id: "decrees"}]);
  assert.deepEqual(sections.map(section => section.group.id), ["home", "file"]);
});

test("hrHref keeps the existing deep links", () => {
  assert.equal(nav.hrHref("dashboard"), "/hr");
  assert.equal(nav.hrHref("decrees"), "/hr?view=decrees");
});

test("search folds the Persian letter variants a keyboard picks differently", () => {
  const views = [{id: "people", title: "پرسنل و پروفایل جامع", subtitle: "پرونده پرسنلی"}];
  assert.equal(nav.searchViews(views, "پرسنل").length, 1);
  assert.equal(nav.searchViews(views, "پرونده").length, 1);
  // Arabic yeh/kaf typed instead of the Persian ones.
  assert.equal(nav.searchViews([{id: "decrees", title: "احکام کارگزینی"}], "كارگزيني").length, 1);
});

test("search matches the group name, not just the view title", () => {
  const views = [{id: "decrees", title: "احکام کارگزینی"}];
  assert.equal(nav.searchViews(views, "کارگزینی و پرونده").length, 1);
});

test("search requires every word, and an empty query returns everything", () => {
  const views = [{id: "a", title: "برنامه شیفت"}, {id: "b", title: "احکام کارگزینی"}];
  assert.equal(nav.searchViews(views, "شیفت برنامه").length, 1);
  assert.equal(nav.searchViews(views, "شیفت احکام").length, 0);
  assert.equal(nav.searchViews(views, "   ").length, 2);
});

test("Persian digits in a query still match Persian text", () => {
  assert.equal(nav.normalizeQuery("۱۴۰۵"), "1405");
});
