export type ReviewLauncherRegistryEntry = {
	launcherId: string;
	sourceFile: string;
	launchCallSnippet: string;
};

export const REVIEW_LAUNCHER_REGISTRY: ReviewLauncherRegistryEntry[] = [
	{
		launcherId: "task_background_review_launch_initial",
		sourceFile: ".opencode/plugins/pai-cc-hooks/tools/task.ts",
		launchCallSnippet: 'status: concurrencyEnabled ? "queued" : "running"',
	},
	{
		launcherId: "task_background_review_launch_after_concurrency_acquire",
		sourceFile: ".opencode/plugins/pai-cc-hooks/tools/task.ts",
		launchCallSnippet: 'status: "running",',
	},
];
