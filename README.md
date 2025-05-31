# Jira Taskbar

A lightweight macOS menu bar application for managing Jira tasks, built with Tauri and React.

## Features

- **Menu Bar Integration**: Lives in your macOS menu bar for quick access
- **Secure Credential Storage**: API tokens are stored securely in macOS Keychain
- **Task Overview**: View all your assigned, unresolved Jira tasks at a glance
- **Smart Sorting**: Tasks are automatically sorted by priority and update time
- **Quick Actions**: Click any task to open it directly in your browser
- **Auto-refresh**: Configurable automatic refresh intervals (5, 10, 15, or 30 minutes)
- **Native Performance**: Built with Rust and Tauri for minimal resource usage

## Development Setup

### Prerequisites

- Node.js (v16 or later)
- Rust (latest stable)
- macOS (for development and running)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/jira-taskbar.git
cd jira-taskbar
```

2. Install dependencies:
```bash
npm install
```

3. Run in development mode:
```bash
npm run tauri-dev
```

### Building for Production

To create a production build:

```bash
npm run tauri-build
```

This will generate a `.dmg` file in `src-tauri/target/release/bundle/dmg/`.

## Configuration

On first launch, you'll need to configure:

1. **Jira URL**: Your Atlassian instance URL (e.g., `https://your-domain.atlassian.net`)
2. **Email**: Your Jira account email
3. **API Token**: Generate one at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

The app securely stores your API token in the macOS Keychain.

## Usage

- Click the menu bar icon to view your tasks
- Click on any task to open it in your browser
- Use the refresh button (↻) for manual updates
- Configure auto-refresh intervals in the settings dropdown

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Rust, Tauri
- **APIs**: Jira REST API v3
- **Security**: macOS Keychain for credential storage

## License

MIT