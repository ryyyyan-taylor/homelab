package semaphore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	base  string
	token string
	http  *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{
		base:  baseURL,
		token: token,
		http:  &http.Client{Timeout: 10 * time.Second},
	}
}

// Template represents a Semaphore project template.
type Template struct {
	ID          int          `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	App         string       `json:"app"`
	LastTask    *TaskSummary `json:"last_task,omitempty"`
}

// TaskSummary is the brief task record embedded in a Template.
type TaskSummary struct {
	ID            int    `json:"id"`
	Status        string `json:"status"` // waiting, running, success, error, stopped
	Start         string `json:"start"`
	End           string `json:"end"`
	CommitMessage string `json:"commit_message"`
}

// Task is the full task record returned by the tasks endpoint.
type Task struct {
	ID     int    `json:"id"`
	Status string `json:"status"`
	Start  string `json:"start"`
	End    string `json:"end"`
}

// raw output item from /tasks/{id}/output
type taskOutputItem struct {
	TaskID int    `json:"task_id"`
	Task   string `json:"task"`
	Time   string `json:"time"`
	Output string `json:"output"`
}

// get performs an authenticated GET and decodes the JSON response body into out.
func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("semaphore API %s returned %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// post performs an authenticated POST with a JSON body and decodes the response into out.
func (c *Client) post(path string, payload, out any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, c.base+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("semaphore API %s returned %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// GetTemplates returns all templates for the given project.
func (c *Client) GetTemplates(projectID int) ([]Template, error) {
	var templates []Template
	if err := c.get(fmt.Sprintf("/api/project/%d/templates", projectID), &templates); err != nil {
		return nil, fmt.Errorf("GetTemplates: %w", err)
	}
	return templates, nil
}

// TriggerTask starts a new task run for the given template and returns the new task ID.
func (c *Client) TriggerTask(projectID, templateID int) (int, error) {
	payload := struct {
		TemplateID int `json:"template_id"`
	}{TemplateID: templateID}

	var task Task
	if err := c.post(fmt.Sprintf("/api/project/%d/tasks", projectID), payload, &task); err != nil {
		return 0, fmt.Errorf("TriggerTask: %w", err)
	}
	return task.ID, nil
}

// GetTask returns the current state of a single task.
func (c *Client) GetTask(projectID, taskID int) (*Task, error) {
	var task Task
	if err := c.get(fmt.Sprintf("/api/project/%d/tasks/%d", projectID, taskID), &task); err != nil {
		return nil, fmt.Errorf("GetTask: %w", err)
	}
	return &task, nil
}

// GetTaskOutput returns the non-blank output lines produced by a task.
func (c *Client) GetTaskOutput(projectID, taskID int) ([]string, error) {
	var items []taskOutputItem
	if err := c.get(fmt.Sprintf("/api/project/%d/tasks/%d/output", projectID, taskID), &items); err != nil {
		return nil, fmt.Errorf("GetTaskOutput: %w", err)
	}

	lines := make([]string, 0, len(items))
	for _, item := range items {
		line := strings.TrimRight(item.Output, "\n")
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines, nil
}
