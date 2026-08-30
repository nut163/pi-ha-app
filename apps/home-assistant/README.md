# Pi Home Agent Home Assistant App

This directory contains the Supervisor-facing App manifest. The release image
is built from the repository root with `Dockerfile`; Home Assistant installs it
through Ingress on port `8099`.

For a local image build:

```bash
docker build -f Dockerfile -t pi-home-agent:dev .
```

The published image name in `config.yaml` follows the repository namespace
(`ghcr.io/troydev/pi-home-agent`). Change both values if this repository is
forked or renamed. The image tag must match the App `version`.

The App requests only the Home Assistant configuration mapping plus the Core and
Supervisor APIs. It does not use host networking or arbitrary host mounts.
