# Repository Agent Notes

## Release workflow

- For a Home Assistant app release, bump the version in `package.json`, `package-lock.json`, and `apps/home-assistant/config.yaml`, then add a short entry to `CHANGELOG.md`.
- Create and push an annotated `vX.Y.Z` tag. `.github/workflows/build.yml` validates the tag with typecheck, tests, and build, then publishes `ghcr.io/nut163/pi-home-agent:X.Y.Z` and `:latest` for `linux/amd64` and `linux/arm64`.
- Confirm the GitHub Actions run succeeds and both image tags are reachable before reporting the release complete.
- Do not commit generated `.playwright-cli/` logs or snapshots.
