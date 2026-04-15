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
                if curl -fsSL --max-time 300 https://deb.nodesource.com/setup_22.x -o "$tmpfile" 2>/dev/null; then
                    sudo -E bash "$tmpfile" 2>&1 | tee -a "$LOG_FILE" || true
                fi
                rm -f "$tmpfile"
                sudo apt-get install -y nodejs 2>&1 | tee -a "$LOG_FILE" || true
                ;;
            dnf)
                sudo dnf module install -y nodejs:22 2>&1 | tee -a "$LOG_FILE" || \
                    sudo dnf install -y nodejs 2>&1 | tee -a "$LOG_FILE" || true
                ;;
            pacman)
                sudo pacman -S --noconfirm --needed nodejs npm 2>&1 | tee -a "$LOG_FILE" || true
                ;;
            zypper)
                sudo zypper --non-interactive install nodejs22 2>&1 | tee -a "$LOG_FILE" || \
                    sudo zypper --non-interactive install nodejs 2>&1 | tee -a "$LOG_FILE" || true
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
            npm config set prefix "$NPM_GLOBAL_DIR" 2>/dev/null || true
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
        if curl -fsSL --max-time 300 https://opencode.ai/install -o "$tmpfile" 2>/dev/null && bash "$tmpfile" >> "$LOG_FILE" 2>&1; then
            ai_ok "OpenCode installed (~/.opencode/bin/opencode)"
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
        # Read OLLAMA_PORT and DREAM_MODE from .env generated in phase 06
        if [[ -f "$INSTALL_DIR/.env" ]]; then
            [[ -z "${OLLAMA_PORT:-}" ]] && OLLAMA_PORT=$(grep -m1 '^OLLAMA_PORT=' "$INSTALL_DIR/.env" | cut -d= -f2-)
            # Always re-read DREAM_MODE from .env — Phase 06 may have changed it
            # (e.g. "local" → "lemonade" for AMD) but the shell variable is stale.
            DREAM_MODE=$(grep -m1 '^DREAM_MODE=' "$INSTALL_DIR/.env" | cut -d= -f2-)
            [[ -z "${LITELLM_KEY:-}" ]] && LITELLM_KEY=$(grep -m1 '^LITELLM_KEY=' "$INSTALL_DIR/.env" | cut -d= -f2-)
        fi
        # Route through LiteLLM on AMD/Lemonade, direct to llama-server otherwise
        if [[ "${DREAM_MODE:-local}" == "lemonade" ]]; then
            _opencode_url="http://127.0.0.1:4000/v1"
            _opencode_key="no-key"  # LiteLLM auth removed for local-only installs
        else
            _opencode_url="http://127.0.0.1:${OLLAMA_PORT:-8080}/v1"
            _opencode_key="no-key"
        fi

        # Writes a fresh opencode.json from the template. Used for first-install
        # and as deterministic recovery when the jq rewrite path finds an
        # existing malformed file it cannot parse (issue #332).
        _opencode_write_fresh() {
            cat > "$1" <<OPENCODE_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "llama-server/${LLM_MODEL}",
  "small_model": "llama-server/${LLM_MODEL}",
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "${_opencode_url}",
        "apiKey": "${_opencode_key}"
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
        }

        if [[ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ]]; then
            _opencode_write_fresh "$OPENCODE_CONFIG_DIR/opencode.json"
            ai_ok "OpenCode configured for local llama-server (model: ${LLM_MODEL})"
        else
            # Reinstall: update API key and URL in existing config (key may have changed)
            _opencode_updated=false
            if command -v jq >/dev/null 2>&1; then
                _opencode_tmp="$OPENCODE_CONFIG_DIR/opencode.json.tmp.$$"
                if jq --arg url "$_opencode_url" --arg key "$_opencode_key" \
                    '.provider["llama-server"].options.baseURL = $url
                     | .provider["llama-server"].options.apiKey = $key' \
                    "$OPENCODE_CONFIG_DIR/opencode.json" > "$_opencode_tmp" 2>/dev/null; then
                    mv "$_opencode_tmp" "$OPENCODE_CONFIG_DIR/opencode.json"
                    ai_ok "OpenCode config updated (API key and URL refreshed)"
                    _opencode_updated=true
                else
                    rm -f "$_opencode_tmp"
                    ai_warn "OpenCode config jq rewrite failed (existing file unparseable) — regenerating from template"
                fi
            else
                # Fallback without jq: narrow sed that only matches the quoted value,
                # preserving any trailing comma on the line
                _sed_i "s|\"apiKey\": *\"[^\"]*\"|\"apiKey\": \"${_opencode_key}\"|" "$OPENCODE_CONFIG_DIR/opencode.json"
                _sed_i "s|\"baseURL\": *\"[^\"]*\"|\"baseURL\": \"${_opencode_url}\"|" "$OPENCODE_CONFIG_DIR/opencode.json"
                ai_ok "OpenCode config updated (API key and URL refreshed)"
                _opencode_updated=true
            fi
            # Recovery path (issue #332): if the update branch above failed to
            # produce a valid file (jq parse error on pre-existing corruption),
            # regenerate deterministically from the template.
            if [[ "$_opencode_updated" != "true" ]]; then
                _opencode_write_fresh "$OPENCODE_CONFIG_DIR/opencode.json"
                ai_ok "OpenCode config regenerated from template (recovered from corruption)"
            fi
        fi
        # OpenCode reads config.json, not opencode.json — always sync
        cp "$OPENCODE_CONFIG_DIR/opencode.json" "$OPENCODE_CONFIG_DIR/config.json"

        # Install OpenCode Web UI as user-level systemd service (no sudo required)
        if [[ -f "$INSTALL_DIR/opencode/opencode-web.service" ]]; then
            SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
            mkdir -p "$SYSTEMD_USER_DIR"

            svc_tmp="/tmp/opencode-web.service.$$"
            cp "$INSTALL_DIR/opencode/opencode-web.service" "$svc_tmp"
            # Escape sed special chars to prevent injection from path values
            _home_esc=$(printf '%s\n' "$HOME" | sed 's/[&/\]/\\&/g')
            _sed_i "s|__HOME__|${_home_esc}|g" "$svc_tmp"
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

