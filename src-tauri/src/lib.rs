use serde::{Deserialize, Serialize};
use tauri::{
    Manager, WindowEvent, State, AppHandle,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use base64::{Engine as _, engine::general_purpose};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use directories::ProjectDirs;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce, Key
};
use rand::RngCore;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraConfig {
    pub url: String,
    pub email: String,
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraTask {
    pub id: String,
    pub key: String,
    pub summary: String,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraTransition {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppState {
    pub config: Option<JiraConfig>,
    pub tasks: Vec<JiraTask>,
}

pub struct WindowState {
    pub hide_on_blur: Arc<Mutex<bool>>,
}

pub struct CredentialStore {
    pub credentials: Arc<Mutex<HashMap<String, String>>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredCredentials {
    encrypted_token: Vec<u8>,
    nonce: Vec<u8>,
}

fn get_machine_id() -> String {
    // Get hardware UUID on macOS
    if let Ok(output) = Command::new("system_profiler")
        .args(&["SPHardwareDataType"])
        .output()
    {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            if line.contains("Hardware UUID") {
                return line.split(':').nth(1)
                    .unwrap_or("default")
                    .trim()
                    .to_string();
            }
        }
    }
    
    // Fallback to hostname
    if let Ok(output) = Command::new("hostname").output() {
        return String::from_utf8_lossy(&output.stdout).trim().to_string();
    }
    
    "default-machine".to_string()
}

fn derive_key_from_machine() -> Key<Aes256Gcm> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let machine_id = get_machine_id();
    let app_salt = "JiraTaskbar-2024-SecureStorage";
    
    // Create a deterministic but unique key for this machine
    let mut hasher = DefaultHasher::new();
    machine_id.hash(&mut hasher);
    app_salt.hash(&mut hasher);
    
    let hash = hasher.finish();
    let mut key_bytes = [0u8; 32];
    
    // Fill key with hash-derived bytes
    for i in 0..4usize {
        let chunk = hash.rotate_left((i * 16) as u32).to_be_bytes();
        key_bytes[i*8..(i+1)*8].copy_from_slice(&chunk);
    }
    
    Key::<Aes256Gcm>::from_slice(&key_bytes).clone()
}

fn get_storage_path() -> Result<PathBuf, String> {
    let proj_dirs = ProjectDirs::from("com", "jirataskbar", "JiraTaskbar")
        .ok_or("Could not determine project directories")?;
    
    let data_dir = proj_dirs.data_dir();
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    
    // Set restrictive permissions on macOS
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(data_dir).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o700); // Only owner can read/write/execute
        fs::set_permissions(data_dir, perms).map_err(|e| e.to_string())?;
    }
    
    Ok(data_dir.join("credentials.json"))
}

