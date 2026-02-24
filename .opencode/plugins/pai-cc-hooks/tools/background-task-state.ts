export type BackgroundTaskStateRecord = {
  taskId: string;
  parentSessionId: string;
  childSessionId: string;
  status: "pending" | "completed";
  updatedAt: number;
};

export async function loadBackgroundTaskState(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: "not implemented" };
}