# ── Dream Host Agent (extension lifecycle management) ──
if [[ -f "$INSTALL_DIR/bin/dream-host-agent.py" ]]; then
    AGENT_PYTHON="$(command -v python3)"
    if [[ -n "$AGENT_PYTHON" ]]; then
        if systemctl --user status >/dev/null 2>&1; then
            # systemd path
            SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
            mkdir -p "$SYSTEMD_USER_DIR"
            if [[ -f "$INSTALL_DIR/scripts/systemd/dream-host-agent.service" ]]; then
                svc_tmp="/tmp/dream-host-agent.service.$$"
                cp "$INSTALL_DIR/scripts/systemd/dream-host-agent.service" "$svc_tmp"
                # Substitute placeholders — use sed directly with | delimiter
                # (paths contain / but never |, so | is a safe delimiter)
                sed -i "s|__INSTALL_DIR__|${INSTALL_DIR}|g" "$svc_tmp" 2>/dev/null || \
                    sed -i '' "s|__INSTALL_DIR__|${INSTALL_DIR}|g" "$svc_tmp"
                sed -i "s|__HOME__|${HOME}|g" "$svc_tmp" 2>/dev/null || \
                    sed -i '' "s|__HOME__|${HOME}|g" "$svc_tmp"
                sed -i "s|__PYTHON3__|${AGENT_PYTHON}|g" "$svc_tmp" 2>/dev/null || \
                    sed -i '' "s|__PYTHON3__|${AGENT_PYTHON}|g" "$svc_tmp"
                # Verify placeholders were actually rendered
                if grep -q '__INSTALL_DIR__\|__HOME__\|__PYTHON3__' "$svc_tmp"; then
                    ai_warn "Host agent systemd unit has unrendered placeholders — check $svc_tmp"
                else
                    cp "$svc_tmp" "$SYSTEMD_USER_DIR/dream-host-agent.service"
                fi
                rm -f "$svc_tmp"
            fi
            systemctl --user daemon-reload 2>/dev/null || true
            systemctl --user enable --now dream-host-agent.service >> "$LOG_FILE" 2>&1 && \
                ai_ok "Dream host agent installed (systemd --user, port 7710)" || \
                ai_warn "Dream host agent service failed to start — run: dream agent start"
            # Force-restart so the running process matches the binary the installer
            # just rewrote. enable --now is a no-op when the unit was already active,
            # which would leave an old daemon holding a deleted inode and serving
            # stale code after a reinstall. See issue #334. Use is-enabled (not
            # is-active) so a temporarily-down daemon during a fresh install still
            # triggers the restart rather than skipping it.
            if systemctl --user is-enabled dream-host-agent.service >/dev/null 2>&1; then
                systemctl --user restart dream-host-agent.service >> "$LOG_FILE" 2>&1 && \
                    ai_ok "Dream host agent restarted (loaded new binary)" || \
                    ai_warn "Dream host agent restart failed (non-fatal) — run: systemctl --user restart dream-host-agent.service"
            fi
            loginctl enable-linger "$(whoami)" 2>/dev/null || \
                sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null || true
        else
            ai_warn "No systemd detected — dream host agent not auto-installed."
            ai_warn "  Start manually: dream agent start"
        fi
    else
        ai_warn "python3 not found — dream host agent not installed"
    fi
fi
