"""
title: Kubernetes Read-Only Tools
author: homelab
description: Read-only pod status, logs, events, and workload status for the homelab cluster. Backed by a ServiceAccount scoped to get/list/watch only - no secrets, no exec, no write access. See kubernetes/apps/platform/open-webui/rbac.yaml.
requirements: kubernetes
version: 0.1.0
"""

from kubernetes import client, config

# Hard caps so a single tool call can't flood a small model's context window.
MAX_ITEMS = 100
MAX_LOG_CHARS = 8000


def _load_client():
    config.load_incluster_config()
    return client.CoreV1Api(), client.AppsV1Api()


class Tools:
    def list_pods(self, namespace: str = "") -> str:
        """
        List pods and their status. Leave namespace empty to list across all
        namespaces. Use this first to find the pod name you actually want
        logs or events for.

        :param namespace: Kubernetes namespace to filter to, or empty for all namespaces.
        """
        core, _ = _load_client()
        pods = (
            core.list_namespaced_pod(namespace)
            if namespace
            else core.list_pod_for_all_namespaces()
        ).items[:MAX_ITEMS]

        if not pods:
            return f"No pods found{f' in namespace {namespace}' if namespace else ''}."

        lines = ["NAMESPACE  NAME  READY  STATUS  RESTARTS  NODE"]
        for p in pods:
            statuses = p.status.container_statuses or []
            ready = sum(1 for s in statuses if s.ready)
            restarts = sum(s.restart_count for s in statuses)
            lines.append(
                f"{p.metadata.namespace}  {p.metadata.name}  "
                f"{ready}/{len(statuses)}  {p.status.phase}  "
                f"{restarts}  {p.spec.node_name}"
            )
        return "\n".join(lines)

    def get_pod_logs(
        self,
        namespace: str,
        pod_name: str,
        container: str = "",
        tail_lines: int = 200,
        previous: bool = False,
    ) -> str:
        """
        Fetch recent logs for a pod. Use list_pods first to confirm the exact
        namespace and pod name. If the pod has multiple containers, specify
        which one; otherwise the first container is used.

        :param namespace: Kubernetes namespace the pod is in.
        :param pod_name: Exact pod name.
        :param container: Container name, or empty to use the pod's first container.
        :param tail_lines: How many lines to fetch from the end of the log (capped at 500).
        :param previous: Set true to fetch logs from the pod's previous (crashed) instance instead of the current one.
        """
        core, _ = _load_client()
        tail_lines = min(tail_lines, 500)

        if not container:
            pod = core.read_namespaced_pod(pod_name, namespace)
            container = pod.spec.containers[0].name

        try:
            logs = core.read_namespaced_pod_log(
                name=pod_name,
                namespace=namespace,
                container=container,
                tail_lines=tail_lines,
                previous=previous,
                timestamps=True,
            )
        except client.exceptions.ApiException as e:
            return f"Error fetching logs: {e.reason} (status {e.status})"

        if len(logs) > MAX_LOG_CHARS:
            logs = logs[-MAX_LOG_CHARS:]
            logs = f"[...truncated to last {MAX_LOG_CHARS} chars...]\n" + logs
        return logs or "(no log output)"

    def list_events(self, namespace: str = "", limit: int = 50) -> str:
        """
        List recent Kubernetes events (warnings, scheduling, restarts, etc.),
        most recent first. Leave namespace empty for cluster-wide events.

        :param namespace: Kubernetes namespace to filter to, or empty for all namespaces.
        :param limit: Maximum number of events to return (capped at 100).
        """
        core, _ = _load_client()
        limit = min(limit, MAX_ITEMS)
        events = (
            core.list_namespaced_event(namespace)
            if namespace
            else core.list_event_for_all_namespaces()
        ).items

        events = sorted(
            events, key=lambda e: e.last_timestamp or e.event_time or "", reverse=True
        )[:limit]

        if not events:
            return f"No events found{f' in namespace {namespace}' if namespace else ''}."

        lines = ["LAST SEEN  TYPE  REASON  OBJECT  MESSAGE"]
        for e in events:
            ts = e.last_timestamp or e.event_time
            obj = f"{e.involved_object.kind}/{e.involved_object.name}"
            lines.append(f"{ts}  {e.type}  {e.reason}  {obj}  {e.message}")
        return "\n".join(lines)

    def get_workload_status(self, namespace: str = "") -> str:
        """
        List Deployments, StatefulSets, and DaemonSets with their ready/desired
        replica counts. Good first call for "is anything broken right now."

        :param namespace: Kubernetes namespace to filter to, or empty for all namespaces.
        """
        _, apps = _load_client()
        lines = ["KIND  NAMESPACE  NAME  READY  DESIRED"]

        deploys = (
            apps.list_namespaced_deployment(namespace)
            if namespace
            else apps.list_deployment_for_all_namespaces()
        ).items[:MAX_ITEMS]
        for d in deploys:
            lines.append(
                f"Deployment  {d.metadata.namespace}  {d.metadata.name}  "
                f"{d.status.ready_replicas or 0}  {d.spec.replicas}"
            )

        statefulsets = (
            apps.list_namespaced_stateful_set(namespace)
            if namespace
            else apps.list_stateful_set_for_all_namespaces()
        ).items[:MAX_ITEMS]
        for s in statefulsets:
            lines.append(
                f"StatefulSet  {s.metadata.namespace}  {s.metadata.name}  "
                f"{s.status.ready_replicas or 0}  {s.spec.replicas}"
            )

        daemonsets = (
            apps.list_namespaced_daemon_set(namespace)
            if namespace
            else apps.list_daemon_set_for_all_namespaces()
        ).items[:MAX_ITEMS]
        for ds in daemonsets:
            lines.append(
                f"DaemonSet  {ds.metadata.namespace}  {ds.metadata.name}  "
                f"{ds.status.number_ready}  {ds.status.desired_number_scheduled}"
            )

        return "\n".join(lines)
