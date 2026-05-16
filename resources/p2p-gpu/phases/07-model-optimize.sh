#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 07: Model Download Optimization
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Resume incomplete downloads with aria2c multi-threaded transfer,
#          start model swap watcher
#
# Expects: DS_DIR, log(), optimize_model_download()
# Provides: Background aria2c download + model swap watcher (if needed)
#
# Fixes covered: #11 (HuggingFace Xet throttle)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 7/12: Optimizing model downloads"

optimize_model_download "$DS_DIR"
