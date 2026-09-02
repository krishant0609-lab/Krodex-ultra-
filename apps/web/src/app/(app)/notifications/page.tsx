'use client';

import { PageShell } from '../../../components/page-shell';
import { useNotifications, useUpdateNotification } from '../../../hooks/use-notifications';

export default function NotificationsPage(): JSX.Element {
  const notifications = useNotifications({ limit: 50 });

  return (
    <PageShell
      title="Notifications"
      description="Inbox. Click a row to mark it read."
      isLoading={notifications.isLoading}
      isError={notifications.isError}
      error={notifications.error}
      isEmpty={
        !notifications.isLoading && (notifications.data?.items.length ?? 0) === 0
      }
      emptyMessage="Inbox zero."
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {(notifications.data?.items ?? []).map((n) => {
          // Derive a presentational read-state from the read_at / dismissed_at
          // columns the row actually carries. There is no persisted `state`
          // field on NotificationRow.
          const isRead = n.read_at !== null || n.dismissed_at !== null;
          return (
            <NotificationRow
              key={n.id}
              notificationId={n.id}
              kind={n.kind}
              state={isRead ? 'read' : 'unread'}
            />
          );
        })}
      </ul>
    </PageShell>
  );
}

interface NotificationRowProps {
  notificationId: string;
  kind: string;
  state: string;
}

function NotificationRow({
  notificationId,
  kind,
  state,
}: NotificationRowProps): JSX.Element {
  const update = useUpdateNotification(notificationId);
  const isRead = state !== 'unread';
  return (
    <li
      data-testid={`notifications-item-${notificationId}`}
      style={{
        padding: '0.5rem 0',
        borderBottom: '1px solid #eee',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{kind}</span>
      <button
        type="button"
        onClick={() => update.mutate({ state: 'read' })}
        disabled={isRead || update.isPending}
        style={{
          padding: '0.25rem 0.5rem',
          border: '1px solid #ccc',
          background: '#fff',
          borderRadius: '0.25rem',
        }}
      >
        {isRead ? 'Read' : 'Mark read'}
      </button>
    </li>
  );
}
