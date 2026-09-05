import Link from 'next/link';

interface ComingSoonProps {
  readonly title: string;
  readonly description: string;
}

/**
 * Placeholder for developer-portal routes that are linked from marketing
 * but not yet implemented (docs / dashboard / marketplace).
 */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-primary-700">
        Coming soon
      </p>
      <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-gray-900">{title}</h1>
      <p className="mb-8 max-w-lg text-base leading-relaxed text-gray-600">{description}</p>
      <Link
        href="/"
        className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
      >
        Back to Developer Portal
      </Link>
    </main>
  );
}
