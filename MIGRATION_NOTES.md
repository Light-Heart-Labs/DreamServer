# Migration Notes

## Container Non-Root User Changes (PR #295)

### Breaking Change: Volume Ownership

Services now run as non-root users (UID 1000). Existing deployments with root-owned volume directories will encounter permission errors.

### Affected Services

- **token-spy**: Volume mount `./data/token-spy:/app/data`
- **dashboard**: Volume mount for nginx directories

### Migration Steps

For existing installations, run these commands before updating:

```bash
# Fix token-spy data directory ownership
sudo chown -R 1000:1000 ~/dream-server/data/token-spy

# Fix dashboard data directory ownership (if applicable)
sudo chown -R 1000:1000 ~/dream-server/data/dashboard
```

### Automated Migration

The installer will automatically fix permissions during updates. Manual intervention is only needed if you encounter permission errors after updating.

### Verification

After updating, verify containers are running:

```bash
cd ~/dream-server
docker-compose ps

# Check container UIDs
docker exec dream-server-token-spy id -u  # Should return 1000
docker exec dream-server-dashboard id -u   # Should return 1000
```

If you see permission errors in logs:

```bash
# View logs
docker-compose logs token-spy
docker-compose logs dashboard

# Fix permissions manually
sudo chown -R 1000:1000 ~/dream-server/data
```
