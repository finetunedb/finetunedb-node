#!/usr/bin/env bash

set -exuo pipefail

(cd dist && pnpm publish --access public --no-git-checks)