package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/ryyyyan-taylor/homelab/apps/dash/k8s"
	"github.com/ryyyyan-taylor/homelab/apps/dash/proxmox"
	"github.com/ryyyyan-taylor/homelab/apps/dash/semaphore"
)

//go:embed frontend/dist
var frontend embed.FS

func main() {
	proxmoxURL := env("PROXMOX_URL", "https://10.0.1.135:8006")
	proxmoxToken := mustEnv("PROXMOX_TOKEN")

	pc := proxmox.NewClient(proxmoxURL, proxmoxToken)

	kc, err := k8s.NewClient()
	if err != nil {
		log.Printf("warning: k8s client unavailable (%v) — Kubernetes tab will return errors", err)
	}

	// Semaphore client — optional; if token is unset the tab returns 503.
	semaphoreURL := env("SEMAPHORE_URL", "http://semaphore.semaphore.svc.cluster.local:3000")
	semaphoreToken := os.Getenv("SEMAPHORE_TOKEN")
	semaphoreProject := envInt("SEMAPHORE_PROJECT_ID", 1)
	var sc *semaphore.Client
	if semaphoreToken != "" {
		sc = semaphore.NewClient(semaphoreURL, semaphoreToken)
	} else {
		log.Printf("warning: SEMAPHORE_TOKEN not set — Semaphore tab will return errors")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/proxmox", func(w http.ResponseWriter, r *http.Request) {
		data, err := pc.GetDashboard()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, data)
	})

	mux.HandleFunc("GET /api/k8s", func(w http.ResponseWriter, r *http.Request) {
		if kc == nil {
			http.Error(w, "k8s client not available", http.StatusServiceUnavailable)
			return
		}
		data, err := kc.GetDashboard()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, data)
	})

	// --- Semaphore routes ---

	mux.HandleFunc("GET /api/semaphore", func(w http.ResponseWriter, r *http.Request) {
		if sc == nil {
			http.Error(w, "semaphore client not configured", http.StatusServiceUnavailable)
			return
		}
		templates, err := sc.GetTemplates(semaphoreProject)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, templates)
	})

	mux.HandleFunc("POST /api/semaphore/run/{templateID}", func(w http.ResponseWriter, r *http.Request) {
		if sc == nil {
			http.Error(w, "semaphore client not configured", http.StatusServiceUnavailable)
			return
		}
		tid, err := strconv.Atoi(r.PathValue("templateID"))
		if err != nil {
			http.Error(w, "invalid templateID", http.StatusBadRequest)
			return
		}
		taskID, err := sc.TriggerTask(semaphoreProject, tid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, map[string]int{"task_id": taskID})
	})

	mux.HandleFunc("GET /api/semaphore/tasks/{taskID}", func(w http.ResponseWriter, r *http.Request) {
		if sc == nil {
			http.Error(w, "semaphore client not configured", http.StatusServiceUnavailable)
			return
		}
		tid, err := strconv.Atoi(r.PathValue("taskID"))
		if err != nil {
			http.Error(w, "invalid taskID", http.StatusBadRequest)
			return
		}
		task, err := sc.GetTask(semaphoreProject, tid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, task)
	})

	mux.HandleFunc("GET /api/semaphore/tasks/{taskID}/output", func(w http.ResponseWriter, r *http.Request) {
		if sc == nil {
			http.Error(w, "semaphore client not configured", http.StatusServiceUnavailable)
			return
		}
		tid, err := strconv.Atoi(r.PathValue("taskID"))
		if err != nil {
			http.Error(w, "invalid taskID", http.StatusBadRequest)
			return
		}
		lines, err := sc.GetTaskOutput(semaphoreProject, tid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		jsonResponse(w, map[string][]string{"lines": lines})
	})

	dist, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(dist)))

	port := env("PORT", "8080")
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return fallback
}

func jsonResponse(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("json encode: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}
