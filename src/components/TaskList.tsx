import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';

interface JiraTask {
  id: string;
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee?: string;
}

interface TaskListProps {
  onConfigurationNeeded: () => void;
}

export const TaskList: React.FC<TaskListProps> = ({ onConfigurationNeeded }) => {
  const [tasks, setTasks] = useState<JiraTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(5);

  const loadTasks = async () => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    
    console.log('TaskList loadTasks - localStorage check:', { url, email });
    
    if (!url || !email) {
      console.log('TaskList: Missing configuration, calling onConfigurationNeeded');
      onConfigurationNeeded();
      return;
    }

    try {
      const token = await invoke<string>('load_credentials', { email });
      const fetchedTasks = await invoke<JiraTask[]>('fetch_tasks', { url, email, token });
      setTasks(fetchedTasks);
      setError('');
      
      // Update menu with tasks
      try {
        await invoke('update_menu_with_tasks', { tasks: fetchedTasks });
      } catch (menuError) {
        console.error('Failed to update menu:', menuError);
      }
    } catch (err) {
      console.log('TaskList error:', err);
      setError(`Failed to load tasks: ${err}`);
      if (err?.toString().includes('No matching entry found') || 
          err?.toString().includes('password')) {
        console.log('TaskList: Credential error, calling onConfigurationNeeded');
        onConfigurationNeeded();
      }
    } finally {
      setLoading(false);
    }
  };

  const openTask = async (key: string) => {
    const url = localStorage.getItem('jira_url');
    if (url) {
      await open(`${url}/browse/${key}`);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    // Set up auto-refresh
    const interval = setInterval(loadTasks, refreshInterval * 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, [refreshInterval]);

  useEffect(() => {
    // Expose functions to window for menu integration
    (window as any).refreshTasks = loadTasks;
    (window as any).openTaskByIndex = (index: number) => {
      if (tasks[index]) {
        openTask(tasks[index].key);
      }
    };
    
    return () => {
      delete (window as any).refreshTasks;
      delete (window as any).openTaskByIndex;
    };
  }, [tasks]);

  const getPriorityClass = (priority: string) => {
    const priorityLower = priority.toLowerCase();
    if (priorityLower === 'highest' || priorityLower === 'blocker') return 'priority-highest';
    if (priorityLower === 'high' || priorityLower === 'critical') return 'priority-high';
    if (priorityLower === 'medium') return 'priority-medium';
    if (priorityLower === 'low') return 'priority-low';
    return 'priority-lowest';
  };

  const getStatusClass = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('done') || statusLower.includes('closed')) return 'status-done';
    if (statusLower.includes('progress') || statusLower.includes('review')) return 'status-progress';
    if (statusLower.includes('blocked')) return 'status-blocked';
    return 'status-todo';
  };

  if (loading) {
    return <div className="loading">Loading tasks...</div>;
  }

  if (error) {
    return (
      <div className="error-container">
        <div className="error">{error}</div>
        <button onClick={loadTasks}>Retry</button>
      </div>
    );
  }

  return (
    <div className="task-list">
      <div className="header">
        <h2>My Tasks ({tasks.length})</h2>
        <button onClick={loadTasks} className="refresh-btn" title="Refresh">
          ↻
        </button>
      </div>
      
      <div className="settings">
        <label>
          Auto-refresh: 
          <select value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))}>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
          </select>
        </label>
      </div>

      <div className="tasks">
        {tasks.length === 0 ? (
          <div className="no-tasks">No tasks assigned to you 🎉</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="task" onClick={() => openTask(task.key)}>
              <div className="task-header">
                <span className="task-key">{task.key}</span>
                <span className={`priority ${getPriorityClass(task.priority)}`}>
                  {task.priority}
                </span>
              </div>
              <div className="task-summary">{task.summary}</div>
              <div className="task-footer">
                <span className={`status ${getStatusClass(task.status)}`}>
                  {task.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};