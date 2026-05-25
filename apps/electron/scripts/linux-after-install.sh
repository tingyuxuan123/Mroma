#!/bin/sh
set -e

# Electron 要求 sandbox helper 属于 root 且带 setuid 位。
# Debian 包无法稳定保留该权限，因此在包管理器以 root 身份安装后修复。
SANDBOX="/opt/Mroma/chrome-sandbox"

if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi

exit 0
