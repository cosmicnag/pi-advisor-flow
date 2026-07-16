/**
 * Unit tests for the `/advisor` argument autocomplete (getArgumentCompletions).
 *
 * These pin that every subcommand the dispatcher accepts — including the newer
 * `triggers`, the `instructions global|mode` nesting, and `triggers <name>` —
 * is surfaced as a TUI suggestion. pi replaces the entire argument text with
 * the selected item's `value`, so nested suggestions must carry the full path
 * (e.g. "instructions global set"), not just the last token.
 */

import { describe, expect, it } from "vitest";
import { completeAdvisorArgs } from "../advisor.js";

const ENABLED_DEFAULT = ["turn_end", "tool_error"];

describe("completeAdvisorArgs — top-level subcommands", () => {
	it("lists every subcommand when the argument is empty", () => {
		const items = completeAdvisorArgs("", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		const labels = items!.map((i) => i.label);
		// Every dispatcher-accepted subcommand must be suggestable.
		for (const sub of [
			"model",
			"status",
			"enable",
			"disable",
			"interrupting",
			"sync",
			"context",
			"thinking",
			"triggers",
			"instructions",
			"review",
			"help",
		]) {
			expect(labels).toContain(sub);
		}
	});

	it("filters by prefix (the regression: 'triggers' must appear for 'tr')", () => {
		const items = completeAdvisorArgs("tr", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		expect(items!.map((i) => i.label)).toContain("triggers");
		// value must be the full argument string to substitute.
		expect(items!.find((i) => i.label === "triggers")!.value).toBe("triggers");
	});

	it("filters by prefix for 'instructions'", () => {
		const items = completeAdvisorArgs("instr", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		expect(items!.map((i) => i.label)).toEqual(["instructions"]);
	});

	it("returns null when nothing matches the prefix", () => {
		expect(completeAdvisorArgs("zzz", ENABLED_DEFAULT)).toBeNull();
	});

	it("each top-level item carries a description", () => {
		const items = completeAdvisorArgs("", ENABLED_DEFAULT)!;
		expect(items.every((i) => typeof i.description === "string" && i.description.length > 0)).toBe(true);
	});
});

describe("completeAdvisorArgs — instructions nesting", () => {
	it("suggests instructions actions after 'instructions '", () => {
		const items = completeAdvisorArgs("instructions ", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		const labels = items!.map((i) => i.label);
		expect(labels).toEqual(expect.arrayContaining(["show", "set", "edit", "clear", "global", "mode"]));
		// value carries the full path (pi substitutes the whole argument).
		expect(items!.find((i) => i.label === "global")!.value).toBe("instructions global");
		expect(items!.find((i) => i.label === "mode")!.value).toBe("instructions mode");
	});

	it("suggests global actions after 'instructions global '", () => {
		const items = completeAdvisorArgs("instructions global ", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		const labels = items!.map((i) => i.label);
		expect(labels).toEqual(expect.arrayContaining(["show", "set", "edit", "clear"]));
		expect(items!.find((i) => i.label === "set")!.value).toBe("instructions global set");
	});

	it("suggests modes after 'instructions mode '", () => {
		const items = completeAdvisorArgs("instructions mode ", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		expect(items!.map((i) => i.label).sort()).toEqual(["global", "none", "project"]);
		expect(items!.find((i) => i.label === "global")!.value).toBe("instructions mode global");
	});

	it("filters nested actions by partial ('instructions g' -> global)", () => {
		const items = completeAdvisorArgs("instructions g", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		expect(items!.map((i) => i.label)).toEqual(["global"]);
		expect(items![0].value).toBe("instructions global");
	});

	it("does not over-recurse past known depth (returns null)", () => {
		// 'instructions global set ' has no further completion depth.
		expect(completeAdvisorArgs("instructions global set ", ENABLED_DEFAULT)).toBeNull();
		// 'instructions show ' is terminal.
		expect(completeAdvisorArgs("instructions show foo", ENABLED_DEFAULT)).toBeNull();
	});
});

describe("completeAdvisorArgs — triggers nesting", () => {
	it("suggests every trigger name after 'triggers '", () => {
		const items = completeAdvisorArgs("triggers ", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		const labels = items!.map((i) => i.label);
		expect(labels).toEqual(
			expect.arrayContaining(["turn_end", "tool_error", "tool_result", "agent_settled", "mid_pause", "input"]),
		);
		// value carries the full path with on/off annotation in description.
		const settled = items!.find((i) => i.label === "agent_settled")!;
		expect(settled.value).toBe("triggers agent_settled");
		expect(settled.description).toContain("[off]"); // not enabled by default
		expect(settled.description).toContain("settles");
		const turnEnd = items!.find((i) => i.label === "turn_end")!;
		expect(turnEnd.description).toContain("[on]");
	});

	it("reflects a custom enabled set in the [on]/[off] annotation", () => {
		const items = completeAdvisorArgs("triggers ", ["agent_settled", "mid_pause"])!;
		expect(items.find((i) => i.label === "agent_settled")!.description).toContain("[on]");
		expect(items.find((i) => i.label === "turn_end")!.description).toContain("[off]");
	});

	it("filters trigger names by partial ('triggers a' -> agent_settled)", () => {
		const items = completeAdvisorArgs("triggers a", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		expect(items!.map((i) => i.label)).toEqual(["agent_settled"]);
		expect(items![0].value).toBe("triggers agent_settled");
	});
});

describe("completeAdvisorArgs — tokenization edge cases", () => {
	it("accepts the singular alias 'trigger' for nesting", () => {
		const items = completeAdvisorArgs("trigger ", ENABLED_DEFAULT);
		expect(items).not.toBeNull();
		// value still uses the canonical plural path prefix (trigger).
		expect(items!.find((i) => i.label === "input")!.value).toBe("trigger input");
	});
});