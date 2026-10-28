require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {validateSchema, validatePayload, validateWorkflow, matches} = require("../app/lib/workflow/validation.ts");
const {defaultWorkflow} = require("../app/lib/workflow/types.ts");
const {PROCESS_TEMPLATES, templateConfig} = require("../app/lib/workflow/templates.ts");
const schema = {fields: [{key: "amount", labelFa: "Amount", type: "number", required: true, min: 0}, {key: "optional", labelFa: "Optional", type: "number"}], sections: []};
const bad = fn => assert.throws(fn, e => e.status === 400);
test("numeric validation accepts Persian/Arabic digits and optional blanks without coercing objects", () => {
  assert.deepEqual(validatePayload(schema, {amount: "۱٬۲۵۰", optional: ""}), {amount: 1250, optional: null});
  assert.equal(validatePayload(schema, {amount: "١٢٣"}).amount, 123);
  for (const amount of [true, [], {}, "bad", -1, 1.5, Infinity]) bad(() => validatePayload(schema, {amount}));
});
test("required, selections, dates, time and checkbox values are enforced on the server", () => {
  bad(() => validatePayload(schema, {}));
  const fields = [{key: "choice", labelFa: "Choice", type: "select", options: [{value: "a", label: "A"}], required: true}, {key: "day", labelFa: "Date", type: "date", required: true}, {key: "accepted", labelFa: "Accept", type: "checkbox", required: true}];
  const payload = {choice: "a", day: "2026-10-27", accepted: true};
  assert.deepEqual(validatePayload({fields, sections: []}, payload), payload);
  bad(() => validatePayload({fields, sections: []}, {...payload, day: "2026-02-31"}));
  bad(() => validatePayload({fields, sections: []}, {...payload, accepted: "true"}));
  bad(() => validatePayload({fields, sections: []}, {...payload, choice: "b"}));
});
test("conditional required fields use normalized values and discard hidden answers", () => {
  const s = {...schema, fields: [...schema.fields, {key: "reason", labelFa: "Reason", type: "text", required: true, visibleWhen: {field: "amount", op: "gt", value: 100}}]};
  assert.equal(validatePayload(s, {amount: "۵۰", reason: "ignored"}).reason, null);
  bad(() => validatePayload(s, {amount: "۱۵۰"}));
  assert.equal(validatePayload(s, {amount: "۱۵۰", reason: "Need"}).reason, "Need");
});
test("stage edits cannot smuggle header or other section fields", () => {
  const s = {...schema, sections: [{key: "finance", title: "Finance"}], fields: [...schema.fields, {key: "decision", labelFa: "Decision", type: "text", required: true, sectionKey: "finance"}]};
  bad(() => validatePayload(s, {amount: 1, decision: "yes"}, "finance"));
  bad(() => validatePayload(s, {amount: 1, decision: "yes"}));
  assert.deepEqual(validatePayload(s, {decision: "yes"}, "finance"), {decision: "yes"});
});
test("repeating rows validate every column and reject unknown properties", () => {
  const s = {fields: [{key: "items", type: "table", labelFa: "Items", required: true, columns: schema.fields}], sections: []};
  assert.equal(validatePayload(s, {items: [{amount: "۱۲"}]}).items[0].amount, 12);
  bad(() => validatePayload(s, {items: [{amount: 1, unknown: "x"}]}));
  bad(() => validatePayload(s, {items: []}));
});
test("schema rejects unsafe keys, duplicate keys, unknown types and circular visibility", () => {
  bad(() => validateSchema({...schema, fields: [...schema.fields, schema.fields[0]]}));
  bad(() => validateSchema({...schema, fields: [{...schema.fields[0], key: "__proto__"}]}));
  bad(() => validateSchema({...schema, fields: [{...schema.fields[0], type: "constructor"}]}));
  bad(() => validateSchema({...schema, fields: [{...schema.fields[0], visibleWhen: {field: "amount", op: "eq", value: 2}}]}));
});
test("workflow publication requires reachable steps, a terminal path and a default route", () => {
  const good = defaultWorkflow(); validateWorkflow(good, schema, true);
  const unreachable = structuredClone(good); unreachable.nodes.push({id: "isolated", type: "end", labelFa: "Unused", transitions: []}); bad(() => validateWorkflow(unreachable, schema, true));
  const noDefault = structuredClone(good); noDefault.nodes[1].transitions[0].condition = {field: "amount", op: "gt", value: 20}; bad(() => validateWorkflow(noDefault, schema, true));
  const broken = structuredClone(good); broken.nodes[1].transitions[0].to = "missing"; bad(() => validateWorkflow(broken, schema, true));
});
test("automatic loops and submitter approval are rejected before publication", () => {
  const config = {startNodeId: "start", nodes: [{id: "start", type: "start", labelFa: "Start", transitions: [{on: "any", to: "loop"}]}, {id: "loop", type: "condition", labelFa: "Loop", transitions: [{on: "any", to: "loop", condition: {field: "amount", op: "gt", value: 5}}, {on: "any", to: "end"}]}, {id: "end", type: "end", labelFa: "End", transitions: []}]};
  bad(() => validateWorkflow(config, schema, true));
  const self = defaultWorkflow(); self.nodes[1].assignees = [{strategy: "submitter"}]; bad(() => validateWorkflow(self, schema, true));
});
test("structured conditions never evaluate executable expressions", () => {
  assert.equal(matches({field: "amount", op: "gt", parameterKey: "manager_authority"}, {amount: 101}, {manager_authority: 100}), true);
  assert.equal(matches({field: "amount", op: "gt", value: 10}, {amount: "process.exit()"}), false);
  const config = defaultWorkflow(); config.nodes[1].transitions[0].condition = "process.exit()"; bad(() => validateWorkflow(config, schema, true));
});
for (const template of PROCESS_TEMPLATES) test(`material template validates: ${template.id}`, () => {
  const s = validateSchema({fields: template.fields, sections: template.sections || []});
  const roles = Object.fromEntries(template.steps.map((s, i) => [s.role, `role-${i}`]));
  validateWorkflow(templateConfig(template, roles), s, true);
});
