import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  extractConversationFactsFingerprint,
  PER_SEGMENT_SOURCE_PREFIX,
  runExtractConversationFactsCore,
  TERMINAL_AUDIT_SOURCE,
} from '../src/commands/extract-conversation-facts.ts';
import {
  BudgetExhausted,
  BudgetTracker,
} from '../src/core/budget/budget-tracker.ts';
import { runPhaseConversationFactsBackfill } from '../src/core/cycle/conversation-facts-backfill.ts';
import type { ExtractedFact } from '../src/core/facts/extract.ts';
import { loadOpCheckpoint } from '../src/core/op-checkpoint.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';

function message(name: string, date: string, time: string, body: string): string {
  return `**${name}** (${date} ${time}): ${body}`;
}

const ONE_SEGMENT_BODY = [
  message('Alpha Example', '2026-08-12', '10:00 AM', 'The role was accepted.'),
  message('Beta Example', '2026-08-12', '10:01 AM', 'Congratulations.'),
].join('\n');

const TWO_SEGMENT_BODY = [
  message('Alpha Example', '2026-08-12', '10:00 AM', 'First segment.'),
  message('Beta Example', '2026-08-12', '10:01 AM', 'Still first.'),
  message('Alpha Example', '2026-08-12', '11:00 AM', 'Second segment.'),
  message('Beta Example', '2026-08-12', '11:01 AM', 'Still second.'),
].join('\n');

const extractedFacts: ExtractedFact[] = [
  {
    fact: 'Brian accepted the role',
    kind: 'event',
    entity_slug: 'Brian',
    source: 'test',
    source_session: null,
    confidence: 1,
    notability: 'medium',
  },
  {
    fact: 'An unlisted person attended',
    kind: 'event',
    entity_slug: 'Unlisted Person',
    source: 'test',
    source_session: null,
    confidence: 1,
    notability: 'medium',
  },
  {
    fact: 'The weather was clear',
    kind: 'fact',
    entity_slug: null,
    source: 'test',
    source_session: null,
    confidence: 1,
    notability: 'low',
  },
];

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

afterAll(async () => {
  await engine.disconnect();
});

beforeEach(async () => {
  await resetPgliteState(engine);
  await engine.setConfig('facts.extraction_enabled', 'true');
  await engine.setConfig('conversation_parser.llm_fallback_enabled', 'false');
  await engine.setConfig('cycle.conversation_facts_backfill.enabled', 'true');
  await seedConversation(ONE_SEGMENT_BODY);
});

async function seedConversation(body: string): Promise<void> {
  await engine.putPage('sessions/example', {
    type: 'conversation',
    title: 'Example conversation',
    compiled_truth: body,
    timeline: '',
    frontmatter: {},
  });
  await engine.putPage('people/brian-example', {
    type: 'person',
    title: 'Brian Example',
    compiled_truth: '# Brian Example',
    timeline: '',
    frontmatter: {},
  });
  await engine.setPageAliases('people/brian-example', 'default', ['brian']);
}

function extractorFor(...batches: ExtractedFact[][]) {
  let index = 0;
  return async (): Promise<ExtractedFact[]> =>
    (batches[index++] ?? []).map((fact) => ({ ...fact }));
}

async function checkpointEntries(): Promise<string[]> {
  return loadOpCheckpoint(engine, {
    op: 'extract-conversation-facts',
    fingerprint: extractConversationFactsFingerprint({ sourceId: 'default' }),
  });
}

async function dataEntities(): Promise<Array<string | null>> {
  const rows = await engine.executeRaw<{ entity_slug: string | null }>(
    `SELECT entity_slug
       FROM facts
      WHERE source = $1
        AND source_markdown_slug = 'sessions/example'
      ORDER BY row_num`,
    [PER_SEGMENT_SOURCE_PREFIX],
  );
  return rows.map((row) => row.entity_slug);
}

async function terminalCount(): Promise<number> {
  const rows = await engine.executeRaw<{ count: string | number }>(
    `SELECT COUNT(*) AS count
       FROM facts
      WHERE source = $1
        AND source_markdown_slug = 'sessions/example'`,
    [TERMINAL_AUDIT_SOURCE],
  );
  return Number(rows[0]?.count ?? 0);
}

