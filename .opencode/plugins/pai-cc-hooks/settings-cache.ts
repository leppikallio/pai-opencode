import {
	type LoadedClaudeHookSettings,
	loadClaudeHookSettings,
} from "./claude/config";

let settingsPromise: Promise<LoadedClaudeHookSettings> | null = null;

export function resetPaiCcHooksSettingsCacheForTests(): void {
	settingsPromise = null;
}

export function getPaiCcHooksSettings(): Promise<LoadedClaudeHookSettings> {
	if (!settingsPromise) {
		settingsPromise = loadClaudeHookSettings();
	}

	return settingsPromise as Promise<LoadedClaudeHookSettings>;
}
