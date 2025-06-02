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

interface JiraTransition {
  id: string;
  name: string;
}

interface TaskListProps {
  onConfigurationNeeded: () => void;
}

interface StatusEmojiConfig {
  [status: string]: string;
}

// Helper functions for safe JSON parsing with type validation
const safeParseStatusFilter = (jsonString: string | null): string[] | null => {
  if (!jsonString) return null;
  
  try {
    const parsedData = JSON.parse(jsonString);
    if (Array.isArray(parsedData) && parsedData.every(item => typeof item === 'string')) {
      return parsedData as string[];
    } else {
      console.error('Invalid structure for jira_status_filter from localStorage:', parsedData);
      localStorage.removeItem('jira_status_filter');
      return null;
    }
  } catch (error) {
    console.error('Error parsing jira_status_filter from localStorage:', error);
    localStorage.removeItem('jira_status_filter');
    return null;
  }
};

const safeParseStatusEmojis = (jsonString: string | null): StatusEmojiConfig => {
  if (!jsonString) return {};
  
  try {
    const parsedData = JSON.parse(jsonString);
    if (
      typeof parsedData === 'object' &&
      parsedData !== null &&
      Object.keys(parsedData).every(key => typeof key === 'string') &&
      Object.values(parsedData).every(value => typeof value === 'string')
    ) {
      return parsedData as StatusEmojiConfig;
    } else {
      console.error('Invalid structure for status_emojis from localStorage:', parsedData);
      localStorage.removeItem('status_emojis');
      return {};
    }
  } catch (error) {
    console.error('Error parsing status_emojis from localStorage:', error);
    localStorage.removeItem('status_emojis');
    return {};
  }
};

