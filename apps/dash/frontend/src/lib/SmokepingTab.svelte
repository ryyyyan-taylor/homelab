<script>
  import { onMount, onDestroy } from 'svelte'

  let hours = $state(24)
  let data = $state(null)
  let error = $state(null)
  let loading = $state(false)
  let timer

  async function load() {
    loading = true
    try {
      const r = await fetch(`/api/smokeping?hours=${hours}`)
      if (!r.ok) throw new Error(await r.text() || r.statusText)
      data = await r.json()
      error = null
    } catch (e) {
      error = e.message
    }
    loading = false
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function fmtDuration(start, end) {
    const secs = Math.round((new Date(end) - new Date(start)) / 1000)
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    return m < 60 ? `${m}m ${secs % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
  }

  const badge = { outage: 'red', degraded: 'amber', minor: 'muted' }
  const scopeLabel = { upstream: 'Upstream / ISP', lan: 'LAN' }

  onMount(() => {
    load()
    timer = setInterval(load, 60000)
  })
  onDestroy(() => clearInterval(timer))
</script>

<div class="toolbar">
  <label>
    Range
    <select bind:value={hours} onchange={load}>
      <option value={6}>6 hours</option>
      <option value={24}>24 hours</option>
      <option value={72}>3 days</option>
      <option value={168}>7 days</option>
    </select>
  </label>
  <button onclick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
  {#if data}
    <span class="muted">{data.targets.join(', ')} · {data.fine_sec ? `last ${data.fine_hours}h at ${data.fine_sec}s, older at ${data.step_sec}s` : `${data.step_sec}s buckets`}</span>
  {/if}
</div>

{#if error}
  <div class="error">Failed to load smokeping data: {error}</div>
{:else if !data}
  <div class="loading">Loading…</div>
{:else}
  <div class="table-header">Loss events</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Start</th><th>End</th><th>Duration</th><th>Severity</th><th>Avg loss (peak)</th><th>Worst round</th><th>Peak RTT</th><th>Where</th><th>Targets</th>
        </tr>
      </thead>
      <tbody>
        {#each [...data.events].reverse() as e}
          <tr>
            <td class="c-start mono" data-label="Start">{fmtTime(e.start)}</td>
            <td class="c-end mono" data-label="End">{fmtTime(e.end)}</td>
            <td class="c-dur mono">{fmtDuration(e.start, e.end)}{#if e.resolution_sec >= 60} <span class="muted" title="Event comes from {e.resolution_sec}s buckets; start and end are approximate">±{e.resolution_sec / 60}m</span>{/if}</td>
            <td class="c-sev"><span class="badge {badge[e.severity]}">{e.severity}</span></td>
            <td class="c-loss mono" data-label="Avg loss">{e.peak_loss.toFixed(1)}%</td>
            <td class="c-worst mono" data-label="Worst">{e.worst_round_loss.toFixed(0)}%</td>
            <td class="c-rtt mono" data-label="Peak RTT">{e.peak_rtt_ms ? e.peak_rtt_ms.toFixed(0) + ' ms' : '—'}</td>
            <td class="c-scope" data-label="Where">{scopeLabel[e.scope]}</td>
            <td class="c-targets muted" data-label="Targets">{e.targets.map(t => t.split('/')[1]).join(', ')}</td>
          </tr>
        {:else}
          <tr><td colspan="9" class="empty">No loss events in the last {hours}h</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .error   { color: var(--red);   padding: 1rem; }
  .loading { color: var(--muted); padding: 1rem; }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  select, button {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  button:disabled { opacity: 0.6; cursor: default; }

  .table-header {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding: 0.6rem 1rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 10px 10px 0 0;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 0 0 10px 10px;
    background: var(--surface);
  }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    padding: 0.6rem 1rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  .empty { text-align: center; color: var(--muted); padding: 1.5rem; }
  .mono  { font-family: var(--font-mono); }
  .muted { color: var(--muted); font-size: 0.8rem; }

  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 500; }
  .badge.red   { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge.amber { background: rgba(245,158,11,0.15); color: var(--amber); }
  .badge.muted { background: rgba(100,116,139,0.15); color: var(--muted); }

  @media (max-width: 768px) {
    .toolbar { flex-wrap: wrap; gap: 0.5rem 0.75rem; }
    .toolbar > .muted { flex-basis: 100%; }
    select, button { font-size: 16px; padding: 0.4rem 0.7rem; }

    .table-wrap { overflow-x: visible; }
    thead { display: none; }
    table, tbody { display: block; }
    tr {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 0.6rem 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      align-items: start;
    }
    tr:last-child { border-bottom: none; }
    td { padding: 0; border: none; min-width: 0; white-space: normal; }
    tr:hover td { background: none; }
    .c-sev   { grid-row: 1; grid-column: 1 / 4; }
    .c-dur   { grid-row: 1; grid-column: 4 / 7; text-align: right; }
    .c-start { grid-row: 2; grid-column: 1 / 4; }
    .c-end   { grid-row: 2; grid-column: 4 / 7; }
    .c-loss  { grid-row: 3; grid-column: 1 / 3; }
    .c-worst { grid-row: 3; grid-column: 3 / 5; }
    .c-rtt   { grid-row: 3; grid-column: 5 / 7; }
    .c-scope { grid-row: 4; grid-column: 1 / 4; }
    .c-targets { grid-row: 4; grid-column: 4 / 7; text-align: right; }
    td[data-label]::before {
      content: attr(data-label);
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-bottom: 0.1rem;
    }
    .c-targets::before, .c-scope::before { white-space: nowrap; }
    td.empty { grid-row: 1; grid-column: 1 / -1; }
    td.empty::before { content: none; }
  }
</style>
