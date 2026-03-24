class AgentManager:
    """
    Manages the lifecycle of autonomous agents within DreamServer.
    Handles startup, heartbeat monitoring, and graceful shutdown.
    """
    def __init__(self):
        self.active_agents = {}

    def spawn_agent(self, agent_id, config):
        print(f"Spawning agent {agent_id} with config: {config}")
        # Logic to initialize agent process/container
        self.active_agents[agent_id] = {"status": "starting", "config": config}

    def stop_agent(self, agent_id):
        if agent_id in self.active_agents:
            print(f"Stopping agent {agent_id}...")
            self.active_agents[agent_id]["status"] = "stopped"
