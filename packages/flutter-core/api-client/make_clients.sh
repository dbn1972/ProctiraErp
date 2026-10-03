#!/usr/bin/env bash
#
# PRC-M254: Dart API client code generation is NOT implemented.
#
# The clients under lib/src/api and models under lib/src/models are
# hand-written. Drift is caught instead by:
#   - test/api_contract_test.dart   (client calls == contract/client_routes.json)
#   - apps/api-gateway/src/dart-client-contract.test.ts
#                                   (contract routes are mounted on the gateway)
#
# This script fails loudly so no pipeline can mistake it for a successful
# regeneration step.
set -euo pipefail
echo "make_clients.sh: code generation is not implemented; clients are hand-written." >&2
echo "Update lib/src/api + contract/client_routes.json by hand and run 'dart test'." >&2
exit 1
