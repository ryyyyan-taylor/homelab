<script>
  let { data: propData, error } = $props()

  let data = $state(propData)
  $effect(() => { data = propData })

  let templateState = $state({})
  let activeId = $state(null)
  let outputEl = $state(null)

  $effect(() => {
    if (!data) return
    for (const tmpl of data) {
      if (!(tmpl.id in templateState)) {
        templateState[tmpl.id] = { running: false, taskID: null, log: [], err: null }
      }
    }
    if (activeId === null && data.length > 0) activeId = data[0].id
  })

  // Auto-scroll output pane when log grows
  $effect(() => {
    const log = activeId !== null ? templateState[activeId]?.log : null
    if (log?.length && outputEl) {
      outputEl.scrollTop = outputEl.scrollHeight
    }
  })

  async function runTemplate(templateID) {
    if (!templateState[templateID]) {
      templateState[templateID] = { running: false, taskID: null, log: [], err: null }
    }
    activeId = templateID
    const s = templateState[templateID]
    s.running = true
    s.log = []
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

    let seenLines = 0
    let consecutive404 = 0
    while (true) {
      await sleep(2000)

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

      try {
        const or = await fetch(`/api/semaphore/tasks/${taskID}/output`)
        if (or.ok) {
          const { lines } = await or.json()
          if (lines && lines.length > seenLines) {
            s.log = [`Started task #${taskID}`, ...lines]
            seenLines = lines.length
          }
        }
      } catch (_) {}

      if (status === 'success' || status === 'error' || status === 'stopped') {
        s.running = false
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
  <div class="layout">
    <!-- Left column: template list -->
    <div class="sidebar">
      <div class="sidebar-header">Task Templates</div>
      {#each data as tmpl}
        {@const s = templateState[tmpl.id]}
        {@const last = tmpl.last_task}
        <div
          class="tmpl-row {activeId === tmpl.id ? 'active' : ''}"
          role="button"
          tabindex="0"
          onclick={() => activeId = tmpl.id}
          onkeydown={e => e.key === 'Enter' && (activeId = tmpl.id)}
        >
          <div class="tmpl-info">
            <span class="tmpl-name">{tmpl.name}</span>
            <div class="tmpl-meta">
              {#if s?.running && s?.taskID}
                <span class="badge amber">running</span>
                <span class="muted mono">#{s.taskID}</span>
              {:else if last}
                <span class="badge {statusBadgeClass(last.status)}">{last.status}</span>
                <span class="muted mono">{fmtTime(last.end || last.start)}</span>
              {:else}
                <span class="badge muted-badge">never run</span>
              {/if}
            </div>
          </div>
          <button
            class="run-btn"
            disabled={s?.running}
            onclick={e => { e.stopPropagation(); runTemplate(tmpl.id) }}
          >
            {#if s?.running}
              <span class="spinner">⟳</span>
            {:else}
              ▶
            {/if}
          </button>
        </div>
      {/each}
    </div>

    <!-- Right column: persistent output pane -->
    <div class="output-col">
      {#if activeId !== null}
        {@const s = templateState[activeId]}
        {@const tmpl = data.find(t => t.id === activeId)}
        <div class="output-header">
          <span class="output-title">{tmpl?.name ?? ''}</span>
          {#if s?.running}
            <span class="badge amber">running</span>
          {:else if s?.log?.length}
            <span class="badge muted-badge">task #{s.taskID}</span>
          {/if}
          {#if s?.err}
            <span class="err-text">⚠ {s.err}</span>
          {/if}
        </div>
        <div class="output-pane" bind:this={outputEl}>
          {#if s?.log?.length}
            <pre>{s.log.join('\n')}</pre>
          {:else}
            <span class="placeholder">No output yet — click ▶ to run.</span>
          {/if}
        </div>
      {:else}
        <div class="output-pane">
          <span class="placeholder">Select a template to view output.</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .error   { color: var(--red);   padding: 1rem; }
  .loading { color: var(--muted); padding: 1rem; }

  .layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    height: calc(100vh - 7rem);
  }

  /* Sidebar */
  .sidebar {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
    flex-shrink: 0;
  }

  .tmpl-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.1s;
  }
  .tmpl-row:last-child { border-bottom: none; }
  .tmpl-row:hover { background: var(--surface2); }
  .tmpl-row.active { background: var(--surface2); border-left: 2px solid var(--blue); }

  .tmpl-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tmpl-name {
    font-size: 0.88rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tmpl-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .mono { font-family: var(--font-mono); font-size: 0.72rem; }

  .run-btn {
    flex-shrink: 0;
    background: var(--blue);
    border: none;
    color: #fff;
    width: 2rem;
    height: 2rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .run-btn:hover:not(:disabled) { opacity: 0.85; }
  .run-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .spinner { animation: spin 1s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Output column */
  .output-col {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
  }

  .output-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
    flex-shrink: 0;
  }

  .output-title {
    font-size: 0.85rem;
    font-weight: 600;
    flex: 1;
  }

  .err-text { font-size: 0.78rem; color: var(--red); }

  .output-pane {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0 0 10px 10px;
    padding: 0.75rem 1rem;
    overflow-y: auto;
    min-height: 0;
  }

  .output-pane pre {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text);
    margin: 0;
  }

  .placeholder {
    color: var(--muted);
    font-size: 0.85rem;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
    flex-shrink: 0;
  }
  .badge.green       { background: rgba(34,197,94,0.15);  color: var(--green); }
  .badge.red         { background: rgba(239,68,68,0.15);  color: var(--red); }
  .badge.amber       { background: rgba(245,158,11,0.15); color: var(--amber); }
  .badge.muted-badge { background: var(--surface2); color: var(--muted); }

  .muted { color: var(--muted); }
</style>
