<script>
  import { onMount, onDestroy } from 'svelte'
  import ProxmoxTab from './lib/ProxmoxTab.svelte'
  import KubernetesTab from './lib/KubernetesTab.svelte'

  let tab = $state('proxmox')
  let interval = $state(30)
  let proxmoxData = $state(null)
  let k8sData = $state(null)
  let proxmoxError = $state(null)
  let k8sError = $state(null)
  let lastUpdated = $state(null)
  let timer

  async function fetchAll() {
    const [px, k8s] = await Promise.allSettled([
      fetch('/api/proxmox').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/k8s').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
    ])

    if (px.status === 'fulfilled') { proxmoxData = px.value; proxmoxError = null }
    else proxmoxError = px.reason

    if (k8s.status === 'fulfilled') { k8sData = k8s.value; k8sError = null }
    else k8sError = k8s.reason

    lastUpdated = new Date()
  }

  function startTimer() {
    clearInterval(timer)
    timer = setInterval(fetchAll, interval * 1000)
  }

  $effect(() => {
    startTimer()
    return () => clearInterval(timer)
  })

  onMount(fetchAll)
  onDestroy(() => clearInterval(timer))
</script>

<div class="shell">
  <header>
    <span class="title">homelab</span>
    <nav>
      <button class:active={tab === 'proxmox'} onclick={() => tab = 'proxmox'}>Proxmox</button>
      <button class:active={tab === 'kubernetes'} onclick={() => tab = 'kubernetes'}>Kubernetes</button>
    </nav>
    <div class="controls">
      {#if lastUpdated}
        <span class="muted">updated {lastUpdated.toLocaleTimeString()}</span>
      {/if}
      <label>
        Refresh
        <select bind:value={interval} onchange={startTimer}>
          <option value={15}>15s</option>
          <option value={30}>30s</option>
          <option value={60}>60s</option>
          <option value={300}>5m</option>
        </select>
      </label>
    </div>
  </header>

  <main>
    {#if tab === 'proxmox'}
      <ProxmoxTab data={proxmoxData} error={proxmoxError} />
    {:else}
      <KubernetesTab data={k8sData} error={k8sError} />
    {/if}
  </main>
</div>

<style>
  .shell { display: flex; flex-direction: column; min-height: 100vh; }

  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.75rem 1.5rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .title {
    font-weight: 700;
    font-size: 1.1rem;
    letter-spacing: 0.05em;
    color: var(--text);
  }

  nav { display: flex; gap: 0.25rem; }

  nav button {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0.4rem 0.9rem;
    border-radius: 6px;
    font-size: 0.9rem;
    transition: all 0.15s;
  }

  nav button:hover { color: var(--text); background: var(--surface2); }
  nav button.active { color: var(--text); background: var(--surface2); }

  .controls {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .muted { color: var(--muted); font-size: 0.8rem; }

  label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  select {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  main { flex: 1; padding: 1.5rem; }
</style>
