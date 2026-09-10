/**
 * ISBN lookup adapter (G-916).
 *
 * `LIBRARY_ISBN_PROVIDER=openlibrary` selects the HTTP implementation.
 * Tests and the default path use the offline stub — never the network.
 */

export interface IsbnLookupResult {
  isbn: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
}

export interface IsbnLookup {
  lookup(isbn: string): Promise<IsbnLookupResult | null>;
}

export function normalizeIsbn(isbn: string): string {
  return isbn.replace(/[-\s]/g, '').toUpperCase();
}

const STUB_CATALOG: Record<string, IsbnLookupResult> = {
  '9780134685991': {
    isbn: '9780134685991',
    title: 'Introduction to Algorithms',
    author: 'Cormen et al.',
    publisher: 'MIT Press',
    publishedYear: 2022,
  },
  '9780262033848': {
    isbn: '9780262033848',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    publisher: 'Prentice Hall',
    publishedYear: 2008,
  },
  '9780201633610': {
    isbn: '9780201633610',
    title: 'Design Patterns',
    author: 'Gamma et al.',
    publisher: 'Addison-Wesley',
    publishedYear: 1994,
  },
};

/** Deterministic offline lookup — never calls the network. */
export class StubIsbnLookup implements IsbnLookup {
  async lookup(isbn: string): Promise<IsbnLookupResult | null> {
    const key = normalizeIsbn(isbn);
    if (!key) return null;
    return (
      STUB_CATALOG[key] ?? {
        isbn: key,
        title: `Title for ${key}`,
        author: 'Unknown author',
        publisher: null,
        publishedYear: null,
      }
    );
  }
}

export class OpenLibraryIsbnLookup implements IsbnLookup {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async lookup(isbn: string): Promise<IsbnLookupResult | null> {
    const key = normalizeIsbn(isbn);
    if (!key) return null;
    const response = await this.fetchImpl(
      `https://openlibrary.org/isbn/${encodeURIComponent(key)}.json`,
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      title?: string;
      authors?: Array<{ name?: string }>;
      publishers?: string[];
      publish_date?: string;
    };
    const title = body.title?.trim();
    if (!title) return null;
    const yearMatch = body.publish_date?.match(/(19|20)\d{2}/);
    return {
      isbn: key,
      title,
      author:
        body.authors
          ?.map((a) => a.name)
          .filter(Boolean)
          .join(', ') || null,
      publisher: body.publishers?.[0] ?? null,
      publishedYear: yearMatch ? Number(yearMatch[0]) : null,
    };
  }
}

export function createIsbnLookup(env: NodeJS.ProcessEnv = process.env): IsbnLookup {
  const provider = env.LIBRARY_ISBN_PROVIDER?.trim().toLowerCase();
  if (provider === 'openlibrary') return new OpenLibraryIsbnLookup();
  return new StubIsbnLookup();
}
