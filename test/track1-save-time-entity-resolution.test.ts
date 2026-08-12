import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import {
  resolveEntitySlug,
  resolveEntitySlugWithSource,
} from '../src/core/entities/resolve.ts';
import { MIGRATIONS } from '../src/core/migrate.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { PostgresEngine } from '../src/core/postgres-engine.ts';
import { _resetWarnOnceForTests } from '../src/core/utils.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';

type EngineKind = 'postgres' | 'pglite';

class ResolverHarness {
  readonly exactPages = new Map<string, string>();
  readonly slugAliases = new Map<string, string>();
  readonly pageAliases = new Map<string, string[]>();
  readonly fuzzy = new Map<string, string>();
  readonly prefix = new Map<string, string>();
  readonly aliasRedirectCalls: Array<{
    slug: string;
    sources: string | readonly string[];
  }> = [];
  readonly pageAliasCalls: Array<{
    names: string[];
    sourceId?: string;
    sourceIds?: string[];
  }> = [];
  fuzzyCalls = 0;
  slugAliasError: unknown;
  pageAliasError: unknown;

  constructor(readonly kind: EngineKind, readonly sourceId = 'source-a') {}

  private key(sourceId: string, value: string): string {
    return `${sourceId}|${value}`;
  }

  addExact(slug: string, sourceId = this.sourceId): void {
    this.exactPages.set(this.key(sourceId, slug), slug);
  }

  addSlugAlias(alias: string, canonical: string, sourceId = this.sourceId): void {
    this.slugAliases.set(this.key(sourceId, alias), canonical);
  }

  addPageAlias(aliasNorm: string, targets: string[], sourceId = this.sourceId): void {
    this.pageAliases.set(this.key(sourceId, aliasNorm), targets);
  }

  addFuzzy(raw: string, canonical: string, sourceId = this.sourceId): void {
    this.fuzzy.set(this.key(sourceId, raw.toLowerCase()), canonical);
  }

  addPrefix(token: string, canonical: string, sourceId = this.sourceId): void {
    this.prefix.set(this.key(sourceId, token), canonical);
  }

  async executeRaw<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('SELECT slug FROM pages WHERE source_id')) {
      const sourceId = String(params[0]);
      const slug = String(params[1]);
      const exact = this.exactPages.get(this.key(sourceId, slug));
      return (exact ? [{ slug: exact }] : []) as T[];
    }
    if (sql.includes('GREATEST(') && sql.includes('similarity(')) {
      this.fuzzyCalls++;
      const sourceId = String(params[0]);
      const raw = String(params[1]);
      const slug = this.fuzzy.get(this.key(sourceId, raw));
      return (slug ? [{ slug, title: slug, score: 0.9 }] : []) as T[];
    }
    if (sql.includes('AS connection_count') && sql.includes('p.slug LIKE ANY')) {
      const sourceId = String(params[0]);
      const patterns = Array.isArray(params[1]) ? params[1].map(String) : [];
      for (const pattern of patterns) {
        const match = pattern.match(/^(?:people|companies)\/([a-z0-9-]+)(?:-%|)$/);
        const slug = match ? this.prefix.get(this.key(sourceId, match[1])) : undefined;
        if (slug) return [{ slug, connection_count: 1 }] as T[];
      }
      return [];
    }
    throw new Error(`Unexpected resolver SQL: ${sql.replace(/\s+/g, ' ').trim()}`);
  }

  async resolveSlugWithAlias(
    slug: string,
    sourceOrSources: string | readonly string[],
  ): Promise<string> {
    this.aliasRedirectCalls.push({ slug, sources: sourceOrSources });
    if (this.slugAliasError) {
      const error = this.slugAliasError;
      this.slugAliasError = undefined;
      throw error;
    }
    const sourceId = Array.isArray(sourceOrSources)
      ? sourceOrSources[0]
      : sourceOrSources;
    return this.slugAliases.get(this.key(String(sourceId), slug)) ?? slug;
  }

  async resolveAliases(
    names: string[],
    opts?: { sourceId?: string; sourceIds?: string[] },
  ): Promise<Map<string, Array<{ slug: string; source_id: string }>>> {
    this.pageAliasCalls.push({ names: [...names], ...opts });
    if (this.pageAliasError) {
      const error = this.pageAliasError;
      this.pageAliasError = undefined;
      throw error;
    }
    const sourceId = opts?.sourceIds?.[0] ?? opts?.sourceId ?? this.sourceId;
    const out = new Map<string, Array<{ slug: string; source_id: string }>>();
    for (const name of names) {
      const targets = this.pageAliases.get(this.key(sourceId, name)) ?? [];
      if (targets.length > 0) {
        out.set(name, targets.map((slug) => ({ slug, source_id: sourceId })));
      }
    }
    return out;
  }

  asEngine(): BrainEngine {
    return this as unknown as BrainEngine;
  }
}

