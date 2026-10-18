# Approved base images for the Docker container runner

This directory holds the trusted base-image registry that the EO-4.5
`DockerContainerRunner` (ADR-0034, R3/R5/R10) consults when it evaluates a
`ContainerRequest`. The registry is **public** — nothing in it is a secret
— but every entry is **load-bearing** security policy: an image listed
here can run on operator machines with workspace mounts.

## Format

`images.json` is the exact shape the `ContainerPolicy` contract expects:

```json
{
  "approvedImages": [
    {
      "name": "node",
      "versions": ["22"],
      "digest": "sha256:…64hex…"
    }
  ],
  "requireDigest": true
}
```

A deployment reads it into `AIW_CONTAINER_POLICY_JSON` (one env var,
unchanged schema). The runner re-evaluates the policy on every call.

## Approval process

1. **Discover.** Pick the smallest, most upstream image that covers the
   build/test need. Prefer official vendor images from a trusted
   registry (Docker Hub official, Google Distroless, GitHub-hosted).
2. **Approve.** Run the helper:
   ```bash
   node scripts/approve-image.mjs node:22 --scan --severity HIGH
   ```
   This pulls the image, extracts its content-addressable digest and (with
   `--scan`) runs Trivy. The script fails CLOSED on an unreachable
   daemon, a missing digest, or a Trivy finding at or above `--severity`.
3. **Review.** The emitted JSON entry is appended to `images.json`. A
   human reviewer confirms: license acceptable, source upstream trusted,
   digest matches the output of a reproducible pull.
4. **Promote.** Paste the resulting `images.json` into the deployment's
   `AIW_CONTAINER_POLICY_JSON` env var. The runner now accepts
   `node:22@sha256:…`; everything else is refused.
5. **Rotate.** Image rotation is the inverse: approve a new digest, bump
   the version, deploy the new policy. Never edit a digest in place.

## Non-goals

- The script never pushes images to a registry; your organisation's
  publication process stays separate.
- There is no automatic sync between this file and
  `AIW_CONTAINER_POLICY_JSON`; promotion is a conscious act.
- Image registry authentication is out of scope — scanning a pulled
  image works whether the registry was public or not.

## Why digest-pinning is non-negotiable

A tag (`node:22`) can move. A digest (`sha256:…`) cannot. The container
runner forces the digest form (`<name>:<version>@<digest>`) in the
`docker run` argv it composes; without a pinned digest the image is
rejected (`CONTAINER_POLICY_DENIED`).
