use std::process::Command;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DockerStatus {
    pub installed: bool,
    pub running: bool,
    pub version: Option<String>,
    pub compose_installed: bool,
    pub compose_version: Option<String>,
}

/// Check if Docker is installed and running.
pub fn check() -> DockerStatus {
    let version = get_docker_version();
    let installed = version.is_some();
    let running = if installed { is_docker_running() } else { false };
    let compose_version = get_compose_version();
    let compose_installed = compose_version.is_some();

    DockerStatus { installed, running, version, compose_installed, compose_version }
}

fn get_docker_version() -> Option<String> {
    let out = Command::new("docker").args(["--version"]).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn is_docker_running() -> bool {
    Command::new("docker")
        .args(["info"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn get_compose_version() -> Option<String> {
    // Try "docker compose" (v2 plugin) first
    let out = Command::new("docker")
        .args(["compose", "version", "--short"])
        .output()
        .ok()?;

    if out.status.success() {
        return Some(String::from_utf8_lossy(&out.stdout).trim().to_string());
    }

    // Fallback: docker-compose (standalone v1)
    let out = Command::new("docker-compose")
        .args(["--version"])
        .output()
        .ok()?;

    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

/// Get the Docker Desktop download URL for the current platform.
pub fn download_url() -> &'static str {
    #[cfg(target_os = "windows")]
    { "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" }
    #[cfg(target_os = "macos")]
    {
        if cfg!(target_arch = "aarch64") {
            "https://desktop.docker.com/mac/main/arm64/Docker.dmg"
        } else {
            "https://desktop.docker.com/mac/main/amd64/Docker.dmg"
        }
    }
    #[cfg(target_os = "linux")]
    { "https://docs.docker.com/engine/install/" }
}

/// Attempt to install Docker. Returns Ok on success, Err with instructions on failure.
pub async fn install_docker() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        // Try the official convenience script
        let curl = Command::new("bash")
            .args(["-c", "curl -fsSL https://get.docker.com | sh"])
            .output()
            .map_err(|e| format!("Failed to run Docker install script: {}", e))?;

        if curl.status.success() {
            // Add current user to docker group
            let user = std::env::var("USER").unwrap_or_default();
            if !user.is_empty() {
                let _ = Command::new("sudo")
                    .args(["usermod", "-aG", "docker", &user])
                    .output();
            }
            Ok("Docker installed successfully. You may need to log out and back in for group changes.".into())
        } else {
            Err(format!(
                "Automatic install failed. Please install Docker manually:\n{}",
                download_url()
            ))
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Download and run Docker Desktop installer silently
        let url = download_url();
        let installer_path = std::env::temp_dir().join("DockerDesktopInstaller.exe");
        let dl = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing",
                    url,
                    installer_path.display()
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to download Docker Desktop: {}", e))?;

        if !dl.status.success() {
            return Err(format!(
                "Failed to download Docker Desktop. Please install manually:\n{}",
                url
            ));
        }

        let install = Command::new(installer_path)
            .args(["install", "--quiet", "--accept-license"])
            .output()
            .map_err(|e| format!("Failed to run Docker Desktop installer: {}", e))?;

        if install.status.success() {
            Ok("Docker Desktop installed. It may need a restart to complete setup.".into())
        } else {
            Err("Docker Desktop installation failed. Please install manually from docker.com".into())
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Try homebrew first, fall back to manual
        let brew = Command::new("brew")
            .args(["install", "--cask", "docker"])
            .output();

        if let Ok(out) = brew {
            if out.status.success() {
                return Ok("Docker Desktop installed via Homebrew. Please open it from Applications.".into());
            }
        }

        Err(format!(
            "Please download and install Docker Desktop manually:\n{}",
            download_url()
        ))
    }
}
