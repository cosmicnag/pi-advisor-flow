/**
 * Unit tests for global (cross-repo) advisor instructions storage and the
 * active-instructions resolver that switches between project / global / none.
 */

import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getGlobalInstructionsPath,
	readGlobalInstructions,
	writeGlobalInstructions,
	clearGlobalInstructions,
	hasGlobalInstructions,
} from "../src/global-instructions.js";
import {
	readProjectInstructions,
	writeProjectInstructions,
	getProjectInstructionsPath,
} from "../src/project-instructions.js";
import {
	DEFAULT_CONFIG,
	normalizeConfig,
	resolveActiveInstructions,
} from "../src/index.js";

// The global instructions path is rooted at the pi agent dir; redirect it via
// PI_CODING_AGENT_DIR so tests don't touch the real user global file.
function withTempGlobalDir<T>(fn: () => T): T {
	const dir = mkdtempSync(join(tmpdir(), "pi-advisor-global-"));
	const prev = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		return fn();
	} finally {
		process.env.PI_CODING_AGENT_DIR = prev;
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("global instructions storage", () => {
	it("round-trips write → read", () => {
		withTempGlobalDir(() => {
			expect(hasGlobalInstructions()).toBe(false);
			writeGlobalInstructions("be concise and prefer tests");
			expect(hasGlobalInstructions()).toBe(true);
			expect(readGlobalInstructions()).toBe("be concise and prefer tests");
		});
	});

	it("blank write clears (removes the file)", () => {
		withTempGlobalDir(() => {
			writeGlobalInstructions("some rule");
			expect(hasGlobalInstructions()).toBe(true);
			writeGlobalInstructions("");
			expect(hasGlobalInstructions()).toBe(false);
			expect(readGlobalInstructions()).toBe("");
		});
	});

	it("clearGlobalInstructions removes the file and reports prior existence", () => {
		withTempGlobalDir(() => {
			writeGlobalInstructions("rule");
			expect(clearGlobalInstructions()).toBe(true);
			expect(clearGlobalInstructions()).toBe(false); // already gone
		});
	});

	it("read returns empty when no file is set", () => {
		withTempGlobalDir(() => {
			expect(readGlobalInstructions()).toBe("");
			expect(hasGlobalInstructions()).toBe(false);
		});
	});

	it("rejects oversized content", () => {
		withTempGlobalDir(() => {
			expect(() => writeGlobalInstructions("x".repeat(32_001))).toThrow(/too long/);
		});
	});

	it("trims surrounding whitespace on read", () => {
		withTempGlobalDir(() => {
			writeGlobalInstructions("   padded   ");
			expect(readGlobalInstructions()).toBe("padded");
		});
	});
});

describe("resolveActiveInstructions mode switching", () => {
	// Project instructions are rooted at <cwd>/.pi — use a temp cwd so the project
	// file lives in a throwaway dir.
	const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-proj-"));

	it("\"project\" mode reads the per-repo file (default; opt-out of global)", () => {
		writeProjectInstructions(cwd, "project rule A");
		const config = { ...DEFAULT_CONFIG, instructionsMode: "project" as const };
		expect(resolveActiveInstructions(config, cwd)).toBe("project rule A");
	});

	it("\"global\" mode reads the global file, ignoring the project file", () => {
		writeProjectInstructions(cwd, "project rule A");
		withTempGlobalDir(() => {
			writeGlobalInstructions("global rule B");
			const config = { ...DEFAULT_CONFIG, instructionsMode: "global" as const };
			expect(resolveActiveInstructions(config, cwd)).toBe("global rule B");
		});
	});

	it("\"none\" mode reads nothing even when both files exist", () => {
		writeProjectInstructions(cwd, "project rule A");
		withTempGlobalDir(() => {
			writeGlobalInstructions("global rule B");
			const config = { ...DEFAULT_CONFIG, instructionsMode: "none" as const };
			expect(resolveActiveInstructions(config, cwd)).toBe("");
		});
	});

	it("global mode with no global file set returns empty (not an error)", () => {
		withTempGlobalDir(() => {
			const config = { ...DEFAULT_CONFIG, instructionsMode: "global" as const };
			expect(resolveActiveInstructions(config, cwd)).toBe("");
		});
	});

	it("a fresh repo with default config does NOT inherit a global file", () => {
		// Even when a global file exists, default ("project") mode ignores it.
		writeProjectInstructions(cwd, ""); // ensure project has none
		withTempGlobalDir(() => {
			writeGlobalInstructions("global should be ignored");
			const config = normalizeConfig(null); // default → project
			expect(resolveActiveInstructions(config, cwd)).toBe("");
		});
	});

	it("normalizeConfig round-trips an explicit global selection across reloads", () => {
		const once = normalizeConfig({ instructionsMode: "global" });
		const twice = normalizeConfig({ instructionsMode: once.instructionsMode });
		expect(twice.instructionsMode).toBe("global");
	});

	// cleanup
	afterAll(() => rmSync(cwd, { recursive: true, force: true }));
});

it("project instructions path is under cwd", () => {
	expect(getProjectInstructionsPath("/tmp/demo")).toContain("advisor.md");
});

it("global instructions path is under the extensions dir", () => {
	withTempGlobalDir(() => {
		expect(getGlobalInstructionsPath()).toContain("pi-advisor-instructions.md");
	});
});

it("writes project instructions file under cwd", () => {
	const c = mkdtempSync(join(tmpdir(), "pi-advisor-write-"));
	try {
		writeProjectInstructions(c, "hello");
		expect(existsSync(getProjectInstructionsPath(c))).toBe(true);
		expect(readProjectInstructions(c)).toBe("hello");
	} finally {
		rmSync(c, { recursive: true, force: true });
	}
});