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
    <span class="muted">{data.targets.join(', ')} · {data.step_sec}s probe step</span>
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
          <th>Start</th><th>End</th><th>Duration</th><th>Severity</th><th>Peak loss</th><th>Peak RTT</th><th>Where</th><th>Targets</th>
        </tr>
      </thead>
      <tbody>
        {#each [...data.events].reverse() as e}
          <tr>
            <td class="mono">{fmtTime(e.start)}</td>
            <td class="mono">{fmtTime(e.end)}</td>
            <td class="mono">{fmtDuration(e.start, e.end)}</td>
            <td><span class="badge {badge[e.severity]}">{e.severity}</span></td>
            <td class="mono">{e.peak_loss.toFixed(1)}%</td>
            <td class="mono">{e.peak_rtt_ms ? e.peak_rtt_ms.toFixed(0) + ' ms' : '—'}</td>
            <td>{scopeLabel[e.scope]}</td>
            <td class="muted">{e.targets.map(t => t.split('/')[1]).join(', ')}</td>
          </tr>
        {:else}
          <tr><td colspan="8" class="empty">No loss events in the last {hours}h</td></tr>
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
</style>
