package main

import (
	"crypto/tls"
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

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

	// --- Shell tab: SSH terminal + VNC console over WebSocket ---

	wsUpgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	vncUpgrader := websocket.Upgrader{
		CheckOrigin:  func(r *http.Request) bool { return true },
		Subprotocols: []string{"binary"},
	}

	wsDialer := &websocket.Dialer{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // homelab, self-signed Proxmox cert
		Subprotocols:    []string{"binary"},
	}

	mux.HandleFunc("GET /api/shell/vncproxy", func(w http.ResponseWriter, r *http.Request) {
		node := r.URL.Query().Get("node")
		vmid := r.URL.Query().Get("vmid")
		if node == "" || vmid == "" {
			http.Error(w, "missing node or vmid", http.StatusBadRequest)
			return
		}
		data, err := pc.VNCProxy(node, vmid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		port, _ := strconv.Atoi(data.Port)
		jsonResponse(w, map[string]any{"ticket": data.Ticket, "port": port})
	})

	mux.HandleFunc("GET /api/shell/vnc", func(w http.ResponseWriter, r *http.Request) {
		node := r.URL.Query().Get("node")
		vmid := r.URL.Query().Get("vmid")
		ticket := r.URL.Query().Get("ticket")
		port, err := strconv.Atoi(r.URL.Query().Get("port"))
		if err != nil || node == "" || vmid == "" || ticket == "" {
			http.Error(w, "missing or invalid params", http.StatusBadRequest)
			return
		}

		browserConn, err := vncUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer browserConn.Close()

		vncURL := pc.VNCWebSocketURL(node, "qemu", vmid, port, ticket)
		proxmoxConn, _, err := wsDialer.Dial(vncURL, http.Header{
			"Authorization": {"PVEAPIToken=" + proxmoxToken},
		})
		if err != nil {
			log.Printf("VNC dial %s: %v", vncURL, err)
			return
		}
		defer proxmoxConn.Close()

		// Pipe Proxmox → browser
		go func() {
			for {
				mt, msg, err := proxmoxConn.ReadMessage()
				if err != nil {
					browserConn.Close()
					return
				}
				if err := browserConn.WriteMessage(mt, msg); err != nil {
					return
				}
			}
		}()

		// Pipe browser → Proxmox
		for {
			mt, msg, err := browserConn.ReadMessage()
			if err != nil {
				return
			}
			if err := proxmoxConn.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	})

	// Parse the SSH private key used to connect to managed hosts.
	var sshConfig *ssh.ClientConfig
	if keyPEM := strings.ReplaceAll(env("SHELL_SSH_KEY", ""), `\n`, "\n"); keyPEM != "" {
		signer, err := ssh.ParsePrivateKey([]byte(keyPEM))
		if err != nil {
			log.Printf("warning: failed to parse SHELL_SSH_KEY (%v) — Shell tab will show errors", err)
		} else {
			sshConfig = &ssh.ClientConfig{
				User:            "root",
				Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
				HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // homelab, no known_hosts
			}
		}
	} else {
		log.Printf("warning: SHELL_SSH_KEY not set — Shell tab will show errors")
	}

	mux.HandleFunc("GET /api/shell/ws", func(w http.ResponseWriter, r *http.Request) {
		targetType := r.URL.Query().Get("type") // "node" or "lxc"
		node := r.URL.Query().Get("node")
		vmid := r.URL.Query().Get("vmid")
		initCols, _ := strconv.Atoi(r.URL.Query().Get("cols"))
		initRows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
		if initCols <= 0 {
			initCols = 80
		}
		if initRows <= 0 {
			initRows = 24
		}

		if node == "" || targetType == "" {
			http.Error(w, "missing node or type", http.StatusBadRequest)
			return
		}

		// Upgrade the browser connection first so errors can appear inside the terminal.
		browserConn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer browserConn.Close()

		termErr := func(msg string) {
			browserConn.WriteMessage(websocket.BinaryMessage, []byte("\r\n\x1b[31m"+msg+"\x1b[0m\r\n"))
		}

		if sshConfig == nil {
			termErr("[error: SHELL_SSH_KEY is not configured on this pod]")
			return
		}

		// Resolve the target SSH host.
		var sshHost string
		switch targetType {
		case "node":
			sshHost = pc.HostAddr() + ":22"
		case "lxc":
			addr, err := pc.GetLXCSSHAddr(node, vmid)
			if err != nil {
				termErr("[error: " + err.Error() + "]")
				return
			}
			sshHost = addr + ":22"
		default:
			termErr("[error: unsupported target type: " + targetType + "]")
			return
		}

		sshClient, err := ssh.Dial("tcp", sshHost, sshConfig)
		if err != nil {
			termErr("[SSH connect failed: " + err.Error() + "]")
			return
		}
		defer sshClient.Close()

		session, err := sshClient.NewSession()
		if err != nil {
			termErr("[SSH session failed: " + err.Error() + "]")
			return
		}
		defer session.Close()

		stdinPipe, err := session.StdinPipe()
		if err != nil {
			termErr("[stdin pipe: " + err.Error() + "]")
			return
		}

		stdoutPipe, err := session.StdoutPipe()
		if err != nil {
			termErr("[stdout pipe: " + err.Error() + "]")
			return
		}
		stderrPipe, err := session.StderrPipe()
		if err != nil {
			termErr("[stderr pipe: " + err.Error() + "]")
			return
		}

		// goroutine-safe write to the browser terminal.
		var wsMu sync.Mutex
		writeWS := func(p []byte) {
			wsMu.Lock()
			defer wsMu.Unlock()
			browserConn.WriteMessage(websocket.BinaryMessage, p)
		}

		go func() {
			buf := make([]byte, 4096)
			for {
				n, err := stdoutPipe.Read(buf)
				if n > 0 {
					writeWS(buf[:n])
				}
				if err != nil {
					return
				}
			}
		}()
		go func() {
			buf := make([]byte, 4096)
			for {
				n, err := stderrPipe.Read(buf)
				if n > 0 {
					writeWS(buf[:n])
				}
				if err != nil {
					return
				}
			}
		}()

		if err := session.RequestPty("xterm-256color", initRows, initCols, ssh.TerminalModes{
			ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400,
		}); err != nil {
			termErr("[PTY request failed: " + err.Error() + "]")
			return
		}

		if err := session.Shell(); err != nil {
			termErr("[shell start failed: " + err.Error() + "]")
			return
		}

		// Forward browser input → SSH stdin. Text frames "1:cols:rows:" are resize signals.
		for {
			mt, msg, err := browserConn.ReadMessage()
			if err != nil {
				break
			}
			if mt == websocket.TextMessage {
				if s := string(msg); strings.HasPrefix(s, "1:") {
					parts := strings.Split(s[2:], ":")
					if len(parts) >= 2 {
						cols, _ := strconv.Atoi(parts[0])
						rows, _ := strconv.Atoi(parts[1])
						if cols > 0 && rows > 0 {
							session.WindowChange(rows, cols)
						}
					}
				}
			} else if mt == websocket.BinaryMessage {
				stdinPipe.Write(msg) //nolint:errcheck
			}
		}
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