for (const kind of ['postgres', 'pglite'] as const) {
  describe(`${kind} shared resolver contract`, () => {
    test('slug alias redirect is source-scoped and inherited by the untagged save seam', async () => {
      const harness = new ResolverHarness(kind);
      harness.addSlugAlias('people/brian-old', 'people/brian-example');
      harness.addSlugAlias('people/brian-old', 'people/wrong-source', 'source-b');

      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        'people/brian-old',
      )).toEqual({ slug: 'people/brian-example', source: 'alias_redirect' });
      expect(await resolveEntitySlug(
        harness.asEngine(),
        'source-a',
        'people/brian-old',
      )).toBe('people/brian-example');
      expect(harness.aliasRedirectCalls).toEqual([
        { slug: 'people/brian-old', sources: 'source-a' },
        { slug: 'people/brian-old', sources: 'source-a' },
      ]);
    });

    test('exact live page wins before slug alias lookup', async () => {
      const harness = new ResolverHarness(kind);
      harness.addExact('people/brian-old');
      harness.addSlugAlias('people/brian-old', 'people/brian-example');

      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        'people/brian-old',
      )).toEqual({ slug: 'people/brian-old', source: 'exact_page' });
      expect(harness.aliasRedirectCalls).toHaveLength(0);
    });

    test('single normalized display-name alias is source-scoped and tagged', async () => {
      const harness = new ResolverHarness(kind);
      harness.addPageAlias('brian', ['people/brian-example']);
      harness.addPageAlias('brian', ['people/wrong-source'], 'source-b');

      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        '  [Brian]  ',
      )).toEqual({ slug: 'people/brian-example', source: 'alias_match' });
      expect(harness.pageAliasCalls).toEqual([
        { names: ['brian'], sourceId: 'source-a' },
      ]);
      expect(harness.fuzzyCalls).toBe(0);
    });

    test('lowercase bare and hyphenated names still cascade through page aliases', async () => {
      const harness = new ResolverHarness(kind);
      harness.addPageAlias('kendall', ['people/kendall-example']);
      harness.addPageAlias('kendall-example', ['people/kendall-example']);

      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        'kendall',
      )).toEqual({ slug: 'people/kendall-example', source: 'alias_match' });
      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        'kendall-example',
      )).toEqual({ slug: 'people/kendall-example', source: 'alias_match' });
    });

    test('42501 on either alias lookup resumes the old cascade and warns once', async () => {
      _resetWarnOnceForTests();
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const slugHarness = new ResolverHarness(kind);
        slugHarness.slugAliasError = Object.assign(
          new Error('permission denied for table slug_aliases'),
          { code: '42501' },
        );
        slugHarness.addFuzzy('people/brian-old', 'people/brian-example');
        expect(await resolveEntitySlugWithSource(
          slugHarness.asEngine(),
          'source-a',
          'people/brian-old',
        )).toEqual({ slug: 'people/brian-example', source: 'fuzzy_match' });
        expect(slugHarness.pageAliasCalls).toHaveLength(0);

        const pageHarness = new ResolverHarness(kind);
        pageHarness.pageAliasError = Object.assign(
          new Error('permission denied for table page_aliases'),
          { sqlState: '42501' },
        );
        pageHarness.addFuzzy('Brian Example', 'people/brian-example');
        expect(await resolveEntitySlugWithSource(
          pageHarness.asEngine(),
          'source-a',
          'Brian Example',
        )).toEqual({ slug: 'people/brian-example', source: 'fuzzy_match' });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const warning = String(warnSpy.mock.calls[0]?.[0]);
        expect(warning).toContain('SQLSTATE 42501');
        expect(warning).toContain('connecting role needs SELECT');
        expect(warning).toContain('any applicable row-security policy');
        expect(warning).toContain('slug_aliases and page_aliases');
        expect(warning).not.toContain('migration 127');
        expect(warning).not.toContain('gbrain_tenant');
      } finally {
        warnSpy.mockRestore();
        _resetWarnOnceForTests();
      }
    });

    test('multi-hit alias records sorted ambiguity and falls through safely', async () => {
      const harness = new ResolverHarness(kind);
      harness.addPageAlias('brian example', [
        'people/brian-beta',
        'people/brian-alpha',
        'people/brian-beta',
      ]);
      harness.addFuzzy('Brian Example', 'people/brian-fuzzy');

      expect(await resolveEntitySlugWithSource(
        harness.asEngine(),
        'source-a',
        'Brian Example',
      )).toEqual({
        slug: 'people/brian-fuzzy',
        source: 'fuzzy_match',
        ambiguous_aliases: ['people/brian-alpha', 'people/brian-beta'],
      });
    });

    test('no alias rows preserve current exact, fuzzy, unambiguous-prefix, and fallback results', async () => {
      const harness = new ResolverHarness(kind);
      harness.addExact('people/exact-person');
      harness.addFuzzy('Fuzzy Person', 'people/fuzzy-person');
      harness.addPrefix('alice', 'people/alice-example');

      const cases = [
        ['people/exact-person', { slug: 'people/exact-person', source: 'exact_page' }],
        ['Fuzzy Person', { slug: 'people/fuzzy-person', source: 'fuzzy_match' }],
        ['Alice', { slug: 'people/alice-example', source: 'fuzzy_match' }],
        ['Unknown Person', { slug: 'unknown-person', source: 'fallback_slugify' }],
      ] as const;

      for (const [raw, expected] of cases) {
        const tagged = await resolveEntitySlugWithSource(
          harness.asEngine(),
          'source-a',
          raw,
        );
        expect(tagged).toEqual(expected);
        expect(tagged && 'ambiguous_aliases' in tagged).toBeFalse();
        expect(await resolveEntitySlug(harness.asEngine(), 'source-a', raw)).toBe(expected.slug);
      }
    });
  });
}

