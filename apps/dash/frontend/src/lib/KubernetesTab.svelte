<script>
  import UtilBar from './UtilBar.svelte'

  let { data, error } = $props()

  function fmtBytes(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB'
    return bytes + ' B'
  }

  function pct(used, total) {
    return total > 0 ? (used / total) * 100 : 0
  }

  function saturation(node) {
    return Math.max(
      pct(node.cpu_usage_millicores, node.cpu_total_millicores),
      pct(node.cpu_request_millicores, node.cpu_total_millicores),
      pct(node.mem_usage_bytes, node.mem_total_bytes),
      pct(node.mem_request_bytes, node.mem_total_bytes),
    )
  }
</script>

{#if error}
  <div class="error">Failed to load Kubernetes data: {error}</div>
{:else if !data}
  <div class="loading">Loading…</div>
{:else}
  <div class="layout">
    <!-- Left: node cards -->
    <div class="sidebar">
      <div class="sidebar-header">Nodes</div>
      <div class="node-list">
        {#each data.nodes as node}
          <div class="node-card">
            <div class="node-header">
              <div>
                <div class="node-name">{node.name}</div>
                <div class="node-roles">{node.roles.join(', ')}</div>
              </div>
              <span class="badge {node.ready ? 'green' : 'red'}">{node.ready ? 'Ready' : 'NotReady'}</span>
            </div>
            <div class="node-metrics">
              <UtilBar label="CPU" value={pct(node.cpu_usage_millicores, node.cpu_total_millicores)} />
              <span class="sub muted">{(node.cpu_usage_millicores / 1000).toFixed(2)} / {(node.cpu_total_millicores / 1000).toFixed(0)} cores</span>
              <UtilBar label="RAM" value={pct(node.mem_usage_bytes, node.mem_total_bytes)} />
              <span class="sub muted">{fmtBytes(node.mem_usage_bytes)} / {fmtBytes(node.mem_total_bytes)}</span>
              <div class="sat-divider"></div>
              <UtilBar label="Sat." value={saturation(node)} />
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Right: deployments table -->
    <div class="main-col">
      <div class="table-header">Deployments</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Namespace</th><th>Deployment</th><th>Ready</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each data.deployments as d}
              {@const healthy = d.ready_replicas === d.total_replicas}
              <tr>
                <td class="mono muted">{d.namespace}</td>
                <td>{d.name}</td>
                <td class="mono">{d.ready_replicas}/{d.total_replicas}</td>
                <td><span class="badge {healthy ? 'green' : 'red'}">{healthy ? 'Healthy' : 'Degraded'}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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

  .node-list {
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .node-card {
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .node-card:last-child { border-bottom: none; }

  .node-header { display: flex; justify-content: space-between; align-items: flex-start; }
  .node-name   { font-weight: 600; font-size: 0.88rem; margin-bottom: 0.15rem; }
  .node-roles  { font-size: 0.72rem; color: var(--muted); }

  .node-metrics { display: flex; flex-direction: column; gap: 0.35rem; }
  .sat-divider  { height: 1px; background: var(--border); margin: 0.15rem 0; }
  .sub { font-size: 0.7rem; font-family: var(--font-mono); }

  /* Main column */
  .main-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

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
    flex-shrink: 0;
  }

  .table-wrap {
    flex: 1;
    overflow-y: auto;
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
    background: var(--surface);
    position: sticky;
    top: 0;
  }
  td { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface2); }

  .mono  { font-family: var(--font-mono); }
  .muted { color: var(--muted); }

  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 500; }
  .badge.green { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge.red   { background: rgba(239,68,68,0.15); color: var(--red); }
</style>
