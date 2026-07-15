/**
 * Global (cross-repo, per-user) persistent instructions for the advisor.
 *
 * Lives at `~/.pi/agent/extensions/pi-advisor-instructions.md` — alongside the
 * global config file (`pi-advisor.json`). Unlike {@link module:project-instructions
 * project instructions}, these are NOT scoped to a working directory: they apply
 * to every repo where the user opts into "global" instructions mode.
 *
 * Selection between project / global / none is driven by `AdvisorConfig.instructionsMode`;
 * this module only owns storage. See `/advisor instructions global …`.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_SUBDIR = "extensions";

/** Human-editable file stored once, globally, in the pi agent config dir. */
export const GLOBAL_INSTRUCTIONS_FILENAME = "pi-advisor-instructions.md";

/** Keep accidental giant files from consuming the advisor's context window. */
export const MAX_GLOBAL_INSTRUCTIONS_CHARS = 32_000;

/** Full global path: ~/.pi/agent/extensions/pi-advisor-instructions.md */
export function getGlobalInstructionsPath(): string {
	return join(getAgentDir(), CONFIG_SUBDIR, GLOBAL_INSTRUCTIONS_FILENAME);
}

export function normalizeGlobalInstructions(value: string): string {
	const normalized = value.trim();
	if (normalized.length > MAX_GLOBAL_INSTRUCTIONS_CHARS) {
		throw new Error(
			`Advisor global instructions are too long (${normalized.length} characters; maximum ${MAX_GLOBAL_INSTRUCTIONS_CHARS}).`,
		);
	}
	return normalized;
}

/** Read global instructions. A missing file means none are set. */
export function readGlobalInstructions(): string {
	const path = getGlobalInstructionsPath();
	if (!existsSync(path)) return "";
	return normalizeGlobalInstructions(readFileSync(path, "utf8"));
}

/** Returns true if global instructions are currently persisted. */
export function hasGlobalInstructions(): boolean {
	return existsSync(getGlobalInstructionsPath());
}

/**
 * Persist global instructions atomically. Blank text clears them (removes the
 * file). Returns the global path.
 */
export function writeGlobalInstructions(value: string): string {
	const path = getGlobalInstructionsPath();
	const normalized = normalizeGlobalInstructions(value);
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

/** Remove the global instructions file if present. Returns true if it existed. */
export function clearGlobalInstructions(): boolean {
	const path = getGlobalInstructionsPath();
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}