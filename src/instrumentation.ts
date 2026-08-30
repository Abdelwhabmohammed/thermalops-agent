export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const g = globalThis as unknown as { thermalopsBooted?: boolean };
  if (g.thermalopsBooted) return;
  g.thermalopsBooted = true;

  const { startScheduler } = await import('@/lib/server/scheduler');
  startScheduler();
}
