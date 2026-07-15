import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getProjectInstructionsPath,
	MAX_PROJECT_INSTRUCTIONS_CHARS,
	readProjectInstructions,
	writeProjectInstructions,
} from "../src/project-instructions.js";

const directories: string[] = [];
function project(): string {
	const path = mkdtempSync(join(tmpdir(), "pi-advisor-instructions-"));
	directories.push(path);
	return path;
}

afterEach(() => {
	for (const path of directories) rmSync(path, { recursive: true, force: true });
	directories.length = 0;
});

describe("project advisor instructions", () => {
	it("stores guidance under the project's pi config directory", () => {
		const cwd = project();
		const path = writeProjectInstructions(cwd, "  Prefer accessibility checks.  ");
		expect(path).toBe(getProjectInstructionsPath(cwd));
		expect(path).toBe(join(cwd, ".pi", "advisor.md"));
		expect(readProjectInstructions(cwd)).toBe("Prefer accessibility checks.");
		expect(readFileSync(path, "utf8")).toBe("Prefer accessibility checks.\n");
	});

	it("treats blank guidance as clear", () => {
		const cwd = project();
		const path = writeProjectInstructions(cwd, "Use integration tests.");
		writeProjectInstructions(cwd, "  \n ");
		expect(readProjectInstructions(cwd)).toBe("");
		expect(() => readFileSync(path)).toThrow();
	});

	it("rejects instructions that would dominate the context", () => {
		const cwd = project();
		expect(() => writeProjectInstructions(cwd, "x".repeat(MAX_PROJECT_INSTRUCTIONS_CHARS + 1))).toThrow(/too long/);
	});
});