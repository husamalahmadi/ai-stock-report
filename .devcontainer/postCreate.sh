
set -e
# Install deps for both projects if they exist
if [ -f server/package.json ]; then (cd server && npm ci || npm install); fi
if [ -f web/package.json ]; then (cd web && npm ci || npm install); fi
echo "Post-create complete."