#[tauri::command]
async fn save_credentials(_url: String, email: String, token: String) -> Result<(), String> {
    println!("Saving credentials for email: {}", email);
    
    // Use encrypted file storage directly
    let cipher = Aes256Gcm::new(&derive_key_from_machine());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let encrypted = cipher.encrypt(nonce, token.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;
    
    let stored = StoredCredentials {
        encrypted_token: encrypted,
        nonce: nonce_bytes.to_vec(),
    };
    
    let storage_path = get_storage_path()?;
    let mut all_creds: HashMap<String, StoredCredentials> = if storage_path.exists() {
        let data = fs::read_to_string(&storage_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        HashMap::new()
    };
    
    all_creds.insert(email.clone(), stored);
    
    let json = serde_json::to_string_pretty(&all_creds).map_err(|e| e.to_string())?;
    fs::write(&storage_path, json).map_err(|e| e.to_string())?;
    
    println!("Credentials saved to encrypted file successfully");
    Ok(())
}

#[tauri::command]
async fn load_credentials(email: String) -> Result<String, String> {
    println!("Loading credentials for: {}", email);
    
    // Use encrypted file storage directly
    
    let storage_path = get_storage_path()?;
    if !storage_path.exists() {
        return Err("No stored credentials found".to_string());
    }
    
    let data = fs::read_to_string(&storage_path).map_err(|e| e.to_string())?;
    let all_creds: HashMap<String, StoredCredentials> = 
        serde_json::from_str(&data).map_err(|e| e.to_string())?;
    
    let stored = all_creds.get(&email)
        .ok_or("No credentials found for this email")?;
    
    let cipher = Aes256Gcm::new(&derive_key_from_machine());
    let nonce = Nonce::from_slice(&stored.nonce);
    
    let decrypted = cipher.decrypt(nonce, stored.encrypted_token.as_ref())
        .map_err(|e| format!("Decryption error: {}", e))?;
    
    let token = String::from_utf8(decrypted)
        .map_err(|e| format!("UTF8 error: {}", e))?;
    
    println!("Credentials loaded from encrypted file successfully");
    Ok(token)
}

#[tauri::command]
async fn clear_credentials(email: String) -> Result<(), String> {
    println!("Clearing credentials for: {}", email);
    
    let storage_path = get_storage_path()?;
    if storage_path.exists() {
        let data = fs::read_to_string(&storage_path).map_err(|e| e.to_string())?;
        let mut all_creds: HashMap<String, StoredCredentials> = 
            serde_json::from_str(&data).unwrap_or_default();
        
        all_creds.remove(&email);
        
        if all_creds.is_empty() {
            fs::remove_file(&storage_path).map_err(|e| e.to_string())?;
        } else {
            let json = serde_json::to_string_pretty(&all_creds).map_err(|e| e.to_string())?;
            fs::write(&storage_path, json).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn test_connection(url: String, email: String, token: String) -> Result<bool, String> {
    println!("Testing connection to: {}", url);
    println!("Email: {}", email);
    
    let client = reqwest::Client::new();
    let auth = general_purpose::STANDARD.encode(format!("{}:{}", email, token));
    
    let full_url = format!("{}/rest/api/3/myself", url);
    println!("Full URL: {}", full_url);
    
    let response = client
        .get(&full_url)
        .header("Authorization", format!("Basic {}", auth))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            println!("Request error: {}", e);
            e.to_string()
        })?;
    
    let status = response.status();
    println!("Response status: {}", status);
    
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        println!("Response body: {}", text);
    }
    
    Ok(status.is_success())
}

#[tauri::command]
async fn fetch_tasks(url: String, email: String, token: String, project_key: Option<String>, status_filter: Option<Vec<String>>) -> Result<Vec<JiraTask>, String> {
    let client = reqwest::Client::new();
    let auth = general_purpose::STANDARD.encode(format!("{}:{}", email, token));
    
    let base_jql = "assignee = currentUser() AND status NOT IN (Done, Closed, Resolved)";
    let jql = if let Some(project) = project_key {
        format!("{} AND project = {} ORDER BY priority DESC, updated DESC", base_jql, project)
    } else {
        format!("{} ORDER BY priority DESC, updated DESC", base_jql)
    };
    println!("Executing JQL: {}", jql);
    
    let response = client
        .get(format!("{}/rest/api/3/search", url))
        .header("Authorization", format!("Basic {}", auth))
        .query(&[("jql", jql)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to fetch tasks: {}", response.status()));
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    println!("Response JSON: {:?}", json);
    println!("Total issues found: {}", json["total"].as_u64().unwrap_or(0));
    
    let tasks = json["issues"]
        .as_array()
        .ok_or("Invalid response format")?
        .iter()
        .map(|issue| {
            Ok(JiraTask {
                id: issue["id"].as_str().unwrap_or("").to_string(),
                key: issue["key"].as_str().unwrap_or("").to_string(),
                summary: issue["fields"]["summary"].as_str().unwrap_or("").to_string(),
                status: issue["fields"]["status"]["name"].as_str().unwrap_or("").to_string(),
                priority: issue["fields"]["priority"]
                    .as_object()
                    .and_then(|p| p["name"].as_str())
                    .unwrap_or("Medium")
                    .to_string(),
                assignee: issue["fields"]["assignee"]
                    .as_object()
                    .and_then(|a| a["displayName"].as_str())
                    .map(|s| s.to_string()),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    
    println!("Returning {} tasks", tasks.len());
    Ok(tasks)
}

#[tauri::command]
async fn get_task_transitions(url: String, email: String, token: String, task_key: String) -> Result<Vec<JiraTransition>, String> {
    let client = reqwest::Client::new();
    let auth = general_purpose::STANDARD.encode(format!("{}:{}", email, token));
    
    println!("Getting transitions for task: {}", task_key);
    
    let response = client
        .get(format!("{}/rest/api/3/issue/{}/transitions", url, task_key))
        .header("Authorization", format!("Basic {}", auth))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if !response.status().is_success() {
        return Err(format!("Failed to get transitions: {}", response.status()));
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    let transitions = json["transitions"]
        .as_array()
        .ok_or("Invalid transitions response format")?
        .iter()
        .map(|transition| {
            Ok(JiraTransition {
                id: transition["id"].as_str().unwrap_or("").to_string(),
                name: transition["name"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    
    println!("Found {} transitions for {}", transitions.len(), task_key);
    Ok(transitions)
}

#[tauri::command]
async fn transition_task(url: String, email: String, token: String, task_key: String, transition_id: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let auth = general_purpose::STANDARD.encode(format!("{}:{}", email, token));
    
    println!("Transitioning task {} with transition {}", task_key, transition_id);
    
    let body = serde_json::json!({
        "transition": {
            "id": transition_id
        }
    });
    
    let response = client
        .post(format!("{}/rest/api/3/issue/{}/transitions", url, task_key))
        .header("Authorization", format!("Basic {}", auth))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to transition task: {} - {}", status, error_text));
    }
    
    println!("Successfully transitioned task {}", task_key);
    Ok(())
}

#[tauri::command]
async fn update_menu_with_tasks(app: AppHandle, tasks: Vec<JiraTask>) -> Result<(), String> {
    println!("Updating menu with {} tasks", tasks.len());
    
    if let Some(tray) = app.tray_by_id("main") {
        let menu_builder = MenuBuilder::new(&app);
        
        // Add header with task count
        let header_text = format!("Jira Tasks ({})", tasks.len());
        let header = MenuItemBuilder::with_id("header", header_text)
            .enabled(false)
            .build(&app)
            .map_err(|e| e.to_string())?;
        let mut menu_builder = menu_builder.item(&header);
        
        // Add separator
        menu_builder = menu_builder.separator();
        
        if tasks.is_empty() {
            let no_tasks = MenuItemBuilder::with_id("no_tasks", "No tasks assigned")
                .enabled(false)
                .build(&app)
                .map_err(|e| e.to_string())?;
            menu_builder = menu_builder.item(&no_tasks);
        } else {
            // Group tasks by status
            let mut status_groups: std::collections::HashMap<String, Vec<(usize, &JiraTask)>> = std::collections::HashMap::new();
            
            for (i, task) in tasks.iter().enumerate() {
                status_groups.entry(task.status.clone()).or_insert_with(Vec::new).push((i, task));
            }
            
            // Sort statuses (common Jira workflow order)
            let status_order = vec!["To Do", "In Progress", "In Review", "Code Review", "Testing", "Ready for Deployment"];
            let mut sorted_statuses: Vec<String> = status_order.iter()
                .filter(|&status| status_groups.contains_key(*status))
                .map(|s| s.to_string())
                .collect();
            
            // Add any other statuses not in the predefined order
            for status in status_groups.keys() {
                if !sorted_statuses.contains(status) {
                    sorted_statuses.push(status.clone());
                }
            }
            
            let mut task_count = 0;
            for status in sorted_statuses {
                if let Some(status_tasks) = status_groups.get(&status) {
                    // Add status header
                    let status_header = MenuItemBuilder::with_id(
                        format!("status_{}", status.replace(" ", "_")),
                        format!("── {} ({}) ──", status, status_tasks.len())
                    )
                    .enabled(false)
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                    menu_builder = menu_builder.item(&status_header);
                    
                    // Add tasks for this status (limit 5 per status, 15 total)
                    for &(original_index, task) in status_tasks.iter().take(5) {
                        if task_count >= 15 { break; }
                        
                        let task_text = format!("  {} - {}", task.key, 
                            if task.summary.len() > 35 { 
                                format!("{}...", &task.summary[..32]) 
                            } else { 
                                task.summary.clone() 
                            });
                        
                        let task_item = MenuItemBuilder::with_id(format!("task_{}", original_index), task_text)
                            .build(&app)
                            .map_err(|e| e.to_string())?;
                        menu_builder = menu_builder.item(&task_item);
                        
                        task_count += 1;
                    }
                    
                    if task_count >= 15 { break; }
                }
            }
            
            // Show if there are more tasks
            if tasks.len() > task_count {
                let more_tasks = MenuItemBuilder::with_id("more_tasks", 
                    format!("... and {} more tasks", tasks.len() - task_count))
                    .enabled(false)
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                menu_builder = menu_builder.item(&more_tasks);
            }
        }
        
        // Add separator
        menu_builder = menu_builder.separator();
        
        // Add refresh option
        let refresh = MenuItemBuilder::with_id("refresh", "↻ Refresh")
            .build(&app)
            .map_err(|e| e.to_string())?;
        menu_builder = menu_builder.item(&refresh);
        
        // Add show window option
        let show = MenuItemBuilder::with_id("show", "⚙️ Settings")
            .build(&app)
            .map_err(|e| e.to_string())?;
        menu_builder = menu_builder.item(&show);
        
        // Add separator before quit
        menu_builder = menu_builder.separator();
        
        // Add quit option
        let quit = MenuItemBuilder::with_id("quit", "Quit")
            .build(&app)
            .map_err(|e| e.to_string())?;
        menu_builder = menu_builder.item(&quit);
        
        let menu = menu_builder.build()
            .map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu))
            .map_err(|e| e.to_string())?;
        
        // Update tray tooltip
        tray.set_tooltip(Some(&format!("{} tasks", tasks.len())))
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
fn set_hide_on_blur(state: State<WindowState>, hide: bool) -> Result<(), String> {
    let mut hide_on_blur = state.hide_on_blur.lock().map_err(|e| e.to_string())?;
    *hide_on_blur = hide;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(WindowState {
            hide_on_blur: Arc::new(Mutex::new(true)),
        })
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            load_credentials,
            clear_credentials,
            test_connection,
            fetch_tasks,
            get_task_transitions,
            transition_task,
            set_hide_on_blur,
            update_menu_with_tasks
        ])
        .setup(|app| {
            let show = MenuItemBuilder::with_id("show", "Show")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit")
                .build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &quit])
                .build()?;
            
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let event_id = event.id().as_ref();
                    match event_id {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "refresh" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval("window.refreshTasks && window.refreshTasks()");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        id if id.starts_with("task_") => {
                            // Open task in browser
                            if let Some(window) = app.get_webview_window("main") {
                                let task_index = id.strip_prefix("task_").unwrap_or("0");
                                let _ = window.eval(&format!("window.openTaskByIndex && window.openTaskByIndex({})", task_index));
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            
            println!("Tray icon created successfully");
            
            let window = app.get_webview_window("main").unwrap();
            
            // Start with window hidden
            let _ = window.hide();
            
            // Hide the window when it loses focus
            let window_clone = window.clone();
            let hide_on_blur = app.state::<WindowState>().hide_on_blur.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    if let Ok(hide) = hide_on_blur.lock() {
                        if *hide {
                            let _ = window_clone.hide();
                        }
                    }
                }
            });
            
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}