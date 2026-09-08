# Supply-chain gate (G-508)

Nightly / manual workflow: `.github/workflows/supply-chain.yml`

| Check               | Behaviour                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm audit --prod` | Fails on high/critical (advisory gate)                                         |
| CycloneDX SBOM stub | Writes `sbom.cdx.json` artifact (node inventory)                               |
| Cosign stub         | Records image digest placeholder + verifies cosign CLI presence when available |

Honest residual: production image signing requires registry credentials and a
release pipeline that pushes digests — this job proves the gate wiring.
