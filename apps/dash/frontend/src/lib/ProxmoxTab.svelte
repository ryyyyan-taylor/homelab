<script>
  import UtilBar from './UtilBar.svelte'

  let { data, error } = $props()

  function fmtBytes(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return (bytes / 1e3).toFixed(1) + ' KB'
  }

  function fmtUptime(s) {
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function pct(used, total) {
    return total > 0 ? (used / total) * 100 : 0
  }
</script>

{#if error}
  <div class="error">Failed to load Proxmox data: {error}</div>
{:else if !data}
  <div class="loading">Loading…</div>
{:else}
  <!-- Host card -->
  <section class="host-card">
    <div class="host-header">
      <div>
        <h2>{data.node.name}</h2>
        <span class="badge green">online</span>
      </div>
      <span class="uptime muted">up {fmtUptime(data.node.uptime_seconds)}</span>
    </div>
    <div class="gauges">
      <div class="gauge-group">
        <span class="gauge-label">CPU</span>
        <UtilBar value={data.node.cpu_percent} />
        <span class="gauge-sub muted">{data.node.cpu_cores} cores</span>
      </div>
      <div class="gauge-group">
        <span class="gauge-label">RAM</span>
        <UtilBar value={pct(data.node.mem_used_bytes, data.node.mem_total_bytes)} />
        <span class="gauge-sub muted">{fmtBytes(data.node.mem_used_bytes)} / {fmtBytes(data.node.mem_total_bytes)}</span>
      </div>
      <div class="gauge-group">
        <span class="gauge-label">Disk</span>
        <UtilBar value={pct(data.node.disk_used_bytes, data.node.disk_total_bytes)} />
        <span class="gauge-sub muted">{fmtBytes(data.node.disk_used_bytes)} / {fmtBytes(data.node.disk_total_bytes)}</span>
      </div>
    </div>
  </section>

  <!-- VMs -->
  <section class="table-section">
    <h3>Virtual Machines</h3>
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Name</th><th>Status</th><th>CPU</th><th>RAM</th><th>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {#each data.vms as vm}
          <tr>
            <td class="mono muted">{vm.vmid}</td>
            <td>{vm.name}</td>
            <td><span class="badge {vm.status === 'running' ? 'green' : 'muted-badge'}">{vm.status}</span></td>
            <td class="util-cell">
              {#if vm.status === 'running'}
                <UtilBar value={vm.cpu_percent} />
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td class="util-cell">
              {#if vm.status === 'running'}
                <UtilBar value={pct(vm.mem_used_bytes, vm.mem_total_bytes)} />
                <span class="muted tiny">{fmtBytes(vm.mem_used_bytes)} / {fmtBytes(vm.mem_total_bytes)}</span>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td class="mono muted">{vm.status === 'running' ? fmtUptime(vm.uptime_seconds) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <!-- LXCs -->
  <section class="table-section">
    <h3>LXC Containers</h3>
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Name</th><th>Status</th><th>CPU</th><th>RAM</th><th>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {#each data.lxcs as lxc}
          <tr>
            <td class="mono muted">{lxc.vmid}</td>
            <td>{lxc.name}</td>
            <td><span class="badge {lxc.status === 'running' ? 'green' : 'muted-badge'}">{lxc.status}</span></td>
            <td class="util-cell">
              {#if lxc.status === 'running'}
                <UtilBar value={lxc.cpu_percent} />
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td class="util-cell">
              {#if lxc.status === 'running'}
                <UtilBar value={pct(lxc.mem_used_bytes, lxc.mem_total_bytes)} />
                <span class="muted tiny">{fmtBytes(lxc.mem_used_bytes)} / {fmtBytes(lxc.mem_total_bytes)}</span>
              {:else}
                <span class="muted">—</span>
              {/if}
            </td>
            <td class="mono muted">{lxc.status === 'running' ? fmtUptime(lxc.uptime_seconds) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

<style>
  .error { color: var(--red); padding: 1rem; }
  .loading { color: var(--muted); padding: 1rem; }

  .host-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.5rem;
  }

  .host-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .host-header h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }

  .gauges {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.25rem;
  }

  .gauge-group { display: flex; flex-direction: column; gap: 0.4rem; }
  .gauge-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .gauge-sub { font-size: 0.75rem; font-family: var(--font-mono); }

  .uptime { font-size: 0.85rem; font-family: var(--font-mono); }

  .table-section { margin-bottom: 1.5rem; }
  .table-section h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 0.75rem; }

  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }

  th {
    text-align: left;
    padding: 0.6rem 1rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    background: var(--surface2);
  }

  td { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  .mono { font-family: var(--font-mono); }
  .muted { color: var(--muted); }
  .tiny { font-size: 0.7rem; display: block; margin-top: 0.2rem; }

  .util-cell { min-width: 160px; }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .badge.green { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.muted-badge { background: var(--surface2); color: var(--muted); }
</style>