export const TaskList: React.FC<TaskListProps> = ({ onConfigurationNeeded }) => {
  const [tasks, setTasks] = useState<JiraTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<{[key: string]: JiraTransition[]}>({});
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [showStatusFilter, setShowStatusFilter] = useState(false);

  const loadTasks = async () => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    const project = localStorage.getItem('jira_project');
    const savedStatuses = localStorage.getItem('jira_status_filter');
    
    console.log('TaskList loadTasks - localStorage check:', { url, email, project, savedStatuses });
    console.log('Starting to load tasks...');
    
    if (!url || !email) {
      console.log('TaskList: Missing configuration, calling onConfigurationNeeded');
      onConfigurationNeeded();
      return;
    }

    try {
      console.log('STEP 1: Loading credentials...');
      const token = await invoke<string>('load_credentials', { email });
      const projectKey = project && project.trim() !== '' ? project : null;
      const statusFilter = safeParseStatusFilter(savedStatuses);
      
      console.log('STEP 2: Fetching tasks...');
      const fetchedTasks = await invoke<JiraTask[]>('fetch_tasks', { 
        url, 
        email, 
        token, 
        projectKey,
        statusFilter 
      });
      
      console.log('STEP 3: Tasks fetched -', fetchedTasks.length, 'tasks');
      setTasks(fetchedTasks);
      setError('');
      
      console.log('STEP 4: Loading emojis...');
      const savedEmojis = localStorage.getItem('status_emojis');
      const statusEmojis: StatusEmojiConfig = safeParseStatusEmojis(savedEmojis);
      console.log('Emojis:', statusEmojis);
      
      console.log('STEP 5: Calling update_menu_with_tasks...');
      await invoke('update_menu_with_tasks', { tasks: fetchedTasks, status_emojis: statusEmojis });
      console.log('STEP 6: Menu update call completed!');
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

  const loadTransitions = async (taskKey: string) => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    
    if (!url || !email) return;

    try {
      const token = await invoke<string>('load_credentials', { email });
      const taskTransitions = await invoke<JiraTransition[]>('get_task_transitions', {
        url,
        email,
        token,
        taskKey
      });
      
      setTransitions(prev => ({ ...prev, [taskKey]: taskTransitions }));
    } catch (err) {
      console.error('Failed to load transitions:', err);
    }
  };

  const handleStatusChange = async (taskKey: string, transitionId: string) => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    
    if (!url || !email) return;

    setTransitioning(taskKey);

    try {
      const token = await invoke<string>('load_credentials', { email });
      await invoke('transition_task', {
        url,
        email,
        token,
        taskKey,
        transitionId
      });
      
      // Reload tasks after successful transition
      await loadTasks();
      setExpandedTask(null);
    } catch (err) {
      console.error('Failed to transition task:', err);
      setError(`Failed to update task status: ${err}`);
    } finally {
      setTransitioning(null);
    }
  };

  const toggleTaskExpansion = async (taskKey: string) => {
    if (expandedTask === taskKey) {
      setExpandedTask(null);
    } else {
      setExpandedTask(taskKey);
      if (!transitions[taskKey]) {
        await loadTransitions(taskKey);
      }
    }
  };

  const loadAvailableStatuses = async () => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    const project = localStorage.getItem('jira_project');
    
    if (!url || !email) return;

    try {
      const token = await invoke<string>('load_credentials', { email });
      const projectKey = project && project.trim() !== '' ? project : null;
      const statuses = await invoke<string[]>('get_available_statuses', {
        url,
        email,
        token,
        projectKey
      });
      
      setAvailableStatuses(statuses);
    } catch (err) {
      console.error('Failed to load available statuses:', err);
    }
  };

  const handleStatusFilterChange = (status: string, checked: boolean) => {
    let newSelectedStatuses;
    if (checked) {
      newSelectedStatuses = [...selectedStatuses, status];
    } else {
      newSelectedStatuses = selectedStatuses.filter(s => s !== status);
    }
    
    setSelectedStatuses(newSelectedStatuses);
    localStorage.setItem('jira_status_filter', JSON.stringify(newSelectedStatuses));
    
    // Reload tasks with new filter
    loadTasks();
  };

  const clearStatusFilter = () => {
    setSelectedStatuses([]);
    localStorage.removeItem('jira_status_filter');
    loadTasks();
  };

  useEffect(() => {
    // Load saved status filter with safe parsing
    const savedStatuses = localStorage.getItem('jira_status_filter');
    const parsedStatuses = safeParseStatusFilter(savedStatuses);
    if (parsedStatuses) {
      setSelectedStatuses(parsedStatuses);
    }
    
    loadTasks();
    loadAvailableStatuses();
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

  const projectKey = localStorage.getItem('jira_project');
  const headerText = projectKey && projectKey.trim() !== '' 
    ? `${projectKey} Tasks (${tasks.length})` 
    : `My Tasks (${tasks.length})`;

  return (
    <div className="task-list">
      <div className="header">
        <h2>{headerText}</h2>
        <button onClick={loadTasks} className="refresh-btn" title="Refresh">
          ↻
        </button>
      </div>
      
      <div className="settings">
        <div className="setting-row">
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
        
        <div className="setting-row">
          <button 
            className="filter-toggle-btn"
            onClick={() => setShowStatusFilter(!showStatusFilter)}
          >
            🔍 Filter by Status {selectedStatuses.length > 0 && `(${selectedStatuses.length})`}
          </button>
        </div>
        
        {showStatusFilter && (
          <div className="status-filter">
            <div className="filter-header">
              <span>Select Status Columns:</span>
              {selectedStatuses.length > 0 && (
                <button className="clear-filter-btn" onClick={clearStatusFilter}>
                  Clear All
                </button>
              )}
            </div>
            <div className="status-checkboxes">
              {availableStatuses.map((status) => (
                <label key={status} className="status-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={(e) => handleStatusFilterChange(status, e.target.checked)}
                  />
                  <span className={`status-label ${getStatusClass(status)}`}>
                    {status}
                  </span>
                </label>
              ))}
            </div>
            {selectedStatuses.length === 0 && (
              <div className="filter-hint">
                No filters selected - showing all active tasks
              </div>
            )}
          </div>
        )}
      </div>

      <div className="tasks">
        {tasks.length === 0 ? (
          <div className="no-tasks">No tasks assigned to you 🎉</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="task">
              <div className="task-content" onClick={() => openTask(task.key)}>
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
              
              <div className="task-actions">
                <button 
                  className="expand-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTaskExpansion(task.key);
                  }}
                  title="Change Status"
                >
                  {expandedTask === task.key ? '▲' : '▼'}
                </button>
              </div>

              {expandedTask === task.key && (
                <div className="task-transitions">
                  <h4>Change Status:</h4>
                  {transitions[task.key] ? (
                    <div className="transition-buttons">
                      {transitions[task.key].map((transition) => (
                        <button
                          key={transition.id}
                          className="transition-btn"
                          disabled={transitioning === task.key}
                          onClick={() => handleStatusChange(task.key, transition.id)}
                        >
                          {transitioning === task.key ? 'Updating...' : transition.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="loading-transitions">Loading transitions...</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};