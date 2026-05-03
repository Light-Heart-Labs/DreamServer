# Third-party provenance

Dream Server DESKTOP keeps its DreamServer integration code in this extension and fetches the upstream Hermes Agent source during the Docker image build.

## Hermes Agent

- Repository: https://github.com/NousResearch/hermes-agent
- Pinned commit: `5d3be898a8671eb9fb99cf18f43165502f54e7f4`
- Package metadata: `hermes-agent`, MIT license
- Build location: `/opt/hermes-agent-src`

The Dockerfile exposes `HERMES_AGENT_REPO` and `HERMES_AGENT_REF` build args so maintainers can audit or update the upstream pin without committing the full upstream source tree to DreamServer.
