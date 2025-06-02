import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ConfigurationProps {
  onConfigSaved: () => void;
}

interface StatusEmojiConfig {
  [status: string]: string;
}

export const Configuration: React.FC<ConfigurationProps> = ({ onConfigSaved }) => {
  const [url, setUrl] = useState(localStorage.getItem('jira_url') || '');
  const [email, setEmail] = useState(localStorage.getItem('jira_email') || '');
  const [token, setToken] = useState('');
  const [projectKey, setProjectKey] = useState(localStorage.getItem('jira_project') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([]);
  const [statusEmojis, setStatusEmojis] = useState<StatusEmojiConfig>({});
  const [showEmojiConfig, setShowEmojiConfig] = useState(false);
  const [loadingStatuses, setLoadingStatuses] = useState(false);

  // Default emoji mappings
  const defaultEmojis: StatusEmojiConfig = {
    'To Do': '📋',
    'In Progress': '🔄',
    'In Review': '👀',
    'Code Review': '💻',
    'Testing': '🧪',
    'Ready for Deployment': '🚀',
    'Done': '✅',
    'Closed': '🔒',
    'Resolved': '✅',
    'Blocked': '🚫',
    'Em andamento': '🔄',
    'Para fazer': '📋',
    'Concluído': '✅',
    'Bloqueado': '🚫'
  };

  useEffect(() => {
    // Load saved emoji configurations
    const savedEmojis = localStorage.getItem('status_emojis');
    if (savedEmojis) {
      try {
        setStatusEmojis(JSON.parse(savedEmojis));
      } catch (e) {
        console.error('Error loading saved emojis:', e);
      }
    }
  }, []);

  const loadAvailableStatuses = async () => {
    if (!url || !email || !token) {
      setError('Please fill in all connection details first');
      return;
    }

    setLoadingStatuses(true);
    try {
      const statuses = await invoke<string[]>('get_available_statuses', {
        url,
        email,
        token,
        projectKey: projectKey && projectKey.trim() !== '' ? projectKey : null
      });
      
      setAvailableStatuses(statuses);
      
      // Set default emojis for new statuses
      const newStatusEmojis = { ...statusEmojis };
      statuses.forEach(status => {
        if (!newStatusEmojis[status]) {
          newStatusEmojis[status] = defaultEmojis[status] || '📌';
        }
      });
      setStatusEmojis(newStatusEmojis);
      
    } catch (err) {
      console.error('Failed to load available statuses:', err);
      setError(`Failed to load statuses: ${err}`);
    } finally {
      setLoadingStatuses(false);
    }
  };

  const handleEmojiChange = (status: string, emoji: string) => {
    const newStatusEmojis = { ...statusEmojis, [status]: emoji };
    setStatusEmojis(newStatusEmojis);
    localStorage.setItem('status_emojis', JSON.stringify(newStatusEmojis));
  };

  const resetToDefaults = () => {
    const newStatusEmojis: StatusEmojiConfig = {};
    availableStatuses.forEach(status => {
      newStatusEmojis[status] = defaultEmojis[status] || '📌';
    });
    setStatusEmojis(newStatusEmojis);
    localStorage.setItem('status_emojis', JSON.stringify(newStatusEmojis));
  };

  const handleTestConnection = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('Testing connection with:', { url, email, token: token ? '***' : 'empty' });
      
      const success = await invoke<boolean>('test_connection', { url, email, token });
      console.log('Connection test result:', success);
      
      if (success) {
        console.log('Saving credentials...');
        await invoke('save_credentials', { url, email, token });
        
        console.log('Saving to localStorage...');
        localStorage.setItem('jira_url', url);
        localStorage.setItem('jira_email', email);
        localStorage.setItem('jira_project', projectKey);
        console.log('Verifying localStorage:', {
          saved_url: localStorage.getItem('jira_url'),
          saved_email: localStorage.getItem('jira_email'),
          saved_project: localStorage.getItem('jira_project')
        });
        
        console.log('Calling onConfigSaved...');
        onConfigSaved();
      } else {
        setError('Connection failed. Please check your credentials.');
      }
    } catch (err) {
      console.error('Error in handleTestConnection:', err);
      setError(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="configuration">
      <h2>Jira Configuration</h2>
      
      <div className="form-group">
        <label htmlFor="url">Jira URL</label>
        <input
          id="url"
          type="url"
          placeholder="https://your-domain.atlassian.net"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          placeholder="your-email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="token">API Token</label>
        <input
          id="token"
          type="password"
          placeholder="Your Jira API Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <small>
          <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer">
            Generate API Token
          </a>
        </small>
      </div>

      <div className="form-group">
        <label htmlFor="project">Project Key (Optional)</label>
        <input
          id="project"
          type="text"
          placeholder="e.g., PROJ, DEV, TEST (leave empty for all projects)"
          value={projectKey}
          onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
        />
        <small>
          Filter tasks to show only from this project. Leave empty to see all your tasks.
        </small>
      </div>

      {error && <div className="error">{error}</div>}

      <button
        onClick={handleTestConnection}
        disabled={!url || !email || !token || loading}
      >
        {loading ? 'Testing...' : 'Test Connection & Save'}
      </button>

      {/* Emoji Configuration Section */}
      <div className="emoji-config-section" style={{ marginTop: '2rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
        <div className="section-header">
          <h3>Status Emojis Configuration</h3>
          <button 
            className="toggle-btn"
            onClick={() => setShowEmojiConfig(!showEmojiConfig)}
            style={{ marginLeft: '1rem' }}
          >
            {showEmojiConfig ? '▲ Hide' : '▼ Show'}
          </button>
        </div>

        {showEmojiConfig && (
          <div className="emoji-config">
            <p>Customize emojis that appear in the menu bar for each status:</p>
            
            <div className="emoji-config-actions" style={{ marginBottom: '1rem' }}>
              <button 
                onClick={loadAvailableStatuses}
                disabled={loadingStatuses || !url || !email || !token}
                style={{ marginRight: '1rem' }}
              >
                {loadingStatuses ? 'Loading...' : 'Load Project Statuses'}
              </button>
              
              {availableStatuses.length > 0 && (
                <button onClick={resetToDefaults}>
                  Reset to Defaults
                </button>
              )}
            </div>

            {availableStatuses.length > 0 && (
              <div className="status-emoji-grid">
                {availableStatuses.map((status) => (
                  <div key={status} className="status-emoji-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem', gap: '1rem' }}>
                    <div style={{ minWidth: '150px', textAlign: 'left' }}>
                      <strong>{status}</strong>
                    </div>
                    <input
                      type="text"
                      value={statusEmojis[status] || ''}
                      onChange={(e) => handleEmojiChange(status, e.target.value)}
                      placeholder="🔥"
                      style={{ width: '60px', textAlign: 'center', fontSize: '1.2rem' }}
                      maxLength={4}
                    />
                    <div style={{ fontSize: '1.2rem' }}>
                      {statusEmojis[status]} {status}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {availableStatuses.length === 0 && (
              <div className="emoji-hint">
                Click "Load Project Statuses" to configure emojis for your project's statuses.
                Make sure your connection details are correct first.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};