$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
node (Join-Path $RootDir "apps/cloud-agent-tui/src/main.mjs") @args
