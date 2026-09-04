import { redirect } from 'next/navigation';

/** Convenience alias — `/apply` redirects into the registration portal. */
export default function ApplyAliasPage(): never {
  redirect('/register');
}
