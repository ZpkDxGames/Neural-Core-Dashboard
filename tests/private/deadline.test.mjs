import test from "node:test";
import assert from "node:assert/strict";
import {
  privateRequestScope,
  checkDeadline,
  boundedDependency,
} from "../../backend/v2/private/deadline.mjs";
test("expired request contexts fail before SQL; hung private dependencies abort within a bounded wait", async () => {
  assert.throws(
    () =>
      privateRequestScope.run({ deadlineAt: Date.now() - 1 }, checkDeadline),
    (e) => e.code === "PRIVATE_REQUEST_TIMEOUT",
  );
  let signal;
  await assert.rejects(
    () =>
      boundedDependency((s) => {
        signal = s;
        return new Promise(() => {});
      }, 20),
    /PRIVATE_DEPENDENCY_TIMEOUT/,
  );
  assert.equal(signal.aborted, true);
});
