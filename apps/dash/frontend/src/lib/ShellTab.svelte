<script>
  import { onMount, onDestroy } from 'svelte'
  import UtilBar from './UtilBar.svelte'

  let { data, error } = $props()

  let activeKey = $state(null)   // 'node' | 'lxc-{vmid}'
  let connStatus = $state('idle') // 'idle' | 'connecting' | 'connected' | 'error' | 'closed'
  let connError = $state('')

  let termEl = $state(null)
  let term = null
  let fitAddon = null
  let ws = null

  function pct(used, total) {
    return total > 0 ? (used / total) * 100 : 0
  }

  function closeWS() {
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
  }

  function openShell(type, node, vmid) {
    if (!term) return
    term.clear()
    connStatus = 'connecting'
    connError = ''

    const params = new URLSearchParams({ type, node })
    if (type === 'lxc') params.set('vmid', String(vmid))

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const conn = new WebSocket(`${proto}//${location.host}/api/shell/ws?${params}`)
    conn.binaryType = 'arraybuffer'
    ws = conn

    conn.onopen = () => {
      connStatus = 'connected'
      fitAddon?.fit()
    }

    conn.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term?.write(new Uint8Array(e.data))
      }
    }

    conn.onerror = () => {
      connStatus = 'error'
      connError = 'connection failed'
    }

    conn.onclose = (e) => {
      if (ws === conn) {
        ws = null
        connStatus = 'closed'
        if (e.code !== 1000 && term) {
          term.write(`\r\n\x1b[33m[disconnected]\x1b[0m\r\n`)
        }
      }
    }
  }

  function selectNode() {
    if (!data) return
    closeWS()
    activeKey = 'node'
    openShell('node', data.node.name, null)
  }

  function selectLXC(lxc) {
    if (lxc.status !== 'running') return
    closeWS()
    activeKey = `lxc-${lxc.vmid}`
    openShell('lxc', data.node.name, lxc.vmid)
  }

  onMount(async () => {
    const { Terminal } = await import('@xterm/xterm')
    const { FitAddon } = await import('@xterm/addon-fit')

    fitAddon = new FitAddon()
    term = new Terminal({
      theme: {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#3b82f6',
        selectionBackground: 'rgba(59,130,246,0.25)',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.45,
      scrollback: 2000,
      cursorBlink: true,
    })

    term.loadAddon(fitAddon)
    term.open(termEl)
    fitAddon.fit()

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })

    term.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(`1:${cols}:${rows}:`)
      }
    })

    const ro = new ResizeObserver(() => fitAddon?.fit())
    ro.observe(termEl)
    return () => ro.disconnect()
  })

  onDestroy(() => {
    closeWS()
    term?.dispose()
  })
</script>

