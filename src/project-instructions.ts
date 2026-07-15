/** Project-scoped persistent instructions for the advisor. */

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Human-editable file stored in each project's pi config directory. */
export const PROJECT_INSTRUCTIONS_FILENAME = "advisor.md";

/** Keep accidental giant files from consuming the advisor's context window. */
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 32_000;

export function getProjectInstructionsPath(cwd: string): string {
	return join(resolve(cwd), CONFIG_DIR_NAME, PROJECT_INSTRUCTIONS_FILENAME);
}

export function normalizeProjectInstructions(value: string): string {
	const normalized = value.trim();
	if (normalized.length > MAX_PROJECT_INSTRUCTIONS_CHARS) {
		throw new Error(
			`Advisor instructions are too long (${normalized.length} characters; maximum ${MAX_PROJECT_INSTRUCTIONS_CHARS}).`,
		);
	}
	return normalized;
}

/** Read instructions for one project. A missing file means no instructions. */
export function readProjectInstructions(cwd: string): string {
	const path = getProjectInstructionsPath(cwd);
	if (!existsSync(path)) return "";
	return normalizeProjectInstructions(readFileSync(path, "utf8"));
}

/**
 * Persist instructions atomically. Blank text clears the project override by
 * removing the file. Returns the path associated with the project.
 */
export function writeProjectInstructions(cwd: string, value: string): string {
	const path = getProjectInstructionsPath(cwd);
	const normalized = normalizeProjectInstructions(value);
	if (!normalized) {
		rmSync(path, { force: true });
		return path;
	}

	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFileSync(temporaryPath, `${normalized}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
	return path;
}