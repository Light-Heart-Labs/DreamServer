# GUI Progress Protocol Integration Guide

## Overview

The Tauri installer GUI communicates with the existing bash installer via a
simple line protocol. When the environment variable `DREAM_INSTALLER_GUI=1` is
set, each phase emits structured progress lines that the GUI parses to update
the progress bar.

## Setup

1. Copy `progress-protocol.sh` to `dream-server/installers/lib/progress.sh`
2. Add `source "${LIB_DIR}/progress.sh"` to `install-core.sh` (after the other
   lib sources)
3. Add one `dream_progress` call at the start of each phase:

## Phase Integration

Add these lines at the **top** of each phase file (after the header comment):

```bash
# 01-preflight.sh
dream_progress 5 "preflight" "Running preflight checks"

# 02-detection.sh
dream_progress 12 "detection" "Detecting GPU hardware"

# 03-features.sh
dream_progress 18 "features" "Selecting features"

# 04-requirements.sh
dream_progress 25 "requirements" "Installing system dependencies"

# 05-docker.sh
dream_progress 30 "docker" "Setting up Docker"

# 06-directories.sh
dream_progress 38 "directories" "Preparing installation directory"

# 07-devtools.sh
dream_progress 42 "devtools" "Installing development tools"

# 08-images.sh
dream_progress 48 "images" "Downloading container images"
# Also add inside the image pull loop:
#   dream_progress $((48 + pull_index * 3)) "images" "Pulling ${image_name}"

# 09-offline.sh
dream_progress 65 "offline" "Configuring offline mode"

# 10-amd-tuning.sh
dream_progress 70 "amd-tuning" "Tuning AMD GPU settings"

# 11-services.sh
dream_progress 75 "services" "Starting services"

# 12-health.sh
dream_progress 85 "health" "Checking service health"

# 13-summary.sh
dream_progress 98 "summary" "Finishing up"
```

## Protocol Format

```
DREAM_PROGRESS:<percent>:<phase_id>:<human_message>
```

- `percent`: 0-100 integer
- `phase_id`: kebab-case identifier matching the phase filename
- `human_message`: display text for the GUI

## Notes

- The `dream_progress` function is a no-op when `DREAM_INSTALLER_GUI` is unset,
  so it has zero impact on terminal installs.
- The Tauri installer sets `DREAM_INSTALLER_GUI=1` via the process environment
  before spawning `install.sh`.
- The GUI also has fallback heuristic parsing that looks for keywords like
  "pulling", "starting services", "health check" etc. in stdout, so even
  without these lines the progress bar will roughly work.
