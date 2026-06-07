#!/usr/bin/env bash
#
# Regenerate the OpenEMIS Dart API client from the backend OpenAPI document.
#
# TODO(29.2): wire this up properly. The production toolchain should:
#   1. Boot the API gateway in a temp container and dump the aggregated
#      OpenAPI 3.0 schema (or read it from the build artifact).
#   2. Run `openapi-generator-cli generate -g dart-dio -i schema.json -o lib`.
#   3. Apply a custom mustache template that adds `If-Match` plumbing to
#      mutation operations (matches the conflict resolution contract).
#
# For now the models and clients under lib/ are hand-written so the mobile app
# can compile without the generator toolchain installed.
set -euo pipefail

echo "make_clients.sh: TODO — code generation not wired yet."
echo "Hand-written clients live under lib/src/api and lib/src/models."
echo "Skipping (success)."
