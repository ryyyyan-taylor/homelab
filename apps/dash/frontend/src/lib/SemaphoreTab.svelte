<script>
  let { data, error } = $props()

  // Per-template UI state: { [templateID]: { running, taskID, log, logOpen, err } }
  let templateState = $state({})

  // Pre-initialise state entries when data loads — never mutate $state during rendering
  $effect(() => {
    if (!data) return
    for (const tmpl of data) {
      if (!(tmpl.id in templateState)) {
        templateState[tmpl.id] = { running: false, taskID: null, log: [], logOpen: false, err: null }
      }
    }
  })

  async function runTemplate(templateID) {
    // Initialise lazily if the effect hasn't fired yet (shouldn't happen, but be safe)
    if (!templateState[templateID]) {
      templateState[templateID] = { running: false, taskID: null, log: [], logOpen: false, err: null }
    }
    const s = templateState[templateID]
    s.running = true
    s.log = []
    s.logOpen = true
    s.err = null

    let taskID
    try {
      const resp = await fetch(`/api/semaphore/run/${templateID}`, { method: 'POST' })
      if (!resp.ok) throw new Error(await resp.text())
      const body = await resp.json()
      taskID = body.task_id
      s.taskID = taskID
      s.log = [`Started task #${taskID}`]
    } catch (e) {
      s.err = String(e)
      s.running = false
      return
    }

    // Poll until terminal status
    let seenLines = 0
    let consecutive404 = 0
    while (true) {
      await sleep(2000)

      // Fetch status
      let status
      try {
        const tr = await fetch(`/api/semaphore/tasks/${taskID}`)
        if (!tr.ok) throw new Error(`status ${tr.status}`)
        const t = await tr.json()
        status = t.status
      } catch (e) {
        consecutive404++
        if (consecutive404 >= 5) { s.err = 'Lost contact with task'; s.running = false; return }
        continue
      }
      consecutive404 = 0

      // Fetch output
      try {
        const or = await fetch(`/api/semaphore/tasks/${taskID}/output`)
        if (or.ok) {
          const { lines } = await or.json()
          if (lines && lines.length > seenLines) {
            s.log = [`Started task #${taskID}`, ...lines]
            seenLines = lines.length
          }
        }
      } catch (_) { /* non-fatal */ }

      if (status === 'success' || status === 'error' || status === 'stopped') {
        s.running = false
        // Reload templates in background so the status badge refreshes
        reloadTemplates()
        break
      }
    }
  }

  async function reloadTemplates() {
    try {
      const r = await fetch('/api/semaphore')
      if (r.ok) data = await r.json()
    } catch (_) {}
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  function fmtTime(iso) {
    if (!iso || iso.startsWith('0001')) return '—'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  function statusBadgeClass(status) {
    if (!status) return 'muted-badge'
    if (status === 'success') return 'green'
    if (status === 'error') return 'red'
    if (status === 'running' || status === 'waiting') return 'amber'
    return 'muted-badge'
  }
</script>

{#if error}
  <div class="error">Failed to load Semaphore data: {error}</div>
{:else if !data}
  <div class="loading">Loading…</div>
{:else}
  <section class="templates-section">
    <h3>Task Templates</h3>
    <div class="template-grid">
      {#each data as tmpl}
        {@const s = templateState[tmpl.id]}
        {@const last = tmpl.last_task}
        <div class="template-card">
          <div class="card-header">
            <div class="card-title">
              <span class="name">{tmpl.name}</span>
              {#if tmpl.description}
                <span class="desc muted">{tmpl.description}</span>
              {/if}
            </div>
            <button
              class="run-btn"
              disabled={s?.running}
              onclick={() => runTemplate(tmpl.id)}
            >
              {#if s?.running}
                <span class="spinner">⟳</span> Running…
              {:else}
                ▶ Run
              {/if}
            </button>
          </div>

          <div class="card-meta">
            {#if s?.running && s?.taskID}
              <span class="badge amber">running</span>
              <span class="muted meta-text">task #{s.taskID}</span>
            {:else if last}
              <span class="badge {statusBadgeClass(last.status)}">{last.status}</span>
              <span class="muted meta-text">{fmtTime(last.end || last.start)}</span>
            {:else}
              <span class="badge muted-badge">never run</span>
            {/if}

            {#if s?.err}
              <span class="err-text">⚠ {s.err}</span>
            {/if}

            {#if s?.log?.length > 0}
              <button class="log-toggle" onclick={() => s.logOpen = !s.logOpen}>
                {s.logOpen ? '▾ Hide log' : '▸ Show log'}
              </button>
            {/if}
          </div>

          {#if s?.logOpen && s?.log?.length > 0}
            <div class="log-panel">
              <pre>{s.log.join('\n')}</pre>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .error  { color: var(--red);   padding: 1rem; }
  .loading { color: var(--muted); padding: 1rem; }

  .templates-section { margin-bottom: 1.5rem; }
  h3 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin-bottom: 0.75rem;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 1rem;
  }

  .template-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .card-title {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .name {
    font-weight: 600;
    font-size: 0.95rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desc {
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .run-btn {
    flex-shrink: 0;
    background: var(--blue);
    border: none;
    color: #fff;
    padding: 0.35rem 0.9rem;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .run-btn:hover:not(:disabled) { opacity: 0.85; }
  .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .spinner { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .card-meta {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .meta-text { font-size: 0.78rem; font-family: var(--font-mono); }
  .err-text  { font-size: 0.78rem; color: var(--red); }

  .log-toggle {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 0.78rem;
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }
  .log-toggle:hover { color: var(--text); }

  .log-panel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    max-height: 320px;
    overflow-y: auto;
  }

  .log-panel pre {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text);
    margin: 0;
  }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
  }
  .badge.green      { background: rgba(34,197,94,0.15);  color: var(--green); }
  .badge.red        { background: rgba(239,68,68,0.15);  color: var(--red); }
  .badge.amber      { background: rgba(245,158,11,0.15); color: var(--amber); }
  .badge.muted-badge { background: var(--surface2); color: var(--muted); }

  .muted { color: var(--muted); }
</style>
