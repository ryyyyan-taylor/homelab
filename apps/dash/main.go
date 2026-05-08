package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/ryyyyan-taylor/homelab/apps/dash/k8s"
	"github.com/ryyyyan-taylor/homelab/apps/dash/proxmox"
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

	dist, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(dist)))

	port := env("PORT", "8080")
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
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
