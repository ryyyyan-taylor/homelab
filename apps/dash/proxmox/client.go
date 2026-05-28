package proxmox

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	base   string
	token  string
	http   *http.Client
}

func NewClient(base, token string) *Client {
	return &Client{
		base:  base,
		token: token,
		http: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // self-signed Proxmox cert
			},
		},
	}
}

// Dashboard is the payload returned to the frontend.
type Dashboard struct {
	Node NodeInfo `json:"node"`
	VMs  []VMInfo `json:"vms"`
	LXCs []VMInfo `json:"lxcs"`
}

type NodeInfo struct {
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpu_percent"`
	CPUCores      int     `json:"cpu_cores"`
	MemUsedBytes  int64   `json:"mem_used_bytes"`
	MemTotalBytes int64   `json:"mem_total_bytes"`
	DiskUsedBytes int64   `json:"disk_used_bytes"`
	DiskTotalBytes int64  `json:"disk_total_bytes"`
	UptimeSeconds int64   `json:"uptime_seconds"`
}

type VMInfo struct {
	VMID          int     `json:"vmid"`
	Name          string  `json:"name"`
	Status        string  `json:"status"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemUsedBytes  int64   `json:"mem_used_bytes"`
	MemTotalBytes int64   `json:"mem_total_bytes"`
	UptimeSeconds int64   `json:"uptime_seconds"`
}

// raw Proxmox API types

type pveResponse[T any] struct {
	Data T `json:"data"`
}

type pveNode struct {
	Node    string  `json:"node"`
	CPU     float64 `json:"cpu"`
	MaxCPU  int     `json:"maxcpu"`
	Mem     int64   `json:"mem"`
	MaxMem  int64   `json:"maxmem"`
	Disk    int64   `json:"disk"`
	MaxDisk int64   `json:"maxdisk"`
	Uptime  int64   `json:"uptime"`
}

type pveVM struct {
	VMID   int     `json:"vmid"`
	Name   string  `json:"name"`
	Status string  `json:"status"`
	CPU    float64 `json:"cpu"`
	Mem    int64   `json:"mem"`
	MaxMem int64   `json:"maxmem"`
	Uptime int64   `json:"uptime"`
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest("GET", c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "PVEAPIToken="+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxmox API returned %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) GetDashboard() (*Dashboard, error) {
	var nodesResp pveResponse[[]pveNode]
	if err := c.get("/api2/json/nodes", &nodesResp); err != nil {
		return nil, fmt.Errorf("nodes: %w", err)
	}
	if len(nodesResp.Data) == 0 {
		return nil, fmt.Errorf("no nodes returned")
	}
	n := nodesResp.Data[0]

	var vmsResp pveResponse[[]pveVM]
	if err := c.get("/api2/json/nodes/"+n.Node+"/qemu", &vmsResp); err != nil {
		return nil, fmt.Errorf("qemu: %w", err)
	}

	var lxcsResp pveResponse[[]pveVM]
	if err := c.get("/api2/json/nodes/"+n.Node+"/lxc", &lxcsResp); err != nil {
		return nil, fmt.Errorf("lxc: %w", err)
	}

	dash := &Dashboard{
		Node: NodeInfo{
			Name:           n.Node,
			CPUPercent:     n.CPU * 100,
			CPUCores:       n.MaxCPU,
			MemUsedBytes:   n.Mem,
			MemTotalBytes:  n.MaxMem,
			DiskUsedBytes:  n.Disk,
			DiskTotalBytes: n.MaxDisk,
			UptimeSeconds:  n.Uptime,
		},
	}

	for _, v := range vmsResp.Data {
		dash.VMs = append(dash.VMs, VMInfo{
			VMID:          v.VMID,
			Name:          v.Name,
			Status:        v.Status,
			CPUPercent:    v.CPU * 100,
			MemUsedBytes:  v.Mem,
			MemTotalBytes: v.MaxMem,
			UptimeSeconds: v.Uptime,
		})
	}
	sort.Slice(dash.VMs, func(i, j int) bool { return dash.VMs[i].VMID < dash.VMs[j].VMID })

	for _, l := range lxcsResp.Data {
		dash.LXCs = append(dash.LXCs, VMInfo{
			VMID:          l.VMID,
			Name:          l.Name,
			Status:        l.Status,
			CPUPercent:    l.CPU * 100,
			MemUsedBytes:  l.Mem,
			MemTotalBytes: l.MaxMem,
			UptimeSeconds: l.Uptime,
		})
	}
	sort.Slice(dash.LXCs, func(i, j int) bool { return dash.LXCs[i].VMID < dash.LXCs[j].VMID })

	return dash, nil
}

// TermProxyData is returned by Proxmox termproxy endpoints.
type TermProxyData struct {
	Ticket string `json:"ticket"`
	Port   int    `json:"port"`
	UpID   string `json:"upid"`
}

// post sends an authenticated POST with an empty body to the Proxmox API.
func (c *Client) post(path string, out any) error {
	req, err := http.NewRequest("POST", c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "PVEAPIToken="+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("proxmox API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// TermProxy creates a terminal proxy session. targetType is "node" or "lxc".
func (c *Client) TermProxy(node, targetType, vmid string) (TermProxyData, error) {
	var path string
	switch targetType {
	case "node":
		path = "/api2/json/nodes/" + node + "/termproxy"
	case "lxc":
		path = "/api2/json/nodes/" + node + "/lxc/" + vmid + "/termproxy"
	default:
		return TermProxyData{}, fmt.Errorf("unsupported type: %s", targetType)
	}

	var resp pveResponse[TermProxyData]
	if err := c.post(path, &resp); err != nil {
		return TermProxyData{}, err
	}
	return resp.Data, nil
}

// VNCWebSocketURL returns the wss:// URL for the Proxmox vncwebsocket endpoint.
func (c *Client) VNCWebSocketURL(node, targetType, vmid string, port int, ticket string) string {
	wsBase := strings.Replace(c.base, "https://", "wss://", 1)
	wsBase = strings.Replace(wsBase, "http://", "ws://", 1)

	var path string
	switch targetType {
	case "node":
		path = "/api2/json/nodes/" + node + "/vncwebsocket"
	default:
		path = "/api2/json/nodes/" + node + "/lxc/" + vmid + "/vncwebsocket"
	}

	q := url.Values{}
	q.Set("port", strconv.Itoa(port))
	q.Set("vncticket", ticket)
	return wsBase + path + "?" + q.Encode()
}