test('upstream migrations leave deployment-specific alias grants to deployments', () => {
  const migrationSql = MIGRATIONS.map((migration) => [
    migration.sql,
    migration.sqlFor?.postgres,
    migration.sqlFor?.pglite,
  ].filter(Boolean).join('\n')).join('\n');

  expect(MIGRATIONS.some(
    ({ name }) => name === 'tenant_alias_table_select_grants',
  )).toBeFalse();
  expect(migrationSql).not.toContain('gbrain_tenant');
  expect(migrationSql).not.toContain(
    'GRANT SELECT ON TABLE slug_aliases, page_aliases',
  );
});

function permissionDeniedTransaction(table: 'slug_aliases' | 'page_aliases') {
  let savepointCalls = 0;
  const permissionDenied = () => Object.assign(
    new Error(`permission denied for table ${table}`),
    { code: '42501' },
  );
  const queryText = (strings: TemplateStringsArray) => strings.join(' ');

  const sql = async (
    strings: TemplateStringsArray,
  ): Promise<Array<Record<string, unknown>>> => {
    if (queryText(strings).includes(`FROM ${table}`)) throw permissionDenied();
    return [{ ok: 1 }];
  };
  Object.assign(sql, {
    async savepoint<T>(fn: (nested: typeof sql) => Promise<T>): Promise<T> {
      savepointCalls++;
      const nested = async (
        strings: TemplateStringsArray,
      ): Promise<Array<Record<string, unknown>>> => {
        if (queryText(strings).includes(`FROM ${table}`)) throw permissionDenied();
        return [{ ok: 1 }];
      };
      return fn(nested as typeof sql);
    },
  });
  return { sql, savepointCalls: () => savepointCalls };
}

