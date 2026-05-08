<script>
  let { value, label } = $props()

  let color = $derived(
    value >= 85 ? 'var(--red)' :
    value >= 70 ? 'var(--amber)' :
    'var(--green)'
  )
</script>

<div class="util-bar">
  {#if label}<span class="label">{label}</span>{/if}
  <div class="track">
    <div class="fill" style="width: {Math.min(value, 100)}%; background: {color}"></div>
  </div>
  <span class="pct" style="color: {color}">{value.toFixed(1)}%</span>
</div>

<style>
  .util-bar { display: flex; align-items: center; gap: 0.5rem; }
  .label { font-size: 0.75rem; color: var(--muted); width: 2.5rem; flex-shrink: 0; }
  .track { flex: 1; height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
  .pct { font-size: 0.75rem; font-family: var(--font-mono); width: 3.5rem; text-align: right; flex-shrink: 0; }
</style>
