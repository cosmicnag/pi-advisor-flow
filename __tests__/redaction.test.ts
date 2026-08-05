/**
 * Unit tests for src/redaction.ts — secret redaction before advisor reviews.
 *
 * Two layers: the pure redactSecrets patterns, and (at the bottom) a runtime
 * check that the text handed to the review function has tool results / user
 * prompts scrubbed — i.e. redaction is wired into the actual review path, not
 * just exported.
 */

import { describe, expect, it, vi } from "vitest";
import { redactSecrets } from "../src/redaction.js";
import { AdvisorRuntime } from "../src/runtime.js";
import type { Api, AssistantMessage, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AdvisorReviewResult } from "../src/agent.js";
import type { AdvisorNote, AdvisorTrigger } from "../src/index.js";

describe("redactSecrets", () => {
	it("redacts PEM private keys", () => {
		const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\n-----END PRIVATE KEY-----";
		const { text, redactions } = redactSecrets(`key:\n${pem}`);
		expect(text).not.toContain("MIIEvQIBADAN");
		expect(text).toContain("[REDACTED]");
		expect(redactions).toBeGreaterThan(0);
	});

	it("redacts Bearer tokens", () => {
		const { text } = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456");
		expect(text).toContain("Bearer [REDACTED]");
		expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
	});

	it("redacts sk-/pk-/api-/token- prefixed values", () => {
		const { text } = redactSecrets("api key sk-ant-api03-abcdefghijklmnop-qrstuvwxyz");
		expect(text).not.toContain("sk-ant-api03");
		expect(text).toContain("[REDACTED]");
	});

	it("redacts well-known service tokens (ghp, glpat, xox, AKIA)", () => {
		for (const token of ["ghp_abcdefghijklmnopqrstuvwxyz", "glpat-abcdefghijklmnop", "xoxb-1234567890-abcdef", "AKIAABCDEFGHIJKLMNOP"]) {
			const { text } = redactSecrets(`token=${token}`);
			expect(text).not.toContain(token);
			expect(text).toContain("[REDACTED]");
		}
	});

	it("redacts key=value and key: value assignments", () => {
		const { text } = redactSecrets("api_key = super-secret-value-1234\nPASSWORD= hunter2");
		expect(text).not.toContain("super-secret-value-1234");
		expect(text).not.toContain("hunter2");
		expect(text).toContain("[REDACTED]");
	});

	it("redacts credentials embedded in URLs", () => {
		const { text } = redactSecrets("https://admin:password123@example.com/repo");
		expect(text).not.toContain("password123");
		expect(text).toContain("[REDACTED]");
	});

	it("leaves ordinary text untouched", () => {
		const plain = "The quick brown fox jumps over the lazy dog.";
		expect(redactSecrets(plain).text).toBe(plain);
	});
});

// ---------------------------------------------------------------------------
// Runtime wiring: the review function must receive redacted text even when the
// secrets arrive through paths that bypass the rolling buffer (tool_result /
// input extra) or through the buffer itself (tool results on turn_end).
// ---------------------------------------------------------------------------

