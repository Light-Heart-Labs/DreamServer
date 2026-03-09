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
# Provides: (developer tools installed globally)
#
# Modder notes:
#   Add new developer tools or change installation methods here.
# ============================================================================

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
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >> "$LOG_FILE" 2>&1 || true
                sudo apt-get install -y nodejs >> "$LOG_FILE" 2>&1 || true
                ;;
            dnf)
                sudo dnf module install -y nodejs:22 >> "$LOG_FILE" 2>&1 || \
                    sudo dnf install -y nodejs >> "$LOG_FILE" 2>&1 || true
                ;;
            pacman)
                sudo pacman -S --noconfirm --needed nodejs npm >> "$LOG_FILE" 2>&1 || true
                ;;
            zypper)
                sudo zypper --non-interactive install nodejs22 >> "$LOG_FILE" 2>&1 || \
                    sudo zypper --non-interactive install nodejs >> "$LOG_FILE" 2>&1 || true
                ;;
            *)
                ai_warn "Unknown package manager — cannot install Node.js automatically"
                ;;
        esac
    fi

    if command -v npm &> /dev/null; then
        # Install Claude Code (Anthropic's CLI for Claude)
        if ! command -v claude &> /dev/null; then
            sudo npm install -g @anthropic-ai/claude-code >> "$LOG_FILE" 2>&1 && \
                ai_ok "Claude Code installed (run 'claude' to start)" || \
                ai_warn "Claude Code install failed — install later with: npm i -g @anthropic-ai/claude-code"
        else
            ai_ok "Claude Code already installed"
        fi

        # Install Codex CLI (OpenAI's terminal agent)
        if ! command -v codex &> /dev/null; then
            sudo npm install -g @openai/codex >> "$LOG_FILE" 2>&1 && \
                ai_ok "Codex CLI installed (run 'codex' to start)" || \
                ai_warn "Codex CLI install failed — install later with: npm i -g @openai/codex"
        else
            ai_ok "Codex CLI already installed"
        fi
    else
        ai_warn "npm not available — skipping Claude Code and Codex CLI install"
        ai "  Install later: npm i -g @anthropic-ai/claude-code @openai/codex"
    fi

    # ── OpenCode (local agentic coding platform) ──
    if ! command -v opencode &> /dev/null && [[ ! -x "$HOME/.opencode/bin/opencode" ]]; then
        ai "Installing OpenCode..."
        if curl -fsSL https://opencode.ai/install 2>/dev/null | bash >> "$LOG_FILE" 2>&1; then
            ai_ok "OpenCode installed (~/.opencode/bin/opencode)"
        else
            ai_warn "OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash"
        fi
    else
        ai_ok "OpenCode already installed"
    fi

    # Configure OpenCode to use local llama-server
    if [[ -x "$HOME/.opencode/bin/opencode" ]]; then
        OPENCODE_CONFIG_DIR="$HOME/.config/opencode"
        mkdir -p "$OPENCODE_CONFIG_DIR"
        if [[ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ]]; then
            cat > "$OPENCODE_CONFIG_DIR/opencode.json" <<OPENCODE_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "llama-server/${LLM_MODEL}",
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://127.0.0.1:${OLLAMA_PORT:-11434}/v1",
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
            sed -i "s|__HOME__|${_home_esc}|g" "$svc_tmp"
            sed -i "s|__OPENCODE_SERVER_PASSWORD__|${_pass_esc}|g" "$svc_tmp"
            cp "$svc_tmp" "$SYSTEMD_USER_DIR/opencode-web.service"
            rm -f "$svc_tmp"

            systemctl --user daemon-reload 2>/dev/null || true
            systemctl --user enable --now opencode-web.service >> "$LOG_FILE" 2>&1 && \
                ai_ok "OpenCode Web UI service installed (user-level, port 3003)" || \
                ai_warn "OpenCode Web UI service failed to start"

            # Enable lingering so service survives logout
            loginctl enable-linger "$(whoami)" 2>/dev/null || \
                sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null || \
                ai_warn "Could not enable linger. OpenCode may stop after logout. Run: loginctl enable-linger $(whoami)"
        fi
    fi
fi
