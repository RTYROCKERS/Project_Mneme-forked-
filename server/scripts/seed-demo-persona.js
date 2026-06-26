/**
 * Seed a believable demo persona: a Software Engineer with ~4 years of
 * professional experience building backend services at a company. Builds a
 * coherent "history" so Mneme looks like it has been quietly observing this
 * person across years of real work:
 *   - the onboarding PRIOR (declared expertise -> triage profile)
 *   - a few weak DECLARED ANCHORS (the brain-dump claims)
 *   - 100+ OBSERVED memories across browser/terminal/IDE: the production
 *     gotchas, incident lessons, debugging war-stories and gradually-forgotten
 *     details a working engineer accumulates on the job — with realistic
 *     forgetting curves (solid -> almost gone), re-Googled "blind spots",
 *     varied ages, and knowledge-graph links.
 *
 * All memories are embedded via the ACTIVE provider (Azure) so recall fires.
 * Clears the demo account's existing Mneme memories first for a clean set.
 *
 * Usage: node scripts/seed-demo-persona.js [email]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const svc = require('../src/services/mnemeService');
const llm = require('../src/config/llm');
const { cosineSimilarity } = require('../src/engines/embeddingEngine');

const EMAIL = process.argv[2] || 'ashholmes591@gmail.com';
const LINK_AT = 0.45;
const DEDUPE_AT = 0.78;
const DAY = 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a, b) => Math.round(rnd(a, b));

// --- the persona's structured profile (drives the triage narrative) ----------
const PROFILE = {
  role: 'Software Engineer (4 years experience)',
  education: {
    current: 'BSc Computer Science',
    past: '',
  },
  focus: 'Backend services & distributed systems (Node.js/TypeScript, PostgreSQL, AWS, Kubernetes)',
};

// --- the persona's declared prior (drives triage chattiness) ----------------
const EXPERTISE = [
  { domain: 'Backend development (Node.js/TypeScript)', level: 'expert' },
  { domain: 'REST API design', level: 'expert' },
  { domain: 'SQL & PostgreSQL', level: 'comfortable' },
  { domain: 'Git & version control', level: 'expert' },
  { domain: 'Docker & containers', level: 'comfortable' },
  { domain: 'Kubernetes', level: 'learning' },
  { domain: 'Distributed systems', level: 'learning' },
  { domain: 'AWS & cloud infrastructure', level: 'learning' },
  { domain: 'Observability & monitoring', level: 'learning' },
];

// The onboarding brain-dump: things they CLAIMED -> weak, fading declared anchors.
const ANCHORS = [
  'REST API design and choosing correct HTTP status codes',
  'SQL joins, indexing and reading query plans',
  'Git branching, and merge vs rebase',
  'Docker images vs containers and writing Dockerfiles',
  'Writing unit and integration tests',
];

// Sources by key: [kind, identifier, label]
const SOURCES = {
  so:         ['browser',  'stackoverflow.com',      'Stack Overflow'],
  gh:         ['browser',  'github.com',             'GitHub'],
  aws:        ['browser',  'docs.aws.amazon.com',    'AWS Docs'],
  mdn:        ['browser',  'developer.mozilla.org',  'MDN Web Docs'],
  pg:         ['browser',  'postgresql.org',         'PostgreSQL Docs'],
  k8s:        ['browser',  'kubernetes.io',          'Kubernetes Docs'],
  redis:      ['browser',  'redis.io',               'Redis Docs'],
  react:      ['browser',  'react.dev',              'React Docs'],
  datadog:    ['browser',  'app.datadoghq.com',      'Datadog'],
  confluence: ['browser',  'wiki.company.internal',  'Confluence — internal wiki'],
  shell:      ['terminal', 'zsh',                    'Terminal'],
  orders:     ['desktop',  'company-platform/orders-service', 'VS Code — orders-service'],
  webapp:     ['desktop',  'company-platform/web-app',        'VS Code — web-app'],
};

// strength -> { stability(days), current retrievability } with jitter
const STRENGTH = {
  solid:       () => ({ stability: rnd(22, 34), r: rnd(0.86, 0.93), recall: pick(3, 7) }),
  fading:      () => ({ stability: rnd(8, 14),  r: rnd(0.63, 0.80), recall: pick(1, 3) }),
  slipping:    () => ({ stability: rnd(5, 8),   r: rnd(0.38, 0.55), recall: pick(0, 2) }),
  almost_gone: () => ({ stability: rnd(3, 5),   r: rnd(0.12, 0.30), recall: pick(0, 1) }),
};

// card, detail, difficulty, surface(source key), strength, [blind spot overrides]
const MEMORIES = [
  // --- Git & version control (lived-in muscle memory + classic re-Googles) ---
  ['git rebase rewrites commit history into a linear log — never rebase a branch others share.', 'Prefer merge on shared branches.', 'intermediate', 'shell', 'slipping', { lookup: 5, lapse: 1 }],
  ['git reflog can recover commits after a bad reset or rebase — they survive ~30 days before GC.', '', 'intermediate', 'shell', 'fading', { lookup: 3 }],
  ['git bisect binary-searches your commits to find the one that introduced a bug.', '', 'intermediate', 'shell', 'slipping', { lookup: 2 }],
  ['Use --force-with-lease instead of --force so you never clobber a teammate\u2019s pushed commits.', '', 'intermediate', 'shell', 'fading', { lookup: 2 }],
  ['git cherry-pick copies one specific commit onto your current branch.', '', 'easy', 'shell', 'fading'],
  ['Detached HEAD means you checked out a commit, not a branch — commit there and it\u2019s easy to lose.', 'Make a branch before committing.', 'intermediate', 'shell', 'slipping', { lookup: 3 }],
  ['A leaked secret in a git commit lives in history forever — rotate the key, deleting the file is not enough.', '', 'intermediate', 'gh', 'slipping', { lookup: 2 }],
  ['Squash a noisy feature branch into one clean commit before merging to keep main readable.', '', 'easy', 'gh', 'fading'],

  // --- Docker & containers ---
  ['A Docker image is an immutable snapshot; a container is a running instance of that image.', '', 'easy', 'shell', 'solid'],
  ['Each Dockerfile instruction is a cached layer — order least-changing steps first for fast rebuilds.', '', 'intermediate', 'orders', 'fading'],
  ['Copy package.json and install deps BEFORE copying source, or every code change busts the dep cache.', '', 'intermediate', 'orders', 'slipping', { lookup: 3 }],
  ['Use multi-stage builds to keep compilers and dev tools out of the final image and shrink it.', '', 'intermediate', 'orders', 'slipping', { lookup: 2 }],
  ['Running a container as root is a security risk — add a non-root USER in the Dockerfile.', '', 'intermediate', 'orders', 'fading'],
  ['docker exec -it <container> sh drops you into a running container to debug it live.', '', 'easy', 'shell', 'fading'],
  ['Containers are ephemeral — anything not on a mounted volume is gone on restart.', '', 'easy', 'shell', 'solid'],
  ['.dockerignore node_modules and .git or you bloat the build context and leak files into the image.', '', 'easy', 'orders', 'fading', { lookup: 2 }],

  // --- Kubernetes (still learning — lots of re-lookups) ---
  ['A failing liveness probe restarts the pod; a failing readiness probe just pulls it from the Service.', '', 'hard', 'k8s', 'slipping', { lookup: 4 }],
  ['CrashLoopBackOff means the container keeps exiting — check kubectl logs --previous for the last crash.', '', 'intermediate', 'shell', 'fading', { lookup: 3 }],
  ['Requests guarantee capacity, limits cap it — exceed a memory limit and the pod is OOMKilled.', '', 'hard', 'k8s', 'slipping', { lookup: 3 }],
  ['kubectl rollout undo reverts a Deployment to its previous ReplicaSet for a fast rollback.', '', 'intermediate', 'shell', 'almost_gone', { lookup: 3 }],
  ['A Service finds pods by label selector — a label typo means zero endpoints and silent failure.', '', 'intermediate', 'k8s', 'slipping', { lookup: 2 }],
  ['ConfigMap/Secret values mounted as env vars don\u2019t refresh until the pod restarts.', '', 'intermediate', 'k8s', 'fading'],
  ['ImagePullBackOff usually means a wrong image tag or missing registry credentials.', '', 'intermediate', 'shell', 'fading', { lookup: 2 }],
  ['HPA scales replicas on a metric (often CPU) — but it can\u2019t help if the bottleneck is the database.', '', 'hard', 'k8s', 'almost_gone', { lookup: 2 }],
  ['A pod stuck Pending usually means no node has enough CPU/memory to satisfy its requests.', '', 'intermediate', 'shell', 'slipping', { lookup: 3 }],

  // --- Databases / SQL (the daily backend grind) ---
  ['A database index (usually a B-tree) speeds reads but costs extra write time and storage.', '', 'intermediate', 'orders', 'solid'],
  ['The N+1 query problem: one query per row in a loop — batch it with a JOIN or a single IN clause.', '', 'intermediate', 'so', 'slipping', { lookup: 3 }],
  ['EXPLAIN ANALYZE shows the real plan — a Seq Scan on a big table usually means a missing index.', '', 'intermediate', 'pg', 'fading', { lookup: 2 }],
  ['A foreign key with no index makes joins and cascade deletes do full table scans.', '', 'intermediate', 'pg', 'slipping'],
  ['A long-running transaction holds its locks the whole time and blocks everyone — keep them short.', '', 'intermediate', 'pg', 'slipping'],
  ['Deadlock: two transactions each hold a lock the other wants — the DB kills one, so just retry it.', '', 'hard', 'pg', 'slipping', { lookup: 2 }],
  ['READ COMMITTED is Postgres\u2019 default; SERIALIZABLE prevents anomalies but aborts more under contention.', '', 'hard', 'pg', 'almost_gone', { lookup: 3 }],
  ['Connection pools exhaust under load — cap app pool size and front Postgres with PgBouncer.', '', 'hard', 'orders', 'slipping', { lookup: 2 }],
  ['Adding a NOT NULL column with no default rewrites and locks the whole table on big tables.', 'Add nullable, backfill, then set NOT NULL.', 'hard', 'pg', 'slipping', { lookup: 3 }],
  ['A unique constraint must be enforced by the DB — checking-then-inserting in app code races.', '', 'intermediate', 'orders', 'fading'],
  ['SELECT only the columns you need — SELECT * wastes bandwidth and breaks on schema changes.', '', 'easy', 'orders', 'fading'],
  ['ON DELETE CASCADE can silently wipe related rows — know your foreign keys before you delete.', '', 'intermediate', 'pg', 'fading', { lookup: 2 }],
  ['Soft deletes (deleted_at) preserve history, but now every query must remember to filter them.', '', 'intermediate', 'orders', 'slipping'],
  ['OFFSET pagination gets slower the deeper you page — use keyset/cursor pagination for big lists.', '', 'hard', 'orders', 'slipping', { lookup: 2 }],

  // --- Distributed systems (the hard-won lessons) ---
  ['CAP theorem: under a network partition you can keep consistency OR availability, not both.', '', 'hard', 'confluence', 'fading'],
  ['An idempotent endpoint can be retried safely — essential under at-least-once delivery.', 'Critical for payment and webhook retries.', 'hard', 'orders', 'slipping'],
  ['Retries with no backoff cause a thundering herd — use exponential backoff WITH jitter.', '', 'hard', 'confluence', 'slipping', { lookup: 3 }],
  ['Eventual consistency: replicas converge over time, so a read right after a write can be stale.', '', 'intermediate', 'confluence', 'fading'],
  ['A distributed lock needs a TTL, or a crashed holder blocks everyone forever.', '', 'hard', 'redis', 'slipping', { lookup: 2 }],
  ['At-least-once delivery means consumers MUST dedupe — track processed message IDs.', '', 'hard', 'orders', 'slipping'],
  ['Clock skew breaks "newest timestamp wins" — use version numbers or logical clocks instead.', '', 'hard', 'confluence', 'almost_gone', { lookup: 3 }],
  ['A circuit breaker fails fast instead of hammering a dependency that\u2019s already down.', '', 'hard', 'confluence', 'slipping', { lookup: 2 }],
  ['Prefer sagas over two-phase commit for cross-service transactions — 2PC is slow and blocks.', '', 'hard', 'confluence', 'almost_gone'],

  // --- Caching / Redis ---
  ['Cache invalidation is hard — stale cache is behind most "prod shows old data" bugs.', '', 'hard', 'redis', 'slipping', { lookup: 3 }],
  ['Always set a TTL on cache keys or memory grows unbounded until eviction or OOM.', '', 'intermediate', 'redis', 'fading'],
  ['Cache stampede: many keys expire at once and all miss to the DB — add jitter or a single-flight lock.', '', 'hard', 'redis', 'slipping', { lookup: 2 }],
  ['Redis is single-threaded — a big O(n) command like KEYS blocks everything; use SCAN instead.', '', 'hard', 'redis', 'slipping', { lookup: 3 }],
  ['Never cache per-user data under a global key — you\u2019ll serve one user\u2019s data to another.', '', 'intermediate', 'orders', 'fading'],
  ['Cache-aside: read cache, on miss load from DB and populate — but guard the populate from stampedes.', '', 'intermediate', 'confluence', 'almost_gone'],

  // --- Messaging / Kafka / queues ---
  ['Kafka preserves order only within a partition, never across the whole topic.', '', 'hard', 'confluence', 'slipping', { lookup: 3 }],
  ['A consumer group splits partitions across consumers — more consumers than partitions just sit idle.', '', 'hard', 'confluence', 'slipping'],
  ['Consumer lag means you\u2019re falling behind producers — scale consumers or speed up processing.', '', 'intermediate', 'datadog', 'fading', { lookup: 2 }],
  ['A poison message that always fails can block a partition — route it to a dead-letter queue.', '', 'hard', 'orders', 'slipping', { lookup: 2 }],
  ['Commit Kafka offsets AFTER processing, or a crash loses the in-flight messages.', '', 'hard', 'orders', 'slipping'],

  // --- HTTP / networking / API design ---
  ['HTTP 401 means "not authenticated"; 403 means "authenticated but not allowed".', '', 'easy', 'mdn', 'slipping', { lookup: 4, lapse: 1 }],
  ['429 Too Many Requests means you hit a rate limit — back off and honor the Retry-After header.', '', 'intermediate', 'mdn', 'fading', { lookup: 2 }],
  ['502 = upstream returned a bad response; 504 = upstream timed out. They point at different problems.', '', 'intermediate', 'datadog', 'fading', { lookup: 3 }],
  ['CORS is enforced by the browser — the SERVER must send Access-Control-Allow-Origin to permit it.', '', 'intermediate', 'mdn', 'slipping', { lookup: 5, lapse: 2 }],
  ['A preflight OPTIONS request precedes any non-simple cross-origin request.', '', 'intermediate', 'mdn', 'almost_gone', { lookup: 3 }],
  ['Set a timeout on every outbound HTTP call, or one slow dependency hangs your whole request.', '', 'intermediate', 'orders', 'slipping', { lookup: 2 }],
  ['Always paginate list endpoints — an unbounded result set eventually OOMs the server.', '', 'intermediate', 'orders', 'fading'],
  ['Version your public API (e.g. /v1) so you can evolve it without breaking existing clients.', '', 'intermediate', 'confluence', 'fading'],
  ['A REST API should be stateless and use the right verb and status code for each action.', '', 'intermediate', 'orders', 'fading'],
  ['gzip/brotli on JSON and text responses cuts bandwidth dramatically for little CPU.', '', 'easy', 'orders', 'fading'],
  ['Return 201 with a Location header on create, 204 with no body on a successful delete.', '', 'easy', 'mdn', 'almost_gone', { lookup: 2 }],

  // --- Security / auth ---
  ['Keep secrets out of source code — load API keys and connection strings from env vars or a vault.', '', 'easy', 'orders', 'solid'],
  ['A JWT is stateless auth: signed claims the server verifies without storing a session.', '', 'intermediate', 'mdn', 'fading'],
  ['Never log full request bodies — you\u2019ll leak passwords and tokens straight into your logs.', '', 'intermediate', 'orders', 'slipping', { lookup: 2 }],
  ['SQL injection: never string-concat user input into a query — always use parameterized queries.', '', 'intermediate', 'so', 'fading'],
  ['Hash passwords with bcrypt or argon2 plus a salt — never store plaintext or MD5.', '', 'intermediate', 'confluence', 'fading'],
  ['CSRF tokens stop a third-party page making authenticated requests on a logged-in user\u2019s behalf.', '', 'hard', 'mdn', 'almost_gone', { lookup: 3 }],
  ['Validate and sanitize input at the boundary — never trust anything the client sends.', '', 'intermediate', 'orders', 'fading'],
  ['Least privilege: a service\u2019s IAM role should grant only the exact actions it needs.', '', 'hard', 'aws', 'slipping', { lookup: 2 }],

  // --- Cloud / AWS (still learning) ---
  ['S3 buckets are private by default — an accidentally public bucket is a classic data leak.', '', 'intermediate', 'aws', 'fading', { lookup: 2 }],
  ['IAM is deny-by-default and an explicit Deny always beats an Allow.', '', 'hard', 'aws', 'slipping', { lookup: 3 }],
  ['Lambda cold starts add latency on the first call after idle — keep functions small and warm.', '', 'hard', 'aws', 'slipping', { lookup: 2 }],
  ['Lambdas are stateless — don\u2019t rely on globals or /tmp surviving between invocations.', '', 'intermediate', 'aws', 'fading'],
  ['SQS is at-least-once — design consumers to be idempotent and dedupe on a message ID.', '', 'hard', 'aws', 'slipping'],
  ['A security group is stateful (return traffic auto-allowed); a NACL is stateless.', '', 'hard', 'aws', 'almost_gone', { lookup: 3 }],
  ['Tag every cloud resource, or your monthly bill becomes impossible to attribute to a team.', '', 'easy', 'aws', 'fading'],
  ['A CloudWatch alarm in "Insufficient Data" often means the metric simply stopped reporting.', '', 'intermediate', 'datadog', 'almost_gone', { lookup: 2 }],

  // --- Observability (learning, but bitten often) ---
  ['Structured JSON logs are searchable and aggregatable; ad-hoc printf logs are not.', '', 'intermediate', 'datadog', 'fading'],
  ['p99 latency matters more than the average — the mean hides the slow tail users actually feel.', '', 'hard', 'datadog', 'slipping', { lookup: 2 }],
  ['A trace ID threaded through every service lets you follow one request end to end.', '', 'intermediate', 'datadog', 'slipping'],
  ['Alert on user-facing symptoms (error rate, latency), not causes (CPU) — page humans only for real pain.', '', 'hard', 'confluence', 'fading', { lookup: 2 }],
  ['High-cardinality labels (like user_id) on a metric explode your metrics cost.', '', 'hard', 'datadog', 'almost_gone', { lookup: 3 }],
  ['A dashboard nobody looks at is just decoration — alerts are what actually catch incidents.', '', 'easy', 'datadog', 'almost_gone'],

  // --- Concurrency & language gotchas (re-Googled forever) ---
  ['A race condition: two threads touch shared state unsynchronized — guard it with a lock.', '', 'hard', 'orders', 'slipping'],
  ['Node is single-threaded — a blocking sync call freezes the event loop and every other request.', '', 'intermediate', 'mdn', 'fading', { lookup: 2 }],
  ['await inside a loop runs serially — use Promise.all for independent async work.', '', 'intermediate', 'so', 'slipping', { lookup: 3 }],
  ['Floating point: 0.1 + 0.2 !== 0.3 — never store money as a float, use integer cents.', '', 'intermediate', 'so', 'fading', { lookup: 2 }],
  ['JavaScript Date months are 0-indexed — January is 0, December is 11.', '', 'easy', 'mdn', 'slipping', { lookup: 4, lapse: 1 }],
  ['Store timestamps in UTC and convert at the edge — naive local times cause off-by-an-hour bugs.', '', 'intermediate', 'so', 'slipping', { lookup: 3 }],
  ['Event listeners that are never removed leak memory and grow the heap until OOM.', '', 'hard', 'datadog', 'slipping', { lookup: 2 }],
  ['Use === in JS — == does type coercion and gives surprising truthy/falsy results.', '', 'easy', 'mdn', 'fading'],
  ['Python\u2019s default mutable argument (def f(x=[])) is shared across all calls — a classic trap.', '', 'intermediate', 'so', 'slipping', { lookup: 3 }],
  ['A regex with nested quantifiers can catastrophically backtrack and hang on crafted input.', '', 'hard', 'so', 'almost_gone', { lookup: 3 }],
  ['Mutating React state directly won\u2019t re-render — always set a new object/array.', '', 'intermediate', 'react', 'fading', { lookup: 2 }],
  ['React\u2019s useEffect runs after render; its dependency array decides when it re-runs.', 'Empty array = run once on mount.', 'intermediate', 'react', 'fading'],

  // --- Testing & CI/CD ---
  ['Flaky tests usually come from timing, shared state, or hidden test-order dependence.', '', 'intermediate', 'gh', 'slipping', { lookup: 2 }],
  ['A test that mocks everything tests nothing — keep real integration coverage on critical paths.', '', 'intermediate', 'orders', 'fading'],
  ['CI must FAIL the build on lint/test errors, not just warn — a warning nobody reads is ignored.', '', 'easy', 'gh', 'fading'],
  ['Code reviews catch more bugs and merge faster when each PR stays small and focused.', '', 'easy', 'gh', 'fading'],

  // --- Deploys & incidents ---
  ['Blue-green deploy keeps the old version live until the new one is healthy — instant rollback.', '', 'hard', 'confluence', 'slipping', { lookup: 2 }],
  ['A canary release sends a small % of traffic to the new version to catch issues before full rollout.', '', 'intermediate', 'confluence', 'slipping'],
  ['Feature flags decouple deploy from release — ship code dark, flip it on later.', '', 'intermediate', 'confluence', 'fading'],
  ['During a rolling deploy old and new code run together, so every DB migration must be backward-compatible.', '', 'hard', 'confluence', 'slipping', { lookup: 3 }],
  ['When prod is on fire, roll back first and root-cause later — restore service, then investigate.', '', 'easy', 'confluence', 'fading'],

  // --- Performance ---
  ['Profile before you optimize — premature optimization wastes time on code that isn\u2019t the bottleneck.', '', 'intermediate', 'confluence', 'fading'],
  ['Batching N small requests into one round trip cuts per-request overhead dramatically.', '', 'intermediate', 'orders', 'slipping'],
  ['An unbounded in-memory list or cache is a slow memory leak — always cap its size.', '', 'intermediate', 'orders', 'fading'],
];

async function ensureSources(userId) {
  const ids = {};
  for (const [key, [kind, identifier, label]] of Object.entries(SOURCES)) {
    const { rows } = await pool.query(
      `INSERT INTO mneme_sources (user_id, kind, identifier, label, permission)
       VALUES ($1, $2, $3, $4, 'always')
       ON CONFLICT (user_id, kind, identifier)
       DO UPDATE SET label = EXCLUDED.label, permission = 'always'
       RETURNING id`,
      [userId, kind, identifier, label]
    );
    ids[key] = rows[0].id;
  }
  return ids;
}

async function clearAccount(userId) {
  await pool.query('DELETE FROM observation_log WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM memories WHERE user_id = $1', [userId]); // cascades links + recall_events
}

async function insertObserved(userId, sourceIds) {
  let ok = 0;
  for (const [card, detail, difficulty, srcKey, strengthKey, extra = {}] of MEMORIES) {
    const s = STRENGTH[strengthKey]();
    const daysAgo = -s.stability * Math.log2(s.r);
    const reviewedAt = new Date(Date.now() - daysAgo * DAY);
    const createdAt = new Date(reviewedAt.getTime() - pick(3, 45) * DAY);
    const [kind] = SOURCES[srcKey];
    let vector = null;
    try { vector = await llm.embedText(card); } catch (e) { console.log('  embed fail:', e.message); }
    await pool.query(
      `INSERT INTO memories
         (user_id, source_id, card, detail, embedding, difficulty, origin_kind, origin_ref,
          stability, last_reviewed_at, recall_count, lapse_count, lookup_count, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14)`,
      [
        userId, sourceIds[srcKey], card, detail || null,
        vector ? JSON.stringify(vector) : null, difficulty, kind, SOURCES[srcKey][1],
        Number(s.stability.toFixed(2)), reviewedAt, s.recall,
        extra.lapse || 0, extra.lookup || 0, createdAt,
      ]
    );
    ok++;
    process.stdout.write('.');
    await sleep(110);
  }
  console.log(`\n  inserted ${ok} observed memories`);
}

async function rebuildLinks(userId) {
  const { rows } = await pool.query(
    `SELECT id, embedding FROM memories
     WHERE user_id = $1 AND status = 'active' AND embedding IS NOT NULL`,
    [userId]
  );
  const mems = rows.map((m) => ({
    id: m.id,
    vec: typeof m.embedding === 'string' ? JSON.parse(m.embedding) : m.embedding,
  }));
  let edges = 0;
  for (let i = 0; i < mems.length; i++) {
    for (let j = i + 1; j < mems.length; j++) {
      const sim = cosineSimilarity(mems[i].vec, mems[j].vec);
      if (sim >= LINK_AT && sim < DEDUPE_AT) {
        const a = mems[i].id, b = mems[j].id;
        const lo = a < b ? a : b, hi = a < b ? b : a;
        await pool.query(
          `INSERT INTO memory_links (user_id, memory_a, memory_b, similarity)
           VALUES ($1,$2,$3,$4) ON CONFLICT (memory_a, memory_b) DO UPDATE SET similarity = $4`,
          [userId, lo, hi, sim]
        );
        edges++;
      }
    }
  }
  console.log(`  built ${edges} knowledge-graph links`);
}

(async () => {
  try {
    console.log('Providers:', JSON.stringify(llm.activeProviders()));
    const u = await pool.query('SELECT id, name FROM users WHERE email = $1', [EMAIL]);
    if (!u.rows[0]) throw new Error(`No user with email ${EMAIL}`);
    const userId = u.rows[0].id;
    console.log(`Seeding persona for ${u.rows[0].name} <${EMAIL}>\n`);

    console.log('1) clearing old demo memories...');
    await clearAccount(userId);

    console.log('2) sources...');
    const sourceIds = await ensureSources(userId);

    console.log('3) onboarding prior + declared anchors...');
    const ob = await svc.saveOnboarding(userId, { expertise: EXPERTISE, profile: PROFILE, anchors: ANCHORS, markOnboarded: true });
    console.log(`   prior set, ${ob.anchorsCreated} declared anchors created`);

    console.log('4) observed memories...');
    await insertObserved(userId, sourceIds);

    console.log('5) knowledge-graph links...');
    await rebuildLinks(userId);

    // summary
    const stats = await pool.query(
      `SELECT origin_kind, count(*) c FROM memories WHERE user_id=$1 AND status='active' GROUP BY origin_kind ORDER BY c DESC`,
      [userId]
    );
    const total = await pool.query(`SELECT count(*) c FROM memories WHERE user_id=$1 AND status='active'`, [userId]);
    console.log(`\n✅ Done. ${total.rows[0].c} active memories:`);
    stats.rows.forEach((r) => console.log(`   ${r.origin_kind}: ${r.c}`));
  } catch (e) {
    console.error('Seed error:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
