import { redirect } from 'next/navigation';

export default function AuthenticatedIndex() {
  redirect('/dashboard');
}
