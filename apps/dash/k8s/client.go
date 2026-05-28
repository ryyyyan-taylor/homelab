package k8s

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	tokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	caPath    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	apiServer = "https://kubernetes.default.svc"
)

type Client struct {
	http  *http.Client
	token string
}

func NewClient() (*Client, error) {
	tokenBytes, err := os.ReadFile(tokenPath)
	if err != nil {
		return nil, fmt.Errorf("not running in-cluster: %w", err)
	}

	caBytes, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("read CA: %w", err)
	}

	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caBytes)

	return &Client{
		token: strings.TrimSpace(string(tokenBytes)),
		http: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{RootCAs: pool},
			},
		},
	}, nil
}

// Dashboard is the payload returned to the frontend.
type Dashboard struct {
	Nodes       []NodeInfo       `json:"nodes"`
	Deployments []DeploymentInfo `json:"deployments"`
}

type NodeInfo struct {
	Name               string   `json:"name"`
	Roles              []string `json:"roles"`
	Ready              bool     `json:"ready"`
	CPUTotalMillicores int64    `json:"cpu_total_millicores"`
	CPUUsageMillicores int64    `json:"cpu_usage_millicores"`
	MemTotalBytes      int64    `json:"mem_total_bytes"`
	MemUsageBytes      int64    `json:"mem_usage_bytes"`
}

type DeploymentInfo struct {
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	TotalReplicas int32  `json:"total_replicas"`
	ReadyReplicas int32  `json:"ready_replicas"`
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest("GET", apiServer+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("k8s API returned %d for %s", resp.StatusCode, path)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// raw k8s API types (minimal — only what we need)

type nodeList struct {
	Items []struct {
		Metadata struct {
			Name   string            `json:"name"`
			Labels map[string]string `json:"labels"`
		} `json:"metadata"`
		Status struct {
			Conditions []struct {
				Type   string `json:"type"`
				Status string `json:"status"`
			} `json:"conditions"`
			Allocatable struct {
				CPU    string `json:"cpu"`
				Memory string `json:"memory"`
			} `json:"allocatable"`
		} `json:"status"`
	} `json:"items"`
}

type nodeMetricsList struct {
	Items []struct {
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
		Usage struct {
			CPU    string `json:"cpu"`
			Memory string `json:"memory"`
		} `json:"usage"`
	} `json:"items"`
}

type deploymentList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Spec struct {
			Replicas int32 `json:"replicas"`
		} `json:"spec"`
		Status struct {
			ReadyReplicas int32 `json:"readyReplicas"`
		} `json:"status"`
	} `json:"items"`
}

type metricEntry struct{ cpuM, memB int64 }

func (c *Client) GetDashboard() (*Dashboard, error) {
	var nodes nodeList
	if err := c.get("/api/v1/nodes", &nodes); err != nil {
		return nil, fmt.Errorf("nodes: %w", err)
	}

	var metrics nodeMetricsList
	_ = c.get("/apis/metrics.k8s.io/v1beta1/nodes", &metrics) // best-effort

	mmap := make(map[string]metricEntry, len(metrics.Items))
	for _, m := range metrics.Items {
		mmap[m.Metadata.Name] = metricEntry{
			cpuM: parseMillicores(m.Usage.CPU),
			memB: parseMemoryBytes(m.Usage.Memory),
		}
	}

	var deployments deploymentList
	if err := c.get("/apis/apps/v1/deployments", &deployments); err != nil {
		return nil, fmt.Errorf("deployments: %w", err)
	}

	dash := &Dashboard{}

	for _, n := range nodes.Items {
		ready := false
		for _, cond := range n.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				ready = true
				break
			}
		}
		m := mmap[n.Metadata.Name]
		name := n.Metadata.Labels["kubernetes.io/hostname"]
		if name == "" {
			name = n.Metadata.Name
		}
		dash.Nodes = append(dash.Nodes, NodeInfo{
			Name:               name,
			Roles:              nodeRoles(n.Metadata.Labels),
			Ready:              ready,
			CPUTotalMillicores: parseMillicores(n.Status.Allocatable.CPU),
			CPUUsageMillicores: m.cpuM,
			MemTotalBytes:      parseMemoryBytes(n.Status.Allocatable.Memory),
			MemUsageBytes:      m.memB,
		})
	}

	for _, d := range deployments.Items {
		dash.Deployments = append(dash.Deployments, DeploymentInfo{
			Namespace:     d.Metadata.Namespace,
			Name:          d.Metadata.Name,
			TotalReplicas: d.Spec.Replicas,
			ReadyReplicas: d.Status.ReadyReplicas,
		})
	}

	return dash, nil
}

func nodeRoles(labels map[string]string) []string {
	var roles []string
	if _, ok := labels["node-role.kubernetes.io/control-plane"]; ok {
		roles = append(roles, "control-plane")
	}
	if _, ok := labels["node-role.kubernetes.io/worker"]; ok {
		roles = append(roles, "worker")
	}
	if len(roles) == 0 {
		roles = append(roles, "worker")
	}
	return roles
}

// parseMillicores parses k8s CPU quantity strings like "2", "500m", "2000m".
func parseMillicores(s string) int64 {
	if strings.HasSuffix(s, "m") {
		v, _ := strconv.ParseInt(strings.TrimSuffix(s, "m"), 10, 64)
		return v
	}
	v, _ := strconv.ParseFloat(s, 64)
	return int64(v * 1000)
}

// parseMemoryBytes parses k8s memory quantity strings like "4Gi", "512Mi", "1024Ki".
func parseMemoryBytes(s string) int64 {
	suffixes := []struct {
		suffix string
		mult   int64
	}{
		{"Ki", 1024},
		{"Mi", 1024 * 1024},
		{"Gi", 1024 * 1024 * 1024},
		{"Ti", 1024 * 1024 * 1024 * 1024},
		{"K", 1000},
		{"M", 1000 * 1000},
		{"G", 1000 * 1000 * 1000},
	}
	for _, sx := range suffixes {
		if strings.HasSuffix(s, sx.suffix) {
			v, _ := strconv.ParseFloat(strings.TrimSuffix(s, sx.suffix), 64)
			return int64(v * float64(sx.mult))
		}
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}
