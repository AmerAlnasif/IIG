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
  entityResolverPolicyFromPack,
  prepareEntityResolverPolicy,
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
  readonly exactPages = new Map<string, { slug: string; type: string; title: string }>();
  readonly softDeletedPages = new Set<string>();
  readonly slugAliases = new Map<string, string>();
  readonly pageAliases = new Map<string, string[]>();
  readonly fuzzy = new Map<string, Array<{
    slug: string;
    type: string;
    title: string;
    score: number;
  }>>();
  readonly prefix = new Map<string, { slug: string; type: string }>();
  readonly config = new Map<string, string>();
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

  addExact(
    slug: string,
    sourceId = this.sourceId,
    type = 'person',
    title = slug,
  ): void {
    this.exactPages.set(this.key(sourceId, slug), { slug, type, title });
    this.softDeletedPages.delete(this.key(sourceId, slug));
  }

  addSoftDeleted(slug: string, sourceId = this.sourceId): void {
    this.exactPages.set(this.key(sourceId, slug), { slug, type: 'person', title: slug });
    this.softDeletedPages.add(this.key(sourceId, slug));
  }

  addSlugAlias(alias: string, canonical: string, sourceId = this.sourceId): void {
    this.slugAliases.set(this.key(sourceId, alias), canonical);
  }

  addPageAlias(aliasNorm: string, targets: string[], sourceId = this.sourceId): void {
    this.pageAliases.set(this.key(sourceId, aliasNorm), targets);
  }

  addFuzzy(
    raw: string,
    canonical: string,
    sourceId = this.sourceId,
    type = 'person',
    score = 0.9,
    title = canonical,
  ): void {
    const key = this.key(sourceId, raw.toLowerCase());
    const candidates = this.fuzzy.get(key) ?? [];
    candidates.push({ slug: canonical, type, title, score });
    candidates.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
    this.fuzzy.set(key, candidates);
  }

  addPrefix(
    token: string,
    canonical: string,
    sourceId = this.sourceId,
    type = 'person',
  ): void {
    this.prefix.set(this.key(sourceId, token), { slug: canonical, type });
  }

  async getConfig(key: string): Promise<string | null> {
    return this.config.get(key) ?? null;
  }

  async executeRaw<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.includes('slug = ANY($2::text[])')) {
      if (!sql.includes('deleted_at IS NULL')) {
        throw new Error('alias target validation must exclude soft-deleted pages');
      }
      const sourceId = String(params[0]);
      const slugs = Array.isArray(params[1]) ? params[1].map(String) : [];
      const entityTypes = sql.includes('type = ANY')
        ? new Set((params.at(-1) as string[]).map(String))
        : null;
      return slugs
        .filter((slug) => {
          const key = this.key(sourceId, slug);
          const page = this.exactPages.get(key);
          return page &&
            !this.softDeletedPages.has(key) &&
            (!entityTypes || entityTypes.has(page.type));
        })
        .map((slug) => ({ slug })) as T[];
    }
    if (sql.includes('FROM pages') && sql.includes('slug = $2')) {
      const sourceId = String(params[0]);
      const slug = String(params[1]);
      const key = this.key(sourceId, slug);
      const page = this.softDeletedPages.has(key)
        ? undefined
        : this.exactPages.get(key);
      const entityTypes = sql.includes('type = ANY')
        ? new Set((params.at(-1) as string[]).map(String))
        : null;
      return (page && (!entityTypes || entityTypes.has(page.type))
        ? [{ slug: page.slug }]
        : []) as T[];
    }
    if (sql.includes('GREATEST(') && sql.includes('similarity(')) {
      this.fuzzyCalls++;
      const sourceId = String(params[0]);
      const raw = String(params[1]);
      const entityTypes = sql.includes('type = ANY')
        ? new Set((params.at(-1) as string[]).map(String))
        : null;
      const candidates = (this.fuzzy.get(this.key(sourceId, raw)) ?? [])
        .filter((candidate) => !entityTypes || entityTypes.has(candidate.type));
      return candidates.map(({ slug, title, score }) => ({ slug, title, score })) as T[];
    }
    if (sql.includes('AS connection_count') && sql.includes('p.slug LIKE ANY')) {
      const sourceId = String(params[0]);
      const patterns = Array.isArray(params[1]) ? params[1].map(String) : [];
      const entityTypes = sql.includes('type = ANY')
        ? new Set((params.at(-1) as string[]).map(String))
        : null;
      for (const pattern of patterns) {
        const match = pattern.match(/^(?:people|companies)\/([a-z0-9-]+)(?:-%|)$/);
        const candidate = match ? this.prefix.get(this.key(sourceId, match[1])) : undefined;
        if (candidate && (!entityTypes || entityTypes.has(candidate.type))) {
          return [{ slug: candidate.slug, connection_count: 1 }] as T[];
        }
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

describe('entity resolver predicate policy', () => {
  test('no active pack uses the bundled default entity taxonomy', async () => {
    const policy = await entityResolverPolicyFromPack(null);
    expect(policy.entityTypes).toEqual(['person', 'company', 'yc', 'civic']);
  });

  test('empty entity declarations fail open and warn once per process', async () => {
    _resetWarnOnceForTests();
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const emptyPack = {
        manifest: { name: 'empty-test-pack', page_types: [] },
      };
      const first = await entityResolverPolicyFromPack(emptyPack);
      const second = await entityResolverPolicyFromPack(emptyPack);

      expect(first.entityTypes).toEqual(['person', 'company', 'yc', 'civic']);
      expect(second.entityTypes).toEqual(['person', 'company', 'yc', 'civic']);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('empty-test-pack');
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('gbrain-base entity taxonomy');
    } finally {
      warnSpy.mockRestore();
      _resetWarnOnceForTests();
    }
  });

  test('a resolved pack with explicit entity types remains authoritative', async () => {
    const policy = await entityResolverPolicyFromPack({
      manifest: {
        name: 'authoritative-test-pack',
        page_types: [
          { name: 'person', primitive: 'annotation' },
          { name: 'researcher', primitive: 'entity' },
        ],
      },
    });
    expect(policy.entityTypes).toEqual(['researcher']);

    const harness = new ResolverHarness('postgres');
    harness.addExact('people/reclassified-person', 'source-a', 'person');
    harness.addExact('experts/exact-researcher', 'source-a', 'researcher');
    expect(await resolveEntitySlugWithSource(
      harness.asEngine(),
      'source-a',
      'people/reclassified-person',
      { policy },
    )).toEqual({
      slug: 'people/reclassified-person',
      source: 'fallback_slugify',
    });
    expect(await resolveEntitySlugWithSource(
      harness.asEngine(),
      'source-a',
      'experts/exact-researcher',
      { policy },
    )).toEqual({ slug: 'experts/exact-researcher', source: 'exact_page' });
  });

  test('per-source DB pack selection follows this lineage\'s dot-form key', async () => {
    const harness = new ResolverHarness('postgres');
    harness.config.set('schema_pack.source.source-a', 'gbrain-base-v2');
    harness.config.set('schema_pack', 'gbrain-base');

    expect((await prepareEntityResolverPolicy(
      harness.asEngine(),
      'source-a',
    )).entityTypes).toEqual(['person', 'company']);
    expect((await prepareEntityResolverPolicy(
      harness.asEngine(),
      'source-b',
    )).entityTypes).toEqual(['person', 'company', 'yc', 'civic']);
  });
});

for (const kind of ['postgres', 'pglite'] as const) {
  describe(`${kind} shared resolver contract`, () => {
    test('slug alias redirect is source-scoped and inherited by the untagged save seam', async () => {
      const harness = new ResolverHarness(kind);
      harness.addSlugAlias('people/brian-old', 'people/brian-example');
      harness.addSlugAlias('people/brian-old', 'people/wrong-source', 'source-b');
      harness.addExact('people/brian-example');

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
      harness.addExact('people/brian-example');

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
      harness.addExact('people/kendall-example');

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
      harness.addExact('people/brian-alpha');
      harness.addExact('people/brian-beta');
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

    test('dead alias targets fall through even when another source has a live page', async () => {
      const cases = [
        {
          raw: 'alice-old-soft',
          configure(harness: ResolverHarness) {
            harness.addSlugAlias('alice-old-soft', 'people/alice-soft-deleted');
            harness.addSoftDeleted('people/alice-soft-deleted');
            harness.addExact('people/alice-soft-deleted', 'source-b');
          },
          expected: 'alice-old-soft',
        },
        {
          raw: 'alice-old-purged',
          configure(harness: ResolverHarness) {
            harness.addSlugAlias('alice-old-purged', 'people/alice-purged');
            harness.addExact('people/alice-purged', 'source-b');
          },
          expected: 'alice-old-purged',
        },
        {
          raw: 'Alice Soft',
          configure(harness: ResolverHarness) {
            harness.addPageAlias('alice soft', ['people/alice-soft-deleted']);
            harness.addSoftDeleted('people/alice-soft-deleted');
            harness.addExact('people/alice-soft-deleted', 'source-b');
          },
          expected: 'alice-soft',
        },
        {
          raw: 'Alice Purged',
          configure(harness: ResolverHarness) {
            harness.addPageAlias('alice purged', ['people/alice-purged']);
            harness.addExact('people/alice-purged', 'source-b');
          },
          expected: 'alice-purged',
        },
      ];

      for (const scenario of cases) {
        const harness = new ResolverHarness(kind);
        scenario.configure(harness);

        expect(await resolveEntitySlugWithSource(
          harness.asEngine(),
          'source-a',
          scenario.raw,
        )).toEqual({
          slug: scenario.expected,
          source: 'fallback_slugify',
        });
        expect(await resolveEntitySlug(
          harness.asEngine(),
          'source-a',
          scenario.raw,
        )).toBe(scenario.expected);
      }
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

    test('save seam excludes a title-colliding non-entity candidate', async () => {
      const harness = new ResolverHarness(kind);
      harness.addExact('aliases/alex-example', 'source-a', 'note', 'alex-example');
      harness.addExact(
        'people/alex-example-person',
        'source-a',
        'person',
        'Alex Example',
      );
      harness.addFuzzy(
        'alex-example',
        'aliases/alex-example',
        'source-a',
        'note',
        1,
        'alex-example',
      );
      harness.addFuzzy(
        'alex-example',
        'people/alex-example-person',
        'source-a',
        'person',
        0.95,
        'Alex Example',
      );

      expect(await resolveEntitySlug(
        harness.asEngine(),
        'source-a',
        'alex-example',
      )).toBe('people/alex-example-person');
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

function pinnedAliasProjectionPool() {
  const statements: string[] = [];
  let savepointCalls = 0;
  let commits = 0;
  const queryText = (strings: TemplateStringsArray) => strings.join('$');

  const tx = async (
    strings: TemplateStringsArray,
  ): Promise<Array<Record<string, unknown>>> => {
    statements.push(queryText(strings));
    return [{ ok: 1 }];
  };
  Object.assign(tx, {
    async savepoint<T>(fn: (nested: typeof tx) => Promise<T>): Promise<T> {
      savepointCalls++;
      return fn(tx);
    },
  });

  const pool = Object.assign(async () => [], {
    async begin<T>(fn: (nested: typeof tx) => Promise<T>): Promise<T> {
      const result = await fn(tx);
      commits++;
      return result;
    },
  });

  return {
    pool,
    statements,
    savepointCalls: () => savepointCalls,
    commits: () => commits,
  };
}

test('Postgres alias projection nests on a pinned transaction', async () => {
  const harness = pinnedAliasProjectionPool();
  const engine = new PostgresEngine();
  Object.defineProperty(engine, '_sql', { value: harness.pool });

  await engine.transaction(async (scoped) => {
    await scoped.setPageAliases('people/alice-example', 'source-a', [
      'alice',
      'alice example',
    ]);
  });

  expect(harness.savepointCalls()).toBe(1);
  expect(harness.commits()).toBe(1);
  expect(harness.statements.some((sql) => sql.includes('DELETE FROM page_aliases'))).toBeTrue();
  expect(harness.statements.some((sql) => sql.includes('INSERT INTO page_aliases'))).toBeTrue();
});

function concurrentDeniedProbePool() {
  let aborted = false;
  let commits = 0;
  let savepointSeq = 0;
  let maxSavepointDepth = 0;
  const savepointStack: string[] = [];
  const permissionDenied = (table: string) => Object.assign(
    new Error(`permission denied for table ${table}`),
    { code: '42501' },
  );
  const queryText = (strings: TemplateStringsArray) => strings.join(' ');

  const tx = async (
    strings: TemplateStringsArray,
  ): Promise<Array<Record<string, unknown>>> => {
    if (aborted) {
      throw Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
    }
    const sql = queryText(strings);
    if (sql.includes('FROM slug_aliases')) throw permissionDenied('slug_aliases');
    if (sql.includes('FROM page_aliases')) throw permissionDenied('page_aliases');
    return [{ ok: 1 }];
  };
  Object.assign(tx, {
    async unsafe(sql: string): Promise<Array<Record<string, unknown>>> {
      if (aborted) {
        throw Object.assign(new Error('current transaction is aborted'), { code: '25P02' });
      }
      return sql.includes('SELECT 1 AS ok') ? [{ ok: 1 }] : [];
    },
    async savepoint<T>(fn: (nested: typeof tx) => Promise<T>): Promise<T> {
      const name = `s${savepointSeq++}`;
      savepointStack.push(name);
      maxSavepointDepth = Math.max(maxSavepointDepth, savepointStack.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      try {
        const result = await fn(tx);
        const index = savepointStack.indexOf(name);
        if (index < 0) {
          aborted = true;
          throw Object.assign(new Error(`savepoint ${name} does not exist`), { code: '3B001' });
        }
        savepointStack.splice(index, 1);
        return result;
      } catch (error) {
        const index = savepointStack.indexOf(name);
        if (index < 0) {
          aborted = true;
          throw Object.assign(new Error(`savepoint ${name} does not exist`), { code: '3B001' });
        }
        savepointStack.splice(index);
        throw error;
      }
    },
  });

  const pool = Object.assign(async () => [], {
    async begin<T>(fn: (nested: typeof tx) => Promise<T>): Promise<T> {
      const result = await fn(tx);
      if (aborted) {
        throw Object.assign(new Error('cannot commit aborted transaction'), { code: '25P02' });
      }
      commits++;
      return result;
    },
  });

  return {
    pool,
    commits: () => commits,
    maxSavepointDepth: () => maxSavepointDepth,
  };
}

test('Postgres serializes concurrent denied alias probes for the full savepoint lifecycle', async () => {
  const harness = concurrentDeniedProbePool();
  const engine = new PostgresEngine();
  Object.defineProperty(engine, '_sql', { value: harness.pool });

  await engine.transaction(async (scoped) => {
    const results = await Promise.allSettled([
      scoped.resolveSlugWithAlias('people/alice-old', 'source-a'),
      scoped.resolveAliases(['alice'], { sourceId: 'source-a' }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(results.map((result) =>
      result.status === 'rejected'
        ? (result.reason as { code?: string }).code
        : undefined,
    )).toEqual(['42501', '42501']);
    expect(await scoped.executeRaw('SELECT 1 AS ok')).toEqual([{ ok: 1 }]);
  });

  expect(harness.maxSavepointDepth()).toBe(1);
  expect(harness.commits()).toBe(1);
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
