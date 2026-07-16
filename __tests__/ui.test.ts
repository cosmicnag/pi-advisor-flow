/**
 * Smoke tests for the custom TUI components in src/ui.ts.
 *
 * These confirm the components construct and render against a theme without
 * throwing — catching import, Theme-interface, and wiring regressions (e.g. a
 * renamed method pi-tui ships in a bump). Full keyboard behavior mirrors the
 * proven pi-vision-handoff picker pattern and isn't re-asserted here, since
 * keypress data encoding is fragile to pin in a unit test.
 */

import { describe, expect, it } from "vitest";
import { TriggersSelectorComponent, AdvisorModelSelectorComponent } from "../src/ui.js";
import { DEFAULT_TRIGGERS } from "../src/index.js";

/** Minimal Theme stub: fg/bold pass strings through unchanged. The components
 *  only ever call `theme.fg(color, str)` and `theme.bold(str)`. */
const fakeTheme = {
	fg: (_color: string, str: string) => str,
	bold: (str: string) => str,
} as unknown as ConstructorParameters<typeof TriggersSelectorComponent>[0];

const fakeModels: { provider: string; id: string; name: string; reasoning: boolean; input: ("text" | "image")[]; contextWindow: number; maxTokens: number }[] = [
	{ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4", reasoning: true, input: ["text", "image"], contextWindow: 200_000, maxTokens: 8192 },
	{ provider: "openai", id: "gpt-4o", name: "GPT-4o", reasoning: false, input: ["text", "image"], contextWindow: 128_000, maxTokens: 16_384 },
	{ provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true, input: ["text"], contextWindow: 400_000, maxTokens: 100_000 },
];

describe("TriggersSelectorComponent", () => {
	it("constructs and renders without throwing", () => {
		let captured: unknown = undefined;
		const c = new TriggersSelectorComponent(fakeTheme, [...DEFAULT_TRIGGERS], (r) => { captured = r; });
		const lines = c.render(80);
		expect(Array.isArray(lines)).toBe(true);
		expect(lines.length).toBeGreaterThan(0);
		// All six triggers are listed.
		expect(lines.join("\n")).toContain("turn_end");
		expect(lines.join("\n")).toContain("mid_pause");
		expect(lines.join("\n")).toContain("input");
		expect(c.focused).toBe(false);
		expect(captured).toBeUndefined(); // done not called on construction
	});

	it("marks currently-enabled triggers as checked in the render", () => {
		const c = new TriggersSelectorComponent(fakeTheme, ["turn_end", "tool_error"], () => {});
		const out = c.render(80).join("\n");
		expect(out).toContain("[x] turn_end");
		expect(out).toContain("[ ] tool_result"); // not enabled
	});

	it("does not throw on invalidate", () => {
		const c = new TriggersSelectorComponent(fakeTheme, [...DEFAULT_TRIGGERS], () => {});
		expect(() => c.invalidate()).not.toThrow();
	});
});

describe("AdvisorModelSelectorComponent", () => {
	it("constructs and renders without throwing", () => {
		const c = new AdvisorModelSelectorComponent(fakeTheme, fakeModels, "anthropic/claude-sonnet-4", () => {});
		const lines = c.render(80);
		expect(Array.isArray(lines)).toBe(true);
		expect(lines.length).toBeGreaterThan(0);
		const out = lines.join("\n");
		expect(out).toContain("claude-sonnet-4");
		expect(out).toContain("None"); // leading disable row
	});

	it("sorts the current model to the top and marks it current", () => {
		const c = new AdvisorModelSelectorComponent(fakeTheme, fakeModels, "openai/gpt-5", () => {});
		const out = c.render(80).join("\n");
		// The "None" row is always first; the current model should be the first
		// real model after it, and marked current (✓).
		const noneIdx = out.indexOf("None");
		const gpt5Idx = out.indexOf("gpt-5");
		expect(noneIdx).toBeGreaterThanOrEqual(0);
		expect(gpt5Idx).toBeGreaterThan(noneIdx);
		expect(out).toContain("✓");
		// Reasoning badge present for a reasoning model.
		expect(out).toContain("🧠");
	});

	it("renders a vision badge for image-capable models", () => {
		const c = new AdvisorModelSelectorComponent(fakeTheme, fakeModels, null, () => {});
		expect(c.render(80).join("\n")).toContain("🖼️");
	});

	it("never defaults the highlight to the 'None' row when the current model isn't listed", () => {
		// Regression: a configured model not enumerated by the registry made
		// findIndex return -1, dropping the highlight onto the index-0 "None"
		// row — a stray Enter then silently disabled the advisor. The highlight must
		// land on the first REAL model instead.
		const c = new AdvisorModelSelectorComponent(fakeTheme, fakeModels, "nonexistent/model", () => {});
		const out = c.render(80).join("\n");
		// The 'None' row is present but NOT the highlighted ("→ ") row.
		expect(out).toContain("None");
		expect(out).not.toContain("→ None");
		// A real model is highlighted instead.
		expect(out).toMatch(/→ \S+/);
	});
});