describe('conversation backfill entity resolution', () => {
  test('canonicalizes aliases, preserves null, and counts fallback slugification', async () => {
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runExtractConversationFactsCore(engine, {
        sourceId: 'default',
        slug: 'sessions/example',
        types: ['conversation'],
        sleepMs: 0,
        extractor: extractorFor(extractedFacts),
      });

      expect(await dataEntities()).toEqual([
        'people/brian-example',
        'unlisted-person',
        null,
      ]);
      expect(result.fallback_slugify_count).toBe(1);
      expect(result.resolution_errors).toBe(0);
      expect(result.facts_inserted).toBe(3);
      expect(await terminalCount()).toBe(1);

      const stderr = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain(
        'entity_resolution_counts={"alias_match":1,"fallback_slugify":1}',
      );
    } finally {
      writeSpy.mockRestore();
    }
  });

  test('rejects soft-deleted and purged targets from both alias lanes', async () => {
    await engine.executeRaw(
      `INSERT INTO sources (id, name)
       VALUES ('source-b', 'Source B')
       ON CONFLICT (id) DO NOTHING`,
    );

    const targets = [
      'people/alice-soft-deleted',
      'people/alice-purged',
    ];
    for (const slug of targets) {
      await engine.putPage(slug, {
        type: 'person',
        title: slug,
        compiled_truth: `# ${slug}`,
        timeline: '',
        frontmatter: {},
      });
      await engine.putPage(slug, {
        type: 'person',
        title: slug,
        compiled_truth: `# ${slug} in source B`,
        timeline: '',
        frontmatter: {},
      }, { sourceId: 'source-b' });
    }

    await engine.executeRaw(
      `INSERT INTO slug_aliases (source_id, alias_slug, canonical_slug)
       VALUES
         ('default', 'alice-old-soft', 'people/alice-soft-deleted'),
         ('default', 'alice-old-purged', 'people/alice-purged')`,
    );
    await engine.setPageAliases(
      'people/alice-soft-deleted',
      'default',
      ['alice soft'],
    );
    await engine.setPageAliases(
      'people/alice-purged',
      'default',
      ['alice purged'],
    );
    await engine.softDeletePage('people/alice-soft-deleted', { sourceId: 'default' });
    await engine.deletePage('people/alice-purged', { sourceId: 'default' });

    const staleAliasFacts: ExtractedFact[] = [
      {
        fact: 'The soft-deleted redirect was mentioned',
        kind: 'event',
        entity_slug: 'alice-old-soft',
        source: 'test',
        source_session: null,
        confidence: 1,
        notability: 'medium',
      },
      {
        fact: 'The purged redirect was mentioned',
        kind: 'event',
        entity_slug: 'alice-old-purged',
        source: 'test',
        source_session: null,
        confidence: 1,
        notability: 'medium',
      },
      {
        fact: 'The soft-deleted display alias was mentioned',
        kind: 'event',
        entity_slug: 'Alice Soft',
        source: 'test',
        source_session: null,
        confidence: 1,
        notability: 'medium',
      },
      {
        fact: 'The purged display alias was mentioned',
        kind: 'event',
        entity_slug: 'Alice Purged',
        source: 'test',
        source_session: null,
        confidence: 1,
        notability: 'medium',
      },
    ];

    const result = await runExtractConversationFactsCore(engine, {
      sourceId: 'default',
      slug: 'sessions/example',
      types: ['conversation'],
      sleepMs: 0,
      extractor: extractorFor(staleAliasFacts),
    });

    expect(await dataEntities()).toEqual([
      'alice-old-soft',
      'alice-old-purged',
      'alice-soft',
      'alice-purged',
    ]);
    expect(result.fallback_slugify_count).toBe(4);
  });

  test('backfill excludes a title-colliding non-entity candidate', async () => {
    await engine.putPage('aliases/alex-example', {
      type: 'note',
      title: 'alex-example',
      compiled_truth: '# Alias definition',
      timeline: '',
      frontmatter: {},
    });
    await engine.putPage('people/alex-example-person', {
      type: 'person',
      title: 'Alex Example',
      compiled_truth: '# Alex Example',
      timeline: '',
      frontmatter: {},
    });

    const result = await runExtractConversationFactsCore(engine, {
      sourceId: 'default',
      slug: 'sessions/example',
      types: ['conversation'],
      sleepMs: 0,
      extractor: extractorFor([{
        fact: 'Alex Example changed roles',
        kind: 'event',
        entity_slug: 'alex-example',
        source: 'test',
        source_session: null,
        confidence: 1,
        notability: 'medium',
      }]),
    });

    expect(await dataEntities()).toEqual(['people/alex-example-person']);
    expect(result.fallback_slugify_count).toBe(0);
    expect(result.resolution_errors).toBe(0);
  });

  test('best-effort resolver failure keeps the raw value and later segments checkpoint', async () => {
    await seedConversation(TWO_SEGMENT_BODY);
    const originalResolveAliases = engine.resolveAliases.bind(engine);
    engine.resolveAliases = async (names, opts) => {
      if (names.includes('unlisted person')) {
        throw new Error('resolver unavailable for unlisted person');
      }
      return originalResolveAliases(names, opts);
    };
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runExtractConversationFactsCore(engine, {
        sourceId: 'default',
        slug: 'sessions/example',
        types: ['conversation'],
        sleepMs: 0,
        extractor: extractorFor(
          [extractedFacts[0]],
          [extractedFacts[1], extractedFacts[0], extractedFacts[2]],
        ),
      });

      expect(await dataEntities()).toEqual([
        'people/brian-example',
        'Unlisted Person',
        'people/brian-example',
        null,
      ]);
      expect(result.resolution_errors).toBe(1);
      expect(result.fallback_slugify_count).toBe(0);
      expect(result.segments_processed).toBe(2);
      expect(result.facts_inserted).toBe(4);
      expect(result.pages_processed).toBe(1);
      expect(await checkpointEntries()).toContain(
        'default|sessions/example|2026-08-12T11:01:00Z',
      );
      expect(await terminalCount()).toBe(1);

      const stderr = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(stderr).toContain('entity resolution failed for "Unlisted Person"');
      expect(stderr).toContain('keeping raw value');
    } finally {
      engine.resolveAliases = originalResolveAliases;
      writeSpy.mockRestore();
    }
  });

  test('BudgetExhausted from resolution halts without becoming a resolution error', async () => {
    const originalResolveAliases = engine.resolveAliases.bind(engine);
    engine.resolveAliases = async () => {
      throw new BudgetExhausted('resolver budget exhausted', {
        reason: 'cost',
        spent: 2,
        cap: 1,
      });
    };
    try {
      const tracker = new BudgetTracker({ maxCostUsd: 1, label: 'track1-resolution' });
      const result = await runExtractConversationFactsCore(engine, {
        sourceId: 'default',
        slug: 'sessions/example',
        types: ['conversation'],
        sleepMs: 0,
        budgetTracker: tracker,
        extractor: extractorFor(extractedFacts),
      });

      expect(result.budget_exhausted).toBeTrue();
      expect(result.resolution_errors).toBe(0);
      expect(result.facts_inserted).toBe(0);
      expect(await dataEntities()).toEqual([]);
      expect(await terminalCount()).toBe(0);
      expect(await checkpointEntries()).toEqual([]);
    } finally {
      engine.resolveAliases = originalResolveAliases;
    }
  });

  test('failed data insert writes no terminal or telemetry and retries cleanly', async () => {
    const originalInsertFacts = engine.insertFacts.bind(engine);
    const writeSpy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      engine.insertFacts = async (facts, opts) => {
        if (facts.some((fact) => fact.source === PER_SEGMENT_SOURCE_PREFIX)) {
          throw new Error('constraint sentinel');
        }
        return originalInsertFacts(facts, opts);
      };
      await expect(runExtractConversationFactsCore(engine, {
        sourceId: 'default',
        slug: 'sessions/example',
        types: ['conversation'],
        sleepMs: 0,
        extractor: extractorFor(extractedFacts),
      })).rejects.toThrow('constraint sentinel');

      expect(await dataEntities()).toEqual([]);
      expect(await terminalCount()).toBe(0);
      expect(await checkpointEntries()).toEqual([]);
      const failedStderr = writeSpy.mock.calls.map((call) => String(call[0])).join('');
      expect(failedStderr).not.toContain('entity_resolution_counts=');
      engine.insertFacts = originalInsertFacts;

      const result = await runExtractConversationFactsCore(engine, {
        sourceId: 'default',
        slug: 'sessions/example',
        types: ['conversation'],
        sleepMs: 0,
        extractor: extractorFor(extractedFacts),
      });
      expect(result.facts_inserted).toBe(3);
      expect(result.fallback_slugify_count).toBe(1);
      expect(result.resolution_errors).toBe(0);
      expect(await terminalCount()).toBe(1);
      expect(await checkpointEntries()).toContain(
        'default|sessions/example|2026-08-12T10:01:00Z',
      );
    } finally {
      engine.insertFacts = originalInsertFacts;
      writeSpy.mockRestore();
    }
  });

  test('cycle propagates an abort instead of aggregating it as a source warning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runPhaseConversationFactsBackfill(engine, {
      signal: controller.signal,
      dryRun: true,
    })).rejects.toThrow('aborted');
  });
});
