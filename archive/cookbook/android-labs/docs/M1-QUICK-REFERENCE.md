# M1 Deployment Quick Reference

## Key Commands
- **Deploy Application:** `make deploy`
- **Build Docker Image:** `docker build -t my-app .`
- **Run Docker Container:** `docker run -d -p 8080:80 --name my-app-container my-app`
- **Stop Docker Container:** `docker stop my-app-container`
- **Remove Docker Container:** `docker rm my-app-container`
- **Pull Latest Image:** `docker pull my-app`
- **List Containers:** `docker ps`
- **List All Containers:** `docker ps -a`
- **List Images:** `docker images`
- **Remove Image:** `docker rmi my-app`
- **Prune Unused Data:** `docker system prune`
- **View Logs:** `docker logs my-app-container`
- **Attach to Container Shell:** `docker exec -it my-app-container /bin/bash`
- **Scale Services:** `docker-compose scale web=3`
- **Update Dependencies:** `pip install -r requirements.txt`
- **Run Tests:** `pytest`
- **Check Disk Usage:** `df -h`
- **Check Memory Usage:** `free -h`
- **Check Processes:** `top`
- **Install Package:** `sudo apt-get install <package>`
- **Update System:** `sudo apt-get update && sudo apt-get upgrade`
- **Restart Service:** `sudo systemctl restart <service>`
- **Enable Service:** `sudo systemctl enable <service>`
- **Disable Service:** `sudo systemctl disable <service>`
- **Check Service Status:** `sudo systemctl status <service>`
- **List Network Interfaces:** `ip a`
- **Check Routing Table:** `ip route`
- **Check Firewall Rules:** `sudo ufw status`
- **Enable Firewall:** `sudo ufw enable`
- **Allow Port:** `sudo ufw allow 80/tcp`
- **Reload Firewall Rules:** `sudo ufw reload`
- **View Logs with Journalctl:** `journalctl -u <service>`
- **View Logs with Tail:** `tail -f /var/log/<log-file>.log`

## Ports
- **Web Server:** 8080
- **Database:** 5432
- **SSH:** 22
- **Redis:** 6379
- **Admin Interface:** 8000

## Common Issues
- **Port Conflicts:** Check with `netstat -tuln | grep <port>` or `lsof -i :<port>`
- **Docker Space Issues:** Use `docker system prune -a` to clean up unused data
- **Network Errors:** Verify network interfaces with `ip a` and routing with `ip route`
- **Firewall Blocks:** Ensure necessary ports are allowed with `sudo ufw allow <port>`
- **Service Failures:** Check logs with `journalctl -u <service>` or `docker logs <container>`
- **Disk Space Full:** Check usage with `df -h` and remove unnecessary files
- **Memory Leaks:** Monitor with `top` or `htop`
- **Package Installation Errors:** Ensure dependencies are up-to-date with `sudo apt-get update`
- **Test Failures:** Debug with `pytest -v`
- **Configuration Errors:** Verify configuration files for typos or incorrect settings
- **Docker Compose Issues:** Ensure services are correctly defined in `docker-compose.yml`
- **SSL Certificates:** Use Let's Encrypt for free SSL certificates
- **Resource Limits:** Increase limits in `docker-compose.yml` if necessary
