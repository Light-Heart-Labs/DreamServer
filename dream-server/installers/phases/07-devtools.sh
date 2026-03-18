#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 07: Developer Tools
# ============================================================================
# Part of: installers/phases/
# Purpose: Install Claude Code, Codex CLI, and OpenCode
#
# Expects: DRY_RUN, INSTALL_DIR, LOG_FILE, LLM_MODEL, MAX_CONTEXT,
#           PKG_MANAGER,
#           ai(), ai_ok(), ai_warn(), log()
# Provides: (developer tools installed to ~/.npm-global)
#
# Modder notes:
#   Add new developer tools or change installation methods here.
# ============================================================================

dream_progress 42 "devtools" "Installing developer tools"
if $DRY_RUN; then
    log "[DRY RUN] Would install AI developer tools (Claude Code, Codex CLI, OpenCode)"
    log "[DRY RUN] Would configure OpenCode for local llama-server (user-level systemd service on port 3003)"
else
    ai "Installing AI developer tools..."

    # Ensure Node.js/npm is available (needed for Claude Code and Codex)
    if ! command -v npm &> /dev/null; then
        ai "Installing Node.js..."
        case "$PKG_MANAGER" in
            apt)
                tmpfile=$(mktemp /tmp/nodesource-setup.XXXXXX.sh)
                curl_node_exit=0
                curl -fsSL --max-time 300 https://deb.nodesource.com/setup_22.x -o "$tmpfile" 2>/dev/null || curl_node_exit=$?
                if [[ $curl_node_exit -eq 0 ]]; then
                    bash_node_exit=0
                    sudo -E bash "$tmpfile" 2>&1 | tee -a "$LOG_FILE" || bash_node_exit=$?
                    [[ $bash_node_exit -ne 0 ]] && log "NodeSource setup failed (exit $bash_node_exit)"
                fi
                rm -f "$tmpfile"
                apt_node_exit=0
                sudo apt-get install -y nodejs 2>&1 | tee -a "$LOG_FILE" || apt_node_exit=$?
                [[ $apt_node_exit -ne 0 ]] && log "apt install nodejs failed (exit $apt_node_exit)"
                ;;
            dnf)
                dnf_node_exit=0
                sudo dnf module install -y nodejs:22 2>&1 | tee -a "$LOG_FILE" || dnf_node_exit=$?
                if [[ $dnf_node_exit -ne 0 ]]; then
                    dnf_fallback_exit=0
                    sudo dnf install -y nodejs 2>&1 | tee -a "$LOG_FILE" || dnf_fallback_exit=$?
                    [[ $dnf_fallback_exit -ne 0 ]] && log "dnf install nodejs failed (exit $dnf_fallback_exit)"
                fi
                ;;
            pacman)
                pacman_node_exit=0
                sudo pacman -S --noconfirm --needed nodejs npm 2>&1 | tee -a "$LOG_FILE" || pacman_node_exit=$?
                [[ $pacman_node_exit -ne 0 ]] && log "pacman install nodejs failed (exit $pacman_node_exit)"
                ;;
            zypper)
                zypper_node_exit=0
                sudo zypper --non-interactive install nodejs22 2>&1 | tee -a "$LOG_FILE" || zypper_node_exit=$?
                if [[ $zypper_node_exit -ne 0 ]]; then
                    zypper_fallback_exit=0
                    sudo zypper --non-interactive install nodejs 2>&1 | tee -a "$LOG_FILE" || zypper_fallback_exit=$?
                    [[ $zypper_fallback_exit -ne 0 ]] && log "zypper install nodejs failed (exit $zypper_fallback_exit)"
                fi
                ;;
            *)
                ai_warn "Unknown package manager — cannot install Node.js automatically"
                ;;
        esac
    fi

    if command -v npm &> /dev/null; then
        # Set up user-level npm global prefix (no sudo needed)
        NPM_GLOBAL_DIR="$HOME/.npm-global"
        if [[ ! -d "$NPM_GLOBAL_DIR" ]]; then
            mkdir -p "$NPM_GLOBAL_DIR"
            npm_config_exit=0
            npm config set prefix "$NPM_GLOBAL_DIR" 2>/dev/null || npm_config_exit=$?
            [[ $npm_config_exit -ne 0 ]] && log "npm config set prefix failed (exit $npm_config_exit)"
        fi
        # Ensure user-level bin is on PATH for this session
        export PATH="$NPM_GLOBAL_DIR/bin:$PATH"

        # Install Claude Code (Anthropic's CLI for Claude)
        if ! command -v claude &> /dev/null; then
            npm install -g @anthropic-ai/claude-code >> "$LOG_FILE" 2>&1 && \
                ai_ok "Claude Code installed (run 'claude' to start)" || \
                ai_warn "Claude Code install failed — install later with: npm i -g @anthropic-ai/claude-code"
        else
            ai_ok "Claude Code already installed"
        fi

        # Install Codex CLI (OpenAI's terminal agent)
        if ! command -v codex &> /dev/null; then
            npm install -g @openai/codex >> "$LOG_FILE" 2>&1 && \
                ai_ok "Codex CLI installed (run 'codex' to start)" || \
                ai_warn "Codex CLI install failed — install later with: npm i -g @openai/codex"
        else
            ai_ok "Codex CLI already installed"
        fi

        # Ensure ~/.npm-global/bin is on PATH permanently
        if [[ -d "$NPM_GLOBAL_DIR/bin" ]] && ! grep -q 'npm-global' "$HOME/.bashrc" 2>/dev/null; then
            echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
            ai "Added ~/.npm-global/bin to PATH in ~/.bashrc"
        fi
    else
        ai_warn "npm not available — skipping Claude Code and Codex CLI install"
        ai "  Install later: npm i -g @anthropic-ai/claude-code @openai/codex"
    fi

    # ── OpenCode (local agentic coding platform) ──
    if ! command -v opencode &> /dev/null && [[ ! -x "$HOME/.opencode/bin/opencode" ]]; then
        ai "Installing OpenCode..."
        tmpfile=$(mktemp /tmp/opencode-install.XXXXXX.sh)
        curl_opencode_exit=0
        curl -fsSL --max-time 300 https://opencode.ai/install -o "$tmpfile" 2>/dev/null || curl_opencode_exit=$?
        if [[ $curl_opencode_exit -eq 0 ]]; then
            bash_opencode_exit=0
            bash "$tmpfile" >> "$LOG_FILE" 2>&1 || bash_opencode_exit=$?
            if [[ $bash_opencode_exit -eq 0 ]]; then
                ai_ok "OpenCode installed (~/.opencode/bin/opencode)"
            else
                ai_warn "OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash"
            fi
        else
            ai_warn "OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash"
        fi
        rm -f "$tmpfile"
    else
        ai_ok "OpenCode already installed"
    fi

    # Configure OpenCode to use local llama-server
    if [[ -x "$HOME/.opencode/bin/opencode" ]]; then
        OPENCODE_CONFIG_DIR="$HOME/.config/opencode"
        mkdir -p "$OPENCODE_CONFIG_DIR"
        if [[ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ]]; then
            # Read OLLAMA_PORT from the .env generated in phase 06
            # (it's not exported as a shell variable, only written to the file)
            if [[ -z "${OLLAMA_PORT:-}" && -f "$INSTALL_DIR/.env" ]]; then
                OLLAMA_PORT=$(grep -m1 '^OLLAMA_PORT=' "$INSTALL_DIR/.env" | cut -d= -f2-)
            fi
            cat > "$OPENCODE_CONFIG_DIR/opencode.json" <<OPENCODE_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "llama-server/${LLM_MODEL}",
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://127.0.0.1:${OLLAMA_PORT:-8080}/v1",
        "apiKey": "no-key"
      },
      "models": {
        "${LLM_MODEL}": {
          "name": "${LLM_MODEL}",
          "limit": {
            "context": ${MAX_CONTEXT:-131072},
            "output": 32768
          }
        }
      }
    }
  }
}
OPENCODE_EOF
            ai_ok "OpenCode configured for local llama-server (model: ${LLM_MODEL})"
        else
            ai_ok "OpenCode config already exists — skipping"
        fi

        # Install OpenCode Web UI as user-level systemd service (no sudo required)
        if [[ -f "$INSTALL_DIR/opencode/opencode-web.service" ]]; then
            SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
            mkdir -p "$SYSTEMD_USER_DIR"

            # Read OPENCODE_SERVER_PASSWORD from .env
            OPENCODE_SERVER_PASSWORD=""
            if [[ -f "$INSTALL_DIR/.env" ]]; then
                OPENCODE_SERVER_PASSWORD=$(grep -m1 '^OPENCODE_SERVER_PASSWORD=' "$INSTALL_DIR/.env" | cut -d= -f2-)
            fi

            svc_tmp="/tmp/opencode-web.service.$$"
            cp "$INSTALL_DIR/opencode/opencode-web.service" "$svc_tmp"
            # Escape sed special chars to prevent injection from path or password values
            _home_esc=$(printf '%s\n' "$HOME" | sed 's/[&/\]/\\&/g')
            _pass_esc=$(printf '%s\n' "${OPENCODE_SERVER_PASSWORD}" | sed 's/[&/\]/\\&/g')
            _sed_i "s|__HOME__|${_home_esc}|g" "$svc_tmp"
            _sed_i "s|__OPENCODE_SERVER_PASSWORD__|${_pass_esc}|g" "$svc_tmp"
            cp "$svc_tmp" "$SYSTEMD_USER_DIR/opencode-web.service"
            rm -f "$svc_tmp"

            systemctl_reload_exit=0
            systemctl --user daemon-reload 2>/dev/null || systemctl_reload_exit=$?
            [[ $systemctl_reload_exit -ne 0 ]] && log "systemctl --user daemon-reload failed (exit $systemctl_reload_exit)"

            systemctl_enable_exit=0
            systemctl --user enable --now opencode-web.service >> "$LOG_FILE" 2>&1 || systemctl_enable_exit=$?
            if [[ $systemctl_enable_exit -eq 0 ]]; then
                ai_ok "OpenCode Web UI service installed (user-level, port 3003)"
            else
                ai_warn "OpenCode Web UI service failed to start"
            fi

            # Enable lingering so service survives logout
            linger_exit=0
            loginctl enable-linger "$(whoami)" 2>/dev/null || linger_exit=$?
            if [[ $linger_exit -ne 0 ]]; then
                sudo_linger_exit=0
                sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null || sudo_linger_exit=$?
                if [[ $sudo_linger_exit -ne 0 ]]; then
                    ai_warn "Could not enable linger. OpenCode may stop after logout. Run: loginctl enable-linger $(whoami)"
                fi
            fi
        fi
    fi
fi
