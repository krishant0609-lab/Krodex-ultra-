'use client';

/**
 * KRODEX web — Backlog (index).
 *
 *   /backlog
 *
 * Phase 7.9 visual layer:
 *  - Eyebrow "Backlog", title "Recovery", and a calm
 *    description that names the purpose without fabrication.
 *  - A list of open backlog items. Each row shows: the
 *    source task id (mono), the reason, the open date
 *    on the right, and a recover/drop action pair.
 *  - 7-state contract honored: loading, empty, error,
 *    populated. The empty state is honest: "Your backlog
 *    is empty" — we do not invent a starter item.
 *
 * Hooks used (no new server state):
 *  - useBacklogItems({ state: 'open', limit: 50 })
 *  - useRecoverBacklogItem(id)
 *  - useDropBacklogItem(id)
 *
 * Out of scope: viewing a closed backlog item (the API
 * supports GET /backlog/:id but the queue only filters
 * open items; closing a row keeps it in the list once
 * the filter is changed). For Phase 7.9 the page is the
 * read-and-act queue.
 */

import { PageShell } from '../../../components/page-shell';
import { ApiError } from '../../../lib/api-client';
import {
  useBacklogItems,
  useDropBacklogItem,
  useRecoverBacklogItem,
} from '../../../hooks/use-backlog';
import { formatShortDate } from '../../../lib/format-date';
import styles from './backlog.module.css';

interface BacklogRowProps {
  item: {
    id: string;
    source_task_id: string;
    reason: string;
    state: string;
    created_at: string;
  };
}

function BacklogRow({ item }: BacklogRowProps): JSX.Element {
  const recover = useRecoverBacklogItem(item.id);
  const drop = useDropBacklogItem(item.id);

  const openLabel = formatShortDate(item.created_at) ?? '—';
  const isOpen = item.state === 'open' || item.state === 'scheduled';

  const handleRecover = (): void => {
    recover.mutate({});
  };

  const handleDrop = (): void => {
    drop.mutate();
  };

  return (
    <li className={styles.item} data-testid={`backlog-item-${item.id}`}>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <div className={styles.rowMeta}>
            <span
              className={styles.rowTask}
              data-testid={`backlog-task-${item.id}`}
            >
              {item.source_task_id}
            </span>
            <span className={styles.rowReason}>{item.reason}</span>
          </div>
          {isOpen ? (
            <div className={styles.actionsRow}>
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
                onClick={handleRecover}
                disabled={recover.isPending || drop.isPending}
                data-testid={`backlog-recover-${item.id}`}
              >
                Recover
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={handleDrop}
                disabled={recover.isPending || drop.isPending}
                data-testid={`backlog-drop-${item.id}`}
              >
                Drop
              </button>
            </div>
          ) : (
            <span className={styles.rowReason}>{item.state}</span>
          )}
        </div>
        <div className={styles.rowAside}>
          <span className={styles.rowLabel}>Opened</span>
          <span className={styles.rowDate}>{openLabel}</span>
        </div>
      </div>
    </li>
  );
}

export default function BacklogPage(): JSX.Element {
  const backlog = useBacklogItems({ state: 'open', limit: 50 });
  const items = backlog.data?.items ?? [];
  const isEmpty = !backlog.isLoading && !backlog.isError && items.length === 0;

  return (
    <PageShell
      title="Recovery"
      eyebrow="Backlog"
      description="Open missed items. Recover one to schedule it back into your planner, or drop it to close the loop."
      isLoading={backlog.isLoading}
      isError={backlog.isError}
      error={backlog.error}
      isEmpty={isEmpty}
      emptyTitle="Your backlog is empty"
      emptyMessage="When a planned task is marked missed, it will appear here for you to recover or drop."
    >
      <ol className={styles.list} data-testid="backlog-list">
        {items.map((item) => (
          <BacklogRow key={item.id} item={item} />
        ))}
      </ol>
      {backlog.isError ? (
        <p className={styles.errorMeta} role="status">
          {backlog.error instanceof ApiError
            ? `${backlog.error.code} (${backlog.error.status})`
            : 'Could not load backlog.'}
        </p>
      ) : null}
    </PageShell>
  );
}