test('Postgres alias reads isolate permission errors with transaction savepoints', async () => {
  for (const table of ['slug_aliases', 'page_aliases'] as const) {
    const tx = permissionDeniedTransaction(table);
    const engine = new PostgresEngine();
    Object.defineProperty(engine, '_sql', { value: tx.sql });
    const operation = table === 'slug_aliases'
      ? engine.resolveSlugWithAlias('people/brian-old', 'source-a')
      : engine.resolveAliases(['brian'], { sourceId: 'source-a' });
    await expect(operation).rejects.toHaveProperty('code', '42501');
    expect(tx.savepointCalls()).toBe(1);
    expect(await tx.sql`SELECT 1 AS ok`).toEqual([{ ok: 1 }]);
  }
});

async function expectSqlState(
  operation: Promise<unknown>,
  expectedCode: '42501' | '42P01',
): Promise<void> {
  await expect(operation).rejects.toHaveProperty('code', expectedCode);
}

describe('PGLite recoverable alias reads', () => {
  let pglite: PGLiteEngine;

  beforeAll(async () => {
    pglite = new PGLiteEngine();
    await pglite.connect({});
    await pglite.initSchema();
    await pglite.executeRaw('CREATE ROLE track1_alias_denied NOLOGIN');
  });

  afterAll(async () => {
    await pglite.disconnect();
  });

  beforeEach(async () => {
    await resetPgliteState(pglite);
  });

  test('recovers after permission-denied alias reads in a transaction', async () => {
    await pglite.transaction(async (txEngine) => {
      await txEngine.executeRaw('SET LOCAL ROLE track1_alias_denied');
      await expectSqlState(
        txEngine.resolveSlugWithAlias('people/brian-old', 'default'),
        '42501',
      );
      expect(await txEngine.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
    });

    await pglite.transaction(async (txEngine) => {
      await txEngine.executeRaw('SET LOCAL ROLE track1_alias_denied');
      await expectSqlState(
        txEngine.resolveAliases(['brian'], { sourceId: 'default' }),
        '42501',
      );
      expect(await txEngine.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
    });
  });

  test('serializes concurrent alias recovery in one transaction', async () => {
    await pglite.transaction(async (txEngine) => {
      await txEngine.executeRaw('SET LOCAL ROLE track1_alias_denied');
      const [slugResult, pageResult] = await Promise.allSettled([
        txEngine.resolveSlugWithAlias('people/brian-old', 'default'),
        txEngine.resolveAliases(['brian'], { sourceId: 'default' }),
      ]);
      expect(slugResult.status).toBe('rejected');
      expect(pageResult.status).toBe('rejected');
      if (slugResult.status === 'rejected') {
        expect((slugResult.reason as { code?: string }).code).toBe('42501');
      }
      if (pageResult.status === 'rejected') {
        expect((pageResult.reason as { code?: string }).code).toBe('42501');
      }
      expect(await txEngine.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
    });
  });

  test('recovers after missing-table alias probes in a transaction', async () => {
    const rollbackSlug = new Error('rollback slug table drop');
    await expect(pglite.transaction(async (txEngine) => {
      await txEngine.executeRaw('DROP TABLE slug_aliases');
      expect(await txEngine.resolveSlugWithAlias(
        'people/brian-old',
        'default',
      )).toBe('people/brian-old');
      expect(await txEngine.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
      throw rollbackSlug;
    })).rejects.toBe(rollbackSlug);

    const rollbackPage = new Error('rollback page table drop');
    await expect(pglite.transaction(async (txEngine) => {
      await txEngine.executeRaw('DROP TABLE page_aliases');
      await expectSqlState(
        txEngine.resolveAliases(['brian'], { sourceId: 'default' }),
        '42P01',
      );
      expect(await txEngine.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
      throw rollbackPage;
    })).rejects.toBe(rollbackPage);
  });
});
