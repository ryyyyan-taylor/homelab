package smokeping

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
)

const (
	routerGroup = "LAN"
	fineHours   = 2
)

var nanToken = regexp.MustCompile(`-?\bnan\b`)

type Client struct {
	base string
	http *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{base: baseURL, http: &http.Client{Timeout: 15 * time.Second}}
}

type Event struct {
	Start     time.Time `json:"start"`
	End       time.Time `json:"end"`
	Targets   []string  `json:"targets"`
	Scope     string    `json:"scope"`
	Severity  string    `json:"severity"`
	PeakLoss  float64   `json:"peak_loss"`
	PeakWorst float64   `json:"worst_round_loss"`
	PeakRTT   float64   `json:"peak_rtt_ms"`
	ResSec    int       `json:"resolution_sec"`
}

type Result struct {
	Hours     int      `json:"hours"`
	StepSec   int      `json:"step_sec"`
	FineSec   int      `json:"fine_sec,omitempty"`
	FineHours int      `json:"fine_hours,omitempty"`
	Targets   []string `json:"targets"`
	Events    []Event  `json:"events"`
}

type xport struct {
	Meta struct {
		Start  int64    `json:"start"`
		Step   int64    `json:"step"`
		Legend []string `json:"legend"`
	} `json:"meta"`
	Data [][]*float64 `json:"data"`
}

type series struct {
	group, name      string
	loss, worst, rtt int
}

func (c *Client) fetch(hours int) (*xport, error) {
	resp, err := c.http.Get(fmt.Sprintf("%s/?hours=%d", c.base, hours))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rrd-api returned %s", resp.Status)
	}

	var x xport
	if err := json.Unmarshal(nanToken.ReplaceAll(body, []byte("null")), &x); err != nil {
		return nil, fmt.Errorf("decode rrd-api response: %w", err)
	}
	return &x, nil
}

func (c *Client) Outages(hours int, minLoss float64) (*Result, error) {
	coarse, err := c.fetch(hours)
	if err != nil {
		return nil, err
	}

	result := &Result{Hours: hours, StepSec: int(coarse.Meta.Step), Targets: []string{}, Events: []Event{}}
	targets := parseLegend(coarse.Meta.Legend)
	for _, t := range targets {
		result.Targets = append(result.Targets, t.group+"/"+t.name)
	}

	var fine *xport
	if hours > fineHours {
		if f, err := c.fetch(fineHours); err == nil && f.Meta.Step < coarse.Meta.Step {
			fine = f
		}
	}

	var coarseUntil, fineAfter int64
	if fine != nil {
		step := coarse.Meta.Step
		k := (fine.Meta.Start - coarse.Meta.Start + step - 1) / step
		coarseUntil = coarse.Meta.Start + max(k, 1)*step
		fineAfter = coarseUntil
		result.FineSec = int(fine.Meta.Step)
		result.FineHours = fineHours
	}

	var perTarget []Event
	for _, t := range targets {
		perTarget = append(perTarget, targetEvents(*coarse, t, minLoss, 0, coarseUntil)...)
		if fine != nil {
			perTarget = append(perTarget, targetEvents(*fine, t, minLoss, fineAfter, 0)...)
		}
	}
	result.Events = mergeEvents(perTarget)
	return result, nil
}

func parseLegend(legend []string) []series {
	index := map[string]*series{}
	var order []string
	for i, l := range legend {
		parts := strings.Split(l, "/")
		if len(parts) != 3 {
			continue
		}
		key := parts[0] + "/" + parts[1]
		s, ok := index[key]
		if !ok {
			s = &series{group: parts[0], name: parts[1], loss: -1, worst: -1, rtt: -1}
			index[key] = s
			order = append(order, key)
		}
		switch parts[2] {
		case "loss":
			s.loss = i
		case "worst":
			s.worst = i
		case "rtt":
			s.rtt = i
		}
	}
	out := make([]series, 0, len(order))
	for _, k := range order {
		if s := index[k]; s.loss >= 0 && s.worst >= 0 && s.rtt >= 0 {
			out = append(out, *index[k])
		}
	}
	return out
}

func targetEvents(x xport, t series, minLoss float64, after, until int64) []Event {
	var events []Event
	var cur *Event
	gap := 0
	step := time.Duration(x.Meta.Step) * time.Second

	for i, row := range x.Data {
		end := x.Meta.Start + int64(i+1)*x.Meta.Step
		if end <= after || (until > 0 && end > until) {
			continue
		}
		at := time.Unix(end, 0).UTC()
		loss := row[t.loss]
		if loss == nil {
			continue
		}
		if *loss < minLoss {
			gap++
			if cur != nil && gap > 1 {
				events = append(events, *cur)
				cur = nil
			}
			continue
		}
		gap = 0
		if cur == nil {
			cur = &Event{Start: at.Add(-step), Targets: []string{t.group + "/" + t.name}, ResSec: int(x.Meta.Step)}
		}
		cur.End = at
		cur.PeakLoss = math.Max(cur.PeakLoss, *loss)
		if worst := row[t.worst]; worst != nil {
			cur.PeakWorst = math.Max(cur.PeakWorst, *worst)
		}
		if rtt := row[t.rtt]; rtt != nil {
			cur.PeakRTT = math.Max(cur.PeakRTT, *rtt)
		}
	}
	if cur != nil {
		events = append(events, *cur)
	}
	return events
}

func mergeEvents(events []Event) []Event {
	sort.Slice(events, func(i, j int) bool { return events[i].Start.Before(events[j].Start) })
	var merged []Event
	for _, e := range events {
		if n := len(merged); n > 0 && !e.Start.After(merged[n-1].End) {
			m := &merged[n-1]
			if e.End.After(m.End) {
				m.End = e.End
			}
			for _, t := range e.Targets {
				if !slices.Contains(m.Targets, t) {
					m.Targets = append(m.Targets, t)
				}
			}
			m.ResSec = max(m.ResSec, e.ResSec)
			m.PeakLoss = math.Max(m.PeakLoss, e.PeakLoss)
			m.PeakWorst = math.Max(m.PeakWorst, e.PeakWorst)
			m.PeakRTT = math.Max(m.PeakRTT, e.PeakRTT)
			continue
		}
		merged = append(merged, e)
	}
	for i := range merged {
		merged[i].Scope = scope(merged[i].Targets)
		merged[i].Severity = severity(merged[i].PeakWorst)
	}
	if merged == nil {
		return []Event{}
	}
	return merged
}

func scope(targets []string) string {
	for _, t := range targets {
		if strings.HasPrefix(t, routerGroup+"/") {
			return "lan"
		}
	}
	return "upstream"
}

func severity(worstRound float64) string {
	switch {
	case worstRound >= 50:
		return "outage"
	case worstRound >= 20:
		return "degraded"
	default:
		return "minor"
	}
}