let idCounter = 0;
function entry(role: "user" | "assistant", text: string): SessionEntry {
	idCounter++;
	return {
		type: "message",
		id: `e${idCounter}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role,
			content: role === "assistant" ? [{ type: "text", text }] : text,
			...(role === "assistant"
				? {
						api: "openai-completions",
						provider: "fake",
						model: "fake",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
						stopReason: "stop" as const,
						timestamp: Date.now(),
					}
				: { timestamp: Date.now() }),
		} as unknown as import("@earendil-works/pi-agent-core").AgentMessage,
	} as unknown as SessionEntry;
}

type ReviewFn = (
	text: string,
	model: Model<Api>,
	auth: { apiKey?: string; headers?: Record<string, string> },
	cwd: string,
	signal: AbortSignal,
	config: { maxToolRounds: number; thinking: boolean; thinkingLevel: "minimal" | "low" | "medium" | "high" | "xhigh"; systemPrompt?: string; onUsage?: () => void },
) => Promise<AdvisorReviewResult>;

const FAKE_MODEL: Model<Api> = {
	id: "fake",
	name: "Fake",
	api: "openai-completions" as Api,
	provider: "fake",
	baseUrl: "http://localhost",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8192,
};

function makeRuntime(
	review: ReviewFn,
	config: Partial<{ enabled: boolean; advisorModel: string | null; contextChars: number; triggers: AdvisorTrigger[]; armForTasks: boolean }> = {},
) {
	const sendAdvice = vi.fn(async (_notes: AdvisorNote[], _model: string, _opts?: { forceNonTriggering?: boolean }) => {});
	const host = { sendAdvice };
	const rt = new AdvisorRuntime(
		host as never,
		() => ({
			enabled: config.enabled ?? true,
			armForTasks: config.armForTasks ?? false,
			advisorModel: config.advisorModel === undefined ? "fake/fake" : config.advisorModel,
			thinking: false,
			thinkingLevel: "medium" as const,
			contextChars: config.contextChars ?? 12_000,
			cooldownMs: 0,
			maxToolRounds: 6,
			maxRetries: 3,
			interrupting: true,
			syncLag: 0,
			triggers: config.triggers ?? ["turn_end", "tool_error"],
			midPauseMs: 4000,
			instructionsMode: "project",
		}),
		review as never,
	);
	const ctx = {
		signal: new AbortController().signal,
		cwd: "/tmp",
		modelRegistry: { find: () => FAKE_MODEL },
		getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "k", headers: {} }),
	};
	return { rt, sendAdvice, host, ctx };
}

async function settle(rt: AdvisorRuntime, ms = 50): Promise<void> {
	for (let i = 0; i < 50 && rt.isBusy; i++) {
		await new Promise((r) => setTimeout(r, ms / 10));
	}
	await new Promise((r) => setTimeout(r, 5));
}

describe("AdvisorRuntime — redaction wiring", () => {
	it("redacts secrets from tool results on turn_end before the advisor sees them", async () => {
		let seen = "";
		const { rt, ctx } = makeRuntime(async (text) => {
			seen = text;
			return { advise: null, rounds: 1 };
		});
		await rt.onTurnEnd(
			{
				role: "assistant",
				content: [{ type: "text", text: "reading the config" }],
				api: "openai-completions",
				provider: "fake",
				model: "fake",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			} as unknown as AssistantMessage,
			[{ role: "toolResult", toolCallId: "c1", name: "read", content: [{ type: "text", text: "api_key=sk-live-secret-abcdefghijkl" }], timestamp: Date.now() } as unknown as ToolResultMessage],
			[entry("user", "check the config")],
			ctx,
		);
		await settle(rt);
		expect(seen).toContain("[REDACTED]");
		expect(seen).not.toContain("sk-live-secret-abcdefghijkl");
	});

	it("redacts the tool_result extra injected at requestReview (bypasses the buffer)", async () => {
		let seen = "";
		const { rt, ctx } = makeRuntime(
			async (text) => {
				seen = text;
				return { advise: null, rounds: 1 };
			},
			{ triggers: ["tool_result"] },
		);
		await rt.onToolExecutionEnd(
			{ toolCallId: "c1", toolName: "bash", result: "AWS_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
			ctx,
		);
		await settle(rt);
		expect(seen).toContain("[REDACTED]");
		expect(seen).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
	});

	it("redacts the raw user prompt on the input trigger", async () => {
		let seen = "";
		const { rt, ctx } = makeRuntime(
			async (text) => {
				seen = text;
				return { advise: null, rounds: 1 };
			},
			{ triggers: ["input"] },
		);
		await rt.onInput("deploy with token ghp_abcdefghijklmnopqrstuvwxyz please", ctx);
		await settle(rt);
		expect(seen).toContain("[REDACTED]");
		expect(seen).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
	});
});
