import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ConfigurationProps {
  onConfigSaved: () => void;
}

export const Configuration: React.FC<ConfigurationProps> = ({ onConfigSaved }) => {
  const [url, setUrl] = useState(localStorage.getItem('jira_url') || '');
  const [email, setEmail] = useState(localStorage.getItem('jira_email') || '');
  const [token, setToken] = useState('');
  const [projectKey, setProjectKey] = useState(localStorage.getItem('jira_project') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    </div>
  );
};