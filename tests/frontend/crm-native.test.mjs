import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyForm,
  normalizeIntake,
  validateForm,
  safeUrl,
  taskFromUrl,
} from "../../frontend/crm/domain.mjs";
test("native consultation preserves the same normalized snapshot after restoring a retry", () => {
  const form = {
    ...emptyForm(),
    full_name: " QA ",
    email: "QA@example.invalid",
    skin_type: "OILY",
    sensitivity: "Sensitive",
    requested_category: "SERUM",
    max_budget: "500000",
    concern_acne: true,
    consent: true,
  };
  assert.equal(validateForm(form), "");
  const original = normalizeIntake(form);
  assert.deepEqual(
    normalizeIntake(JSON.parse(JSON.stringify(original))),
    original,
  );
  assert.equal(original.max_budget, 500000);
  assert.equal(original.email, "qa@example.invalid");
  assert.notEqual(validateForm({ ...form, consent: false }), "");
  assert.notEqual(validateForm({ ...form, concern_acne: false }), "");
});
test("native catalog and task links reject executable or unrelated destinations", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://user:password@example.com"), "");
  assert.equal(safeUrl("/files/catalog.png"), "/files/catalog.png");
  assert.equal(taskFromUrl("/app/crm-task/42"), "42");
  assert.equal(taskFromUrl("/app/crm-lead/42"), null);
});
