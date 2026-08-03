/**
 * Unit tests for branchHasTaskStart (src/index.ts) — the arm-for-tasks task
 * detection used by the auto-enable/disable lifecycle hooks.
 *
 * The depth counter (not a boolean flip) is what makes nested pi-supergsd tasks
 * behave: finishing the INNER task must not disable the advisor while the OUTER
 * task is still active. The clamp at 0 covers pi-supergsd's `discardTask`, which
 * appends a `task-done` with no matching `task-start` (src/index.ts:383).
 */

import { describe, expect, it } from "vitest";
import { branchHasTaskStart } from "../src/index.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

let idCounter = 0;

/** A pi-supergsd-style custom entry: `type: "custom"` + `customType`. */
function taskEntry(customType: "task-start" | "task-done"): SessionEntry {
	idCounter++;
	return {
		type: "custom",
		id: `t${idCounter}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		customType,
		data: {},
	} as unknown as SessionEntry;
}

/** A plain message entry, so tests are robust to interleaved content. */
function messageEntry(): SessionEntry {
	idCounter++;
	return {
		type: "message",
		id: `m${idCounter}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: "hello", timestamp: Date.now() },
	} as unknown as SessionEntry;
}

function ctxWith(branch: SessionEntry[]): ExtensionContext {
	return {
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;
}

describe("branchHasTaskStart", () => {
	it("is false for an empty branch", () => {
		expect(branchHasTaskStart(ctxWith([]))).toBe(false);
	});

	it("is false for a plain main-session branch (no task markers)", () => {
		expect(branchHasTaskStart(ctxWith([messageEntry(), messageEntry()]))).toBe(false);
	});

	it("is true when inside a task (task-start present)", () => {
		const branch = [messageEntry(), taskEntry("task-start"), messageEntry()];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(true);
	});

	it("is false after the task finished (task-start followed by task-done)", () => {
		const branch = [taskEntry("task-start"), messageEntry(), taskEntry("task-done")];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(false);
	});

	it("is true for nested tasks when only the inner task finished", () => {
		// outer start → inner start → inner done → still inside the outer task.
		const branch = [
			taskEntry("task-start"),
			taskEntry("task-start"),
			messageEntry(),
			taskEntry("task-done"),
		];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(true);
	});

	it("is false after ALL nested tasks finished", () => {
		const branch = [
			taskEntry("task-start"),
			taskEntry("task-start"),
			taskEntry("task-done"),
			taskEntry("task-done"),
		];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(false);
	});

	it("clamps at 0 for a discardTask (task-done with no matching task-start)", () => {
		// pi-supergsd discardTask appends task-done with no task-start; a naive
		// counter would underflow into "inside a task". Must stay false.
		const branch = [messageEntry(), taskEntry("task-done")];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(false);
	});

	it("ignores unrelated custom entries", () => {
		const branch = [
			{ type: "custom", customType: "task-result", id: "x", parentId: null, timestamp: new Date().toISOString() } as unknown as SessionEntry,
			taskEntry("task-start"),
		];
		expect(branchHasTaskStart(ctxWith(branch))).toBe(true);
	});
});