{#if error}
  <div class="error">Failed to load Proxmox data: {error}</div>
{:else if !data}
  <div class="loading">Loading…</div>
{:else}
  <div class="layout">
    <!-- Left: machine list -->
    <div class="sidebar">
      <div class="sidebar-header">Hosts &amp; Containers</div>

      <!-- PVE host -->
      <div
        class="machine-row {activeKey === 'node' ? 'active' : ''}"
        role="button" tabindex="0"
        onclick={selectNode}
        onkeydown={e => e.key === 'Enter' && selectNode()}
      >
        <div class="machine-info">
          <div class="name-row">
            <span class="name">{data.node.name}</span>
            <span class="badge blue">host</span>
          </div>
          <div class="bars">
            <UtilBar label="CPU" value={data.node.cpu_percent} />
            <UtilBar label="RAM" value={pct(data.node.mem_used_bytes, data.node.mem_total_bytes)} />
          </div>
        </div>
      </div>

      <!-- QEMU VMs — no text terminal available -->
      {#if data.vms.length > 0}
        <div class="section-divider">VMs</div>
        {#each data.vms as vm}
          <div class="machine-row disabled" title="QEMU VMs use a graphical console, not a text terminal">
            <div class="machine-info">
              <div class="name-row">
                <span class="vmid muted">#{vm.vmid}</span>
                <span class="name">{vm.name}</span>
                <span class="badge muted-badge">no terminal</span>
              </div>
              <div class="bars">
                <UtilBar label="CPU" value={vm.cpu_percent} />
                <UtilBar label="RAM" value={pct(vm.mem_used_bytes, vm.mem_total_bytes)} />
              </div>
            </div>
          </div>
        {/each}
      {/if}

      <!-- LXC containers -->
      {#if data.lxcs.length > 0}
        <div class="section-divider">Containers</div>
        {#each data.lxcs as lxc}
          {@const key = `lxc-${lxc.vmid}`}
          {@const running = lxc.status === 'running'}
          <div
            class="machine-row {activeKey === key ? 'active' : ''} {!running ? 'disabled' : ''}"
            role={running ? 'button' : undefined}
            tabindex={running ? 0 : -1}
            onclick={() => selectLXC(lxc)}
            onkeydown={e => e.key === 'Enter' && selectLXC(lxc)}
            title={!running ? `Container is ${lxc.status}` : undefined}
          >
            <div class="machine-info">
              <div class="name-row">
                <span class="vmid muted">#{lxc.vmid}</span>
                <span class="name">{lxc.name}</span>
                <span class="badge {running ? 'green' : 'muted-badge'}">{running ? 'running' : lxc.status}</span>
              </div>
              <div class="bars">
                <UtilBar label="CPU" value={lxc.cpu_percent} />
                <UtilBar label="RAM" value={pct(lxc.mem_used_bytes, lxc.mem_total_bytes)} />
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Right: terminal -->
    <div class="term-col">
      <div class="term-header">
        {#if activeKey}
          <span class="term-title">
            {#if activeKey === 'node'}{data.node.name}{:else}{data.lxcs.find(l => `lxc-${l.vmid}` === activeKey)?.name ?? activeKey}{/if}
          </span>
          {#if connStatus === 'connected'}
            <span class="badge green">connected</span>
          {:else if connStatus === 'connecting'}
            <span class="badge amber">connecting…</span>
          {:else if connStatus === 'error' || connStatus === 'closed'}
            <span class="badge red">{connStatus}</span>
            {#if connError}<span class="err-text">⚠ {connError}</span>{/if}
          {/if}
        {:else}
          <span class="term-title muted">Select a host or container to open a shell</span>
        {/if}
      </div>
      <div class="term-wrap" bind:this={termEl}></div>
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
    overflow-y: auto;
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
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .section-divider {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    padding: 0.4rem 1rem 0.2rem;
    background: var(--surface2);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  .machine-row {
    display: flex;
    align-items: center;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
  }
  .machine-row:last-child { border-bottom: none; }
  .machine-row:hover:not(.disabled) { background: var(--surface2); }
  .machine-row.active { background: var(--surface2); border-left: 2px solid var(--blue); padding-left: calc(1rem - 2px); }
  .machine-row.disabled { cursor: default; opacity: 0.5; }

  .machine-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .vmid {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    flex-shrink: 0;
  }

  .name {
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  /* Terminal column */
  .term-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .term-header {
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

  .term-title {
    font-size: 0.85rem;
    font-weight: 600;
    flex: 1;
  }

  .err-text { font-size: 0.78rem; color: var(--red); }

  .term-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: #0f1117;
    border: 1px solid var(--border);
    border-radius: 0 0 10px 10px;
    padding: 6px;
  }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 0.12rem 0.4rem;
    border-radius: 4px;
    font-size: 0.68rem;
    font-weight: 500;
    flex-shrink: 0;
  }
  .badge.green      { background: rgba(34,197,94,0.15);  color: var(--green); }
  .badge.red        { background: rgba(239,68,68,0.15);  color: var(--red); }
  .badge.amber      { background: rgba(245,158,11,0.15); color: var(--amber); }
  .badge.blue       { background: rgba(59,130,246,0.15); color: var(--blue); }
  .badge.muted-badge { background: var(--surface2); color: var(--muted); }

  .muted { color: var(--muted); }
</style>
