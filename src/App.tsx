import { useState, useEffect } from 'react';
import { Configuration } from './components/Configuration';
import { TaskList } from './components/TaskList';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

function App() {
  const [configured, setConfigured] = useState(() => {
    const url = localStorage.getItem('jira_url');
    const email = localStorage.getItem('jira_email');
    const initial = !!(url && email);
    console.log('Initial configured state:', initial, { url, email });
    return initial;
  });
  const [hideOnBlur, setHideOnBlur] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Remove the useEffect that was resetting the state

  const handleConfigSaved = () => {
    console.log('App: handleConfigSaved called');
    setConfigured(true);
    setShowSettings(false);
  };

  const handleConfigurationNeeded = () => {
    console.log('handleConfigurationNeeded called');
    setConfigured(false);
    setShowSettings(true);
  };

  const handleHideOnBlurChange = async (value: boolean) => {
    setHideOnBlur(value);
    await invoke('set_hide_on_blur', { hide: value });
  };

  console.log('App render state:', { configured, showSettings });
  
  return (
    <div className="app">
      <div className="app-header">
        <h1>Jira Tasks</h1>
        <div className="header-controls">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={hideOnBlur}
              onChange={(e) => handleHideOnBlurChange(e.target.checked)}
            />
            <span>Hide on blur</span>
          </label>
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>
      
      {showSettings || !configured ? (
        <Configuration 
          onConfigSaved={handleConfigSaved} 
        />
      ) : (
        <TaskList onConfigurationNeeded={handleConfigurationNeeded} />
      )}
    </div>
  );
}

export default App;