"""Environment loader with clean .env file handling."""

import os
from pathlib import Path


def load_env(env_path: str | Path = ".env") -> dict[str, str | None]:
    """
    Load environment variables from a .env file.
    
    Args:
        env_path: Path to the .env file (default: ".env")
        
    Returns:
        Dictionary of environment variable names to values
    """
    path = Path(env_path)
    if not path.exists():
        return {}
    
    # Handle empty file edge case
    if path.stat().st_size == 0:
        return {}
    
    # Read binary to preserve exact line endings
    content = path.read_bytes()
    
    # Decode to text
    text = content.decode("utf-8")
    
    # Split lines, preserving line endings for reconstruction if needed
    lines = text.splitlines(keepends=True)
    
    env_vars: dict[str, str | None] = {}
    
    for line in lines:
        # Strip only the line ending (not leading/trailing whitespace on the line itself)
        stripped = line.rstrip("\r\n")
        
        # Skip empty lines and comments
        if not stripped or stripped.startswith("#"):
            continue
        
        # Parse KEY=VALUE
        if "=" in stripped:
            key, _, value = stripped.partition("=")
            env_vars[key.strip()] = value if value else None
    
    return env_vars


def set_env_from_file(env_path: str | Path = ".env") -> dict[str, str | None]:
    """
    Load .env file and set variables in os.environ.
    
    Args:
        env_path: Path to the .env file (default: ".env")
        
    Returns:
        Dictionary of loaded environment variables
    """
    env_vars = load_env(env_path)
    
    # Set in os.environ (only non-None values)
    for key, value in env_vars.items():
        if value is not None:
            os.environ[key] = value
    
    return env_vars


def save_env(env_vars: dict[str, str | None], env_path: str | Path = ".env") -> None:
    """
    Save environment variables to a .env file atomically.
    
    Args:
        env_vars: Dictionary of environment variable names to values
        env_path: Path to the .env file (default: ".env")
    """
    path = Path(env_path)
    
    # Build content
    lines: list[str] = []
    for key, value in env_vars.items():
        if value is None:
            lines.append(f"{key}=")
        else:
            # Escape values that might break parsing
            if "=" in value or " " in value or "#" in value:
                value = f'"{value}"'
            lines.append(f"{key}={value}")
    
    # Preserve trailing newline only if original file had one
    content = "\n".join(lines)
    if path.exists():
        original = path.read_bytes()
        if original and not original.endswith(b"\n"):
            content = content.rstrip("\n")
    
    # Atomic write: temp file → rename
    temp_path = path.with_suffix(".env.tmp")
    temp_path.write_text(content, encoding="utf-8")
    temp_path.rename(path)
