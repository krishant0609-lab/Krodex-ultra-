import type { ReactNode } from 'react';
import { AppShellClient } from './app-shell-client';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return <AppShellClient>{children}</AppShellClient>;
}
