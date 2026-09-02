'use client';

import { PageShell } from '../../../components/page-shell';
import { usePlannerTasks } from '../../../hooks/use-planner';

export default function PlannerPage(): JSX.Element {
  const tasks = usePlannerTasks({ limit: 100 });

  return (
    <PageShell
      title="Planner"
      description="Today's and upcoming tasks."
      isLoading={tasks.isLoading}
      isError={tasks.isError}
      error={tasks.error}
      isEmpty={!tasks.isLoading && (tasks.data?.items.length ?? 0) === 0}
      emptyMessage="No tasks planned."
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(tasks.data?.items ?? []).map((t) => (
          <li
            key={t.id}
            data-testid={`planner-task-${t.id}`}
            style={{
              padding: '0.5rem 0',
              borderBottom: '1px solid #eee',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{t.title}</span>
            <span style={{ color: '#888', fontSize: '0.875rem' }}>
              {t.state} · {t.plan_date}
            </span>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
