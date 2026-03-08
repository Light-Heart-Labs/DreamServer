# ============================================================================
# DreamServer Homebrew Formula
# ============================================================================
# Install: brew install light-heart-labs/tap/dreamserver
#
# This formula:
#   1. Installs Docker Desktop (as a cask dependency) if not present
#   2. Downloads the DreamServer bootstrap script
#   3. Creates a `dreamserver` command that runs the installer/manager
#
# To publish this formula:
#   1. Create repo: github.com/Light-Heart-Labs/homebrew-tap
#   2. Copy this file to: Formula/dreamserver.rb
#   3. Users can then: brew tap light-heart-labs/tap && brew install dreamserver
#
# The formula pulls fresh installer code on every `dreamserver install` run,
# so it never needs updating for backend changes.
# ============================================================================

class Dreamserver < Formula
  desc "One command to a full local AI stack - LLM, chat, voice, agents, workflows, RAG, and image generation"
  homepage "https://github.com/Light-Heart-Labs/DreamServer"
  url "https://github.com/Light-Heart-Labs/DreamServer/archive/refs/heads/main.tar.gz"
  version "2.0.0"
  license "Apache-2.0"

  # Docker Desktop is required
  depends_on cask: "docker"
  depends_on "git"
  depends_on "curl"

  def install
    # Install the bootstrap script as offline fallback
    libexec.install "dream-server/get-dream-server.sh"

    # Create the main command wrapper
    (bin/"dreamserver").write <<~EOS
      #!/bin/bash
      # DreamServer CLI wrapper (installed via Homebrew)
      set -euo pipefail

      INSTALL_DIR="$HOME/dream-server"
      BOOTSTRAP_URL="https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/main/dream-server/get-dream-server.sh"
      LOCAL_BOOTSTRAP="#{libexec}/get-dream-server.sh"

      case "${1:-}" in
        install|setup)
          echo "Installing DreamServer..."
          # Try fresh download first, fall back to bundled copy
          if curl -fsSL "$BOOTSTRAP_URL" | bash; then
            :
          elif [ -f "$LOCAL_BOOTSTRAP" ]; then
            echo "Network unavailable, using bundled installer..."
            bash "$LOCAL_BOOTSTRAP"
          else
            echo "Error: Cannot download installer and no local copy found."
            exit 1
          fi
          ;;
        start)
          if [ -d "$INSTALL_DIR" ]; then
            cd "$INSTALL_DIR" && ./dream-cli start
          else
            echo "DreamServer not installed. Run: dreamserver install"
            exit 1
          fi
          ;;
        stop)
          if [ -d "$INSTALL_DIR" ]; then
            cd "$INSTALL_DIR" && ./dream-cli stop
          else
            echo "DreamServer not installed."
            exit 1
          fi
          ;;
        status)
          if [ -d "$INSTALL_DIR" ]; then
            cd "$INSTALL_DIR" && ./dream-cli status
          else
            echo "DreamServer not installed. Run: dreamserver install"
            exit 1
          fi
          ;;
        update)
          if [ -d "$INSTALL_DIR" ]; then
            cd "$INSTALL_DIR" && ./dream-update.sh update
          else
            echo "DreamServer not installed. Run: dreamserver install"
            exit 1
          fi
          ;;
        uninstall)
          echo "This will remove DreamServer and all its data from $INSTALL_DIR"
          read -r -p "Are you sure? [y/N] " confirm
          if [[ "$confirm" =~ ^[Yy]$ ]]; then
            if [ -d "$INSTALL_DIR" ]; then
              cd "$INSTALL_DIR" && docker compose down 2>/dev/null || true
            fi
            rm -rf "$INSTALL_DIR"
            echo "DreamServer removed."
          fi
          ;;
        open)
          open "http://localhost:3000" 2>/dev/null || echo "Open http://localhost:3000 in your browser"
          ;;
        *)
          if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/dream-cli" ]; then
            cd "$INSTALL_DIR" && ./dream-cli "$@"
          else
            echo "DreamServer - Local AI for Everyone"
            echo ""
            echo "Usage:"
            echo "  dreamserver install    Install DreamServer (downloads latest)"
            echo "  dreamserver start      Start all services"
            echo "  dreamserver stop       Stop all services"
            echo "  dreamserver status     Show service status"
            echo "  dreamserver update     Update to latest version"
            echo "  dreamserver open       Open web UI in browser"
            echo "  dreamserver uninstall  Remove DreamServer"
            echo ""
            echo "After install, all dream-cli commands are available:"
            echo "  dreamserver logs, dreamserver enable, dreamserver mode, etc."
          fi
          ;;
      esac
    EOS
  end

  def caveats
    <<~EOS
      DreamServer requires Docker Desktop to be running.

      To install DreamServer:
        dreamserver install

      This will detect your hardware, download the right AI models,
      and start all services. Open http://localhost:3000 when done.

      To manage DreamServer:
        dreamserver start     Start services
        dreamserver stop      Stop services
        dreamserver status    Check status
        dreamserver open      Open web UI
    EOS
  end

  test do
    assert_match "DreamServer", shell_output("#{bin}/dreamserver 2>&1")
  end
end
