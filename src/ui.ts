/**
 * Custom TUI components for /advisor interactive menus.
 *
 * Both mirror the pattern from pi's built-in selectors / pi-vision-handoff:
 * a `Component` mounting a fuzzy-searchable, scrollable list via `ctx.ui.custom`.
 * The flow is search-as-you-type (the Input is always focused), with arrow keys
 * to move the highlight and dedicated keys to toggle/confirm/cancel.
 */

import {
	type Component,
	Container,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { DynamicBorder, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import {
	ADVISOR_TRIGGERS,
	ADVISOR_TRIGGER_LABELS,
	formatModelRef,
	type AdvisorTrigger,
} from "./index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Triggers multi-select
// ─────────────────────────────────────────────────────────────────────────────

export interface TriggersSelectorResult {
	/** The new trigger set (always ≥1; the picker refuses to save an empty set). */
	triggers: AdvisorTrigger[];
	/** True if the user cancelled (Esc) — config must not change. */
	cancelled: boolean;
}

interface TriggerItem {
	trigger: AdvisorTrigger;
	label: string;
	description: string;
}

/**
 * Final width guard for custom TUI output.
 *
 * pi 0.83 treats any custom-component line wider than `render(width)` as a
 * fatal rendering error. Built-in Text/Input components already honor width,
 * but direct styled strings (headings, hints) do not. Keep this guard at the
 * component boundary so future copy changes cannot crash the entire TUI.
 */
function fitToWidth(lines: string[], width: number): string[] {
	const maxWidth = Math.max(1, width);
	return lines.map((line) => visibleWidth(line) > maxWidth
		? truncateToWidth(line, maxWidth, "")
		: line);
}

export class TriggersSelectorComponent implements Component {
	private theme: Theme;
	private done: (result: TriggersSelectorResult) => void;

	private readonly allItems: TriggerItem[] = ADVISOR_TRIGGERS.map((t) => ({
		trigger: t,
		label: ADVISOR_TRIGGER_LABELS[t],
		description: ADVISOR_TRIGGER_LABELS[t],
	}));
	private filteredItems: TriggerItem[] = this.allItems;
	/** Mutated locally as the user toggles; committed to config only on save. */
	private selected: Set<AdvisorTrigger>;
	private selectedIndex = 0;
	private readonly maxVisible = 8;
	private searchInput: Input;
	private listContainer: Container;
	private footerText: Text;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(theme: Theme, current: AdvisorTrigger[], done: (result: TriggersSelectorResult) => void) {
		this.theme = theme;
		this.done = done;
		this.selected = new Set(current);
		this.searchInput = new Input();
		this.listContainer = new Container();
		this.footerText = new Text(this.footer(), 0, 0);
		this.searchInput.onSubmit = () => this.save();
		this.updateList();
	}

	render(width: number): string[] {
		const border = new DynamicBorder((s) => this.theme.fg("accent", s));
		const lines: string[] = [];
		lines.push(...border.render(width));
		lines.push("");
		lines.push(this.theme.fg("accent", this.theme.bold("Advisor triggers")));
		lines.push(...wrapTextWithAnsi(
			this.theme.fg(
				"muted",
				"Capture always runs on turn_end; these pick which moments DO review. At least one must stay on.",
			),
			Math.max(1, width),
		));
		lines.push("");
		lines.push(...this.searchInput.render(width));
		lines.push("");
		lines.push(...this.listContainer.render(width));
		lines.push("");
		lines.push(...this.footerText.render(width));
		lines.push(...border.render(width));
		return fitToWidth(lines, width);
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}
		// Tab toggles the highlighted trigger (distinct from search text).
		if (matchesKey(data, Key.tab)) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) this.toggle(item.trigger);
			return;
		}
		if (kb.matches(data, "tui.select.confirm") || matchesKey(data, Key.ctrl("s"))) {
			this.save();
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.finish(true);
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.finish(true);
			}
			return;
		}
		this.searchInput.handleInput(data);
		this.refresh();
	}

	invalidate(): void {
		this.searchInput.invalidate();
		this.listContainer.invalidate();
		this.footerText.invalidate();
	}

	// ── internals ──────────────────────────────────────────────────────────

	private toggle(t: AdvisorTrigger): void {
		if (this.selected.has(t)) this.selected.delete(t);
		else this.selected.add(t);
		this.updateList();
	}

	private save(): void {
		// Refuse to save an empty set: keep focus so the user can re-enable one.
		if (this.selected.size === 0) {
			this.footerText.setText(this.theme.fg("warning", "  At least one trigger must stay enabled. (tab to toggle)"));
			return;
		}
		// Preserve ADVISOR_TRIGGERS order in the saved array.
		const triggers = ADVISOR_TRIGGERS.filter((t) => this.selected.has(t));
		this.done({ triggers, cancelled: false });
	}

	private finish(cancelled: boolean): void {
		this.done({ triggers: [], cancelled });
	}

	private refresh(): void {
		const query = this.searchInput.getValue();
		this.filteredItems = query
			? fuzzyFilter(this.allItems, query, (i) => `${i.trigger} ${i.description}`)
			: this.allItems;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching triggers"), 0, 0));
			this.footerText.setText(this.footer());
			return;
		}
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;
			const selected = i === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
			const box = this.selected.has(item.trigger) ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
			const name = selected ? this.theme.fg("accent", item.trigger) : item.trigger;
			this.listContainer.addChild(new Text(`${prefix}${box} ${name}`, 0, 0));
		}
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`), 0, 0));
		}
		const cur = this.filteredItems[this.selectedIndex];
		if (cur) {
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(new Text(this.theme.fg("muted", `  ${cur.description}`), 0, 0));
		}
		this.footerText.setText(this.footer());
	}

	private footer(): string {
		const on = ADVISOR_TRIGGERS.filter((t) => this.selected.has(t));
		const parts = [
			`${keyText("tui.select.up" as never)}/${keyText("tui.select.down" as never)} move`,
			"tab toggle",
			`${keyText("tui.select.confirm" as never)} save`,
			"esc cancel",
			`${on.length} on`,
		];
		return this.theme.fg("dim", `  ${parts.join(" · ")} · ${on.length ? on.join(", ") : "(none — pick one)"}`);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Advisor model picker
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelSelectorResult {
	/** "provider/id", or null for the synthetic "None" row / cancellation. */
	ref: string | null;
	cancelled: boolean;
}

interface ModelItem {
	ref: string | null;
	provider: string;
	modelId: string;
	modelName: string;
	reasoning: boolean;
	vision: boolean;
	none?: boolean;
}

interface PickableModel {
	provider: string;
	id: string;
	name: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
}

function fmtK(n: number | undefined): string {
	if (!n || n <= 0) return "—";
	return n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
}

export class AdvisorModelSelectorComponent implements Component {
	private theme: Theme;
	private done: (result: ModelSelectorResult) => void;

	private allItems: ModelItem[];
	private filteredItems: ModelItem[];
	private selectedIndex = 0;
	private readonly maxVisible = 10;
	private searchInput: Input;
	private listContainer: Container;
	private footerText: Text;
	private currentRef: string | null;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		theme: Theme,
		models: PickableModel[],
		currentRef: string | null,
		done: (result: ModelSelectorResult) => void,
	) {
		this.theme = theme;
		this.done = done;
		this.currentRef = currentRef;
		this.allItems = this.buildItems(models, currentRef);
		this.filteredItems = this.allItems;
		// Initial highlight: the current model if it's in the list; otherwise the
		// FIRST real model (index 1, since index 0 is the synthetic "None" row).
		// We deliberately never default to "None": a stray Enter on a pre-highlighted
		// "None" would silently disable the advisor (the trap that bit users whose
		// configured model isn't enumerated by the registry, where findIndex = -1).
		const start = this.allItems.findIndex((i) => i.ref === currentRef);
		this.selectedIndex = start >= 0 ? start : Math.min(1, this.allItems.length - 1);
		this.searchInput = new Input();
		this.listContainer = new Container();
		this.footerText = new Text(this.footer(), 0, 0);
		this.searchInput.onSubmit = () => {
			const item = this.filteredItems[this.selectedIndex];
			if (item) this.confirm(item);
		};
		this.updateList();
	}

	render(width: number): string[] {
		const border = new DynamicBorder((s) => this.theme.fg("accent", s));
		const lines: string[] = [];
		lines.push(...border.render(width));
		lines.push("");
		lines.push(this.theme.fg("accent", this.theme.bold("Advisor model")));
		lines.push(...wrapTextWithAnsi(
			this.theme.fg("muted", "Pick a second model to peer-review each turn. Type to filter."),
			Math.max(1, width),
		));
		lines.push("");
		lines.push(...this.searchInput.render(width));
		lines.push("");
		lines.push(...this.listContainer.render(width));
		lines.push("");
		lines.push(...this.footerText.render(width));
		lines.push(...border.render(width));
		return fitToWidth(lines, width);
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.confirm") || matchesKey(data, Key.ctrl("s"))) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) this.confirm(item);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.finish(true);
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.finish(true);
			}
			return;
		}
		this.searchInput.handleInput(data);
		this.refresh();
	}

	invalidate(): void {
		this.searchInput.invalidate();
		this.listContainer.invalidate();
		this.footerText.invalidate();
	}

	// ── internals ──────────────────────────────────────────────────────────

	private buildItems(models: PickableModel[], currentRef: string | null): ModelItem[] {
		const none: ModelItem = {
			ref: null,
			provider: "",
			modelId: "none",
			modelName: "None — disable the advisor (clears the model)",
			reasoning: false,
			vision: false,
			none: true,
		};
		const make = (m: PickableModel): ModelItem => ({
			ref: formatModelRef(m.provider, m.id),
			provider: m.provider,
			modelId: m.id,
			modelName: m.name || m.id,
			reasoning: !!m.reasoning,
			vision: !!(m.input && m.input.includes("image")),
		});
		const all = models.map(make);
		// Sort: current first, then reasoning-capable, then by ref (stable).
		all.sort((a, b) => {
			const aCur = a.ref === currentRef ? 0 : 1;
			const bCur = b.ref === currentRef ? 0 : 1;
			if (aCur !== bCur) return aCur - bCur;
			const aR = a.reasoning ? 0 : 1;
			const bR = b.reasoning ? 0 : 1;
			if (aR !== bR) return aR - bR;
			return (a.ref ?? "").localeCompare(b.ref ?? "");
		});
		return [none, ...all];
	}

	private footer(): string {
		const total = this.allItems.length - 1;
		const reasoning = this.allItems.filter((i) => i.reasoning).length;
		const cur = this.currentRef ? `current: ${this.currentRef}` : "current: none";
		const match = this.searchInput.getValue() ? `${this.filteredItems.length - 1 <= 0 ? 0 : this.filteredItems.length - (this.filteredItems[0]?.none ? 1 : 0)} match` : `${total} models · ${reasoning} reasoning`;
		const parts = [
			`${keyText("tui.select.up" as never)}/${keyText("tui.select.down" as never)} move`,
			`${keyText("tui.select.confirm" as never)} select`,
			"esc cancel",
			match,
		];
		return this.theme.fg("dim", `  ${parts.join(" · ")} · ${cur} `);
	}

	private refresh(): void {
		const query = this.searchInput.getValue();
		this.filteredItems = query
			? fuzzyFilter(this.allItems, query, (i) => `${i.provider} ${i.modelId} ${i.ref ?? "none"} ${i.modelName}`)
			: this.allItems;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching models"), 0, 0));
			this.footerText.setText(this.footer());
			return;
		}
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;
			const selected = i === this.selectedIndex;
			const prefix = selected ? this.theme.fg("accent", "→ ") : "  ";
			let label: string;
			if (item.none) {
				label = this.theme.fg("warning", item.modelName);
			} else {
				const id = selected ? this.theme.fg("accent", item.modelId) : item.modelId;
				const provider = this.theme.fg("muted", ` [${item.provider}]`);
				const badges: string[] = [];
				if (item.reasoning) badges.push(this.theme.fg("success", "🧠"));
				if (item.vision) badges.push(this.theme.fg("accent", "🖼️"));
				const badgeStr = badges.length ? ` ${badges.join(" ")}` : "";
				label = `${id}${provider}${badgeStr}`;
			}
			const cur =
				(item.ref === this.currentRef && item.ref !== null) || (item.none && this.currentRef === null)
					? this.theme.fg("success", " ✓")
					: "";
			this.listContainer.addChild(new Text(`${prefix}${label}${cur}`, 0, 0));
		}
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`), 0, 0));
		}
		const cur = this.filteredItems[this.selectedIndex];
		if (cur) {
			this.listContainer.addChild(new Spacer(1));
			if (cur.none) {
				this.listContainer.addChild(new Text(this.theme.fg("muted", `  ${cur.modelName}`), 0, 0));
			} else {
				this.listContainer.addChild(new Text(this.theme.fg("muted", `  ${cur.modelName}`), 0, 0));
			}
		}
		this.footerText.setText(this.footer());
	}

	private confirm(item: ModelItem): void {
		this.done({ ref: item.ref, cancelled: false });
	}

	private finish(cancelled: boolean): void {
		this.done({ ref: null, cancelled });
	}
}